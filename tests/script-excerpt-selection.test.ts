import assert from "node:assert/strict";
import { test } from "node:test";
import {
  moveReadonlySelection,
  selectedDocumentQuote,
  selectedTextareaRange,
} from "../apps/web/src/business/script-excerpt-selection.js";

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
  assert.throws(
    () => selectedTextareaRange("😀\r\n后", "😀\n别", 0, 2),
    /改变/,
  );
  assert.throws(
    () => selectedTextareaRange("😀\r\n后", "😀\n后", 1, 2),
    /完整/,
  );
  assert.throws(
    () => selectedTextareaRange("😀\r\n后", "😀\n后", 2, 2),
    /完整/,
  );
});

test("a unique reading-paper quote maps to exact saved Unicode and CRLF offsets", () => {
  assert.deepEqual(
    selectedDocumentQuote("开场\r\n😀旧钥匙\r\n门开了", "😀旧钥匙\n门"),
    {
      range: { startOffset: 4, endOffset: 11 },
      quote: "😀旧钥匙\r\n门",
    },
  );
});

test("ambiguous or layout-transformed paper selections fall back to canonical selection", () => {
  assert.equal(selectedDocumentQuote("他说你好，她说你好", "你好"), null);
  assert.equal(selectedDocumentQuote("aaaa", "aa"), null);
  assert.equal(selectedDocumentQuote("第一列\t第二列", "第一列 第二列"), null);
  assert.equal(selectedDocumentQuote("未改动原文", "不存在的文字"), null);
  assert.equal(selectedDocumentQuote("😀旧钥匙", "\ud83d"), null);
  assert.equal(selectedDocumentQuote("空白\n\n内容", "\n\n"), null);
  assert.equal(selectedDocumentQuote("原文", ""), null);
  assert.equal(
    selectedDocumentQuote("甲".repeat(20001), "甲".repeat(20001)),
    null,
  );
});

test("readonly arrows collapse a range and extend back across complete Unicode points", () => {
  const text = "前😀后";
  assert.deepEqual(moveReadonlySelection(text, 0, 4, "forward", "ArrowRight", false), {
    start: 4, end: 4, direction: "none",
  });
  assert.deepEqual(moveReadonlySelection(text, 4, 4, "none", "ArrowLeft", true), {
    start: 3, end: 4, direction: "backward",
  });
  assert.deepEqual(moveReadonlySelection(text, 3, 4, "backward", "ArrowLeft", true), {
    start: 1, end: 4, direction: "backward",
  });
  assert.deepEqual(moveReadonlySelection(text, 1, 4, "backward", "ArrowRight", true), {
    start: 3, end: 4, direction: "backward",
  });
  assert.deepEqual(moveReadonlySelection(text, 0, 4, "backward", "ArrowLeft", false), {
    start: 0, end: 0, direction: "none",
  });
});

test("readonly selection keeps its anchor when extending forward and clamps document edges", () => {
  const text = "前😀后";
  assert.deepEqual(moveReadonlySelection(text, 1, 1, "none", "ArrowRight", true), {
    start: 1, end: 3, direction: "forward",
  });
  assert.deepEqual(moveReadonlySelection(text, 1, 3, "forward", "ArrowLeft", true), {
    start: 1, end: 1, direction: "forward",
  });
  assert.deepEqual(moveReadonlySelection(text, 0, 0, "none", "ArrowLeft", true), {
    start: 0, end: 0, direction: "forward",
  });
  assert.deepEqual(moveReadonlySelection(text, 4, 4, "none", "ArrowRight", false), {
    start: 4, end: 4, direction: "none",
  });
});
