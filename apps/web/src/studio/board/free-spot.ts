export type BoardRect = { x: number; y: number; width: number; height: number };

/**
 * How tall a card of this kind and width is expected to be, before React Flow
 * has measured it: its frame at that width; audio and empty text have fixed
 * heights; a picture whose shape is not known yet gets a working guess. The
 * card's label row sits above the body and is not part of this height.
 */
export function estimateCardHeight(
  kind: "text" | "image" | "video" | "audio",
  width: number,
  frame: { width: number; height: number } | null,
): number {
  if (kind === "audio") return 96;
  if (kind === "text") return 120;
  return frame ? Math.round((width * frame.height) / frame.width) : 200;
}

/**
 * Where a new card of this size goes, in board coordinates: centred on the
 * origin. While that frame would cover another card, the search steps past
 * the card it hits, right first, then below, left and above, so cards added
 * in a row line up whatever their widths. A spot still inside the view
 * (`within`) is taken before a nearer one outside it, so adding a card does
 * not scroll the cards it came from away. Failing all that, the nearest free
 * spot in that order.
 */
export function nearestFreeSpot({
  origin,
  width,
  height,
  others,
  within,
}: {
  origin: { x: number; y: number };
  width: number;
  height: number;
  others: readonly BoardRect[];
  within?: BoardRect | undefined;
}): { x: number; y: number } {
  const start = {
    x: Math.round(origin.x - width / 2),
    y: Math.round(origin.y - height / 2),
  };
  const hitAt = (spot: { x: number; y: number }) =>
    others.find(
      (other) =>
        spot.x < other.x + other.width + 24 &&
        other.x < spot.x + width + 24 &&
        spot.y < other.y + other.height + 24 &&
        other.y < spot.y + height + 24,
    );
  const inView = (spot: { x: number; y: number }) =>
    !within ||
    (spot.x >= within.x &&
      spot.y >= within.y &&
      spot.x + width <= within.x + within.width &&
      spot.y + height <= within.y + within.height);
  if (!hitAt(start)) return start;
  // Each direction steps past whatever it hits; a step always moves on.
  const directions: ((hit: BoardRect, spot: { x: number; y: number }) => { x: number; y: number })[] = [
    (hit, spot) => ({ x: hit.x + hit.width + 40, y: spot.y }),
    (hit, spot) => ({ x: spot.x, y: hit.y + hit.height + 40 }),
    (hit, spot) => ({ x: hit.x - width - 40, y: spot.y }),
    (hit, spot) => ({ x: spot.x, y: hit.y - height - 40 }),
  ];
  for (const mustBeInView of within ? [true, false] : [false])
    for (const step of directions) {
      let spot = start;
      for (let hops = 0; hops < 50; hops++) {
        const hit = hitAt(spot);
        if (!hit) {
          if (!mustBeInView || inView(spot)) return spot;
          break;
        }
        spot = step(hit, spot);
      }
    }
  return start;
}
