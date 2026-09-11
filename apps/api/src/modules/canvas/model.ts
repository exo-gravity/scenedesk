import {
  EDITING_HISTORY_POLICY,
  retainEditingHistory,
  type HistoryFact,
  inspectCanvasDocument,
  type CanvasDocument,
} from "@drama/domain";
import type { Transaction } from "../../kernel/database.js";
import { digest, canonical } from "../../kernel/crypto.js";
import { Problem, requireThat } from "../../kernel/errors.js";
import type { ApiContext } from "../../kernel/routes.js";
import type { Schema } from "../content/model.js";

export async function canvasRoot(tx: Transaction, id: string, lock = false) {
  const result = await tx.sql.query(
    `SELECT * FROM canvases WHERE tenant_id=$1 AND project_id=$2 AND id=$3 ${lock ? "FOR UPDATE" : ""}`,
    [tx.tenantId, tx.projectId, id],
  );
  requireThat(result.rows[0], 404, "NOT_FOUND", "画布不存在或无访问权限。");
  return result.rows[0];
}
export async function canvasHistory(tx: Transaction, id: string) {
  // Generation origins retain their own exact snapshots, not full-history pins.
  // Any future owner of a full revision must supply typed pins here before use.
  const result = await tx.sql.query(
    `SELECT r.*,b.canonical_bytes FROM canvas_revisions r
    JOIN canvas_history_bodies b ON b.canvas_id=r.canvas_id AND b.hash=r.body_hash
    WHERE r.tenant_id=$1 AND r.project_id=$2 AND r.canvas_id=$3 ORDER BY r.revision DESC`,
    [tx.tenantId, tx.projectId, id],
  );
  const clock = await tx.sql.query("SELECT transaction_timestamp() AS now");
  const policy = retainEditingHistory(
    result.rows.map((r): HistoryFact => ({
      revision: Number(r.revision),
      documentHash: r.body_hash,
      canonicalBytes: r.canonical_bytes,
      createdAt: r.created_at.getTime(),
      pinned: false,
    })),
    clock.rows[0].now.getTime(),
  );
  return { rows: result.rows, ...policy };
}
export async function readCanvas(
  tx: Transaction,
  id: string,
  revision?: number,
): Promise<Schema<"Canvas">> {
  const root = await canvasRoot(tx, id);
  const wanted = revision ?? Number(root.revision);
  requireThat(
    wanted <= Number(root.revision),
    404,
    "NOT_FOUND",
    "这个画布版本尚不存在。",
  );
  if (revision !== undefined)
    requireThat(
      (await canvasHistory(tx, id)).retained.has(revision),
      410,
      "EDIT_HISTORY_EXPIRED",
      "这个恢复点已过保留期，请查看仍保留的版本。",
    );
  const result = await tx.sql.query(
    `SELECT r.revision,r.created_at,b.document,b.hash FROM canvas_revisions r
    JOIN canvas_history_bodies b ON b.canvas_id=r.canvas_id AND b.hash=r.body_hash
    WHERE r.tenant_id=$1 AND r.project_id=$2 AND r.canvas_id=$3 AND r.revision=$4`,
    [tx.tenantId, tx.projectId, id, wanted],
  );
  const row = result.rows[0];
  requireThat(row, 410, "EDIT_HISTORY_EXPIRED", "这个恢复点已过保留期。");
  return {
    id,
    projectId: tx.projectId!,
    revision: Number(row.revision),
    schemaVersion: 1,
    document: row.document,
    documentHash: row.hash,
    updatedAt: row.created_at.toISOString(),
  };
}
export async function appendCanvas(
  tx: Transaction,
  id: string,
  document: CanvasDocument,
  revision: number,
) {
  const inspected = inspectCanvasDocument(document),
    hash = digest(inspected.canonical);
  await tx.sql.query(
    "INSERT INTO canvas_history_bodies(tenant_id,project_id,canvas_id,hash,canonical_json) VALUES($1,$2,$3,$4,$5) ON CONFLICT(canvas_id,hash) DO NOTHING",
    [tx.tenantId, tx.projectId, id, hash, inspected.canonical],
  );
  await tx.sql.query(
    "INSERT INTO canvas_revisions(tenant_id,project_id,canvas_id,revision,body_hash,updated_by) VALUES($1,$2,$3,$4,$5,$6)",
    [tx.tenantId, tx.projectId, id, revision, hash, tx.session.userId],
  );
  await pruneCanvasHistory(tx, id);
  return readCanvas(tx, id);
}
export async function pruneCanvasHistory(tx: Transaction, id: string) {
  const history = await canvasHistory(tx, id);
  const expired = history.rows
    .filter((r) => !history.retained.has(Number(r.revision)))
    .map((r) => r.revision);
  if (expired.length)
    await tx.sql.query(
      "DELETE FROM canvas_revisions WHERE tenant_id=$1 AND project_id=$2 AND canvas_id=$3 AND revision=ANY($4::bigint[])",
      [tx.tenantId, tx.projectId, id, expired],
    );
  await tx.sql.query(
    `DELETE FROM canvas_history_bodies b WHERE tenant_id=$1 AND project_id=$2 AND canvas_id=$3
    AND NOT EXISTS(SELECT 1 FROM canvas_revisions r WHERE r.canvas_id=b.canvas_id AND r.body_hash=b.hash)`,
    [tx.tenantId, tx.projectId, id],
  );
}
export async function sceneCanvasId(tx: Transaction, sceneId: string) {
  const result = await tx.sql.query(
    "SELECT canvas_id FROM scene_canvas_links WHERE tenant_id=$1 AND project_id=$2 AND scene_id=$3",
    [tx.tenantId, tx.projectId, sceneId],
  );
  requireThat(
    result.rows[0],
    404,
    "SCENE_CANVAS_NOT_CREATED",
    "本场尚未创建画布，请明确进入自由画布后开始。",
  );
  return result.rows[0].canvas_id as string;
}
export async function historyPage(
  tx: Transaction,
  context: ApiContext,
  id: string,
  query: Record<string, unknown>,
) {
  const root = await canvasRoot(tx, id),
    history = await canvasHistory(tx, id);
  const cursorContext = canonical([
    "canvasHistory-v1",
    tx.session.userId,
    tx.tenantId,
    tx.projectId,
    id,
  ]);
  let before = Infinity;
  if (query.cursor !== undefined) {
    try {
      before = context.secrets.open<number>(
        String(query.cursor),
        cursorContext,
      );
      if (!Number.isSafeInteger(before) || before < 1)
        throw new Error("Invalid revision");
    } catch {
      throw new Problem(
        422,
        "INVALID_CURSOR",
        "恢复列表游标无效或属于其他画布。",
      );
    }
  }
  const limit = Number(query.limit ?? 30);
  const rows = history.rows.filter(
      (r) =>
        Number(r.revision) < before && history.retained.has(Number(r.revision)),
    ),
    selected = rows.slice(0, limit);
  return {
    items: selected.map((r) => ({
      revision: Number(r.revision),
      documentHash: r.body_hash,
      updatedAt: r.created_at.toISOString(),
      updatedBy: r.updated_by,
      retainedFor: [...history.retained.get(Number(r.revision))!],
    })),
    latestRevision: Number(root.revision),
    policy: EDITING_HISTORY_POLICY,
    ...(rows.length > limit
      ? {
          nextCursor: context.secrets.seal(
            Number(selected.at(-1)!.revision),
            cursorContext,
          ),
        }
      : {}),
  } satisfies Schema<"EditingHistoryPage">;
}

export const defaultScenePreference: Schema<"SaveSceneWorkspacePreference"> = {
  mode: "storyboard",
  selectedShotId: null,
  selectedNodeIds: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  assetPanelOpen: false,
  assistantOpen: false,
};
export async function readPreference(
  tx: Transaction,
  sceneId: string,
): Promise<Schema<"SceneWorkspacePreference">> {
  const result = await tx.sql.query(
    "SELECT revision,preference FROM scene_workspace_preferences WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3 AND scene_id=$4",
    [tx.tenantId, tx.projectId, tx.session.userId, sceneId],
  );
  const row = result.rows[0];
  return {
    sceneId,
    revision: Number(row?.revision ?? 0),
    ...(row?.preference ?? defaultScenePreference),
  };
}
