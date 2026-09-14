/** Screen-space geometry only. These rectangles never enter the canvas document. */
export type ScreenRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type EditorPlacement =
  | {
      kind: "local";
      rect: ScreenRect;
      side: "below" | "right" | "left" | "above";
    }
  | { kind: "compact"; reason: "offscreen" | "space" };
export function intersectionArea(a: ScreenRect, b: ScreenRect) {
  return (
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  );
}
export function canvasEditorSafeArea(
  width: number,
  height: number,
  auxiliaryOpen: boolean,
  windowWidth = width,
): ScreenRect {
  const right = auxiliaryOpen ? (windowWidth >= 1800 ? 412 : 372) : 12;
  return {
    x: 64,
    y: 12,
    width: Math.max(0, width - right - 64),
    height: Math.max(0, height - 76),
  };
}
export function placeCanvasEditor({
  anchor,
  safe,
  references = [],
  previous,
}: {
  anchor: ScreenRect;
  safe: ScreenRect;
  references?: ScreenRect[];
  previous?: EditorPlacement | undefined;
}): EditorPlacement {
  if (!intersectionArea(anchor, safe))
    return { kind: "compact", reason: "offscreen" };
  if (safe.width < 360 || safe.height < 220)
    return { kind: "compact", reason: "space" };
  const width = Math.min(400, safe.width),
    height = Math.min(280, safe.height);
  const fits = (rect: ScreenRect) =>
    rect.x >= safe.x &&
    rect.y >= safe.y &&
    rect.x + rect.width <= safe.x + safe.width &&
    rect.y + rect.height <= safe.y + safe.height &&
    !intersectionArea(rect, anchor);
  // Keep a valid prior position: typing and small viewport changes do not make
  // the editor jump between sides just to gain a little more reference space.
  if (
    previous?.kind === "local" &&
    previous.rect.width <= safe.width &&
    fits(previous.rect)
  ) {
    const distance =
      previous.side === "below"
        ? previous.rect.y - (anchor.y + anchor.height + 12)
        : previous.side === "above"
          ? anchor.y - (previous.rect.y + previous.rect.height + 12)
          : previous.side === "right"
            ? previous.rect.x - (anchor.x + anchor.width + 12)
            : anchor.x - (previous.rect.x + previous.rect.width + 12);
    const crossDistance =
      previous.side === "below" || previous.side === "above"
        ? Math.max(
            anchor.x - (previous.rect.x + previous.rect.width),
            previous.rect.x - (anchor.x + anchor.width),
            0,
          )
        : Math.max(
            anchor.y - (previous.rect.y + previous.rect.height),
            previous.rect.y - (anchor.y + anchor.height),
            0,
          );
    if (Math.abs(distance) <= 24 && crossDistance <= 24) return previous;
  }
  const clampX = (x: number) =>
    Math.max(safe.x, Math.min(safe.x + safe.width - width, x));
  const clampY = (y: number) =>
    Math.max(safe.y, Math.min(safe.y + safe.height - height, y));
  const candidates: Extract<EditorPlacement, { kind: "local" }>[] = [
    {
      kind: "local",
      side: "below",
      rect: {
        x: clampX(anchor.x + (anchor.width - width) / 2),
        y: anchor.y + anchor.height + 12,
        width,
        height,
      },
    },
    {
      kind: "local",
      side: "right",
      rect: {
        x: anchor.x + anchor.width + 12,
        y: clampY(anchor.y),
        width,
        height,
      },
    },
    {
      kind: "local",
      side: "left",
      rect: { x: anchor.x - width - 12, y: clampY(anchor.y), width, height },
    },
    {
      kind: "local",
      side: "above",
      rect: {
        x: clampX(anchor.x + (anchor.width - width) / 2),
        y: anchor.y - height - 12,
        width,
        height,
      },
    },
  ];
  const available = candidates.filter((candidate) => fits(candidate.rect));
  // References are a soft constraint. Preserve every reference in the editor;
  // choose the side covering the least visible reference area when possible.
  available.sort((a, b) =>
    references.reduce(
      (sum, ref) =>
        sum + intersectionArea(a.rect, ref) - intersectionArea(b.rect, ref),
      0,
    ),
  );
  return available[0] ?? { kind: "compact", reason: "space" };
}
