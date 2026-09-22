/**
 * Where the input panel goes, in screen space, relative to the board. Below
 * the card and left-aligned with it when there is room (its sources sit to
 * its left, and a panel starting at the card's edge leaves them visible);
 * otherwise right, left or above; when no side is free, the side that clips
 * the card least, unless that would cover most of it. References the card uses stay visible when
 * possible; other cards are a weaker preference. A panel the user has dragged
 * keeps its offset from the card instead, held inside the board. Nothing here
 * moves a card.
 */
import { studio, tokens } from "../../theme/tokens.js";

export type ScreenRect = { x: number; y: number; width: number; height: number };
export type ComposerPlacement =
  | {
      kind: "local";
      rect: ScreenRect;
      side: "below" | "right" | "left" | "above" | "pinned";
      /** The card as it was when this placement was made; a later call compares against it. */
      anchor: ScreenRect;
    }
  | { kind: "docked"; reason: "offscreen" | "space" };

/**
 * The panel's nominal size: an empty panel (the reference pill row, the prompt
 * at its minimum, the model row), which is what a new draft opens with. The
 * board reserves this much below a new draft when it brings it into view.
 */
export const COMPOSER_SIZE = { width: 660, height: 162 } as const;
/** The row of reference thumbnails and the panel's gap above it. */
const REFERENCE_ROW = studio.referenceSize + tokens.spacing.sm;

/** How tall the panel of a draft is expected to be: the empty panel, plus the reference row when it has references. */
export function composerNominalHeight(references: number) {
  return COMPOSER_SIZE.height + (references > 0 ? REFERENCE_ROW : 0);
}

export function intersectionArea(a: ScreenRect, b: ScreenRect) {
  return (
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  );
}

/** The board minus the top bar and the bottom toolbar, with a small inset. */
export function composerSafeArea(
  width: number,
  height: number,
  { top = 60, bottom = 76, inset = 12 } = {},
): ScreenRect {
  return {
    x: inset,
    y: top,
    width: Math.max(0, width - inset * 2),
    height: Math.max(0, height - top - bottom),
  };
}

export function placeComposer({
  anchor,
  safe,
  references = [],
  avoid = [],
  previous,
  pinned,
  size = COMPOSER_SIZE,
}: {
  anchor: ScreenRect;
  safe: ScreenRect;
  references?: ScreenRect[];
  avoid?: ScreenRect[];
  previous?: ComposerPlacement | undefined;
  /** Where the user dragged the panel to, as its offset from the card's corner. */
  pinned?: { dx: number; dy: number } | undefined;
  size?: { width: number; height: number };
}): ComposerPlacement {
  if (!intersectionArea(anchor, safe)) return { kind: "docked", reason: "offscreen" };
  if (safe.width < 360 || safe.height < 220) return { kind: "docked", reason: "space" };
  const width = Math.min(size.width, safe.width),
    height = Math.min(size.height, safe.height);
  const clampX = (x: number) => Math.max(safe.x, Math.min(safe.x + safe.width - width, x));
  const clampY = (y: number) => Math.max(safe.y, Math.min(safe.y + safe.height - height, y));
  // A dragged panel is the user's choice: it follows the card at that offset
  // and is only held inside the board, even where it covers the card.
  if (pinned)
    return {
      kind: "local",
      side: "pinned",
      rect: { x: clampX(anchor.x + pinned.dx), y: clampY(anchor.y + pinned.dy), width, height },
      anchor,
    };
  const fits = (rect: ScreenRect) =>
    rect.x >= safe.x &&
    rect.y >= safe.y &&
    rect.x + rect.width <= safe.x + safe.width &&
    rect.y + rect.height <= safe.y + safe.height &&
    !intersectionArea(rect, anchor);
  // Keep a valid prior position: typing and small viewport changes must not
  // make the panel jump between sides. "Near" means the card itself has not
  // moved more than a little since that placement was made; once it really
  // has (a pan, a zoom), the sides are chosen afresh. The panel may have
  // grown since, so its old spot is re-checked with the current size.
  const near =
    previous?.kind === "local" &&
    Math.abs(anchor.x - previous.anchor.x) <= 24 &&
    Math.abs(anchor.y - previous.anchor.y) <= 24;
  if (previous?.kind === "local" && near && width <= safe.width) {
    // A panel that grows extends away from the card on its own side, so the
    // edge next to the card stays put and the panel never overlaps it.
    const kept = {
      x: previous.side === "left" ? previous.rect.x - (width - previous.rect.width) : previous.rect.x,
      y: previous.side === "above" ? previous.rect.y - (height - previous.rect.height) : previous.rect.y,
      width,
      height,
    };
    if (fits(kept))
      return kept.width === previous.rect.width && kept.height === previous.rect.height
        ? previous
        : { ...previous, rect: kept };
  }
  const aligned = clampX(anchor.x);
  const candidates: Extract<ComposerPlacement, { kind: "local" }>[] = [
    { kind: "local", side: "below", rect: { x: aligned, y: anchor.y + anchor.height + 12, width, height }, anchor },
    { kind: "local", side: "right", rect: { x: anchor.x + anchor.width + 12, y: clampY(anchor.y), width, height }, anchor },
    { kind: "local", side: "left", rect: { x: anchor.x - width - 12, y: clampY(anchor.y), width, height }, anchor },
    { kind: "local", side: "above", rect: { x: aligned, y: anchor.y - height - 12, width, height }, anchor },
  ];
  const covered = (rect: ScreenRect, rects: ScreenRect[]) =>
    rects.reduce((sum, item) => sum + intersectionArea(rect, item), 0);
  const bySoftConstraints = (
    a: Extract<ComposerPlacement, { kind: "local" }>,
    b: Extract<ComposerPlacement, { kind: "local" }>,
  ) =>
    covered(a.rect, references) - covered(b.rect, references) ||
    covered(a.rect, avoid) - covered(b.rect, avoid);
  const available = candidates.filter((candidate) => fits(candidate.rect));
  // A panel that changes size (a model chosen, a task row appearing) stays on
  // the side it was on while that side still fits, sliding along it if it
  // must; only then do the soft constraints choose, so the panel does not hop
  // around the card.
  const sameSide = (candidate: Extract<ComposerPlacement, { kind: "local" }>) =>
    near && previous?.kind === "local" && candidate.side === previous.side ? 0 : 1;
  available.sort((a, b) => sameSide(a) - sameSide(b) || bySoftConstraints(a, b));
  if (available[0]) return available[0];
  // No side is free: pull each side into the safe area and take the one that
  // clips the card least, unless every side would cover most of the card.
  const anchorArea = anchor.width * anchor.height;
  const clipped = candidates
    .map((candidate) => ({
      ...candidate,
      rect: { ...candidate.rect, x: clampX(candidate.rect.x), y: clampY(candidate.rect.y) },
    }))
    .filter(
      (candidate) =>
        intersectionArea(candidate.rect, safe) === width * height &&
        intersectionArea(candidate.rect, anchor) < anchorArea * 0.6,
    )
    .sort(
      (a, b) =>
        intersectionArea(a.rect, anchor) - intersectionArea(b.rect, anchor) ||
        bySoftConstraints(a, b),
    );
  return clipped[0] ?? { kind: "docked", reason: "space" };
}
