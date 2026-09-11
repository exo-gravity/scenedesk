import type { CanvasDocument } from "@drama/domain";

type Edge = CanvasDocument["edges"][number];
/** Explicitly append one reference without renumbering other drafts' inputs. */
export function appendCanvasReference(
  edges: readonly Edge[],
  edge: Omit<Edge, "position">,
): Edge[] {
  const inbound = edges.filter(
    (e) => e.targetNodeId.toLowerCase() === edge.targetNodeId.toLowerCase(),
  );
  if (
    inbound.some(
      (e) =>
        e.sourceNodeId.toLowerCase() === edge.sourceNodeId.toLowerCase() &&
        e.purpose === edge.purpose,
    )
  )
    throw new Error("这份来源和用途已在参考中，可直接启用或调整现有引用。");
  const nextPosition = Math.max(-1, ...inbound.map((e) => e.position)) + 1;
  if (nextPosition <= 4999)
    return [...edges, { ...edge, position: nextPosition }];
  const positions = new Map(
    [...inbound]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((e, i) => [e.id, i]),
  );
  return [
    ...edges.map((e) =>
      positions.has(e.id) ? { ...e, position: positions.get(e.id)! } : e,
    ),
    { ...edge, position: inbound.length },
  ];
}
