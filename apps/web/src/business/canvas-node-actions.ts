import {
  CANVAS_LIMITS,
  type CanvasDocument,
  type CanvasNode,
} from "@drama/domain";

/** 节点名称上限与契约 `NAME`（1..160）一致。 */
export const CANVAS_TITLE_MAX = 160;
/** 副本标题后缀，`复制节点` 之外的变体才使用。 */
const COPY_SUFFIX = " 副本";

/** `复制节点`：只复制所选节点本身，不复制任何连线。 */
export const COPY_NODE = "node";
/** `复制节点和连线`：另外保留所选集合**内部**的连线。 */
export const COPY_WITH_EDGES = "with-edges";
/** `创建副本`：保留上游参考连线、克隆草稿参数、标题加后缀；不继承生成任务与镜头绑定。 */
export const COPY_VARIANT = "variant";
export type CanvasCopyMode =
  | typeof COPY_NODE
  | typeof COPY_WITH_EDGES
  | typeof COPY_VARIANT;

export type CanvasCopyResult = {
  document: CanvasDocument;
  /** 新增节点的 id，按原选择顺序；调用方据此更新选中集合。 */
  nodeIds: string[];
};

function titleWithSuffix(title: string) {
  return `${title.slice(0, CANVAS_TITLE_MAX - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
}

function assertCapacity(document: CanvasDocument, nodes: number, edges: number) {
  if (document.nodes.length + nodes > CANVAS_LIMITS.nodes)
    throw new Error("画布节点已达上限，请先整理后再复制。");
  if (document.edges.length + edges > CANVAS_LIMITS.edges)
    throw new Error("画布连线已达上限，请先整理后再复制。");
}

/**
 * 复制画布节点。三种语义的区别只体现在“连线带不带、标题改不改”：
 *
 * - `node`：只复制节点，孤立落点。
 * - `with-edges`：额外保留所选集合内部的连线（两端都在所选里），多选时保留结构。
 * - `variant`：草稿的提示与模型选择照抄，并把**上游**参考连线指到副本上；
 *   标题加「副本」。副本是新的 nodeId，因此画布计划来源、镜头绑定与采用事实
 *   都不会跟着复制 —— 这是结构上的保证，不靠额外标记。
 *
 * 原文档不会被修改；素材引用沿用同一 mediaId，不重复上传。
 */
export function copyCanvasNodes(
  document: CanvasDocument,
  selected: readonly string[],
  mode: CanvasCopyMode,
  createId: () => string = () => crypto.randomUUID(),
): CanvasCopyResult {
  const ids = [...new Set(selected)];
  const chosen = ids
    .map((id) => document.nodes.find((node) => node.id === id))
    .filter((node): node is CanvasNode => Boolean(node));
  if (!chosen.length) throw new Error("请先选择要复制的节点。");

  const copies = chosen.map((node) => {
    const copy: CanvasNode = {
      ...structuredClone(node),
      id: createId(),
      position: { x: node.position.x + 48, y: node.position.y + 48 },
      ...(mode === COPY_VARIANT ? { title: titleWithSuffix(node.title) } : {}),
    };
    // groupId 不跟随：复制出来的节点不偷偷进入原分组。
    delete (copy as { groupId?: string }).groupId;
    return copy;
  });
  const remap = new Map(chosen.map((node, index) => [node.id, copies[index]!.id]));
  const selectedSet = new Set(chosen.map((node) => node.id));

  const internal =
    mode === COPY_WITH_EDGES
      ? document.edges.filter(
          (edge) =>
            selectedSet.has(edge.sourceNodeId) &&
            selectedSet.has(edge.targetNodeId),
        )
      : [];
  // `创建副本` 只重指上游连线：下游连线指回既有草稿会静默改写那些草稿的输入。
  const upstream =
    mode === COPY_VARIANT
      ? document.edges.filter(
          (edge) =>
            !selectedSet.has(edge.sourceNodeId) &&
            selectedSet.has(edge.targetNodeId),
        )
      : [];
  const carried = [
    ...internal.map((edge) => ({
      edge,
      sourceNodeId: remap.get(edge.sourceNodeId)!,
      targetNodeId: remap.get(edge.targetNodeId)!,
    })),
    ...upstream.map((edge) => ({
      edge,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: remap.get(edge.targetNodeId)!,
    })),
  ];

  assertCapacity(document, copies.length, carried.length);

  return {
    document: {
      ...document,
      nodes: [...document.nodes, ...copies],
      edges: [
        ...document.edges,
        ...carried.map(({ edge, sourceNodeId, targetNodeId }) => ({
          ...structuredClone(edge),
          id: createId(),
          sourceNodeId,
          targetNodeId,
        })),
      ],
    },
    nodeIds: copies.map((copy) => copy.id),
  };
}

/** 所选集合内部是否存在连线：决定工具条要不要给出「复制节点和连线」。 */
export function hasInternalEdges(
  document: CanvasDocument,
  selected: readonly string[],
): boolean {
  const ids = new Set(selected);
  return document.edges.some(
    (edge) => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId),
  );
}

/** 规范化节点名称：去首尾空白；空名与超长名一律拒绝，不落地半个修改。 */
export function normalizeCanvasTitle(input: string): string | null {
  const title = input.trim();
  if (!title || title.length > CANVAS_TITLE_MAX) return null;
  return title;
}

/** 节点宽度的画布限制，与原「节点属性」数值输入的范围一致。 */
export const CANVAS_NODE_WIDTH = { min: 120, max: 1600 } as const;

/**
 * 精确几何编辑：位置按给定值，宽度夹在画布限制内。只改目标节点，
 * 没有实际变化时返回原文档，不制造一次空提交。
 */
export function updateCanvasNodeGeometry(
  document: CanvasDocument,
  nodeId: string,
  patch: { x?: number; y?: number; width?: number },
): CanvasDocument {
  const node = document.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error("这个节点已不在画布上。");
  const width =
    patch.width === undefined
      ? node.width
      : Math.round(
          Math.min(
            CANVAS_NODE_WIDTH.max,
            Math.max(CANVAS_NODE_WIDTH.min, patch.width),
          ),
        );
  const position = {
    x: patch.x === undefined ? node.position.x : Math.round(patch.x),
    y: patch.y === undefined ? node.position.y : Math.round(patch.y),
  };
  if (
    width === node.width &&
    position.x === node.position.x &&
    position.y === node.position.y
  )
    return document;
  return {
    ...document,
    nodes: document.nodes.map((item) =>
      item.id === nodeId ? { ...item, position, width } : item,
    ),
  };
}

/**
 * 把若干节点加入某个分组（`groupId`）或移出分组（`null`）。分组只是空间整理，
 * 不改变镜头归属或顺序；不存在的分组直接拒绝，避免留下悬空的 groupId。
 */
export function assignCanvasGroup(
  document: CanvasDocument,
  nodeIds: readonly string[],
  groupId: string | null,
): CanvasDocument {
  if (groupId !== null && !document.groups.some((group) => group.id === groupId))
    throw new Error("这个分组已不存在，请重新选择分组。");
  const targets = new Set(nodeIds);
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (!targets.has(node.id)) return node;
    if (groupId === null) {
      if (node.groupId === undefined) return node;
      changed = true;
      const { groupId: _old, ...rest } = node;
      return rest;
    }
    if (node.groupId === groupId) return node;
    changed = true;
    return { ...node, groupId };
  });
  return changed ? { ...document, nodes } : document;
}

export function renameCanvasNode(
  document: CanvasDocument,
  nodeId: string,
  input: string,
): CanvasDocument {
  const node = document.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error("这个节点已不在画布上。");
  const title = normalizeCanvasTitle(input);
  if (title === null) throw new Error("请填写节点名称（最多 160 字）。");
  if (title === node.title) return document;
  return {
    ...document,
    nodes: document.nodes.map((item) =>
      item.id === nodeId ? { ...item, title } : item,
    ),
  };
}
