import type { Transaction } from "../../kernel/database.js";
import { canonical, digest } from "../../kernel/crypto.js";
import { requireThat, versionMatches } from "../../kernel/errors.js";
import type { Schema } from "../content/model.js";

/** Only a persisted draft can identify canvas_draft. Layout, titles and disabled edges are not inputs. */
export async function canvasDraftInput(
  tx: Transaction,
  source: Schema<"ContextSourceInput">,
  checkVersion: boolean,
) {
  const row = (
    await tx.sql.query(
      `SELECT c.id,c.revision,b.document FROM canvas_node_index n JOIN canvases c ON c.id=n.canvas_id JOIN canvas_revisions r ON r.canvas_id=c.id AND r.revision=c.revision JOIN canvas_history_bodies b ON b.canvas_id=c.id AND b.hash=r.body_hash JOIN scene_canvas_links l ON l.canvas_id=c.id JOIN scenes s ON s.id=l.scene_id JOIN episodes e ON e.id=s.episode_id WHERE n.tenant_id=$1 AND n.project_id=$2 AND n.node_id=$3 AND s.status='active' AND e.status='active'`,
      [tx.tenantId, tx.projectId, source.objectId],
    )
  ).rows[0];
  requireThat(
    row,
    404,
    "CANVAS_CONTEXT_UNAVAILABLE",
    "选定画布草稿不存在、已归档或无访问权限。",
  );
  if (checkVersion) versionMatches(Number(row.revision), source.revision);
  const document = row.document as Schema<"CanvasDocument">,
    node = document.nodes.find((n) => n.id === source.objectId.toLowerCase());
  requireThat(
    node?.content.type === "draft",
    422,
    "CANVAS_DRAFT_REQUIRED",
    "画布上下文必须明确选择创作草稿，不能把文字或素材节点作为草稿。",
  );
  const references: Schema<"ResolvedReference">[] = [];
  const edges = document.edges
    .filter((e) => e.targetNodeId === node.id && e.enabled)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const inputs = edges.map((edge) => {
    const reference = document.nodes.find((n) => n.id === edge.sourceNodeId);
    requireThat(
      reference && reference.content.type !== "draft",
      422,
      "CANVAS_CONTEXT_UNAVAILABLE",
      "画布输入引用已变化，请重新选择草稿。",
    );
    if (reference.content.type === "media") {
      requireThat(
        edge.purpose !== "prompt",
        422,
        "INVALID_REFERENCE_PURPOSE",
        "媒体参考必须选择明确用途。",
      );
      references.push({
        sourceLevel: "attempt",
        sourceObjectId: node.id,
        reference: {
          mediaId: reference.content.mediaId,
          purpose: edge.purpose,
          ...(reference.content.assetRevisionId
            ? { assetRevisionId: reference.content.assetRevisionId }
            : {}),
          ...(edge.subjectAssetId
            ? { subjectAssetId: edge.subjectAssetId }
            : {}),
          ...(edge.note ? { note: edge.note } : {}),
        },
      });
    }
    return {
      sourceNodeId: reference.id,
      content: reference.content,
      purpose: edge.purpose,
      position: edge.position,
      ...(edge.subjectAssetId ? { subjectAssetId: edge.subjectAssetId } : {}),
      ...(edge.note ? { note: edge.note } : {}),
    };
  });
  const text = canonical({
    nodeId: node.id,
    kind: node.kind,
    content: node.content,
    inputs,
  });
  requireThat(
    Array.from(text).length <= 20000,
    422,
    "GENERATION_CONTEXT_TOO_LARGE",
    "画布草稿输入过长，请减少明确选择的内容。",
  );
  return {
    snapshot: {
      source: {
        kind: "canvas_draft",
        objectId: node.id,
        revision: Number(row.revision),
        tracking: "current",
        contentHash: digest(text),
      },
      text,
    } as Schema<"ContextSnapshot">,
    references,
  };
}
