import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateCardHeight, nearestFreeSpot } from "../apps/web/src/studio/board/free-spot.js";

test("an empty board centres the new card on the origin", () => {
  assert.deepEqual(
    nearestFreeSpot({ origin: { x: 500, y: 400 }, width: 270, height: 480, others: [] }),
    { x: 365, y: 160 },
  );
});

test("a covered spot moves past the card it hits, right first, whatever that card's width", () => {
  // The neighbour is wider than the new card: a fixed step of the new card's
  // width would land on it again; the search steps past the neighbour instead.
  const wide = [{ x: 0, y: 0, width: 480, height: 270 }];
  assert.deepEqual(
    nearestFreeSpot({ origin: { x: 135, y: 240 }, width: 270, height: 480, others: wide }),
    { x: 520, y: 0 },
  );
  const text = [{ x: 560, y: 338, width: 320, height: 120 }];
  assert.deepEqual(
    nearestFreeSpot({ origin: { x: 720, y: 451 }, width: 270, height: 480, others: text }),
    { x: 920, y: 211 },
  );
});

test("a free spot still inside the view wins over a nearer one outside it", () => {
  const others = [{ x: 0, y: 0, width: 480, height: 270 }];
  // Right of the neighbour would hang out of this view; below it is in view.
  assert.deepEqual(
    nearestFreeSpot({ origin: { x: 135, y: 240 }, width: 270, height: 480, others, within: { x: -100, y: -100, width: 800, height: 1000 } }),
    { x: 0, y: 310 },
  );
  // With no spot in view, the nearest free one is taken as before.
  assert.deepEqual(
    nearestFreeSpot({ origin: { x: 135, y: 240 }, width: 270, height: 480, others, within: { x: 0, y: 0, width: 500, height: 300 } }),
    { x: 520, y: 0 },
  );
});

test("a row of cards is walked past until there is a gap", () => {
  const row = [
    { x: 0, y: 0, width: 300, height: 200 },
    { x: 340, y: 0, width: 300, height: 200 },
    { x: 680, y: 0, width: 300, height: 200 },
  ];
  assert.deepEqual(
    nearestFreeSpot({ origin: { x: 150, y: 100 }, width: 300, height: 200, others: row, within: { x: 0, y: 0, width: 1400, height: 600 } }),
    { x: 1020, y: 0 },
  );
});

test("a card's expected height is its frame at that width; audio and empty text have fixed heights", () => {
  assert.equal(estimateCardHeight("image", 270, { width: 9, height: 16 }), 480);
  assert.equal(estimateCardHeight("video", 480, { width: 16, height: 9 }), 270);
  assert.equal(estimateCardHeight("audio", 360, null), 96);
  assert.equal(estimateCardHeight("text", 320, null), 120);
  // A media card whose picture is not known yet: a working guess, not a frame.
  assert.equal(estimateCardHeight("image", 360, null), 200);
});
