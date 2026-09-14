import type { components } from "@drama/contracts";
import { editingCanonical } from "./editing-canonical.js";

export type CanvasDocument = components["schemas"]["CanvasDocument"];
export type CanvasNode = components["schemas"]["CanvasNode"];
/** Persisted layout of an explicitly materialized generation result group. */
export const CANVAS_RESULT_LAYOUT = Object.freeze({
  width: 320,
  stepX: 340,
});
export const CANVAS_LIMITS = Object.freeze({
  nodes: 2000,
  edges: 5000,
  groups: 200,
  bytes: 4 * 1024 * 1024,
});
export class CanvasDocumentError extends Error {
  constructor(
    readonly code: "CANVAS_REFERENCE_INVALID" | "CANVAS_LIMIT_EXCEEDED",
    message: string,
  ) {
    super(message);
    this.name = "CanvasDocumentError";
  }
}
function invalid(message: string): never {
  throw new CanvasDocumentError("CANVAS_REFERENCE_INVALID", message);
}
export function canvasNodeIdentity(node: CanvasNode) {
  return {
    kind: node.kind,
    type: node.content.type,
    ...(node.content.type === "media"
      ? {
          mediaId: node.content.mediaId.toLowerCase(),
          assetRevisionId: node.content.assetRevisionId?.toLowerCase() ?? null,
        }
      : {}),
  };
}

/** Input has already passed the generated schema. Authorization and historical
 * node identity are checked against the locked database root, never the browser. */
export function inspectCanvasDocument(document: CanvasDocument) {
  for (const key of ["nodes", "edges", "groups"] as const)
    if (document[key].length > CANVAS_LIMITS[key])
      throw new CanvasDocumentError(
        "CANVAS_LIMIT_EXCEEDED",
        "画布超过容量限制，请保留本机内容并分开整理。",
      );
  let canonical: string;
  try {
    canonical = editingCanonical(document);
  } catch {
    return invalid("画布包含无效的字符或坐标。");
  }
  // PostgreSQL text/jsonb cannot represent NUL; reject without an internal error.
  JSON.stringify(document, (_key, value: unknown) => {
    if (typeof value === "string" && value.includes("\0"))
      invalid("画布包含无效的空字符。");
    return value;
  });
  const bytes = new TextEncoder().encode(canonical).byteLength;
  if (bytes > CANVAS_LIMITS.bytes)
    throw new CanvasDocumentError(
      "CANVAS_LIMIT_EXCEEDED",
      "画布正文超过 4 MiB，请保留本机内容并分开整理。",
    );
  const ids = new Set<string>();
  for (const item of [
    ...document.nodes,
    ...document.edges,
    ...document.groups,
  ]) {
    const id = item.id.toLowerCase();
    if (ids.has(id)) invalid("节点、连线与分组不能使用重复的标识。");
    ids.add(id);
  }
  const nodes = new Map(document.nodes.map((n) => [n.id.toLowerCase(), n]));
  const groups = new Set(document.groups.map((g) => g.id.toLowerCase()));
  for (const node of document.nodes) {
    if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))
      invalid("节点坐标必须是有限数。");
    if (node.groupId && !groups.has(node.groupId.toLowerCase()))
      invalid("节点引用的分组不存在。");
  }
  for (const edge of document.edges) {
    const source = nodes.get(edge.sourceNodeId.toLowerCase()),
      target = nodes.get(edge.targetNodeId.toLowerCase());
    if (
      !source ||
      !target ||
      source.id.toLowerCase() === target.id.toLowerCase()
    )
      invalid("连线端点不存在或指向自身。");
    if (source.content.type === "draft" || target.content.type !== "draft")
      invalid("参考只允许从文字或已有媒体连接到创作草稿。");
    if (source.content.type === "text" && edge.purpose !== "prompt")
      invalid("文字参考的用途必须是提示。");
  }
  return { canonical, bytes };
}
