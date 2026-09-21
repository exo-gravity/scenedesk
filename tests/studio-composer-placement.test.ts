import assert from "node:assert/strict";
import { test } from "node:test";
import {
  composerSafeArea,
  intersectionArea,
  placeComposer,
  type ScreenRect,
} from "../apps/web/src/studio/composer/placement.js";

const safe = composerSafeArea(1432, 900);
const anchor = { x: 300, y: 120, width: 240, height: 180 };
const size = { width: 400, height: 280 };
test("the panel has screen dimensions at any zoom and never covers the card", () => {
  for (const scale of [0.0001, 0.1, 1, 2]) {
    const card = { ...anchor, width: anchor.width * scale, height: anchor.height * scale };
    const result = placeComposer({ anchor: card, safe, size });
    assert.equal(result.kind, "local");
    if (result.kind !== "local") throw Error("Expected a local panel");
    assert.equal(result.rect.width, 400);
    assert.equal(result.rect.height, 280);
    assert.equal(intersectionArea(result.rect, card), 0);
    assert.equal(intersectionArea(result.rect, safe), 400 * 280);
  }
});
test("below the card, left-aligned with it, is the first choice", () => {
  const result = placeComposer({ anchor, safe, size });
  assert.equal(result.kind, "local");
  if (result.kind !== "local") throw Error("Expected a local panel");
  assert.equal(result.side, "below");
  assert.equal(result.rect.x, anchor.x);
});
test("a visible reference changes the side, without touching the card", () => {
  const original = structuredClone(anchor);
  const reference: ScreenRect = { x: 200, y: 312, width: 340, height: 280 };
  const result = placeComposer({ anchor, safe, references: [reference], size });
  assert.equal(result.kind, "local");
  if (result.kind !== "local") throw Error("Expected a local panel");
  assert.equal(result.side, "right");
  assert.equal(intersectionArea(result.rect, reference), 0);
  assert.deepEqual(anchor, original);
});
test("an offscreen card docks the panel instead of inventing an anchor", () => {
  assert.deepEqual(placeComposer({ anchor: { ...anchor, x: -1000 }, safe, size }), {
    kind: "docked",
    reason: "offscreen",
  });
});
test("too little room docks the panel rather than clipping it or moving the view", () => {
  for (const available of [
    composerSafeArea(370, 700),
    composerSafeArea(1000, 300),
    { x: 64, y: 12, width: 560, height: 400 },
  ]) {
    const result = placeComposer({
      anchor: { x: 80, y: 60, width: 480, height: 310 },
      safe: available,
      size,
    });
    assert.equal(result.kind, "docked");
  }
});
test("small movements keep the placement; a real pan does not pin the panel", () => {
  const start = placeComposer({ anchor, safe, size });
  assert.equal(placeComposer({ anchor: { ...anchor, y: anchor.y - 10 }, safe, previous: start, size }), start);
  const afterPan = placeComposer({ anchor: { ...anchor, y: 420 }, safe, previous: start, size });
  assert.notDeepEqual(afterPan, start);
});
test("when no side is free, the side that clips the card least wins, unless it would cover most of it", () => {
  const board = composerSafeArea(1224, 1000);
  const card = { x: 432, y: 300, width: 360, height: 440 };
  const result = placeComposer({ anchor: card, safe: board, size: { width: 440, height: 330 } });
  assert.equal(result.kind, "local");
  if (result.kind !== "local") throw Error("Expected a local panel");
  assert.equal(result.side, "right");
  assert.ok(intersectionArea(result.rect, card) <= 20 * card.height);
  assert.equal(intersectionArea(result.rect, board), 440 * 330);
  const cramped = placeComposer({
    anchor: { x: 80, y: 60, width: 480, height: 310 },
    safe: { x: 64, y: 12, width: 560, height: 400 },
    size,
  });
  assert.equal(cramped.kind, "docked");
});
test("the caller's size is honoured and a grown panel re-checks its old spot", () => {
  const result = placeComposer({ anchor, safe, size: { width: 440, height: 360 } });
  assert.equal(result.kind, "local");
  if (result.kind !== "local") throw Error("Expected a local panel");
  assert.equal(result.rect.width, 440);
  assert.equal(result.rect.height, 360);
  assert.equal(intersectionArea(result.rect, anchor), 0);
  const grown = placeComposer({ anchor, safe, previous: result, size: { width: 440, height: 400 } });
  if (grown.kind !== "local") throw Error("Expected a local panel");
  assert.equal(grown.rect.height, 400);
  assert.equal(grown.side, result.side);
});
test("other cards break ties only after references", () => {
  const neighbour: ScreenRect = { x: 200, y: 312, width: 340, height: 240 };
  const free = placeComposer({ anchor, safe, avoid: [neighbour], size });
  assert.equal(free.kind, "local");
  if (free.kind !== "local") throw Error("Expected a local panel");
  assert.equal(free.side, "right");
  const reference: ScreenRect = { x: 600, y: 60, width: 300, height: 220 };
  const kept = placeComposer({ anchor, safe, references: [reference], avoid: [neighbour], size });
  assert.equal(kept.kind, "local");
  if (kept.kind !== "local") throw Error("Expected a local panel");
  assert.equal(kept.side, "below");
  assert.equal(intersectionArea(kept.rect, reference), 0);
});
