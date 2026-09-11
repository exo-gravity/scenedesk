import { randomUUID } from "node:crypto";
import type { Transaction } from "../../kernel/database.js";
import { Problem, requireThat } from "../../kernel/errors.js";
import { findContent, type Schema } from "../content/model.js";
import { archiveTake } from "../candidates/model.js";
import {
  canvasRoot,
  readCanvas,
  sceneCanvasId,
  pruneCanvasHistory,
} from "./model.js";

export async function readSceneCanvas(
  tx: Transaction,
  sceneId: string,
): Promise<Schema<"SceneCanvas">> {
  const canvas = await readCanvas(tx, await sceneCanvasId(tx, sceneId));
  const bindings = await tx.sql.query(
    `SELECT id,node_id,shot_id,shot_revision_id,role,take_id FROM node_shot_bindings
     WHERE tenant_id=$1 AND project_id=$2 AND canvas_id=$3 ORDER BY created_at,id`,
    [tx.tenantId, tx.projectId, canvas.id],
  );
  const active = new Set(canvas.document.nodes.map((n) => n.id.toLowerCase()));
  return {
    sceneId,
    canvas,
    bindings: bindings.rows.map((b) => ({
      id: b.id,
      nodeId: b.node_id,
      shotId: b.shot_id,
      shotRevisionId: b.shot_revision_id,
      role: b.role,
      ...(b.take_id ? { takeId: b.take_id } : {}),
      nodeActive: active.has(b.node_id),
    })),
  };
}
async function lockSceneCanvas(
  tx: Transaction,
  sceneId: string,
  version: number | undefined,
) {
  await findContent(tx, "scenes", sceneId);
  await tx.sql.query(
    "SELECT id FROM scenes WHERE tenant_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
    [tx.tenantId, tx.projectId, sceneId],
  );
  const id = await sceneCanvasId(tx, sceneId);
  const root = await canvasRoot(tx, id, true);
  if (Number(root.revision) !== version)
    throw new Problem(
      412,
      "CANVAS_VERSION_CONFLICT",
      "画布已被更新，请先保存并核对当前关联。",
      { currentRevision: Number(root.revision) },
    );
  return readCanvas(tx, id);
}
export async function bindSceneNode(
  tx: Transaction,
  sceneId: string,
  nodeId: string,
  version: number | undefined,
  body: Schema<"BindCanvasNode">,
) {
  const canvas = await lockSceneCanvas(tx, sceneId, version);
  const node = canvas.document.nodes.find((n) => n.id.toLowerCase() === nodeId);
  requireThat(
    node,
    404,
    "CANVAS_NODE_MISSING",
    "节点已移出画布，请重新核对目标。",
  );
  requireThat(
    node.content.type === "media",
    422,
    "CANVAS_REFERENCE_INVALID",
    "请先选择已有素材节点；文字和创作草稿可独立保留。",
  );
  const shot = await tx.sql.query(
    `SELECT s.* FROM shots s WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.id=$3 AND s.scene_id=$4 FOR UPDATE`,
    [tx.tenantId, tx.projectId, body.shotId, sceneId],
  );
  requireThat(shot.rows[0], 404, "NOT_FOUND", "镜头不存在或不属于本场次。");
  const available = await tx.sql.query(
    `SELECT candidate_shot_active($1,$2,$3) AND EXISTS(SELECT 1 FROM shot_revisions WHERE tenant_id=$1 AND project_id=$2 AND shot_id=$3 AND id=$4)
      AND EXISTS(SELECT 1 FROM media WHERE tenant_id=$1 AND id=$5 AND status='ready' AND (project_id=$2 OR project_id IS NULL)) AS valid`,
    [
      tx.tenantId,
      tx.projectId,
      body.shotId,
      body.shotRevisionId,
      node.content.mediaId,
    ],
  );
  requireThat(
    available.rows[0]?.valid,
    422,
    "CANVAS_REFERENCE_INVALID",
    "关联需要本场可编辑镜头、确切镜头版本和可用素材。",
  );
  // Reauthorize all fixed references even for an identical command with a new key.
  await tx.sql.query("SELECT validate_canvas_current_references($1)", [
    canvas.id,
  ]);
  if (node.content.assetRevisionId) {
    const asset = await tx.sql.query(
      "SELECT asset_revision_usable($1,$2,$3,false) AS valid",
      [tx.tenantId, tx.projectId, node.content.assetRevisionId],
    );
    requireThat(
      asset.rows[0]?.valid,
      422,
      "CANVAS_REFERENCE_INVALID",
      "这个固定资产版本目前不可用于新关联。",
    );
  }
  const take =
    body.role === "candidate"
      ? await archiveTake(
          tx,
          {
            shotId: body.shotId,
            shotRevisionId: body.shotRevisionId,
            mediaId: node.content.mediaId,
            range: body.range,
            ...(body.sourceTakeId ? { sourceTakeId: body.sourceTakeId } : {}),
          },
          true,
        )
      : undefined;
  const existing = await tx.sql.query(
    "SELECT * FROM node_shot_bindings WHERE tenant_id=$1 AND project_id=$2 AND canvas_id=$3 AND node_id=$4 AND shot_id=$5 AND role=$6",
    [tx.tenantId, tx.projectId, canvas.id, nodeId, body.shotId, body.role],
  );
  const old = existing.rows[0];
  if (old) {
    requireThat(
      old.shot_revision_id === body.shotRevisionId.toLowerCase() &&
        (old.take_id ?? null) === (take?.id ?? null),
      409,
      "CANVAS_BINDING_EXISTS",
      "这个节点已有该镜头关联。请核对原版本和区间；需要替换时先明确解除原关联。",
    );
  } else {
    await tx.sql.query(
      "INSERT INTO node_shot_bindings(id,tenant_id,project_id,canvas_id,node_id,shot_id,shot_revision_id,role,take_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        randomUUID(),
        tx.tenantId,
        tx.projectId,
        canvas.id,
        nodeId,
        body.shotId,
        body.shotRevisionId,
        body.role,
        take?.id ?? null,
        tx.session.userId,
      ],
    );
    await pruneCanvasHistory(tx, canvas.id);
  }
  return readSceneCanvas(tx, sceneId);
}
export async function unbindSceneNode(
  tx: Transaction,
  sceneId: string,
  nodeId: string,
  bindingId: string,
  version: number | undefined,
) {
  const canvas = await lockSceneCanvas(tx, sceneId, version);
  const result = await tx.sql.query(
    "DELETE FROM node_shot_bindings WHERE tenant_id=$1 AND project_id=$2 AND canvas_id=$3 AND node_id=$4 AND id=$5 RETURNING id",
    [tx.tenantId, tx.projectId, canvas.id, nodeId, bindingId],
  );
  requireThat(
    result.rowCount === 1,
    404,
    "NOT_FOUND",
    "这个节点的关联已不存在，请重新读取后核对。",
  );
  await pruneCanvasHistory(tx, canvas.id);
  return readSceneCanvas(tx, sceneId);
}
