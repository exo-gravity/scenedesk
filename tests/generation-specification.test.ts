import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aspectRatioOptions,
  durationControl,
  qualityOf,
  qualityOptions,
  reconcileOutputForCapability,
  resolutionFor,
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
    "16:9 · 720P · 5s · 有声",
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
    "8s",
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

const seedream = {
  allowedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "21:9"],
  allowedResolutions: ["1024x1024", "1424x800", "2816x1584", "800x1424", "1152x864", "1568x672"],
  outputs: [
    { resolution: "1024x1024", aspectRatio: "1:1", quality: "1K" },
    { resolution: "1424x800", aspectRatio: "16:9", quality: "1K" },
    { resolution: "2816x1584", aspectRatio: "16:9", quality: "2K" },
    { resolution: "800x1424", aspectRatio: "9:16", quality: "1K" },
    { resolution: "1152x864", aspectRatio: "4:3", quality: "1K" },
    { resolution: "1568x672", aspectRatio: "21:9", quality: "1K" },
  ],
};

test("the panel offers three ratios and drops the rest", () => {
  assert.deepEqual(aspectRatioOptions(seedream), ["16:9", "9:16", "1:1"]);
});

test("a model that allows none of the three keeps its own ratios rather than none", () => {
  assert.deepEqual(
    aspectRatioOptions({ allowedAspectRatios: ["3:5"], allowedResolutions: ["96x160"] }),
    ["3:5"],
  );
});

test("the tiers on offer are the ones the chosen ratio actually has", () => {
  assert.deepEqual(qualityOptions(seedream, "16:9"), [
    { quality: "1K", resolution: "1424x800" },
    { quality: "2K", resolution: "2816x1584" },
  ]);
  assert.deepEqual(qualityOptions(seedream, "9:16"), [{ quality: "1K", resolution: "800x1424" }]);
  assert.deepEqual(qualityOptions(seedream, undefined), []);
});

test("without an output table the flat resolution list stands in, unlabelled", () => {
  const legacy = { allowedAspectRatios: ["1:1"], allowedResolutions: ["32x32", "64x64"] };
  assert.deepEqual(qualityOptions(legacy, "1:1"), [
    { quality: "32x32", resolution: "32x32" },
    { quality: "64x64", resolution: "64x64" },
  ]);
  assert.equal(qualityOf(legacy, "32x32"), "32x32");
});

test("a ratio and a tier resolve to one pixel size", () => {
  assert.equal(resolutionFor(seedream, "16:9", "2K"), "2816x1584");
  assert.equal(resolutionFor(seedream, "9:16", "2K"), undefined);
  assert.equal(qualityOf(seedream, "2816x1584"), "2K");
});

test("switching models drops a size the new model cannot make, and fills a lone choice", () => {
  // 16:9 survives; 2K does not exist for it on the new model, so the size goes.
  const narrowed = {
    allowedAspectRatios: ["16:9"],
    allowedResolutions: ["1280x720"],
    outputs: [{ resolution: "1280x720", aspectRatio: "16:9", quality: "720p" }],
  };
  assert.deepEqual(
    reconcileOutputForCapability({
      kind: "video",
      output: { aspectRatio: "16:9", resolution: "2816x1584" },
      capability: narrowed,
    }),
    { aspectRatio: "16:9", resolution: "1280x720" },
  );
});

test("a summary names the tier, not the pixel size, and writes seconds as s", () => {
  assert.equal(
    specificationSummary({
      kind: "video",
      capability: seedream,
      output: { aspectRatio: "16:9", resolution: "2816x1584", durationSeconds: 5, withAudio: true },
    }),
    "16:9 · 2K · 5s · 有声",
  );
});

test("without an output table the sizes stand on their own, ratio or no ratio", () => {
  // Every record on a deployment that has not been re-provisioned looks like
  // this, and a draft saved before the ratio became required has no ratio.
  const legacy = { allowedAspectRatios: ["16:9", "9:16"], allowedResolutions: ["2816x1584", "1424x800"] };
  assert.deepEqual(qualityOptions(legacy, undefined), [
    { quality: "2816x1584", resolution: "2816x1584" },
    { quality: "1424x800", resolution: "1424x800" },
  ]);
  assert.deepEqual(
    reconcileOutputForCapability({
      kind: "image",
      output: { resolution: "2816x1584" },
      capability: legacy,
    }),
    { resolution: "2816x1584" },
  );
});
