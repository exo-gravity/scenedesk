import type { Transaction } from "../../kernel/database.js";
import { canonical } from "../../kernel/crypto.js";
import { requireThat, versionMatches } from "../../kernel/errors.js";
import { activeParent, type Schema } from "../content/model.js";
import { validateReference } from "./prompt-input.js";

/** Explicit node bodies only: neighbouring nodes and enabled edges are not consent. */
export async function resolveCanvasSources(
  tx: Transaction,
  sources: Schema<"CanvasAssistanceSource">[],
  checkVersion: boolean,
) {
  const snapshots: Schema<"CanvasAssistanceSnapshot">[] = [],
    references: Schema<"ResolvedReference">[] = [],
    dependencies: Schema<"SourceDependency">[] = [],
    seen = new Set<string>();
  requireThat(sources.length > 0 && sources.length <= 20, 422,
    "CANVAS_ASSISTANCE_LIMIT", "请选择 1–20 个明确的画布节点。");
  for (const raw of sources) {
    const source = { ...raw, canvasId: raw.canvasId.toLowerCase(), nodeId: raw.nodeId.toLowerCase() };
    requireThat(!seen.has(source.nodeId), 422, "DUPLICATE_CANVAS_SOURCE", "同一个画布节点只能明确选择一次。");
    seen.add(source.nodeId);
    const canvas = (await tx.sql.query(
      "SELECT c.revision,l.scene_id FROM canvases c JOIN scene_canvas_links l ON l.canvas_id=c.id WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.id=$3",
      [tx.tenantId, tx.projectId, source.canvasId],
    )).rows[0];
    requireThat(canvas, 404, "CANVAS_CONTEXT_UNAVAILABLE", "明确选择的画布不存在或无访问权限。");
    await activeParent(tx, "scenes", canvas.scene_id);
    if (checkVersion) versionMatches(Number(canvas.revision), source.canvasRevision);
    const snapshot = (await tx.sql.query(
      "SELECT canvas_assistance_snapshot($1,$2,$3,$4) AS snapshot",
      [tx.tenantId, tx.projectId, source, checkVersion],
    )).rows[0]?.snapshot as Schema<"CanvasAssistanceSnapshot"> | null;
    requireThat(snapshot, 422, "CANVAS_CONTEXT_UNAVAILABLE", "节点已移除、版本不符或参考用途不合法，请保留输入并核对。");
    if (snapshot.content.type === "media") {
      const reference: Schema<"Reference"> = {
        mediaId: snapshot.content.mediaId,
        purpose: source.purpose!,
        ...(snapshot.content.assetRevisionId ? { assetRevisionId: snapshot.content.assetRevisionId } : {}),
      };
      await validateReference(tx, reference);
      references.push({ sourceLevel: "attempt", sourceObjectId: source.nodeId, reference });
    }
    snapshots.push(snapshot);
    dependencies.push({ kind: "canvas_node", objectId: source.nodeId,
      revision: source.canvasRevision, tracking: "current", contentHash: snapshot.contentHash });
  }
  return { snapshots, references, dependencies };
}

/** History remains fixed, but it never grants access to media or revoked asset imports. */
export async function assertCanvasAssistanceAccess(tx: Transaction, resolved: Schema<"ResolvedInput">) {
  for (const snapshot of resolved.canvasSnapshots ?? []) {
    requireThat((await tx.sql.query(
      "SELECT 1 FROM canvases WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
      [tx.tenantId, tx.projectId, snapshot.source.canvasId],
    )).rowCount, 404, "CANVAS_CONTEXT_UNAVAILABLE", "固定来源画布已不可访问。");
    if (snapshot.content.type === "media") await validateReference(tx, {
      mediaId: snapshot.content.mediaId, purpose: snapshot.source.purpose!,
      ...(snapshot.content.assetRevisionId ? { assetRevisionId: snapshot.content.assetRevisionId } : {}),
    });
  }
  if (resolved.canvasSnapshots?.length)
    for (const item of resolved.references) await validateReference(tx,item.reference);
}

export async function assertCanvasAssistanceCurrent(tx: Transaction, resolved: Schema<"ResolvedInput">) {
  if (!resolved.canvasSnapshots?.length) return;
  const fresh = await resolveCanvasSources(tx, resolved.canvasSnapshots.map((s) => s.source), false);
  requireThat(canonical(fresh.snapshots) === canonical(resolved.canvasSnapshots),
    409, "PLAN_INPUT_CHANGED", "明确选择的节点内容已变化；原固定快照不会升级，请核对后重新准备。");
}
