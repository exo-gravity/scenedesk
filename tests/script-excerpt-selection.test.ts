import assert from "node:assert/strict";
import { test } from "node:test";
import { selectedTextareaRange } from "../apps/web/src/business/script-excerpt-selection.js";

test("textarea selections retain the exact saved CRLF and CR around Unicode text", () => {
  const source = "甲\r\n😀乙\r丙\n丁",
    displayed = "甲\n😀乙\n丙\n丁";
  assert.deepEqual(selectedTextareaRange(source, displayed, 2, 6), {
    range: { startOffset: 3, endOffset: 6 },
    quote: "😀乙\r",
  });
  assert.deepEqual(selectedTextareaRange(source, displayed, 0, 9), {
    range: { startOffset: 0, endOffset: 9 },
    quote: source,
  });
});

test("selection positions distinguish repeated text after normalized line endings", () => {
  assert.deepEqual(selectedTextareaRange("同文\r\n同文", "同文\n同文", 3, 5), {
    range: { startOffset: 4, endOffset: 6 },
    quote: "同文",
  });
});

test("stale display, partial emoji and empty selection cannot produce a fixed excerpt", () => {
  assert.throws(() => selectedTextareaRange("😀\r\n后", "😀\n别", 0, 2), /改变/);
  assert.throws(() => selectedTextareaRange("😀\r\n后", "😀\n后", 1, 2), /完整/);
  assert.throws(() => selectedTextareaRange("😀\r\n后", "😀\n后", 2, 2), /完整/);
});
