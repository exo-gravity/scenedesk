import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMPOSER_SIZE,
  composerNominalHeight,
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
  assert.equal(result.rect.y, anchor.y + anchor.height + 12);
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

test("a panel that grows keeps its side while that side still fits", () => {
  const safe: ScreenRect = { x: 0, y: 0, width: 1600, height: 900 };
  const anchor: ScreenRect = { x: 700, y: 100, width: 280, height: 300 };
  const first = placeComposer({ anchor, safe, size: { width: 660, height: 240 } });
  assert.equal(first.kind, "local");
  // A reference card sits below the anchor, which the soft constraints would rather not cover.
  const grown = placeComposer({
    anchor, safe, previous: first, size: { width: 660, height: 420 },
    references: [{ x: 700, y: 420, width: 280, height: 200 }],
  });
  assert.equal(grown.kind, "local");
  assert.equal((grown as { side: string }).side, (first as { side: string }).side);
});

test("a pinned panel sits at its offset from the card and follows the card", () => {
  const pinned = { dx: -40, dy: 200 };
  const result = placeComposer({ anchor, safe, size, pinned });
  assert.equal(result.kind, "local");
  if (result.kind !== "local") throw Error("Expected a local panel");
  assert.equal(result.side, "pinned");
  assert.deepEqual(result.rect, { x: anchor.x - 40, y: anchor.y + 200, width: 400, height: 280 });
  const moved = placeComposer({ anchor: { ...anchor, x: anchor.x + 150 }, safe, size, pinned });
  if (moved.kind !== "local") throw Error("Expected a local panel");
  assert.equal(moved.rect.x, anchor.x + 150 - 40);
});
test("a pinned panel is held inside the safe area, and may cover the card if the user put it there", () => {
  const result = placeComposer({ anchor, safe, size, pinned: { dx: 5000, dy: -5000 } });
  if (result.kind !== "local") throw Error("Expected a local panel");
  assert.equal(result.rect.x, safe.x + safe.width - 400);
  assert.equal(result.rect.y, safe.y);
  const over = placeComposer({ anchor, safe, size, pinned: { dx: 0, dy: 0 } });
  if (over.kind !== "local") throw Error("Expected a local panel");
  assert.ok(intersectionArea(over.rect, anchor) > 0);
});
test("a pin does not stop docking when the card is off screen or the room is gone", () => {
  const pinned = { dx: 0, dy: 0 };
  assert.equal(placeComposer({ anchor: { ...anchor, x: -1000 }, safe, size, pinned }).kind, "docked");
  assert.equal(
    placeComposer({ anchor: { x: 80, y: 60, width: 480, height: 310 }, safe: composerSafeArea(370, 700), size, pinned }).kind,
    "docked",
  );
});

test("a side chosen while the card was elsewhere is not kept once the card has really moved", () => {
  const safe: ScreenRect = { x: 0, y: 0, width: 1000, height: 900 };
  const size = { width: 660, height: 240 };
  // Near the bottom of a narrow board, only above fits.
  const low = placeComposer({ anchor: { x: 200, y: 640, width: 280, height: 240 }, safe, size });
  assert.equal(low.kind, "local");
  assert.equal((low as { side: string }).side, "above");
  // The view animates the card up: below is free again and is the first choice, even though above still fits.
  const settled = placeComposer({ anchor: { x: 200, y: 300, width: 280, height: 240 }, safe, size, previous: low });
  assert.equal(settled.kind, "local");
  assert.equal((settled as { side: string }).side, "below");
});

test("a side panel does not stay where the card was after a vertical pan when below fits again", () => {
  const safe: ScreenRect = { x: 0, y: 0, width: 1600, height: 900 };
  const size = { width: 660, height: 240 };
  // Low on the board, below does not fit and the panel goes to the right.
  const low = placeComposer({ anchor: { x: 100, y: 500, width: 280, height: 240 }, safe, size });
  assert.equal((low as { side: string }).side, "right");
  // A 200px pan up: the old rectangle still overlaps the card vertically, but the card has moved.
  const moved = placeComposer({ anchor: { x: 100, y: 300, width: 280, height: 240 }, safe, size, previous: low });
  assert.equal(moved.kind, "local");
  if (moved.kind !== "local") throw Error("Expected a local panel");
  assert.equal(moved.side, "below");
  assert.equal(moved.rect.y, 300 + 240 + 12);
});

test("a side panel that grows past the bottom slides up and keeps its side", () => {
  const safe: ScreenRect = { x: 0, y: 0, width: 1600, height: 900 };
  const anchor: ScreenRect = { x: 100, y: 600, width: 280, height: 240 };
  const first = placeComposer({ anchor, safe, size: { width: 660, height: 240 } });
  assert.equal((first as { side: string }).side, "right");
  // A reference sits where the right panel goes; the soft constraints alone would prefer above.
  const reference: ScreenRect = { x: 900, y: 500, width: 100, height: 100 };
  const grown = placeComposer({ anchor, safe, previous: first, size: { width: 660, height: 400 }, references: [reference] });
  assert.equal(grown.kind, "local");
  if (grown.kind !== "local") throw Error("Expected a local panel");
  assert.equal(grown.side, "right");
  assert.equal(grown.rect.y, 500);
});

test("the nominal panel height grows by one reference row when the draft has references", () => {
  assert.equal(composerNominalHeight(0), COMPOSER_SIZE.height);
  assert.equal(composerNominalHeight(1), COMPOSER_SIZE.height + 56 + 8);
  assert.equal(composerNominalHeight(3), COMPOSER_SIZE.height + 56 + 8);
});
