/**
 * Where the input panel goes, in screen space, relative to the board. Below
 * the card and left-aligned with it when there is room; otherwise right, left
 * or above; when no side is free, the side that clips the card least, unless
 * that would cover most of it. References the card uses stay visible when
 * possible; other cards are a weaker preference. Nothing here moves a card.
 */
export type ScreenRect = { x: number; y: number; width: number; height: number };
export type ComposerPlacement =
  | { kind: "local"; rect: ScreenRect; side: "below" | "right" | "left" | "above" }
  | { kind: "docked"; reason: "offscreen" | "space" };

export const COMPOSER_SIZE = { width: 660, height: 240 } as const;

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
  size = COMPOSER_SIZE,
}: {
  anchor: ScreenRect;
  safe: ScreenRect;
  references?: ScreenRect[];
  avoid?: ScreenRect[];
  previous?: ComposerPlacement | undefined;
  size?: { width: number; height: number };
}): ComposerPlacement {
  if (!intersectionArea(anchor, safe)) return { kind: "docked", reason: "offscreen" };
  if (safe.width < 360 || safe.height < 220) return { kind: "docked", reason: "space" };
  const width = Math.min(size.width, safe.width),
    height = Math.min(size.height, safe.height);
  const fits = (rect: ScreenRect) =>
    rect.x >= safe.x &&
    rect.y >= safe.y &&
    rect.x + rect.width <= safe.x + safe.width &&
    rect.y + rect.height <= safe.y + safe.height &&
    !intersectionArea(rect, anchor);
  // Keep a valid prior position: typing and small viewport changes must not
  // make the panel jump between sides. It may have grown since, so re-check
  // the old spot with the current size.
  if (previous?.kind === "local" && width <= safe.width) {
    // A panel that grows extends away from the card on its own side, so the
    // edge next to the card stays put and the panel never overlaps it.
    const kept = {
      x: previous.side === "left" ? previous.rect.x - (width - previous.rect.width) : previous.rect.x,
      y: previous.side === "above" ? previous.rect.y - (height - previous.rect.height) : previous.rect.y,
      width,
      height,
    };
    if (fits(kept)) {
      const distance =
        previous.side === "below"
          ? kept.y - (anchor.y + anchor.height + 12)
          : previous.side === "above"
            ? anchor.y - (kept.y + kept.height + 12)
            : previous.side === "right"
              ? kept.x - (anchor.x + anchor.width + 12)
              : anchor.x - (kept.x + kept.width + 12);
      const crossDistance =
        previous.side === "below" || previous.side === "above"
          ? Math.max(anchor.x - (kept.x + kept.width), kept.x - (anchor.x + anchor.width), 0)
          : Math.max(anchor.y - (kept.y + kept.height), kept.y - (anchor.y + anchor.height), 0);
      if (Math.abs(distance) <= 24 && crossDistance <= 24)
        return kept.width === previous.rect.width && kept.height === previous.rect.height
          ? previous
          : { ...previous, rect: kept };
    }
  }
  const clampX = (x: number) => Math.max(safe.x, Math.min(safe.x + safe.width - width, x));
  const clampY = (y: number) => Math.max(safe.y, Math.min(safe.y + safe.height - height, y));
  const candidates: Extract<ComposerPlacement, { kind: "local" }>[] = [
    { kind: "local", side: "below", rect: { x: clampX(anchor.x), y: anchor.y + anchor.height + 12, width, height } },
    { kind: "local", side: "right", rect: { x: anchor.x + anchor.width + 12, y: clampY(anchor.y), width, height } },
    { kind: "local", side: "left", rect: { x: anchor.x - width - 12, y: clampY(anchor.y), width, height } },
    { kind: "local", side: "above", rect: { x: clampX(anchor.x), y: anchor.y - height - 12, width, height } },
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
  // the side it was on while that side still fits; only then do the soft
  // constraints choose, so the panel does not hop around the card.
  const sameSide = (candidate: Extract<ComposerPlacement, { kind: "local" }>) =>
    previous?.kind === "local" && candidate.side === previous.side ? 0 : 1;
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
