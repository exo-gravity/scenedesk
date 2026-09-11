import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getViewportForBounds } from "@xyflow/react";
import {
  CANVAS_MIN_ZOOM,
  CANVAS_MAX_ZOOM,
  MAX_VIEWPORT_COORDINATE,
  canvasZoomLabel,
  constrainCanvasViewport,
} from "../apps/web/src/business/canvas-viewport.js";

const contract = JSON.parse(
  readFileSync(
    new URL("../docs/implementation/openapi.json", import.meta.url),
    "utf8",
  ),
);
const legal = contract.components.schemas.CanvasPoint.properties.x;
function contains(
  bounds: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
) {
  const view = getViewportForBounds(
    bounds,
    width,
    height,
    CANVAS_MIN_ZOOM,
    1,
    0.3,
  );
  assert.ok(view.zoom >= CANVAS_MIN_ZOOM && view.zoom <= 1);
  assert.ok(bounds.x * view.zoom + view.x >= -1e-7);
  assert.ok(bounds.y * view.zoom + view.y >= -1e-7);
  assert.ok((bounds.x + bounds.width) * view.zoom + view.x <= width + 1e-7);
  assert.ok((bounds.y + bounds.height) * view.zoom + view.y <= height + 1e-7);
  return view;
}
test("fit encloses legal opposite-corner nodes in the smallest editing viewport, including negative coordinates", () => {
  const span = legal.maximum - legal.minimum;
  const bounds = {
    x: legal.minimum,
    y: legal.minimum,
    width: span + 1600,
    height: span + 1600,
  };
  for (const [w, h] of [
    [320, 240],
    [1432, 602],
    [700, 360],
  ]) {
    const view = contains(bounds, w!, h!);
    assert.ok(view.zoom < 0.1);
    assert.ok(view.x >= legal.minimum && view.x <= legal.maximum);
    assert.ok(view.y >= legal.minimum && view.y <= legal.maximum);
  }
});
test("fit encloses the existing 20-by-100 capacity layout and still fits small selections normally", () => {
  const view = contains(
    { x: 0, y: 0, width: 19 * 380 + 320, height: 99 * 280 + 240 },
    1432,
    602,
  );
  assert.ok(view.zoom < 0.1);
  assert.equal(
    contains({ x: 80, y: 80, width: 320, height: 240 }, 1432, 602).zoom,
    1,
  );
});
test("viewport contract and UI share positive bounds, and low overviews never show zero percent", () => {
  const zoom = contract.components.schemas.CanvasViewport.properties.zoom;
  assert.equal(zoom.minimum, CANVAS_MIN_ZOOM);
  assert.equal(zoom.maximum, CANVAS_MAX_ZOOM);
  assert.equal(canvasZoomLabel(CANVAS_MIN_ZOOM), "0.001%");
  assert.equal(canvasZoomLabel(0.0002509698836139663), "0.025%");
  assert.equal(canvasZoomLabel(0.017954220314735335), "1.8%");
  assert.equal(canvasZoomLabel(1), "100%");
  assert.equal(canvasZoomLabel(4), "400%");
});

test("single-node focus at legal coordinate boundaries remains visible and persistable", () => {
  for (const x of [legal.minimum, legal.maximum]) {
    for (const y of [legal.minimum, legal.maximum]) {
      const bounds = { x, y, width: 320, height: 181 };
      for (const [width, height] of [[320, 240], [1423, 602]]) {
        const proposed = getViewportForBounds(
          bounds, width!, height!, CANVAS_MIN_ZOOM, 1, 0.3,
        );
        const view = constrainCanvasViewport(proposed);
        assert.ok(Math.abs(view.x) <= MAX_VIEWPORT_COORDINATE);
        assert.ok(Math.abs(view.y) <= MAX_VIEWPORT_COORDINATE);
        assert.ok(x * view.zoom + view.x >= -1e-7);
        assert.ok(y * view.zoom + view.y >= -1e-7);
        assert.ok((x + bounds.width) * view.zoom + view.x <= width! + 1e-7);
        assert.ok((y + bounds.height) * view.zoom + view.y <= height! + 1e-7);
        assert.equal(view.zoom, proposed.zoom);
        assert.equal(constrainCanvasViewport(view), view);
      }
    }
  }
});

test("screen-space viewport retains extreme node anchors at 400% without extending node coordinates", () => {
  const viewport = contract.components.schemas.CanvasViewport.properties;
  assert.equal(legal.minimum, -1_000_000);
  assert.equal(legal.maximum, 1_000_000);
  assert.equal(viewport.x.minimum, -MAX_VIEWPORT_COORDINATE);
  assert.equal(viewport.x.maximum, MAX_VIEWPORT_COORDINATE);
  assert.deepEqual(viewport.y, viewport.x);
  for (const x of [legal.minimum, legal.maximum]) {
    for (const y of [legal.minimum, legal.maximum]) {
      const anchor = { x: x + 160, y: y + 90.5 };
      const view = { x: 711.5 - anchor.x * 4, y: 301 - anchor.y * 4, zoom: 4 };
      assert.equal(constrainCanvasViewport(view), view);
      assert.equal(anchor.x * view.zoom + view.x, 711.5);
      assert.equal(anchor.y * view.zoom + view.y, 301);
    }
  }
  assert.deepEqual(
    constrainCanvasViewport({ x: 9_000_000, y: -9_000_000, zoom: 4 }),
    { x: 8_000_000, y: -8_000_000, zoom: 4 },
  );
});
