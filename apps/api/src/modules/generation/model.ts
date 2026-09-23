import {
  resolveMedia,
  assertMediaCurrent,
  recordMediaOrigin,
} from "./media-input.js";
import { resolvePrompt, assertPromptCurrent } from "./prompt-input.js";
import { safeText, resolveContext } from "./input-sources.js";
import {
  assertCanvasAssistanceAccess,
  resolveCanvasSources,
} from "./canvas-assistance.js";
import { discussionScope, resolveDiscussion } from "./discussion.js";
import { resolveCanvasReply } from "./canvas-replies.js";
import { estimateCost, findProfile, VerifiedProfileError } from "@drama/provider";
import { randomUUID } from "node:crypto";
import type { Transaction } from "../../kernel/database.js";
import { bindResourceProject } from "../../kernel/database.js";
import { canonical, digest } from "../../kernel/crypto.js";
import { Problem, requireThat, versionMatches } from "../../kernel/errors.js";
import type { Input } from "../../kernel/routes.js";
import { activeParent, contentTree, type Schema } from "../content/model.js";

export const zero = { currency: "CNY", amountMicros: "0" };
export const jobSelect = `SELECT j.*,p.input,p.connection_version_id,p.execution_mode,p.cost_estimate,p.resolved_input,b.provider_job_id FROM generation_jobs j JOIN generation_plans p ON p.id=j.plan_id LEFT JOIN generation_provider_bindings b ON b.job_id=j.id`;
export function planRecord(row: Record<string, any>): Schema<"GenerationPlan"> {
  return {
    id: row.id,
    revision: Number(row.revision),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    input: row.input,
    capabilityRevision: Number(row.capability_revision),
    inputHash: row.input_hash,
    expiresAt: row.expires_at.toISOString(),
    status:
      row.status === "ready" && row.expires_at.getTime() < Date.now()
        ? "expired"
        : row.status,
    blockingReasons: row.blocking_reasons,
    resolvedInput: row.resolved_input,
    connectionVersionId: row.connection_version_id,
    executionMode: row.execution_mode,
    ...(row.cost_estimate ? { costEstimate: row.cost_estimate } : {}),
  };
}
function jobRecord(
  row: Record<string, any>,
  inputOutdated: boolean,
): Schema<"GenerationJob"> {
  const terminal = ["succeeded", "failed", "cancelled"].includes(row.status),
    fixture = row.execution_mode === "test_fixture";
  return {
    id: row.id,
    revision: Number(row.revision),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    scope: "project",
    projectId: row.project_id,
    planId: row.plan_id,
    status: row.status,
    cancelStatus: row.cancel_status ?? "not_requested",
    ...(row.cancel_requested_at
      ? { cancelRequestedAt: row.cancel_requested_at.toISOString() }
      : {}),
    ...(row.provider_job_id ? { providerJobId: row.provider_job_id } : {}),
    mediaIds: row.result_media_id ? [row.result_media_id] : [],
    reservationStatus: terminal ? "released" : "held",
    inputOutdated,
    connectionVersionId: row.connection_version_id,
    costStatus: fixture
      ? "final"
      : row.execution_mode === "verified_provider"
        ? "pending"
        : "unavailable",
    confirmedCost: zero,
    reservationRemaining: row.cost_estimate?.totalReservation ?? zero,
    recoveryEpoch: Number(row.recovery_epoch),
    executionMode: row.execution_mode,
    ...(fixture ? { finalCost: zero } : {}),
    ...(row.proposal_id ? { proposalId: row.proposal_id } : {}),
    ...(row.assistance_artifact_id
      ? { assistanceArtifactId: row.assistance_artifact_id }
      : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
  };
}
export async function serializeJob(tx: Transaction, row: Record<string, any>) {
  await assertCanvasAssistanceAccess(tx, row.resolved_input);
  let outdated = false;
  try {
    await assertAnalysisCurrent(tx, row);
  } catch (error) {
    if (error instanceof Problem && [404, 409, 412, 422].includes(error.status))
      outdated = true;
    else throw error;
  }
  return jobRecord(row, outdated);
}
export async function getPlan(tx: Transaction, id: string) {
  const result = await tx.sql.query(
    "SELECT * FROM generation_plans WHERE tenant_id=$1 AND id=$2",
    [tx.tenantId, id],
  );
  requireThat(result.rows[0], 404, "NOT_FOUND", "生成计划不存在或无访问权限。");
  return result.rows[0]!;
}
export async function getJob(tx: Transaction, id: string) {
  const result = await tx.sql.query(
    `${jobSelect} WHERE j.tenant_id=$1 AND j.id=$2`,
    [tx.tenantId, id],
  );
  requireThat(result.rows[0], 404, "NOT_FOUND", "生成任务不存在或无访问权限。");
  return result.rows[0]!;
}
/**
 * The single durable path from a fixed plan to exactly one job. A batch executes
 * each of its items through this function so per-item guards, the plan-to-job
 * uniqueness and the queue hint cannot drift between the two entry points.
 */
export async function executePlanOnce(
  tx: Transaction,
  planId: string,
  options: { generationExecutor?: boolean } = {},
) {
  const plan = await getPlan(tx, planId);
  const existing = (
    await tx.sql.query(`${jobSelect} WHERE j.tenant_id=$1 AND j.plan_id=$2`, [
      tx.tenantId,
      plan.id,
    ])
  ).rows[0];
  if (existing) return await serializeJob(tx, existing);
  requireThat(
    plan.status === "ready",
    409,
    "PLAN_NOT_READY",
    "计划不可执行，请核对阻断原因或重新准备。",
  );
  requireThat(
    plan.expires_at.getTime() > Date.now(),
    409,
    "PLAN_EXPIRED",
    "计划已过期，请重新核对输入并准备。",
  );
  const cap = (
    await tx.sql.query(
      "SELECT * FROM generation_capabilities WHERE tenant_id=$1 AND id=$2",
      [tx.tenantId, plan.capability_id],
    )
  ).rows[0];
  requireThat(
    cap?.enabled &&
      cap.revision === plan.capability_revision &&
      cap.connection_version_id === plan.connection_version_id,
    409,
    "CAPABILITY_CHANGED",
    "能力版本或启用状态已变化，请重新准备计划。",
  );
  // A plan can only reach "ready" (checked above) as a fixture or a capability
  // that was verified and estimated at plan time; either may now submit.
  requireThat(
    plan.execution_mode === "test_fixture" ||
      plan.execution_mode === "verified_provider",
    503,
    "REAL_PROVIDER_ACCEPTANCE_REQUIRED",
    "真实服务尚未完成接入验证，不能提交生成。",
  );
  // Formerly a gateway rule in deploy/nginx.conf; the deployment now declares its executor
  // through api.json `generationExecutor`, and only paid (verified-provider) plans need one.
  requireThat(
    plan.execution_mode !== "verified_provider" ||
      options.generationExecutor === true,
    503,
    "GENERATION_EXECUTOR_UNAVAILABLE",
    "当前部署尚未配置生成执行服务，请保留已准备的计划，完成配置后再试。",
  );
  await assertAnalysisCurrent(tx, plan);
  const allowed = (
    await tx.sql.query("SELECT generation_submission_allowed($1) AS allowed", [
      cap.id,
    ])
  ).rows[0]?.allowed;
  requireThat(
    allowed,
    429,
    "GENERATION_USAGE_LIMIT",
    "已达到模型任务上限，请等待现有任务完成或核对未决提交。",
  );
  const id = randomUUID();
  await tx.sql.query(
    "INSERT INTO generation_jobs(id,tenant_id,project_id,plan_id,created_by) VALUES($1,$2,$3,$4,$5)",
    [id, tx.tenantId, tx.projectId, plan.id, tx.session.userId],
  );
  await tx.sql.query(
    "UPDATE generation_plans SET status='consumed',revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
    [tx.tenantId, plan.id],
  );
  // Durable queue hint and business consumption commit with the API's encrypted replay record.
  await tx.sql.query("INSERT INTO generation_work(job_id) VALUES($1)", [id]);
  return await serializeJob(tx, await getJob(tx, id));
}
export function generationScope(
  kind: "input" | "plan" | "job" | "list",
  write: boolean,
) {
  return async (tx: Transaction, input: Input) => {
    const source =
      kind === "input"
        ? input.body
        : kind === "plan"
          ? await getPlan(tx, input.params.planId ?? input.body.planId)
          : kind === "job"
            ? await getJob(tx, input.params.jobId!)
            : input.query;
    const id = source.project_id ?? source.projectId;
    requireThat(
      typeof id === "string" && source.scope !== "shared",
      422,
      "GENERATION_PROJECT_REQUIRED",
      "请明确选择生成任务所属项目。",
    );
    await bindResourceProject(tx, id.toLowerCase(), write);
    if (source.resolved_input)
      await assertCanvasAssistanceAccess(tx, source.resolved_input);
    if (kind === "input" && source.canvasSources) {
      // This runs before an encrypted HTTP replay can return the original plan.
      if (source.canvasSources.length)
        await resolveCanvasSources(tx, source.canvasSources, true);
      if (source.assistance?.kind === "discuss")
        await discussionScope(tx, source.assistance.canvasId, true);
      await resolveCanvasReply(tx, source);
      const assistant = (
        await tx.sql.query(
          "SELECT enabled,definition FROM generation_capabilities WHERE tenant_id=$1 AND id=$2 AND connection_id=$3",
          [tx.tenantId, source.capabilityId, source.connectionId],
        )
      ).rows[0];
      requireThat(
        assistant?.enabled &&
          assistant.definition.purpose === "creative_assistance",
        503,
        "MODEL_NOT_CONFIGURED",
        "所选助手能力已不可用，请保留原输入核对。",
      );
      if (source.assistance?.kind === "discuss") return;
      const target = (
        await tx.sql.query(
          "SELECT revision,enabled FROM generation_capabilities WHERE tenant_id=$1 AND id=$2",
          [tx.tenantId, source.assistance.targetCapabilityId],
        )
      ).rows[0];
      requireThat(
        target?.enabled,
        503,
        "TARGET_CAPABILITY_UNAVAILABLE",
        "目标能力已不可用，请保留原输入核对。",
      );
      versionMatches(
        Number(target.revision),
        source.assistance.targetCapabilityRevision,
      );
    }
  };
}
export async function resolveAnalysis(
  tx: Transaction,
  input: Schema<"PlanInput">,
) {
  requireThat(
    input.purpose === "script_analysis" &&
      input.proposalTarget?.mode === "append_to_scene",
    422,
    "ASSISTANCE_PURPOSE_NOT_ENABLED",
    "当前支持为明确场次准备分镜建议；其他能力尚未启用。",
  );
  requireThat(
    (input.contextSources?.length ?? 0) <= 20,
    422,
    "GENERATION_CONTEXT_LIMIT",
    "最多明确选择 20 项上下文。",
  );
  requireThat(
    !(input.contextSources ?? []).some((s) => s.kind === "canvas_draft"),
    422,
    "ASSISTANCE_CONTEXT_NOT_SUPPORTED",
    "剧本拆解仅使用明确选择的文本上下文；画布草稿用于固定镜头的提示准备。 ",
  );
  const target = input.proposalTarget;
  const scene = await activeParent(tx, "scenes", target.sceneId.toLowerCase());
  requireThat(
    scene.episode_id === target.episodeId.toLowerCase(),
    422,
    "PROPOSAL_TARGET_MISMATCH",
    "场次不属于指定单集。",
  );
  versionMatches(Number(scene.revision), target.sceneRevision);
  await activeParent(tx, "episodes", target.episodeId.toLowerCase());
  const script = (
    await tx.sql.query(
      "SELECT * FROM script_revisions WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
      [tx.tenantId, tx.projectId, input.sourceScriptRevisionId],
    )
  ).rows[0];
  requireThat(script, 404, "NOT_FOUND", "所选剧本版本不存在或无访问权限。");
  const text = Array.from(script.text as string),
    range = input.scriptRange!;
  requireThat(
    range.startOffset < range.endOffset && range.endOffset <= text.length,
    422,
    "INVALID_SCRIPT_RANGE",
    "请选择此剧本版本内的非空原文。",
  );
  const quote = safeText(
    text.slice(range.startOffset, range.endOffset).join(""),
  );
  const snapshots: Schema<"ContextSnapshot">[] = [];
  const ids = new Set<string>();
  for (const source of input.contextSources ?? []) {
    const key = `${source.kind}:${source.objectId.toLowerCase()}`;
    requireThat(
      !ids.has(key),
      422,
      "DUPLICATE_CONTEXT_SOURCE",
      "同一上下文只能选择一次。",
    );
    ids.add(key);
    snapshots.push(await resolveContext(tx, source, true));
  }
  requireThat(
    quote.length + snapshots.reduce((n, s) => n + s.text.length, 0) <= 60000,
    422,
    "GENERATION_CONTEXT_LIMIT",
    "所选上下文合计过长，请减少明确来源。",
  );
  const resolved: Schema<"ResolvedInput"> = {
    resolverVersion: "script-analysis/1",
    prompt: safeText(input.prompt),
    references: [],
    shots: [],
    sourceExcerpt: { scriptRevisionId: script.id, range, quote },
    contextSnapshots: snapshots,
    dependencies: [
      {
        kind: "script_revision",
        objectId: script.id,
        revision: 1,
        tracking: "fixed",
        contentHash: digest(quote),
      },
      ...snapshots.map((s) => s.source),
    ],
  };
  return { resolved, snapshot: await contentTree(tx) };
}
export async function assertAnalysisCurrent(
  tx: Transaction,
  plan: Record<string, any>,
) {
  if (["image", "video", "audio"].includes(plan.input.purpose))
    return assertMediaCurrent(tx, plan);
  if (plan.input.purpose === "creative_assistance")
    return assertPromptCurrent(tx, plan);
  const input = plan.input as Schema<"PlanInput">,
    target = input.proposalTarget!;
  requireThat(
    target.mode === "append_to_scene",
    422,
    "INVALID_PROPOSAL_TARGET",
    "请核对目标场次。",
  );
  const scene = await activeParent(tx, "scenes", target.sceneId);
  await activeParent(tx, "episodes", target.episodeId);
  requireThat(
    scene.episode_id === target.episodeId,
    409,
    "PLAN_INPUT_CHANGED",
    "目标场次归属已变化，请重新准备计划。",
  );
  // Editing a different scene or reordering does not silently re-resolve or invalidate selected text.
  for (const saved of (plan.resolved_input as Schema<"ResolvedInput">)
    .contextSnapshots ?? []) {
    const fresh = await resolveContext(
      tx,
      {
        kind: saved.source.kind as Schema<"ContextSourceInput">["kind"],
        objectId: saved.source.objectId,
        revision: saved.source.revision,
      },
      false,
    );
    requireThat(
      saved.source.contentHash === fresh.source.contentHash,
      409,
      "PLAN_INPUT_CHANGED",
      "所选上下文内容已变化，请核对后重新准备计划。",
    );
  }
}
export async function createPlan(tx: Transaction, raw: Schema<"PlanInput">) {
  const input = structuredClone(raw);
  input.projectId = tx.projectId!;
  input.connectionId = input.connectionId.toLowerCase();
  input.capabilityId = input.capabilityId.toLowerCase();
  if (input.canvasSources)
    input.canvasSources = input.canvasSources.map((s) => ({
      ...s,
      canvasId: s.canvasId.toLowerCase(),
      nodeId: s.nodeId.toLowerCase(),
    }));
  if (input.assistance?.canvasId)
    input.assistance.canvasId = input.assistance.canvasId.toLowerCase();
  if (input.canvasSources && input.assistanceSource)
    input.assistanceSource.artifactId =
      input.assistanceSource.artifactId.toLowerCase();
  if (input.sourceScriptRevisionId)
    input.sourceScriptRevisionId = input.sourceScriptRevisionId.toLowerCase();
  if (input.proposalTarget?.mode === "append_to_scene") {
    input.proposalTarget.sceneId = input.proposalTarget.sceneId.toLowerCase();
    input.proposalTarget.episodeId =
      input.proposalTarget.episodeId.toLowerCase();
  }
  const cap = (
    await tx.sql.query(
      "SELECT * FROM generation_capabilities WHERE tenant_id=$1 AND id=$2 AND connection_id=$3",
      [tx.tenantId, input.capabilityId, input.connectionId],
    )
  ).rows[0];
  requireThat(cap, 503, "MODEL_NOT_CONFIGURED", "尚未配置并验证此模型能力。");
  const { resolved, snapshot } = ["image", "video", "audio"].includes(
    input.purpose,
  )
    ? await resolveMedia(tx, input, cap)
    : input.purpose === "creative_assistance"
      ? input.assistance?.kind === "discuss"
        ? await resolveDiscussion(tx, input, cap)
        : await resolvePrompt(tx, input)
      : await resolveAnalysis(tx, input);
  const reasons: string[] = [];
  if (input.canvasSources) {
    requireThat(
      resolved.references.every((r) =>
        cap.definition.supportedPurposes?.includes(r.reference.purpose),
      ) && resolved.references.length <= (cap.definition.maxReferences ?? 100),
      422,
      "ASSISTANCE_REFERENCE_UNSUPPORTED",
      "所选助手能力不支持本次明确媒体的用途或数量。",
    );
    for (const definition of [
      cap.definition,
      ...(resolved.targetCapabilitySnapshot
        ? [resolved.targetCapabilitySnapshot]
        : []),
    ]) {
      requireThat(
        (
          await tx.sql.query(
            "SELECT canvas_assistance_references_supported($1,$2,$3,$4) AS supported",
            [
              tx.tenantId,
              tx.projectId,
              JSON.stringify(resolved.references),
              definition,
            ],
          )
        ).rows[0].supported,
        422,
        "ASSISTANCE_REFERENCE_UNSUPPORTED",
        "实际媒体类型、大小、时长或数量不符合助手或目标能力规则。",
      );
    }
  }
  if (!cap.enabled) reasons.push("MODEL_DISABLED");
  // Only a fixture or a capability an operator marked verified can become ready.
  const verifiedProfile =
    cap.execution_mode === "verified_provider"
      ? findProfile(String(cap.definition.modelVersion))
      : undefined;
  if (cap.execution_mode === "verified_provider") {
    if (!cap.definition.verifiedAt || !verifiedProfile)
      reasons.push("REAL_PROVIDER_ACCEPTANCE_REQUIRED");
  } else if (cap.execution_mode !== "test_fixture")
    reasons.push("REAL_PROVIDER_ACCEPTANCE_REQUIRED");
  if (cap.definition.purpose !== input.purpose)
    reasons.push("CAPABILITY_PURPOSE_MISMATCH");
  let estimate: Schema<"CostEstimate"> = {
    pricingRevision: "explicit-test-fixture/1",
    lines: [],
    baseCost: zero,
    holdMargin: zero,
    totalReservation: zero,
    basisNote: "显式本地测试适配器；没有模型调用与费用，不代表真实模型验收。",
  };
  if (verifiedProfile)
    try {
      estimate = estimateCost(verifiedProfile, resolved);
    } catch (error) {
      if (!(error instanceof VerifiedProfileError)) throw error;
      reasons.push("COST_ESTIMATE_UNAVAILABLE");
    }
  // creative-rework/1 uses the database JSONB canonical representation, shared with
  // its integrity guard. Earlier resolver hashes are deliberately unchanged.
  const rework = input.assistance?.kind === "prepare_rework";
  const inputHash =
    rework || !!input.canvasSources
      ? (
          await tx.sql.query(
            "SELECT rework_input_hash($1::jsonb,$2::jsonb,$3::bigint,$4::uuid) AS hash",
            [input, resolved, cap.revision, cap.connection_version_id],
          )
        ).rows[0].hash
      : digest(
          canonical({
            input,
            resolved,
            capabilityRevision: Number(cap.revision),
            connectionVersionId: cap.connection_version_id,
          }),
        );
  const row = (
    await tx.sql.query(
      `INSERT INTO generation_plans(id,tenant_id,project_id,capability_id,connection_version_id,created_by,input,resolved_input,input_hash,capability_revision,base_content_snapshot,cost_estimate,blocking_reasons,execution_mode,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now()+interval '10 minutes') RETURNING *`,
      [
        randomUUID(),
        tx.tenantId,
        tx.projectId,
        cap.id,
        cap.connection_version_id,
        tx.session.userId,
        input,
        resolved,
        inputHash,
        cap.revision,
        snapshot,
        reasons.length ? null : estimate,
        JSON.stringify(reasons),
        cap.execution_mode,
        reasons.length ? "blocked" : "ready",
      ],
    )
  ).rows[0];
  for (const [position, source] of (input.shotSources ?? []).entries())
    await tx.sql.query(
      "INSERT INTO generation_plan_shots(tenant_id,project_id,plan_id,position,shot_id,shot_revision_id) VALUES($1,$2,$3,$4,$5,$6)",
      [
        tx.tenantId,
        tx.projectId,
        row.id,
        position,
        source.shotId,
        source.shotRevisionId,
      ],
    );
  if (["image", "video", "audio"].includes(input.purpose))
    await recordMediaOrigin(tx, row.id, resolved);
  if (rework) {
    const feedback = resolved.feedbackSnapshot!,
      shot = resolved.shots[0]!;
    await tx.sql.query(
      "INSERT INTO generation_rework_inputs(tenant_id,project_id,plan_id,review_id,comment_id,comment_revision,take_id,shot_id,shot_revision_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        tx.tenantId,
        tx.projectId,
        row.id,
        feedback.reviewId,
        feedback.commentId,
        feedback.commentRevision,
        feedback.subject.takeId,
        shot.shotId,
        shot.shotRevisionId,
      ],
    );
  }
  if (resolved.canvasScope)
    await tx.sql.query(
      "INSERT INTO generation_assistance_scopes(tenant_id,project_id,plan_id,canvas_id,scene_id) VALUES($1,$2,$3,$4,$5)",
      [
        tx.tenantId,
        tx.projectId,
        row.id,
        resolved.canvasScope.canvasId,
        "sceneId" in resolved.canvasScope ? resolved.canvasScope.sceneId : null,
      ],
    );
  for (const [position, saved] of (resolved.canvasSnapshots ?? []).entries())
    await tx.sql.query(
      "INSERT INTO generation_canvas_contexts(tenant_id,project_id,plan_id,position,canvas_id,node_id,canvas_revision,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        tx.tenantId,
        tx.projectId,
        row.id,
        position,
        saved.source.canvasId,
        saved.source.nodeId,
        saved.source.canvasRevision,
        saved,
      ],
    );
  return planRecord(row);
}
