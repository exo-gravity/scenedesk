import type { CanvasNode } from "@drama/domain";

export type FrameAspect = { width: number; height: number };

const DEFAULTS: Record<"image" | "video", FrameAspect> = {
  video: { width: 16, height: 9 },
  image: { width: 1, height: 1 },
};

/**
 * The picture frame a generation draft occupies on the canvas. It follows the
 * chosen output ratio so a result of that ratio fits without changing the card,
 * and it exists before any result does, so a draft and its result are the same
 * shape on the board. Audio has no picture, hence no frame.
 */
export function draftFrameAspect(
  node: Pick<CanvasNode, "kind" | "content">,
): FrameAspect | null {
  if (node.kind === "text" || node.kind === "audio") return null;
  const fallback = DEFAULTS[node.kind];
  if (node.content.type !== "draft") return fallback;
  const ratio = node.content.output.aspectRatio;
  const match = ratio && /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(ratio);
  if (!match) return fallback;
  const width = Number(match[1]),
    height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) return fallback;
  return { width, height };
}
