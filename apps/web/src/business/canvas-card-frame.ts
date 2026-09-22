import type { CanvasNode } from "@drama/domain";
import { CANVAS_NODE_WIDTH } from "./canvas-node-actions.js";

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

/**
 * The frame of a draft that has no result yet: its chosen ratio when it has
 * one, otherwise the project's shape. Audio and text drafts have no frame, so
 * a portrait project never stretches them.
 */
export function emptyDraftFrame(
  node: Pick<CanvasNode, "kind" | "content">,
  projectAspect: FrameAspect,
): FrameAspect | null {
  if (node.kind === "text" || node.kind === "audio") return null;
  if (node.content.type !== "draft") return null;
  return node.content.output.aspectRatio ? draftFrameAspect(node) : projectAspect;
}

/** The side of the square every new picture card has the area of. */
const CARD_AREA_SIDE = 360;
const FIXED_WIDTH = { text: 320, audio: 360 } as const;

/**
 * The width a new card is created with. Picture cards keep one area whatever
 * their shape: a 16:9 card is wider than it is tall, a 9:16 card the reverse,
 * and neither dominates the board. Text and audio have no picture and keep
 * their fixed widths; a picture card whose shape is unknown keeps the old one.
 */
export function defaultCardWidth(
  kind: CanvasNode["kind"],
  aspect?: FrameAspect | null,
): number {
  if (kind === "text" || kind === "audio") return FIXED_WIDTH[kind];
  if (!aspect || !(aspect.width > 0) || !(aspect.height > 0)) return CARD_AREA_SIDE;
  const width = Math.round(CARD_AREA_SIDE * Math.sqrt(aspect.width / aspect.height));
  return Math.min(CANVAS_NODE_WIDTH.max, Math.max(CANVAS_NODE_WIDTH.min, width));
}
