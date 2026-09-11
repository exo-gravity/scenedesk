import assert from "node:assert/strict";
import test from "node:test";
import { validateGeneratedVisual } from "../packages/media/src/generated-output.js";
const output = { resolution: "256x144", durationSeconds: 2, withAudio: true };
const probe = {
  kind: "video" as const,
  mime: "video/mp4",
  width: 256,
  height: 144,
  durationUs: 2000000,
  fpsNum: 24,
  fpsDen: 1,
  hasAudio: true,
};
test("generated video preserves actual integer timing and allows no more than one decoded frame of container quantization", () => {
  validateGeneratedVisual(probe, "video/mp4", output);
  validateGeneratedVisual(
    { ...probe, durationUs: 2041666 },
    "video/mp4",
    output,
  );
  assert.throws(
    () =>
      validateGeneratedVisual(
        { ...probe, durationUs: 2041667 },
        "video/mp4",
        output,
      ),
    /一帧/,
  );
  assert.throws(
    () =>
      validateGeneratedVisual(
        { ...probe, durationUs: 1958333 },
        "video/mp4",
        output,
      ),
    /一帧/,
  );
  validateGeneratedVisual(
    { ...probe, fpsNum: 30000, fpsDen: 1001, durationUs: 2033366 },
    "video/mp4",
    output,
  );
  assert.throws(
    () =>
      validateGeneratedVisual(
        { ...probe, fpsNum: 30000, fpsDen: 1001, durationUs: 2033367 },
        "video/mp4",
        output,
      ),
    /一帧/,
  );
  assert.equal(probe.durationUs, 2000000);
});
test("generated video rejects missing audio, frame evidence and wrong output kind or dimensions", () => {
  for (const invalid of [
    { ...probe, hasAudio: false },
    { ...probe, fpsNum: 0 },
    { ...probe, fpsNum: -24 },
    { ...probe, fpsDen: -1 },
    { ...probe, durationUs: 0 },
    { ...probe, durationUs: Number.MAX_SAFE_INTEGER + 1 },
    { ...probe, width: 128 },
    { ...probe, kind: "image" as const },
  ])
    assert.throws(() => validateGeneratedVisual(invalid, "video/mp4", output));
  validateGeneratedVisual(
    {
      kind: "image",
      mime: "image/png",
      width: 256,
      height: 144,
      hasAudio: false,
    },
    "image/png",
    { resolution: "256x144" },
  );
});
