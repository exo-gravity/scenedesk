import {
  editingCanonical,
  inspectCanvasDocument,
  type CanvasDocument,
  type CanvasNode,
} from "@drama/domain";

export type CanvasCreation = { id: string; sources: CanvasNode[] };
const sourceIdentity = (node: CanvasNode) =>
  editingCanonical({
    id: node.id,
    kind: node.kind,
    title: node.title,
    content: node.content,
  });

/** Pin the selected source identities/content. Layout changes remain independent. */
export function prepareCanvasCreation(
  document: CanvasDocument,
  selected: readonly string[],
): CanvasCreation {
  const ids = [...new Set(selected)];
  if (!ids.length) throw new Error("请先选择已有素材或文字。");
  const sources = ids.map((id) => {
    const node = document.nodes.find((item) => item.id === id);
    if (!node) throw new Error("所选来源已移除，请重新选择。");
    if (node.content.type === "draft")
      throw new Error("未完成的草稿不能作为参考，请选择已有素材或文字。");
    return structuredClone(node);
  });
  return { id: crypto.randomUUID(), sources };
}

export function createCanvasDraft(
  document: CanvasDocument,
  prepared: CanvasCreation,
  kind: "image" | "video" | "audio",
) {
  if (document.nodes.some((node) => node.id === prepared.id))
    throw new Error("这份草稿已创建，请继续编辑现有草稿。");
  if (!prepared.sources.length) throw new Error("请先选择已有素材或文字。");
  for (const source of prepared.sources) {
    const current = document.nodes.find((node) => node.id === source.id);
    if (
      !current ||
      current.content.type === "draft" ||
      sourceIdentity(current) !== sourceIdentity(source)
    )
      throw new Error("打开操作后来源已修改或移除，请重新选择后继续。");
  }
  const node: CanvasNode = {
    id: prepared.id,
    kind,
    title: `新的${{ image: "图片", video: "视频", audio: "声音" }[kind]}草稿`,
    width: 360,
    position: {
      x:
        Math.max(
          ...prepared.sources.map((source) => source.position.x + source.width),
        ) + 96,
      y: Math.min(...prepared.sources.map((source) => source.position.y)),
    },
    content: { type: "draft", prompt: "", output: {} },
  };
  const next: CanvasDocument = {
    ...document,
    nodes: [...document.nodes, node],
    edges: [
      ...document.edges,
      ...prepared.sources.map((source, position) => ({
        id: crypto.randomUUID(),
        sourceNodeId: source.id,
        targetNodeId: node.id,
        enabled: true,
        purpose:
          source.kind === "text"
            ? ("prompt" as const)
            : source.kind === "audio"
              ? ("voice" as const)
              : ("composition" as const),
        position,
      })),
    ],
  };
  inspectCanvasDocument(next);
  return next;
}
