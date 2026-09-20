import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyClick,
  emptySelection,
  isFocused,
} from "../apps/web/src/business/list-selection.js";

/**
 * The shot list has no batch action, so a click only ever moves focus. These are
 * the rules the list rows depend on, expressed against the public model.
 */

test("a click on an untouched list focuses that shot", () => {
  assert.deepEqual(applyClick(emptySelection, "a"), { focused: "a" });
  assert.ok(isFocused(applyClick(emptySelection, "a"), "a"));
});

test("a click replaces the focus without keeping the previous shot", () => {
  const after = applyClick(applyClick(emptySelection, "a"), "c");
  assert.deepEqual(after, { focused: "c" });
  assert.equal(isFocused(after, "a"), false);
});

test("clicking the focused shot again leaves the same focus", () => {
  const once = applyClick(emptySelection, "a");
  assert.deepEqual(applyClick(once, "a"), { focused: "a" });
});

test("a list that has not been touched focuses nothing", () => {
  assert.equal(emptySelection.focused, undefined);
  assert.equal(isFocused(emptySelection, "a"), false);
});
