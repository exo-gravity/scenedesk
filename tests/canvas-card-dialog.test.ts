import assert from "node:assert/strict";
import { test } from "node:test";
import { placeCardDialog } from "../apps/web/src/business/canvas-card-dialog.js";

const anchor = { top: 400, height: 240 };

test("a card dialog sits above its card when there is room", () => {
  assert.deepEqual(placeCardDialog({ anchor, height: 110, inset: 12 }), {
    top: 400 - 12 - 110,
    side: "above",
  });
});

test("a card dialog flips below the card when the card is at the top edge", () => {
  assert.deepEqual(
    placeCardDialog({ anchor: { top: 20, height: 240 }, height: 110, inset: 12 }),
    { top: 20 + 240 + 12, side: "below" },
  );
  // Exactly enough room still counts as room.
  assert.equal(
    placeCardDialog({ anchor: { top: 134, height: 240 }, height: 110, inset: 12 })
      .side,
    "above",
  );
});

test("a card above the board's top edge gets its dialog pinned inside", () => {
  assert.deepEqual(
    placeCardDialog({ anchor: { top: -300, height: 240 }, height: 110, inset: 12 }),
    { top: 12, side: "below" },
  );
});
