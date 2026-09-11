import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Transaction } from "../../kernel/database.js";
import { canonical, digest } from "../../kernel/crypto.js";
import { page, searchPattern } from "../../kernel/pages.js";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import { requireThat, versionMatches } from "../../kernel/errors.js";
import {
  activeParent,
  bumpContent,
  contentRecord,
  contentTree,
  contentVersion,
  validateShotSpec,
  type Schema,
} from "./model.js";
import {
  insertEpisode,
  insertScene,
  insertShot,
  validateScene,
} from "./commands.js";
import { csvProposal } from "./csv.js";

type Proposal = Schema<"Proposal">;
type Operation = Schema<"ProposalOperation">;
const select = `SELECT p.id,p.project_id,r.number AS revision,p.source_kind,p.source_hash,p.source_script_revision_id,p.script_range,p.status,p.created_at,p.updated_at,r.base_content_revision,r.target,r.operations FROM analysis_proposals p JOIN analysis_proposal_revisions r ON r.proposal_id=p.id`;
function proposalRecord(row: Record<string, unknown>): Proposal {
  return contentRecord<Proposal>({
    ...row,
    base_content_revision: Number(row.base_content_revision),
  });
}
async function getProposal(tx: Transaction, id: string, number?: number) {
  const result = await tx.sql.query(
    `${select.replace(" FROM analysis_proposals", ",r.base_content_snapshot FROM analysis_proposals")} WHERE p.tenant_id=$1 AND p.project_id=$2 AND p.id=$3 AND r.number=coalesce($4::bigint,p.revision)`,
    [tx.tenantId, tx.projectId, id, number ?? null],
  );
  requireThat(
    result.rows[0],
    404,
    "NOT_FOUND",
    "提案或修订不存在或无访问权限。",
  );
  const proposal = proposalRecord(result.rows[0]);
  if (proposal.status === "applied") {
    const application = await tx.sql.query(
      "SELECT proposal_revision, selected_operation_ids, created_objects, content_revision, created_at AS applied_at FROM proposal_applications WHERE tenant_id=$1 AND project_id=$2 AND proposal_id=$3",
      [tx.tenantId, tx.projectId, id],
    );
    requireThat(
      application.rows[0],
      500,
      "PROPOSAL_APPLICATION_MISSING",
      "提案采纳结果暂不可用。",
    );
    const row = application.rows[0];
    return {
      ...proposal,
      application: contentRecord<Schema<"ProposalApplication">>({
        ...row,
        proposal_revision: Number(row.proposal_revision),
        content_revision: Number(row.content_revision),
      }),
    };
  }
  return proposal;
}
function targetNormalized(
  target: Schema<"ProposalTarget">,
): Schema<"ProposalTarget"> {
  return target.mode === "new_structure"
    ? target
    : {
        ...target,
        sceneId: target.sceneId.toLowerCase(),
        episodeId: target.episodeId.toLowerCase(),
      };
}
async function validateTarget(
  tx: Transaction,
  target: Schema<"ProposalTarget">,
) {
  if (target.mode === "append_to_scene") {
    const scene = await activeParent(tx, "scenes", target.sceneId);
    requireThat(
      scene.episode_id === target.episodeId,
      422,
      "PROPOSAL_TARGET_MISMATCH",
      "目标场次不属于所选单集。",
    );
    versionMatches(Number(scene.revision), target.sceneRevision);
  }
}
function parent(op: Operation) {
  return op.kind === "scene"
    ? (op.proposed as Schema<"SceneInput">).episodeId.toLowerCase()
    : op.kind === "shot"
      ? (op.proposed as Schema<"ShotInput">).sceneId.toLowerCase()
      : undefined;
}
function evidence(op: Operation) {
  const spec =
    op.kind === "shot" ? (op.proposed as Schema<"ShotInput">).spec : undefined;
  return [
    ...(op.sourceExcerpts ?? []).map((x) => canonical(["excerpt", x])),
    ...(spec?.sourceExcerpts ?? []).map((x) => canonical(["specExcerpt", x])),
    ...(spec?.sourceShotIds ?? []).map((x) =>
      canonical(["shot", x.toLowerCase()]),
    ),
    ...(spec?.dialogue ?? []).flatMap((x) => [
      ...(x.sourceExcerpt
        ? [canonical(["lineExcerpt", x.id.toLowerCase(), x.sourceExcerpt])]
        : []),
      ...(x.sourceDialogueId
        ? [
            canonical([
              "lineSource",
              x.id.toLowerCase(),
              x.sourceDialogueId.toLowerCase(),
            ]),
          ]
        : []),
    ]),
  ];
}
async function validateGraph(
  tx: Transaction,
  operations: Operation[],
  target: Schema<"ProposalTarget">,
  previous?: Proposal,
) {
  await validateTarget(tx, target);
  const ids = new Set<string>(),
    temps = new Map<string, Operation>();
  for (const op of operations) {
    op.opId = op.opId.toLowerCase();
    op.temporaryId = op.temporaryId.toLowerCase();
    requireThat(
      !ids.has(op.opId) && !temps.has(op.temporaryId),
      422,
      "DUPLICATE_PROPOSAL_ID",
      "提案操作与临时对象标识不能重复。",
    );
    ids.add(op.opId);
    temps.set(op.temporaryId, op);
    requireThat(
      op.kind !== "asset_suggestion",
      422,
      "ASSETS_NOT_READY",
      "请先建立资产库，再创建资产建议。",
    );
    requireThat(
      (op.proposed as Schema<"EpisodeInput">).status === "active",
      422,
      "PROPOSAL_CREATE_ONLY",
      "提案只能新建可用内容，不能归档。",
    );
  }
  for (const op of operations) {
    const parentId = parent(op);
    if (target.mode === "append_to_scene")
      requireThat(
        op.kind === "shot" && parentId === target.sceneId,
        422,
        "PROPOSAL_TARGET_MISMATCH",
        "追加提案只能包含指向当前场次的新镜头。",
      );
    else if (parentId) {
      const dependency = temps.get(parentId);
      requireThat(
        dependency?.kind === (op.kind === "scene" ? "episode" : "scene"),
        422,
        "PROPOSAL_PARENT_MISSING",
        "提案的父对象必须是本提案内对应的单集或场次。",
      );
    }
    if (op.kind === "scene")
      await validateScene(tx, op.proposed as Schema<"SceneInput">);
    if (op.kind === "shot")
      await validateShotSpec(
        tx,
        op.temporaryId,
        (op.proposed as Schema<"ShotInput">).spec,
      );
    if (op.sourceExcerpts?.length)
      await validateShotSpec(tx, op.temporaryId, {
        intent: "",
        references: [],
        sourceExcerpts: op.sourceExcerpts,
      });
  }
  if (previous) {
    const byId = new Map(operations.map((op) => [op.opId, op]));
    for (const old of previous.operations) {
      const next = byId.get(old.opId);
      if (!next) {
        requireThat(
          evidence(old).length === 0,
          422,
          "PROPOSAL_SOURCE_REMOVED",
          "含来源证据的操作须保留；采纳时可不勾选。",
        );
        continue;
      }
      requireThat(
        next.kind === old.kind && next.temporaryId === old.temporaryId,
        422,
        "PROPOSAL_ID_CHANGED",
        "已有操作不能更换对象标识或类型。",
      );
      if (canonical(previous.target) === canonical(target))
        requireThat(
          parent(next) === parent(old),
          422,
          "PROPOSAL_PARENT_CHANGED",
          "已有操作不能任意更换父对象。请明确选择新的导入目标。",
        );
      const kept = new Set(evidence(next));
      requireThat(
        evidence(old).every((x) => kept.has(x)),
        422,
        "PROPOSAL_SOURCE_REMOVED",
        "编辑须保留原有来源证据。",
      );
    }
  }
}
const fingerprint = (
  sourceHash: string,
  target: Schema<"ProposalTarget">,
  base: number,
) => digest(canonical([sourceHash, target, base]));
async function appendRevision(
  tx: Transaction,
  id: string,
  number: number,
  body: Schema<"ProposalEdit">,
) {
  const { target } = body;
  const snapshot = await contentTree(tx);
  await tx.sql.query(
    "INSERT INTO analysis_proposal_revisions (tenant_id,project_id,proposal_id,number,base_content_revision,target,target_scene_id,target_episode_id,operations,base_content_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      tx.tenantId,
      tx.projectId,
      id,
      number,
      body.baseContentRevision,
      target,
      target.mode === "append_to_scene" ? target.sceneId : null,
      target.mode === "append_to_scene" ? target.episodeId : null,
      JSON.stringify(body.operations),
      snapshot,
    ],
  );
}
async function applyObjects(
  tx: Transaction,
  proposal: Proposal,
  selectedIds: string[],
) {
  const selected = new Set(selectedIds.map((id) => id.toLowerCase()));
  requireThat(
    selected.size === selectedIds.length,
    422,
    "DUPLICATE_SELECTION",
    "同一提案操作不能重复采纳。",
  );
  const operations = proposal.operations.filter((op) => selected.has(op.opId));
  requireThat(
    operations.length === selected.size,
    422,
    "INVALID_SELECTION",
    "选择包含不属于当前提案修订的操作。",
  );
  const selectedTemps = new Set(operations.map((op) => op.temporaryId));
  if (proposal.target.mode === "new_structure")
    for (const op of operations) {
      const dependency = parent(op);
      requireThat(
        !dependency || selectedTemps.has(dependency),
        422,
        "PROPOSAL_DEPENDENCY_MISSING",
        "请同时勾选所选场次或镜头依赖的父项。",
      );
    }
  const mapping = new Map<string, string>(),
    created: Record<string, string> = {};
  // Positions are allocated after existing siblings, including archived ones.
  // Existing positions are never touched. Stable sort preserves proposal order on ties.
  const positions = new Map<string, number>();
  async function position(
    table: "episodes" | "scenes" | "shots",
    column: "project_id" | "episode_id" | "scene_id",
    id: string,
  ) {
    const key = `${table}:${id}`;
    let value = positions.get(key);
    if (value === undefined) {
      const result = await tx.sql.query(
        `SELECT coalesce(max(position),-1)::text AS position FROM ${table} WHERE tenant_id=$1 AND project_id=$2 AND ${column}=$3`,
        [tx.tenantId, tx.projectId, id],
      );
      value = Number(result.rows[0].position) + 1;
    }
    requireThat(
      Number.isSafeInteger(value),
      422,
      "CONTENT_POSITION_EXHAUSTED",
      "内容序号已达上限，请先整理顺序。",
    );
    positions.set(key, value + 1);
    return value;
  }
  for (const kind of ["episode", "scene", "shot"] as const) {
    const ordered = operations.filter((op) => op.kind === kind);
    if (proposal.target.mode === "new_structure")
      ordered.sort(
        (a, b) =>
          (a.proposed as Schema<"EpisodeInput">).position -
          (b.proposed as Schema<"EpisodeInput">).position,
      );
    for (const op of ordered) {
      let id: string;
      if (kind === "episode")
        id = (
          await insertEpisode(tx, {
            ...(op.proposed as Schema<"EpisodeInput">),
            position: await position("episodes", "project_id", tx.projectId!),
          })
        ).id;
      else if (kind === "scene") {
        const episodeId = mapping.get(parent(op)!)!;
        id = (
          await insertScene(tx, {
            ...(op.proposed as Schema<"SceneInput">),
            episodeId,
            position: await position("scenes", "episode_id", episodeId),
          })
        ).id;
      } else {
        const sceneId =
          proposal.target.mode === "append_to_scene"
            ? proposal.target.sceneId
            : mapping.get(parent(op)!)!;
        const body = op.proposed as Schema<"ShotInput">;
        // Preserve operation-level text evidence on the adopted fixed shot requirements.
        const excerpts = [
          ...(body.spec.sourceExcerpts ?? []),
          ...(op.sourceExcerpts ?? []),
        ];
        const spec = excerpts.length
          ? {
              ...body.spec,
              sourceExcerpts: [
                ...new Map(excerpts.map((e) => [canonical(e), e])).values(),
              ],
            }
          : body.spec;
        id = (
          await insertShot(tx, {
            ...body,
            spec,
            sceneId,
            position: await position("shots", "scene_id", sceneId),
          })
        ).id;
      }
      mapping.set(op.temporaryId, id);
      created[op.opId] = id;
    }
  }
  return created;
}
export function proposalRoutes(app: FastifyInstance, context: ApiContext) {
  registerAction(app, context, "importShotList", async (tx, input) => {
    const base = Number((await contentVersion(tx, input.version)).revision),
      body = input.body as Schema<"ImportShotList">;
    const target = targetNormalized(body.target),
      sourceHash = digest(body.csvText),
      importFingerprint = fingerprint(sourceHash, target, base);
    await validateTarget(tx, target);
    const found = await tx.sql.query(
      "SELECT id FROM analysis_proposals WHERE tenant_id=$1 AND project_id=$2 AND import_fingerprint=$3",
      [tx.tenantId, tx.projectId, importFingerprint],
    );
    if (found.rows[0]) {
      const proposal = await getProposal(tx, found.rows[0].id);
      return { body: proposal, etag: proposal.revision };
    }
    const operations = csvProposal(body.csvText, target);
    await validateGraph(tx, operations, target);
    const id = randomUUID();
    await tx.sql.query(
      "INSERT INTO analysis_proposals (id,tenant_id,project_id,source_kind,source_hash,source_csv_text,import_fingerprint) VALUES ($1,$2,$3,'csv_import',$4,$5,$6)",
      [
        id,
        tx.tenantId,
        tx.projectId,
        sourceHash,
        body.csvText,
        importFingerprint,
      ],
    );
    await appendRevision(tx, id, 1, {
      baseContentRevision: base,
      target,
      operations,
    });
    return { body: await getProposal(tx, id), etag: 1 };
  });
  registerAction(app, context, "listProposals", async (tx, input) => ({
    body: await page(
      tx,
      context.secrets,
      "listProposals",
      input.query,
      `${select} WHERE p.tenant_id=$1 AND p.project_id=$2 AND r.number=p.revision AND ($3::uuid IS NULL OR r.target_scene_id=$3) AND ($4::text IS NULL OR p.status=$4) AND ($5::text IS NULL OR p.source_kind=$5) AND (EXISTS (SELECT 1 FROM jsonb_array_elements(r.operations) op WHERE op->>'summary' ILIKE $6))`,
      [
        tx.tenantId,
        tx.projectId,
        input.query.sceneId ?? null,
        input.query.status ?? null,
        input.query.sourceKind ?? null,
        searchPattern(input.query),
      ],
      proposalRecord,
    ),
  }));
  registerAction(app, context, "getProposal", async (tx, input) => {
    const body = await getProposal(
      tx,
      input.params.proposalId!,
      input.query.revisionNumber as number | undefined,
    );
    return { body, etag: body.revision };
  });
  registerAction(app, context, "editProposal", async (tx, input) => {
    const previous = await getProposal(tx, input.params.proposalId!);
    versionMatches(previous.revision, input.version);
    requireThat(
      previous.status === "proposed",
      409,
      "PROPOSAL_CLOSED",
      "已采纳或拒绝的提案不能再编辑。",
    );
    const body = input.body as Schema<"ProposalEdit">;
    body.target = targetNormalized(body.target);
    // A new baseline is accepted only when explicitly provided, and must be current.
    await contentVersion(tx, body.baseContentRevision);
    await validateGraph(tx, body.operations, body.target, previous);
    const hash =
      previous.sourceKind === "ai_analysis"
        ? digest(
            canonical([
              previous.id,
              previous.sourceHash,
              body.target,
              body.baseContentRevision,
            ]),
          )
        : fingerprint(
            previous.sourceHash,
            body.target,
            body.baseContentRevision,
          );
    const duplicate = await tx.sql.query(
      "SELECT id FROM analysis_proposals WHERE tenant_id=$1 AND project_id=$2 AND import_fingerprint=$3 AND id<>$4",
      [tx.tenantId, tx.projectId, hash, previous.id],
    );
    requireThat(
      !duplicate.rows[0],
      409,
      "PROPOSAL_DUPLICATE_TARGET",
      "同一来源、目标和基线已有提案，请从提案列表打开。",
    );
    await appendRevision(tx, previous.id, previous.revision + 1, body);
    await tx.sql.query(
      "UPDATE analysis_proposals SET revision=revision+1,import_fingerprint=$4,updated_at=now() WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
      [tx.tenantId, tx.projectId, previous.id, hash],
    );
    return {
      body: await getProposal(tx, previous.id),
      etag: previous.revision + 1,
    };
  });
  registerAction(app, context, "applyProposal", async (tx, input) => {
    const root = await contentVersion(tx, input.version),
      proposal = await getProposal(tx, input.params.proposalId!),
      body = input.body as Schema<"ApplyProposal">;
    versionMatches(proposal.revision, body.proposalRevision);
    requireThat(
      proposal.status === "proposed",
      409,
      "PROPOSAL_CLOSED",
      "提案已完成采纳，不能用另一组选择重复创建。",
    );
    requireThat(
      proposal.baseContentRevision === Number(root.revision),
      409,
      "PROPOSAL_BASE_CHANGED",
      "内容已变化，请先查看差异并明确更新提案基线。",
    );
    await validateGraph(tx, proposal.operations, proposal.target);
    const created = await applyObjects(tx, proposal, body.selectedOperationIds);
    await bumpContent(tx);
    const tree = await contentTree(tx);
    await tx.sql.query(
      "INSERT INTO proposal_applications (tenant_id,project_id,proposal_id,proposal_revision,selected_operation_ids,created_objects,content_revision,applied_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        tx.tenantId,
        tx.projectId,
        proposal.id,
        proposal.revision,
        JSON.stringify(body.selectedOperationIds),
        created,
        tree.revision,
        tx.session.userId,
      ],
    );
    await tx.sql.query(
      "UPDATE analysis_proposals SET status='applied',updated_at=now() WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
      [tx.tenantId, tx.projectId, proposal.id],
    );
    return { body: tree, etag: tree.revision };
  });
}
