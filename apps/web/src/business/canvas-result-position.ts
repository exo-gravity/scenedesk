import { CANVAS_RESULT_LAYOUT, type CanvasNode } from "@drama/domain";

type PositionedNode = Pick<CanvasNode, "id" | "position" | "width">;
// CanvasPoint bounds, not the larger screen-space CanvasViewport translation.
const coordinateLimit = 1_000_000;
const gap = 64;

/** Propose only a new result-group position. Existing/replayed placements keep
 * their durable input. Horizontal separation avoids nodes of any measured
 * height, which is intentionally not part of the saved canvas document. */
export function canvasResultPosition(
  nodes: readonly PositionedNode[],
  originId: string,
  resultCount: number,
): CanvasNode["position"] {
  if (!Number.isSafeInteger(resultCount) || resultCount < 1)
    throw Error("结果数量不可用，请重新读取任务。");
  const span = (resultCount - 1) * CANVAS_RESULT_LAYOUT.stepX;
  const width = span + CANVAS_RESULT_LAYOUT.width;
  // Every result's top-left point must satisfy CanvasPoint, including the last.
  const maxX = coordinateLimit - span;
  const origin = nodes.find((node) => node.id === originId);
  const preferred = origin ? origin.position.x + origin.width + gap : 80;
  const y = origin?.position.y ?? 80;
  if (!Number.isFinite(y) || Math.abs(y) > coordinateLimit)
    throw Error("原草稿位置不可用，请重新读取画布。");
  const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x);
  const right = Math.max(
    preferred,
    ...sorted.map((node) => node.position.x + node.width + gap),
  );
  if (right >= -coordinateLimit && right <= maxX) return { x: right, y };

  // At the right boundary, choose the nearest complete horizontal gap. Never
  // clamp individual results: that would change their spacing or overlap them.
  let cursor = -coordinateLimit;
  let candidate: number | undefined;
  const consider = (end: number) => {
    const last = Math.min(end, maxX);
    if (cursor > last) return;
    const x = Math.max(cursor, Math.min(preferred, last));
    if (
      candidate === undefined ||
      Math.abs(x - preferred) < Math.abs(candidate - preferred)
    )
      candidate = x;
  };
  for (const node of sorted) {
    consider(node.position.x - gap - width);
    cursor = Math.max(cursor, node.position.x + node.width + gap);
  }
  consider(maxX);
  if (candidate === undefined)
    throw Error(
      "当前画布横向没有容纳整组结果的空位。请整理画布后重新查看放置位置；原任务与结果仍保留。",
    );
  return { x: candidate, y };
}
