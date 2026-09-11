import type { Transaction } from "../../kernel/database.js";
import { canonical, digest } from "../../kernel/crypto.js";
import { requireThat, versionMatches } from "../../kernel/errors.js";
import { activeParent, contentTree, type Schema } from "../content/model.js";
import { safeText, resolveContext } from "./input-sources.js";
import { canvasDraftInput } from "./canvas-context.js";
import { resolveTakeFeedback } from "../reviews/model.js";

/** Fixed history is resolved first; current head checks never replace that history. */
async function currentTakeFeedback(
  tx: Transaction,
  input: Schema<"PlanInput">,
) {
  const feedback = await resolveTakeFeedback(tx, input.assistance!);
  const media = (
    await tx.sql.query(
      "SELECT status,kind,project_id FROM media WHERE tenant_id=$1 AND id=$2",
      [tx.tenantId, feedback.take.mediaId],
    )
  ).rows[0];
  requireThat(
    media?.status === "ready" &&
      media.kind === "video" &&
      (!media.project_id || media.project_id === tx.projectId),
    409,
    "REWORK_SOURCE_UNAVAILABLE",
    "原候选视频已不可用或无当前访问权限；固定意见不会改绑其他素材。",
  );
  requireThat(
    input.shotSources?.length === 1 &&
      input.shotSources[0]!.shotId.toLowerCase() === feedback.take.shotId &&
      input.shotSources[0]!.shotRevisionId.toLowerCase() ===
        feedback.take.shotRevisionId,
    422,
    "REWORK_TAKE_MISMATCH",
    "修改建议必须明确固定该候选的原镜头及镜头版本。",
  );
  requireThat(
    feedback.currentCommentRevision ===
      feedback.feedbackSnapshot.commentRevision,
    409,
    "REWORK_FEEDBACK_CHANGED",
    "意见已有新修订，请保留原输入并明确核对后重新准备。",
  );
  requireThat(
    !feedback.currentResolved,
    409,
    "REWORK_FEEDBACK_RESOLVED",
    "此意见已解决，请明确核对；不会自动更换意见来源。",
  );
  return feedback;
}

export async function validateReference(
  tx: Transaction,
  reference: Schema<"Reference">,
) {
  const media = (
    await tx.sql.query(
      "SELECT kind,status,project_id FROM media WHERE tenant_id=$1 AND id=$2",
      [tx.tenantId, reference.mediaId],
    )
  ).rows[0];
  requireThat(
    media?.status === "ready" &&
      (!media.project_id || media.project_id === tx.projectId),
    422,
    "ASSISTANCE_REFERENCE_UNAVAILABLE",
    "建议引用必须是当前项目或已授权共享范围内的可用素材。",
  );
  if (reference.assetRevisionId) {
    const valid = (
      await tx.sql.query("SELECT asset_revision_usable($1,$2,$3,false) AS ok", [
        tx.tenantId,
        tx.projectId,
        reference.assetRevisionId,
      ])
    ).rows[0]?.ok;
    requireThat(
      valid,
      422,
      "ASSISTANCE_REFERENCE_UNAVAILABLE",
      "固定资产版本不可用或尚未引入当前项目。",
    );
    const link = (
      await tx.sql.query(
        "SELECT 1 FROM asset_revision_media WHERE tenant_id=$1 AND asset_revision_id=$2 AND media_id=$3",
        [tx.tenantId, reference.assetRevisionId, reference.mediaId],
      )
    ).rows[0];
    requireThat(
      link,
      422,
      "ASSISTANCE_REFERENCE_MISMATCH",
      "素材不属于明确选择的固定资产版本。",
    );
  }
  if (reference.subjectAssetId) {
    const valid = (
      await tx.sql.query("SELECT asset_identity_usable($1,$2,$3,false) AS ok", [
        tx.tenantId,
        tx.projectId,
        reference.subjectAssetId,
      ])
    ).rows[0]?.ok;
    requireThat(
      valid,
      422,
      "ASSISTANCE_REFERENCE_UNAVAILABLE",
      "参考对象未授权或不可用。",
    );
  }
  return media.kind as "image" | "video" | "audio" | "document";
}
export async function resolvePrompt(
  tx: Transaction,
  input: Schema<"PlanInput">,
) {
  requireThat(
    input.purpose === "creative_assistance" && input.assistance,
    422,
    "ASSISTANCE_PURPOSE_NOT_ENABLED",
    "请选择明确的提示准备任务。",
  );
  requireThat(
    !input.sourceScriptRevisionId &&
      !input.scriptRange &&
      !input.proposalTarget &&
      !input.assistanceSource,
    422,
    "ASSISTANCE_SOURCE_MISMATCH",
    "提示准备只能使用本次明确选择的固定镜头和上下文；不能附带未解析的来源。",
  );
  const request = input.assistance;
  requireThat(
    request.kind === "prepare_rework" ||
      (!request.feedback &&
        !request.sourceTakeId &&
        !request.sourceCutRevisionId),
    422,
    "ASSISTANCE_SOURCE_MISMATCH",
    "提示准备不接收返工来源，请选择正确的任务类型。",
  );
  requireThat(
    (input.shotSources?.length ?? 0) > 0 &&
      (input.shotSources?.length ?? 0) <= 100,
    422,
    "ASSISTANCE_SHOT_REQUIRED",
    "请明确选择至少一个固定镜头版本；仅有画布不能形成镜头创作建议。",
  );
  requireThat(
    (input.contextSources?.length ?? 0) <= 20 &&
      (input.additionalReferences?.length ?? 0) <= 100 &&
      (input.referenceOverrides?.length ?? 0) <= 100,
    422,
    "ASSISTANCE_INPUT_LIMIT",
    "明确选择的上下文或参考超过上限。",
  );
  const target = (
    await tx.sql.query(
      "SELECT * FROM generation_capabilities WHERE tenant_id=$1 AND id=$2",
      [tx.tenantId, request.targetCapabilityId],
    )
  ).rows[0];
  requireThat(
    target?.enabled &&
      ["image", "video", "audio"].includes(target.definition.purpose),
    503,
    "TARGET_CAPABILITY_UNAVAILABLE",
    "目标媒体能力尚未配置或已停用，不能隐式选用其他版本。",
  );
  versionMatches(Number(target.revision), request.targetCapabilityRevision);
  const feedback =
    request.kind === "prepare_rework"
      ? await currentTakeFeedback(tx, input)
      : undefined;
  const result = await resolveSelectedInput(tx, input, target);
  if (feedback) {
    result.resolved.resolverVersion = "creative-rework/1";
    result.resolved.feedbackSnapshot = feedback.feedbackSnapshot;
    result.resolved.dependencies.push(feedback.dependency);
  }
  return result;
}

/** Resolve only explicitly selected fixed shots, contexts and overrides for prompt or media plans. */
export async function resolveSelectedInput(
  tx: Transaction,
  input: Schema<"PlanInput">,
  target: Record<string, any>,
  expandSources?: (
    tx: Transaction,
    shots: Schema<"ResolvedShotInput">[],
    snapshots: Schema<"ContextSnapshot">[],
  ) => Promise<{
    references: Schema<"ResolvedReference">[];
    snapshots: Schema<"ContextSnapshot">[];
  }>,
) {
  requireThat(
    (input.shotSources?.length ?? 0) <= 100 &&
      (input.contextSources?.length ?? 0) <= 20 &&
      input.additionalReferences.length <= 100 &&
      input.referenceOverrides.length <= 100,
    422,
    "GENERATION_INPUT_LIMIT",
    "明确选择的输入超过限制。",
  );
  const shots: Schema<"ResolvedShotInput">[] = [],
    references: Schema<"ResolvedReference">[] = [],
    dependencies: Schema<"SourceDependency">[] = [];
  const selected = new Set<string>();
  for (const source of input.shotSources ?? []) {
    const id = source.shotId.toLowerCase();
    requireThat(
      !selected.has(id),
      422,
      "DUPLICATE_SHOT_SOURCE",
      "同一镜头只能明确选择一个固定版本。",
    );
    selected.add(id);
    const row = (
      await tx.sql.query(
        "SELECT r.id,r.spec,r.revision,s.scene_id,s.status FROM shot_revisions r JOIN shots s ON s.id=r.shot_id WHERE r.tenant_id=$1 AND r.project_id=$2 AND r.shot_id=$3 AND r.id=$4",
        [tx.tenantId, tx.projectId, id, source.shotRevisionId],
      )
    ).rows[0];
    requireThat(
      row?.status === "active",
      404,
      "ASSISTANCE_SHOT_UNAVAILABLE",
      "所选镜头版本不存在、已归档或无访问权限。",
    );
    await activeParent(tx, "scenes", row.scene_id);
    const spec = row.spec as Schema<"ShotSpec">;
    shots.push({
      shotId: id,
      shotRevisionId: row.id,
      spec,
      entryState: spec.entryState ?? {},
      exitState: spec.exitState ?? {},
    });
    dependencies.push({
      kind: "shot_revision",
      objectId: row.id,
      revision: Number(row.revision),
      tracking: "fixed",
      contentHash: digest(canonical(spec)),
    });
    for (const reference of spec.references)
      references.push({
        reference,
        sourceLevel: "shot",
        sourceObjectId: row.id,
        shotId: id,
      });
  }
  const snapshots: Schema<"ContextSnapshot">[] = [],
    sourceIds = new Set<string>();
  for (const source of input.contextSources ?? []) {
    const key = `${source.kind}:${source.objectId.toLowerCase()}`;
    requireThat(
      !sourceIds.has(key),
      422,
      "DUPLICATE_CONTEXT_SOURCE",
      "同一上下文只能选择一次。",
    );
    sourceIds.add(key);
    if (source.kind === "canvas_draft") {
      const canvas = await canvasDraftInput(tx, source, true);
      snapshots.push(canvas.snapshot);
      references.push(...canvas.references);
    } else snapshots.push(await resolveContext(tx, source, true));
  }
  if (expandSources) {
    const extra = await expandSources(tx, shots, snapshots);
    references.push(...extra.references);
    for (const snapshot of extra.snapshots) {
      const previous = snapshots.find(
        (s) =>
          s.source.kind === snapshot.source.kind &&
          s.source.objectId === snapshot.source.objectId,
      );
      requireThat(
        !previous ||
          previous.source.contentHash === snapshot.source.contentHash,
        422,
        "GENERATION_SOURCE_MISMATCH",
        "固定来源快照不一致。",
      );
      if (!previous) snapshots.push(snapshot);
    }
  }
  for (const override of input.referenceOverrides) {
    requireThat(
      !override.shotId || selected.has(override.shotId.toLowerCase()),
      422,
      "REFERENCE_OVERRIDE_SCOPE",
      "参考覆盖只能作用于明确选择的镜头。",
    );
    requireThat(
      override.references.every(
        (r) =>
          r.purpose === override.purpose &&
          (!override.subjectAssetId ||
            r.subjectAssetId === override.subjectAssetId),
      ),
      422,
      "REFERENCE_OVERRIDE_SCOPE",
      "参考覆盖的用途和对象必须与声明一致。",
    );
    if (override.action !== "append")
      for (let i = references.length - 1; i >= 0; i--) {
        const row = references[i]!;
        if (
          row.reference.purpose === override.purpose &&
          (!override.shotId || row.shotId === override.shotId.toLowerCase()) &&
          (!override.subjectAssetId ||
            row.reference.subjectAssetId === override.subjectAssetId)
        )
          references.splice(i, 1);
      }
    if (override.action !== "exclude")
      for (const reference of override.references)
        references.push({
          reference,
          sourceLevel: "attempt",
          ...(override.shotId ? { shotId: override.shotId.toLowerCase() } : {}),
        });
  }
  for (const reference of input.additionalReferences)
    references.push({ reference, sourceLevel: "attempt" });
  requireThat(
    references.length <= 100,
    422,
    "ASSISTANCE_INPUT_LIMIT",
    "实际参考超过上限，请明确减少参考。",
  );
  const purposes = target.definition.supportedPurposes as string[];
  for (const row of references) {
    await validateReference(tx, row.reference);
    requireThat(
      purposes.includes(row.reference.purpose),
      422,
      "TARGET_REFERENCE_UNSUPPORTED",
      "目标能力不支持某项实际参考用途，请明确移除或选择适用能力。",
    );
  }
  if (target.definition.maxReferences !== undefined)
    requireThat(
      references.length <= target.definition.maxReferences,
      422,
      "TARGET_REFERENCE_LIMIT",
      "实际参考超过目标能力限制。",
    );
  requireThat(
    snapshots.reduce((n, s) => n + s.text.length, 0) +
      JSON.stringify(shots).length <=
      100000,
    422,
    "ASSISTANCE_INPUT_LIMIT",
    "明确选定的镜头与上下文合计过长，请分开准备。",
  );
  return {
    resolved: {
      resolverVersion: "creative-assistance/1",
      prompt: safeText(input.prompt),
      references,
      shots,
      dependencies: [...dependencies, ...snapshots.map((s) => s.source)],
      contextSnapshots: snapshots,
      ...(input.assistance ? { assistanceRequest: input.assistance } : {}),
      targetCapabilitySnapshot: {
        ...target.definition,
        id: target.id,
        connectionId: target.connection_id,
        revision: Number(target.revision),
        enabled: target.enabled,
        executionMode: target.execution_mode,
      },
      targetConnectionVersionId: target.connection_version_id,
    } as Schema<"ResolvedInput">,
    snapshot: await contentTree(tx),
  };
}
export async function assertPromptCurrent(
  tx: Transaction,
  plan: Record<string, any>,
) {
  const resolved = plan.resolved_input as Schema<"ResolvedInput">,
    input = plan.input as Schema<"PlanInput">,
    request = input.assistance!;
  const target = (
    await tx.sql.query(
      "SELECT revision,connection_version_id,enabled FROM generation_capabilities WHERE tenant_id=$1 AND id=$2",
      [tx.tenantId, request.targetCapabilityId],
    )
  ).rows[0];
  requireThat(
    target?.enabled &&
      Number(target.revision) === request.targetCapabilityRevision &&
      target.connection_version_id === resolved.targetConnectionVersionId,
    409,
    "TARGET_CAPABILITY_CHANGED",
    "目标能力版本或启用状态已变化，请核对原计划。",
  );
  await assertSelectedCurrent(tx, resolved);
  if (request.kind === "prepare_rework") {
    const feedback = await currentTakeFeedback(tx, input);
    requireThat(
      canonical(resolved.feedbackSnapshot) ===
        canonical(feedback.feedbackSnapshot),
      409,
      "REWORK_FEEDBACK_CHANGED",
      "原计划意见快照不匹配，不能替换固定来源。",
    );
  }
}
export async function assertSelectedCurrent(
  tx: Transaction,
  resolved: Schema<"ResolvedInput">,
) {
  for (const source of resolved.shots) {
    const row = (
      await tx.sql.query(
        "SELECT s.scene_id,s.status FROM shots s JOIN shot_revisions r ON r.shot_id=s.id WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.id=$3 AND r.id=$4",
        [tx.tenantId, tx.projectId, source.shotId, source.shotRevisionId],
      )
    ).rows[0];
    requireThat(
      row?.status === "active",
      409,
      "ASSISTANCE_SHOT_UNAVAILABLE",
      "明确选择的镜头已不可用。",
    );
    await activeParent(tx, "scenes", row.scene_id);
  }
  for (const saved of resolved.contextSnapshots ?? []) {
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
      fresh.source.contentHash === saved.source.contentHash,
      409,
      "PLAN_INPUT_CHANGED",
      "明确选择的上下文已变化，请重新核对。",
    );
  }
  for (const row of resolved.references)
    await validateReference(tx, row.reference);
}
