import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyClick,
  batchTargets,
  clearSelection,
  emptySelection,
  focusOnly,
  hasBatch,
  isFocused,
  isSelected,
  selectOnly,
  toggleSelection,
} from "../apps/web/src/business/list-selection.js";

/** The lists that offer batch actions share this model, so its rules are public. */
const ordered = ["a", "b", "c", "d"];

test("a plain click only moves focus and keeps the batch set intact", () => {
  const after = applyClick(selectOnly(emptySelection, ["a", "b"]), "c");
  assert.deepEqual(after, { focused: "c", selected: ["a", "b"] });
});

test("a plain click on an untouched list focuses without selecting", () => {
  assert.deepEqual(applyClick(emptySelection, "a"), {
    focused: "a",
    selected: [],
  });
});

test("a modified click extends the selection and leaves focus alone", () => {
  const extended = applyClick(focusOnly("a"), "c", { extend: true });
  assert.deepEqual(extended, { focused: "a", selected: ["a", "c"] });
  // The pane keeps showing what the user was reading while they pick targets.
  assert.ok(isFocused(extended, "a"));
  assert.ok(isSelected(extended, "c"));
});

test("a modified click removes an object it already selected", () => {
  const both = applyClick(
    applyClick(emptySelection, "b", { extend: true }),
    "c",
    { extend: true },
  );
  assert.deepEqual(both.selected, ["b", "c"]);
  assert.deepEqual(applyClick(both, "c", { extend: true }).selected, ["b"]);
});

test("removing the focused object from the set does not blank its pane", () => {
  const state = applyClick(
    applyClick(emptySelection, "a", { extend: true }),
    "b",
    { extend: true },
  );
  const removed = applyClick({ ...state, focused: "b" }, "b", { extend: true });
  assert.deepEqual(removed, { focused: "b", selected: ["a"] });
});

test("a batch runs in list order and never touches an id the list lost", () => {
  const state = selectOnly(focusOnly("b"), ["d", "b", "gone", "a"]);
  assert.deepEqual(batchTargets(state, ordered), ["a", "b", "d"]);
  assert.ok(hasBatch(state, ordered));
});

test("a batch needs more than one target", () => {
  const single = selectOnly(focusOnly("a"), ["a"]);
  assert.deepEqual(batchTargets(single, ordered), ["a"]);
  assert.equal(hasBatch(single, ordered), false);
  assert.equal(hasBatch(clearSelection(single), ordered), false);
});

test("clearing the selection keeps the focused object on screen", () => {
  assert.deepEqual(clearSelection(focusOnly("a")), {
    focused: "a",
    selected: [],
  });
});

test("toggling builds a selection in the order objects were added", () => {
  const state = toggleSelection(
    toggleSelection(toggleSelection(emptySelection, "c"), "a"),
    "b",
  );
  assert.deepEqual(state.selected, ["c", "a", "b"]);
});
