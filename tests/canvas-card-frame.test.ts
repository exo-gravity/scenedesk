import assert from "node:assert/strict";
import { test } from "node:test";
import { draftFrameAspect } from "../apps/web/src/business/canvas-card-frame.js";

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
