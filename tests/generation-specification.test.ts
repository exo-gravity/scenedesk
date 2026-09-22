import assert from "node:assert/strict";
import { test } from "node:test";
import {
  durationControl,
  reconcileOutputForCapability,
  specificationSummary,
} from "../apps/web/src/business/generation-specification.js";

test("no chosen values produce no summary, never placeholder words", () => {
  assert.equal(specificationSummary({ kind: "video", output: {} }), null);
  assert.equal(specificationSummary({ kind: "image", output: {} }), null);
  assert.equal(specificationSummary({ kind: "audio", output: {} }), null);
});

test("a video summary lists ratio, resolution, duration and audio in that order", () => {
  assert.equal(
    specificationSummary({
      kind: "video",
      output: {
        aspectRatio: "16:9",
        resolution: "720P",
        durationSeconds: 5,
        withAudio: true,
      },
    }),
    "16:9 · 720P · 5 秒 · 有声",
  );
});

test("an image summary ignores duration and audio; an audio summary ignores ratio and resolution", () => {
  assert.equal(
    specificationSummary({
      kind: "image",
      output: { aspectRatio: "1:1", durationSeconds: 5, withAudio: true },
    }),
    "1:1",
  );
  assert.equal(
    specificationSummary({
      kind: "audio",
      output: { aspectRatio: "1:1", resolution: "1080P", durationSeconds: 8 },
    }),
    "8 秒",
  );
});

test("seed and fixed shot sources are appended only when present", () => {
  assert.equal(
    specificationSummary({
      kind: "video",
      output: { aspectRatio: "9:16", seed: 7 },
      shotSourceCount: 2,
    }),
    "9:16 · 种子 7 · 2 镜头",
  );
  assert.equal(
    specificationSummary({ kind: "video", output: {}, shotSourceCount: 0 }),
    null,
  );
});

const range = {
  allowedAspectRatios: ["16:9", "9:16", "1:1"],
  allowedResolutions: ["720P", "1080P"],
  minDurationSeconds: 3,
  maxDurationSeconds: 10,
  audioOutput: true,
};
const fixed = {
  allowedAspectRatios: ["9:16"],
  allowedResolutions: ["720P"],
  minDurationSeconds: 4,
  maxDurationSeconds: 4,
  audioOutput: false,
};

test("switching models keeps every value the new model still accepts", () => {
  assert.deepEqual(
    reconcileOutputForCapability({
      kind: "video",
      output: {
        aspectRatio: "9:16",
        resolution: "1080P",
        durationSeconds: 6,
        withAudio: true,
        seed: 3,
      },
      capability: range,
    }),
    {
      aspectRatio: "9:16",
      resolution: "1080P",
      durationSeconds: 6,
      withAudio: true,
      seed: 3,
    },
  );
});

test("values the new model rejects are dropped, and its only choices are filled in", () => {
  assert.deepEqual(
    reconcileOutputForCapability({
      kind: "video",
      output: {
        aspectRatio: "16:9",
        resolution: "1080P",
        durationSeconds: 6,
        withAudio: true,
        seed: 3,
      },
      capability: fixed,
    }),
    { aspectRatio: "9:16", resolution: "720P", durationSeconds: 4, seed: 3 },
  );
  // A ratio the fixed model does accept survives.
  assert.deepEqual(
    reconcileOutputForCapability({
      kind: "video",
      output: { aspectRatio: "9:16" },
      capability: fixed,
    }),
    { aspectRatio: "9:16", resolution: "720P", durationSeconds: 4 },
  );
});

test("image drafts never carry duration or audio; audio drafts never carry ratio or resolution", () => {
  assert.deepEqual(
    reconcileOutputForCapability({
      kind: "image",
      output: { aspectRatio: "1:1", durationSeconds: 5, withAudio: true },
      capability: { ...range, allowedAspectRatios: ["1:1"] },
    }),
    { aspectRatio: "1:1" },
  );
  assert.deepEqual(
    reconcileOutputForCapability({
      kind: "audio",
      output: { aspectRatio: "1:1", resolution: "720P", durationSeconds: 5 },
      capability: range,
    }),
    { durationSeconds: 5 },
  );
});

test("without a model nothing is kept but the seed", () => {
  assert.deepEqual(
    reconcileOutputForCapability({
      kind: "video",
      output: { aspectRatio: "16:9", seed: 9 },
      capability: undefined,
    }),
    { seed: 9 },
  );
});

test("the duration control is a range when the model allows one, fixed when it does not, absent for images", () => {
  assert.deepEqual(durationControl("video", range), { min: 3, max: 10 });
  assert.deepEqual(durationControl("video", fixed), { fixed: 4 });
  assert.equal(durationControl("image", range), null);
  assert.equal(durationControl("video", undefined), null);
  assert.equal(
    durationControl("audio", { ...range, minDurationSeconds: undefined }),
    null,
  );
});
