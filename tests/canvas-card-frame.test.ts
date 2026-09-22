import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultCardWidth,
  draftFrameAspect,
  emptyDraftFrame,
} from "../apps/web/src/business/canvas-card-frame.js";

const draft = (kind: "image" | "video" | "audio", aspectRatio?: string) => ({
  kind,
  content: {
    type: "draft" as const,
    prompt: "",
    output: aspectRatio ? { aspectRatio } : {},
  },
});

test("a draft frame follows the chosen aspect ratio", () => {
  assert.deepEqual(draftFrameAspect(draft("video", "9:16")), {
    width: 9,
    height: 16,
  });
  assert.deepEqual(draftFrameAspect(draft("image", "4:3")), {
    width: 4,
    height: 3,
  });
});

test("without a chosen ratio, video frames default to 16:9 and image frames to 1:1", () => {
  assert.deepEqual(draftFrameAspect(draft("video")), { width: 16, height: 9 });
  assert.deepEqual(draftFrameAspect(draft("image")), { width: 1, height: 1 });
});

test("an unreadable ratio falls back to the kind's default instead of a broken frame", () => {
  assert.deepEqual(draftFrameAspect(draft("video", "wide")), {
    width: 16,
    height: 9,
  });
  assert.deepEqual(draftFrameAspect(draft("image", "0:3")), {
    width: 1,
    height: 1,
  });
});

test("audio drafts have no picture frame", () => {
  assert.equal(draftFrameAspect(draft("audio", "16:9")), null);
});

test("a new picture card keeps the same area whatever its shape", () => {
  assert.equal(defaultCardWidth("image", { width: 1, height: 1 }), 360);
  assert.equal(defaultCardWidth("video", { width: 16, height: 9 }), 480);
  assert.equal(defaultCardWidth("video", { width: 9, height: 16 }), 270);
  assert.equal(defaultCardWidth("image", { width: 4, height: 3 }), 416);
});

test("extreme shapes stay within the board's width limits", () => {
  assert.equal(defaultCardWidth("image", { width: 100, height: 1 }), 1600);
  assert.equal(defaultCardWidth("image", { width: 1, height: 100 }), 120);
});

test("text and audio cards have fixed widths; a picture card without a shape keeps the old width", () => {
  assert.equal(defaultCardWidth("text"), 320);
  assert.equal(defaultCardWidth("audio", { width: 9, height: 16 }), 360);
  assert.equal(defaultCardWidth("image"), 360);
  assert.equal(defaultCardWidth("video", null), 360);
});

test("an empty draft frames itself with its chosen ratio, else the project's shape", () => {
  const project = { width: 9, height: 16 };
  assert.deepEqual(emptyDraftFrame(draft("video", "16:9"), project), { width: 16, height: 9 });
  assert.deepEqual(emptyDraftFrame(draft("image"), project), project);
});

test("an audio draft has no frame, so the project's shape never stretches it", () => {
  assert.equal(emptyDraftFrame(draft("audio"), { width: 9, height: 16 }), null);
});
