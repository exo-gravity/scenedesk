import assert from "node:assert/strict";
import { test } from "node:test";
import { emptySelection, focusOnly } from "../apps/web/src/business/list-selection.js";
import {
  readSelection,
  subscribeSelections,
  writeSelection,
} from "../apps/web/src/business/list-selection-store.js";

/**
 * A batch selection must survive the surface that made it, because opening an
 * object replaces that surface. These are the store's public rules.
 */
test("an untouched key reports an empty selection", () => {
  assert.deepEqual(readSelection("nothing:here"), emptySelection);
});

test("a written selection is readable and notified", () => {
  const seen: string[] = [];
  const stop = subscribeSelections(() => seen.push("notified"));
  writeSelection("shot:a", focusOnly("take-1"));
  assert.deepEqual(readSelection("shot:a").selected, ["take-1"]);
  assert.equal(readSelection("shot:a").focused, "take-1");
  assert.deepEqual(seen, ["notified"]);
  stop();
});

test("clearing a key removes it rather than storing an empty selection", () => {
  writeSelection("shot:b", focusOnly("take-2"));
  writeSelection("shot:b", emptySelection);
  assert.deepEqual(readSelection("shot:b"), emptySelection);
  writeSelection("shot:b", { ...emptySelection, focused: "take-2" });
  assert.equal(readSelection("shot:b").focused, "take-2");
});

test("a written selection is a copy, so a later mutation cannot leak in", () => {
  const source = { selected: ["take-3"] };
  writeSelection("shot:c", source);
  source.selected.push("take-4");
  assert.deepEqual(readSelection("shot:c").selected, ["take-3"]);
});

test("an unsubscribed listener stops hearing about writes", () => {
  let count = 0;
  const stop = subscribeSelections(() => count++);
  writeSelection("shot:e", focusOnly("take-6"));
  stop();
  writeSelection("shot:e", focusOnly("take-7"));
  assert.equal(count, 1);
});
