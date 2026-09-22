import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGeneratedOutput, MediaFailure } from "@drama/media";

const probe = (durationUs: number) =>
  ({
    kind: "video",
    mime: "video/mp4",
    hasAudio: true,
    durationUs,
    fpsNum: 24,
    fpsDen: 1,
    width: 1280,
    height: 720,
  }) as any;

test("video duration within one second passes; beyond fails", () => {
  const output = { resolution: "1280x720", durationSeconds: 5, withAudio: true };
  assert.doesNotThrow(() => validateGeneratedOutput(probe(5540000), "video/mp4", output));
  assert.doesNotThrow(() => validateGeneratedOutput(probe(4100000), "video/mp4", output));
  assert.throws(
    () => validateGeneratedOutput(probe(6100000), "video/mp4", output),
    (error: unknown) => error instanceof MediaFailure && error.code === "VIDEO_OUTPUT_MISMATCH",
  );
});
