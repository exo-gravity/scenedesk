import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Problem, requireThat, versionMatches } from "../../kernel/errors.js";
import { registerAction, type ApiContext, type Input } from "../../kernel/routes.js";
import type { MediaContext } from "../media/model.js";
import { activeParent } from "../content/model.js";
import { canvasRoot, readCanvas, sceneCanvasId } from "../canvas/model.js";
import type { Transaction } from "../../kernel/database.js";
import type { Schema } from "../content/model.js";
import { createPlan, executePlanOnce, planRecord } from "./model.js";

const BATCH_LIMIT = 100;
/** One row per selected node, joined to its plan, job and canvas origin. */
const itemSql = `SELECT i.node_id,i.status,i.problem_code,i.blocking_reasons,i.plan_id,
 p.input,p.resolved_input,p.status AS plan_status,p.blocking_reasons AS plan_reasons,
 p.cost_estimate,p.expires_at,
 j.id AS job_id,j.status AS job_status,
 o.canvas_id AS origin_canvas_id,o.node_id AS origin_node_id,o.canvas_revision,o.input_fingerprint,o.source_node_ids AS origin_source_node_ids
 FROM generation_batch_items i
 JOIN generation_plans p ON p.id=i.plan_id
 LEFT JOIN generation_jobs j ON j.plan_id=i.plan_id
 LEFT JOIN generation_canvas_origins o ON o.plan_id=i.plan_id
 WHERE i.tenant_id=$1 AND i.project_id=$2 AND i.batch_id=$3 ORDER BY i.created_at,i.node_id`;
type ItemRow = {
  node_id: string;
  status: string;
  problem_code: string | null;
  blocking_reasons: string[];
  plan_id: string;
  input: Schema<"PlanInput">;
  resolved_input: Schema<"ResolvedInput">;
  plan_status: Schema<"GenerationPlan">["status"];
  plan_reasons: string[];
  cost_estimate: Schema<"CostEstimate"> | null;
  expires_at: Date;
  job_id: string | null;
  job_status: Schema<"CanvasGenerationBatchItem">["jobStatus"] | null;
  origin_canvas_id: string | null;
  origin_node_id: string | null;
  canvas_revision: string | null;
  input_fingerprint: string | null;
  origin_source_node_ids: string[] | null;
};
type BatchItem = Schema<"CanvasGenerationBatchItem">;
/**
 * A failure the caller can act on, with a phase-correct fallback: an unexpected
 * error on the prepare path is not the same verdict as one on the run path, and a
 * transient database failure must not be recorded as invalid input.
 */
function problemOf(error: unknown, phase: "prepare" | "run") {
  if (error instanceof Problem) return { code: error.code, message: error.message };
  return phase === "prepare"
    ? { code: "PLAN_PREPARE_FAILED", message: "本次输入尚未通过校验。" }
    : { code: "PLAN_EXECUTE_FAILED", message: "本次提交未完成，可再次确认重试。" };
}
async function batchRow(tx: Transaction, batchId: string) {
  const row = (
    await tx.sql.query(
      "SELECT b.*,c.revision AS current_canvas_revision FROM generation_batches b JOIN canvases c ON c.id=b.canvas_id WHERE b.tenant_id=$1 AND b.project_id=$2 AND b.id=$3",
      [tx.tenantId, tx.projectId, batchId],
    )
  ).rows[0];
  requireThat(row, 404, "NOT_FOUND", "生成批次不存在或无访问权限。");
  return row;
}
/**
 * A batch is grouping, never a second scheduler. Everything the confirmation screen
 * shows is derived: an item that already ran is reported from its job, a plan past
 * its own expiry is reported expired, and an item the canvas has moved past is
 * reported stale instead of failing the batch or re-running against a new state.
 */
async function readBatch(tx: Transaction, batchId: string) {
  const row = await batchRow(tx, batchId);
  const rows = (
    await tx.sql.query(itemSql, [tx.tenantId, tx.projectId, batchId])
  ).rows as ItemRow[];
  const stale = Number(row.canvas_revision) !== Number(row.current_canvas_revision);
  const items: BatchItem[] = rows.map((item) => {
    const expired = item.plan_status === "ready" && item.expires_at.getTime() <= Date.now();
    // Precedence matters. A node that never became a plan keeps its own verdict
    // instead of being relabelled "the canvas changed", and a job that ended in
    // failure is not reported as a submission. Only an item that had a usable plan
    // can be stale, and an execution refusal stays retryable.
    const status = (
      item.job_id
        ? ["failed", "cancelled", "archive_failed"].includes(item.job_status ?? "")
          ? "failed"
          : item.job_status === "reconciliation_required"
            ? "reconciliation_required"
            : "executed"
        : item.status !== "ready"
          ? item.status
          : stale
            ? "stale"
            : expired
              ? "invalid"
              : item.problem_code
                ? "refused"
                : "ready"
    ) as BatchItem["status"];
    const origin =
      item.origin_canvas_id && item.origin_node_id
        ? {
            canvasId: item.origin_canvas_id,
            nodeId: item.origin_node_id,
            canvasRevision: Number(item.canvas_revision),
            inputFingerprint: item.input_fingerprint!,
            sourceNodeIds: item.origin_source_node_ids ?? [],
          }
        : undefined;
    return {
      nodeId: item.node_id,
      status,
      blockingReasons: expired
        ? [...new Set([...(item.blocking_reasons ?? []), "PLAN_EXPIRED"])]
        : (item.blocking_reasons ?? []),
      ...(item.problem_code ? { problemCode: item.problem_code } : {}),
      ...(item.plan_id
        ? {
            plan: {
              id: item.plan_id,
              status: expired ? ("expired" as const) : item.plan_status,
              expiresAt: item.expires_at.toISOString(),
              blockingReasons: item.plan_reasons ?? [],
              capabilityId: item.input.capabilityId,
              connectionId: item.input.connectionId,
              resolvedInput: item.resolved_input,
              ...(item.cost_estimate ? { costEstimate: item.cost_estimate } : {}),
            },
          }
        : {}),
      ...(origin ? { origin } : {}),
      ...(item.job_id ? { jobId: item.job_id } : {}),
      ...(item.job_status ? { jobStatus: item.job_status } : {}),
      ...(item.cost_estimate
        ? { estimatedCost: item.cost_estimate.totalReservation }
        : {}),
    };
  });
  const estimate = aggregate(items);
  return {
    body: {
      id: row.id,
      revision: Number(row.revision),
      canvasId: row.canvas_id,
      sceneId: row.scene_id ?? null,
      canvasRevision: Number(row.canvas_revision),
      currentCanvasRevision: Number(row.current_canvas_revision),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      ...(estimate ? { estimate } : {}),
      items,
    },
  };
}
/**
 * The total is the sum of the items' own immutable reservations. It never invents a
 * price: the number of items that actually contributed is stated in the basis note,
 * and a mixed-currency selection is named rather than silently converted.
 */
function aggregate(items: BatchItem[]): Schema<"CostEstimate"> | undefined {
  const quoted = items.flatMap((item) =>
    item.plan?.costEstimate ? [item.plan.costEstimate] : [],
  );
  if (!quoted.length) return undefined;
  const currencies = [...new Set(quoted.map((e) => e.totalReservation.currency))];
  const revisions = [...new Set(quoted.map((e) => e.pricingRevision))];
  const note = [
    `${quoted.length}/${items.length} 项已固定计划并给出估价`,
    currencies.length > 1
      ? `所选能力使用不同货币（${currencies.join("、")}），不做跨币种换算，因此不给出合计`
      : undefined,
  ]
    .filter(Boolean)
    .join("；");
  const line = () => ({
    pricingRevision: `canvas-batch-aggregate/1 of ${revisions.length} revision(s)`,
    lines: quoted.flatMap((estimate) => estimate.lines),
  });
  // Summing across currencies would invent a number, so a mixed selection states no
  // total at all rather than labelling one currency's units with another's.
  if (currencies.length > 1)
    return { ...line(), baseCost: zeroMoney, holdMargin: zeroMoney, totalReservation: zeroMoney, basisNote: note };
  const currency = currencies[0]!;
  const sum = (pick: (estimate: Schema<"CostEstimate">) => string) =>
    quoted
      .reduce((total, estimate) => total + BigInt(pick(estimate)), 0n)
      .toString();
  return {
    ...line(),
    baseCost: { currency, amountMicros: sum((e) => e.baseCost.amountMicros) },
    holdMargin: { currency, amountMicros: sum((e) => e.holdMargin.amountMicros) },
    totalReservation: {
      currency,
      amountMicros: sum((e) => e.totalReservation.amountMicros),
    },
    basisNote: note,
  };
}
const zeroMoney: Schema<"Money"> = { currency: "XXX", amountMicros: "0" };
/**
 * A selected node that could not become a plan still gets a durable blocked plan row
 * carrying the reason, so the batch keeps exactly one item per selected node and the
 * confirmation screen can account for the whole selection after a reload. The row is
 * never executable and never claims a resolution it does not have: the node's own
 * requested capability is kept when it is known and still configured, so the screen
 * cannot credit an unrelated model to a node that asked for another one.
 */
async function recordUnusable(
  tx: Transaction,
  code: string,
  requested?: { capabilityId: string; connectionId: string; kind: string },
) {
  const capability = (
    await tx.sql.query(
      requested
        ? "SELECT id,connection_id,connection_version_id,revision,execution_mode,definition FROM generation_capabilities WHERE tenant_id=$1 AND id=$2 AND connection_id=$3"
        : "SELECT id,connection_id,connection_version_id,revision,execution_mode,definition FROM generation_capabilities WHERE tenant_id=$1 AND enabled ORDER BY id LIMIT 1",
      requested
        ? [tx.tenantId, requested.capabilityId, requested.connectionId]
        : [tx.tenantId],
    )
  ).rows[0];
  requireThat(
    capability,
    503,
    "MODEL_NOT_CONFIGURED",
    "尚未配置并验证此模型能力。",
  );
  // A plan is immutable once written, so the input is composed before the one insert.
  const row = (
    await tx.sql.query(
      `INSERT INTO generation_plans(id,tenant_id,project_id,capability_id,connection_version_id,created_by,input,resolved_input,input_hash,capability_revision,base_content_snapshot,cost_estimate,blocking_reasons,execution_mode,status,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,$13,'blocked',now()+interval '10 minutes') RETURNING id`,
      [
        randomUUID(),
        tx.tenantId,
        tx.projectId,
        capability.id,
        capability.connection_version_id,
        tx.session.userId,
        {
          scope: "project",
          projectId: tx.projectId,
          // The node's own kind when known; the capability's declared purpose
          // otherwise, so an audio node is never recorded as an image request.
          purpose: requested?.kind ?? capability.definition?.purpose ?? "image",
          capabilityId: capability.id,
          connectionId: capability.connection_id,
          prompt: "",
          output: {},
          additionalReferences: [],
          referenceOverrides: [],
          promptPolicy: "replace",
        },
        {
          // States plainly that this plan resolved nothing.
          resolverVersion: "canvas-batch/unresolved",
          prompt: "",
          references: [],
          shots: [],
          dependencies: [],
        },
        "0".repeat(64),
        capability.revision,
        {},
        JSON.stringify([code]),
        capability.execution_mode,
      ],
    )
  ).rows[0];
  requireThat(row, 503, "MODEL_NOT_CONFIGURED", "尚未配置并验证此模型能力。");
  return row.id as string;
}
async function authoriseCanvas(tx: Transaction, input: Input) {
  // Recheck current ownership and active parents before any cached replay: a
  // retained fixed plan is history, not authority to prepare again.
  const canvasId =
    input.params.canvasId ?? (await sceneCanvasId(tx, input.params.sceneId!));
  if (input.params.sceneId) await activeParent(tx, "scenes", input.params.sceneId);
  requireThat(
    (
      await tx.sql.query("SELECT discussion_canvas_scope($1,$2,$3,true) AS scope", [
        tx.tenantId,
        tx.projectId,
        canvasId,
      ])
    ).rows[0]?.scope,
    404,
    "CANVAS_CONTEXT_UNAVAILABLE",
    "画布不存在、已归档或无访问权限。",
  );
}
export function canvasGenerationBatchRoutes(
  app: FastifyInstance,
  context: ApiContext & Pick<MediaContext, "generationExecutor">,
) {
  for (const operation of [
    "prepareCanvasGenerationBatch",
    "prepareProjectCanvasGenerationBatch",
  ] as const)
    registerAction(
      app,
      context,
      operation,
      async (tx, input) => {
        // Shot sources are stated once for the whole selection and therefore apply to
        // every item. A selection that needs different shot inputs per node is a
        // single-node preparation, not a batch: the request shape deliberately does
        // not carry a per-node mapping, so a node is never bound to another node's
        // shot input by accident.
        const canvasId =
          input.params.canvasId ?? (await sceneCanvasId(tx, input.params.sceneId!));
        await canvasRoot(tx, canvasId, true);
        const canvas = await readCanvas(tx, canvasId);
        versionMatches(canvas.revision, input.version);
        const nodeIds: string[] = input.body.nodeIds.map((id: string) =>
          id.toLowerCase(),
        );
        requireThat(
          nodeIds.length <= BATCH_LIMIT,
          422,
          "CANVAS_BATCH_TOO_LARGE",
          `一次最多固定 ${BATCH_LIMIT} 个节点的生成计划。`,
        );
        const batchId = randomUUID();
        await tx.sql.query(
          "INSERT INTO generation_batches(id,tenant_id,project_id,canvas_id,scene_id,canvas_revision,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            batchId,
            tx.tenantId,
            tx.projectId,
            canvasId,
            input.params.sceneId ?? null,
            canvas.revision,
            tx.session.userId,
          ],
        );
        let sequence = 0;
        for (const nodeId of nodeIds) {
          // Never interpolate request input into SQL, even as an identifier.
          const savepoint = `batch_prepare_${(sequence += 1)}`;
          await tx.sql.query(`SAVEPOINT ${savepoint}`);
          const node = canvas.document.nodes.find((n) => n.id === nodeId);
          if (
            !node ||
            (node.kind !== "image" && node.kind !== "video" && node.kind !== "audio") ||
            node.content.type !== "draft" ||
            !node.content.connectionId ||
            !node.content.capabilityId
          ) {
            // There is no usable draft here, so the only honest identity to keep is
            // what the node itself declares.
            const declared =
              node?.content.type === "draft" &&
              node.content.capabilityId &&
              node.content.connectionId &&
              (node.kind === "image" ||
                node.kind === "video" ||
                node.kind === "audio")
                ? {
                    capabilityId: node.content.capabilityId,
                    connectionId: node.content.connectionId,
                    kind: node.kind,
                  }
                : undefined;
            const planId = await recordUnusable(
              tx,
              "CANVAS_DRAFT_REQUIRED",
              declared,
            );
            await tx.sql.query(`RELEASE SAVEPOINT ${savepoint}`);
            await tx.sql.query(
              "INSERT INTO generation_batch_items(tenant_id,project_id,batch_id,canvas_id,node_id,plan_id,status,problem_code,blocking_reasons) VALUES($1,$2,$3,$4,$5,$6,'invalid',$7,$8)",
              [
                tx.tenantId,
                tx.projectId,
                batchId,
                canvasId,
                nodeId,
                planId,
                "CANVAS_DRAFT_REQUIRED",
                JSON.stringify(["CANVAS_DRAFT_REQUIRED"]),
              ],
            );
            continue;
          }
          const draft = node;
          // Re-assert the draft shape so the model inputs below are read from a
          // narrowed document node rather than re-checked field by field.
          requireThat(
            draft.content.type === "draft" &&
              draft.content.connectionId &&
              draft.content.capabilityId,
            422,
            "CANVAS_DRAFT_REQUIRED",
            "请保存一个已选模型能力的图片、视频或音频草稿。",
          );
          let planId: string, status: string, reasons: string[], code: string | null;
          try {
            const plan = await createPlan(tx, {
              scope: "project",
              projectId: tx.projectId!,
              purpose: draft.kind,
              connectionId: draft.content.connectionId,
              capabilityId: draft.content.capabilityId,
              prompt: draft.content.prompt,
              output: draft.content.output,
              shotSources: input.body.shotSources,
              referenceOverrides: input.body.referenceOverrides,
              additionalReferences: [],
              promptPolicy: input.body.promptPolicy,
              contextSources: [
                {
                  kind: "canvas_draft",
                  objectId: draft.id,
                  revision: canvas.revision,
                },
              ],
            } as Schema<"PlanInput">);
            planId = plan.id;
            status = plan.status === "ready" ? "ready" : "blocked";
            code = null;
            reasons = plan.blockingReasons;
          } catch (error) {
            // One unusable node must not discard the plans already fixed for the
            // rest of the selection, so only this item's work is rolled back.
            await tx.sql.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            const failure = problemOf(error, "prepare");
            planId = await recordUnusable(tx, failure.code, {
              capabilityId: draft.content.capabilityId,
              connectionId: draft.content.connectionId,
              kind: draft.kind,
            });
            status = "invalid";
            code = failure.code;
            reasons = [failure.code];
          }
          await tx.sql.query(`RELEASE SAVEPOINT ${savepoint}`);
          await tx.sql.query(
            "INSERT INTO generation_batch_items(tenant_id,project_id,batch_id,canvas_id,node_id,plan_id,status,problem_code,blocking_reasons) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              tx.tenantId,
              tx.projectId,
              batchId,
              canvasId,
              nodeId,
              planId,
              status,
              code,
              JSON.stringify(reasons),
            ],
          );
        }
        return await readBatch(tx, batchId);
      },
      {
        authorizeScope: async (tx, input) => {
          await authoriseCanvas(tx, input);
        },
      },
    );
  registerAction(
    app,
    context,
    "getCanvasGenerationBatch",
    async (tx, input) => await readBatch(tx, input.params.batchId!),
    {
      authorizeScope: async (tx, input) => {
        await canvasRoot(tx, (await batchRow(tx, input.params.batchId!)).canvas_id);
      },
    },
  );
  registerAction(
    app,
    context,
    "executeCanvasGenerationBatch",
    async (tx, input) => {
      const batchId = input.params.batchId!;
      const row = await batchRow(tx, batchId);
      const canvas = await readCanvas(tx, row.canvas_id);
      // An empty selection must not silently mean "the whole batch": the caller has
      // to name the items it is spending on.
      const wanted: string[] = input.body.nodeIds.map((id: string) =>
        id.toLowerCase(),
      );
      requireThat(
        wanted.length >= 1,
        422,
        "CANVAS_BATCH_EMPTY",
        "请明确本次要提交的节点。",
      );
      requireThat(
        wanted.length <= BATCH_LIMIT,
        422,
        "CANVAS_BATCH_TOO_LARGE",
        `一次最多执行 ${BATCH_LIMIT} 个节点。`,
      );
      requireThat(
        new Set(wanted).size === wanted.length,
        422,
        "CANVAS_BATCH_DUPLICATE",
        "同一次提交不能重复同一节点。",
      );
      const rows = (
        await tx.sql.query(itemSql, [tx.tenantId, tx.projectId, batchId])
      ).rows as ItemRow[];
      const selected = rows.filter((item) => wanted.includes(item.node_id));
      requireThat(
        selected.length === wanted.length,
        422,
        "CANVAS_BATCH_ITEM_UNKNOWN",
        "所选节点不属于这一次准备，请重新读取批次。",
      );
      let sequence = 0,
        changed = false;
      for (const item of selected) {
        // An item that already has a job is left untouched: a retry re-runs only the
        // items whose submission was refused, never the whole batch and never one
        // that already ran.
        if (item.job_id || item.status !== "ready") continue;
        // The batch fixed one canvas revision. An item the canvas has moved past is
        // reported stale and re-prepared, never executed against a new state.
        if (Number(row.canvas_revision) !== canvas.revision) continue;
        // A plan past its own expiry cannot execute; it is reported expired and
        // re-prepared rather than attempted.
        if (item.expires_at.getTime() <= Date.now()) continue;
        const savepoint = `batch_run_${(sequence += 1)}`;
        await tx.sql.query(`SAVEPOINT ${savepoint}`);
        try {
          await executePlanOnce(tx, item.plan_id, {
            generationExecutor: context.generationExecutor === true,
          });
          await tx.sql.query(`RELEASE SAVEPOINT ${savepoint}`);
          // The plan verdict never changes; only the last attempt's outcome does.
          await tx.sql.query(
            "UPDATE generation_batch_items SET problem_code=NULL,blocking_reasons='[]',updated_at=now() WHERE tenant_id=$1 AND project_id=$2 AND batch_id=$3 AND node_id=$4",
            [tx.tenantId, tx.projectId, batchId, item.node_id],
          );
        } catch (error) {
          // Quota, capability change or expiry on one item leaves the batch's other
          // already-submitted jobs alone, and leaves this item retryable because its
          // plan verdict is untouched.
          await tx.sql.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await tx.sql.query(`RELEASE SAVEPOINT ${savepoint}`);
          const failure = problemOf(error, "run");
          await tx.sql.query(
            "UPDATE generation_batch_items SET problem_code=$1,blocking_reasons=$2,updated_at=now() WHERE tenant_id=$3 AND project_id=$4 AND batch_id=$5 AND node_id=$6",
            [
              failure.code,
              JSON.stringify([failure.code]),
              tx.tenantId,
              tx.projectId,
              batchId,
              item.node_id,
            ],
          );
        }
        changed = true;
      }
      // Item state moved, so the batch's change token moves with it.
      if (changed)
        await tx.sql.query(
          "UPDATE generation_batches SET revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
          [tx.tenantId, tx.projectId, batchId],
        );
      return await readBatch(tx, batchId);
    },
    {
      authorizeScope: async (tx, input) => {
        await canvasRoot(tx, (await batchRow(tx, input.params.batchId!)).canvas_id, true);
      },
    },
  );
}
