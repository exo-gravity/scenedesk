import assert from "node:assert/strict";
import { test } from "node:test";
import { referenceState } from "../apps/web/src/business/canvas-reference-state.js";

const edge = { enabled: true, purpose: "composition" as const };
const media = (status: string) => ({ status });

test("a healthy reference reads as its purpose", () => {
  assert.deepEqual(
    referenceState({ edge, source: { kind: "image" }, media: media("ready") }),
    { tone: "ok", label: "构图" },
  );
  assert.deepEqual(
    referenceState({
      edge: { enabled: true, purpose: "prompt" },
      source: { kind: "text" },
    }),
    { tone: "ok", label: "提示" },
  );
});

test("a media reference whose record is still loading is not yet a valid input", () => {
  assert.deepEqual(
    referenceState({ edge, source: { kind: "image" }, media: undefined }),
    { tone: "pending", label: "正在读取素材" },
  );
  assert.deepEqual(
    referenceState({ edge, source: { kind: "image" } }),
    { tone: "pending", label: "正在读取素材" },
  );
});

test("a disabled reference says so before anything else", () => {
  assert.deepEqual(
    referenceState({
      edge: { enabled: false, purpose: "composition" },
      source: { kind: "image" },
      media: media("processing"),
    }),
    { tone: "disabled", label: "已停用" },
  );
});

test("a reference whose source left the canvas is named as missing, never submitted as valid", () => {
  assert.deepEqual(referenceState({ edge, source: undefined }), {
    tone: "missing",
    label: "来源已不在画布上",
  });
});

test("media that is not ready, archived, or unreadable is shown as such", () => {
  assert.deepEqual(
    referenceState({ edge, source: { kind: "video" }, media: media("processing") }),
    { tone: "pending", label: "正在验收原文件" },
  );
  assert.deepEqual(
    referenceState({ edge, source: { kind: "video" }, media: media("archived") }),
    { tone: "archived", label: "已归档 · 原有引用" },
  );
  assert.deepEqual(
    referenceState({ edge, source: { kind: "image" }, media: null }),
    { tone: "failed", label: "素材当前无法读取" },
  );
});
