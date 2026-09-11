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

test("generated audio retains exact sample timing without any video dimensions or track toggle", () => {
  const source = {
    kind: "audio" as const,
    mime: "audio/wav",
    hasAudio: true,
    durationUs: 2000000,
    timing: {
      frameRateMode: "unknown" as const,
      audioSampleRate: 48000,
      audioChannels: 1,
    },
  };
  validateGeneratedVisual(source, "audio/wav", { durationSeconds: 2 });
  validateGeneratedVisual({ ...source, durationUs: 2000020 }, "audio/wav", {
    durationSeconds: 2,
  });
  for (const invalid of [
    { ...source, durationUs: 2000021 },
    { ...source, hasAudio: false },
    { ...source, width: 10 },
    { ...source, timing: { frameRateMode: "unknown" as const } },
  ])
    assert.throws(() =>
      validateGeneratedVisual(invalid, "audio/wav", { durationSeconds: 2 }),
    );
});
