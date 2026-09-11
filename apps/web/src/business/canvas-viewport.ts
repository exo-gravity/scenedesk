/** Legal +/-1,000,000 coordinates plus the maximum 1,600px node width occupy
 * ~20px at this positive floor. The smallest desktop canvas is 240px high:
 * measured-bounds fit therefore has ample room for padding, without a 10%
 * clamp cropping distant nodes. Keep aligned with CanvasViewport and SQL. */
export const CANVAS_MIN_ZOOM = 0.00001;
export const CANVAS_MAX_ZOOM = 4;
const MAX_VIEWPORT_COORDINATE = 1_000_000;

/** Centering a node at the negative coordinate boundary can move the viewport
 * just beyond its own legal range. Keep the visible and persisted view equal. */
export function constrainCanvasViewport<T extends { x: number; y: number }>(
  viewport: T,
): T {
  const limit = (value: number) =>
    Math.max(-MAX_VIEWPORT_COORDINATE, Math.min(MAX_VIEWPORT_COORDINATE, value));
  const x = limit(viewport.x),
    y = limit(viewport.y);
  return x === viewport.x && y === viewport.y
    ? viewport
    : { ...viewport, x, y };
}

export function canvasZoomLabel(zoom: number) {
  const percent = zoom * 100;
  // Small but positive overviews must not be presented as an unusable 0%.
  return `${Number(percent.toFixed(percent < 1 ? 3 : percent < 10 ? 2 : 0))}%`;
}
