import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canvasEditorSafeArea,
  intersectionArea,
  placeCanvasEditor,
  type ScreenRect,
} from "../apps/web/src/business/canvas-editor-placement.js";

const safe = canvasEditorSafeArea(1432, 800, false);
const anchor = { x: 300, y: 120, width: 240, height: 180 };
test("a local editor has readable screen dimensions and avoids the edited node", () => {
  for (const scale of [0.0001, 0.1, 1, 2]) {
    const node = {
      ...anchor,
      width: anchor.width * scale,
      height: anchor.height * scale,
    };
    const result = placeCanvasEditor({ anchor: node, safe });
    assert.equal(result.kind, "local");
    if (result.kind !== "local") throw Error("Expected a local editor");
    assert.equal(result.rect.width, 400);
    assert.equal(result.rect.height, 280);
    assert.equal(intersectionArea(result.rect, node), 0);
    assert.equal(intersectionArea(result.rect, safe), 400 * 280);
  }
});
test("visible reference nodes influence the side, without altering any reference or world geometry", () => {
  const original = structuredClone(anchor);
  const reference: ScreenRect = { x: 200, y: 312, width: 340, height: 280 };
  const result = placeCanvasEditor({ anchor, safe, references: [reference] });
  assert.equal(result.kind, "local");
  if (result.kind !== "local") throw Error("Expected a local editor");
  assert.equal(result.side, "right");
  assert.equal(intersectionArea(result.rect, reference), 0);
  assert.deepEqual(anchor, original);
});
test("an offscreen object and an object covered by the auxiliary dock produce a named compact state, never a fake anchor", () => {
  assert.deepEqual(
    placeCanvasEditor({ anchor: { ...anchor, x: -1000 }, safe }),
    { kind: "compact", reason: "offscreen" },
  );
  const occupied = canvasEditorSafeArea(1290, 700, true, 1366);
  assert.equal(occupied.x + occupied.width, 918);
  assert.deepEqual(
    placeCanvasEditor({ anchor: { ...anchor, x: 1000 }, safe: occupied }),
    { kind: "compact", reason: "offscreen" },
  );
  assert.equal(canvasEditorSafeArea(1800, 900, true, 1876).width, 1324);
});
test("insufficient room requests explicit focus editing rather than clipping or moving the viewport", () => {
  for (const available of [
    canvasEditorSafeArea(390, 700, false),
    canvasEditorSafeArea(1000, 260, false),
    { x: 64, y: 12, width: 560, height: 400 },
  ]) {
    const result = placeCanvasEditor({
      anchor: { x: 80, y: 60, width: 480, height: 310 },
      safe: available,
    });
    assert.equal(result.kind, "compact");
  }
});
test("valid small movements retain placement, but an auxiliary opening or real pan cannot pin the editor outside its safe area", () => {
  const start = placeCanvasEditor({ anchor, safe });
  assert.equal(
    placeCanvasEditor({
      anchor: { ...anchor, y: anchor.y - 10 },
      safe,
      previous: start,
    }),
    start,
  );
  const afterPan = placeCanvasEditor({
    anchor: { ...anchor, y: 420 },
    safe,
    previous: start,
  });
  assert.notDeepEqual(afterPan, start);
  const edge = { ...anchor, x: 950 };
  const beforeDock = placeCanvasEditor({ anchor: edge, safe });
  const afterDock = placeCanvasEditor({
    anchor: edge,
    safe: canvasEditorSafeArea(1432, 800, true),
    previous: beforeDock,
  });
  if (afterDock.kind === "local")
    assert.ok(afterDock.rect.x + afterDock.rect.width <= 1060);
});
