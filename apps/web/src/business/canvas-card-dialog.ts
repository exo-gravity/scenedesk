/**
 * Where a small screen-space dialog (rename, position and size) goes relative
 * to its card: above the card when there is room between the card and the
 * board's top edge, otherwise below it, and never above the board.
 */
export function placeCardDialog({
  anchor,
  height,
  inset = 12,
  gap = 12,
}: {
  /** The card's top edge and height in screen px, relative to the board. */
  anchor: { top: number; height: number };
  /** The dialog's own height in screen px. */
  height: number;
  inset?: number;
  gap?: number;
}): { top: number; side: "above" | "below" } {
  const above = anchor.top - gap - height;
  if (above >= inset) return { top: above, side: "above" };
  return { top: Math.max(inset, anchor.top + anchor.height + gap), side: "below" };
}
