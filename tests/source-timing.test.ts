import assert from "node:assert/strict";
import test from "node:test";
import {
  mapVideoFrames,
  type VideoTiming,
} from "../packages/media/src/source-timing.js";

function source(pts: string[], durationPts?: string): VideoTiming {
  return {
    streamIndex: 0,
    timeBase: { numerator: 1, denominator: 24 },
    width: 64,
    height: 48,
    pixelFormat: "yuv420p",
    sampleAspectRatio: "1:1",
    color: {
      range: "unknown",
      space: "unknown",
      transfer: "unknown",
      primaries: "unknown",
    },
    frames: pts.map((point, i) => ({
      pts: point,
      ...(i === pts.length - 1 && durationPts !== undefined
        ? { durationPts }
        : {}),
    })),
  };
}

test("source mapping uses presentation intervals, exact joints and a verified final end", () => {
  const value = source(["120", "122", "123", "128", "131"], "1");
  const map = mapVideoFrames(value, { numerator: 24, denominator: 1 });
  assert.equal(map.startPts, "120");
  assert.equal(map.endPts, "132");
  assert.equal(map.frameCount, 12);
  assert.deepEqual(
    map.spans.map((s) => [s.outputStartFrame, s.outputEndFrame]),
    [
      [0, 2],
      [2, 3],
      [3, 8],
      [8, 11],
      [11, 12],
    ],
  );
  const ntsc = mapVideoFrames(value, { numerator: 30000, denominator: 1001 });
  assert.equal(ntsc.frameCount, 14);
  assert.deepEqual(
    ntsc.spans.map((s) => [s.outputStartFrame, s.outputEndFrame]),
    [
      [0, 3],
      [3, 4],
      [4, 10],
      [10, 14],
      [14, 14],
    ],
  );
  // A legal long VFR frame covers all intermediate sample times.
  assert.equal(
    mapVideoFrames(source(["0", "24000"], "1"), {
      numerator: 24,
      denominator: 1,
    }).spans[0]!.outputEndFrame,
    24000,
  );
});

test("large and negative source PTS retain exact relative coordinates", () => {
  for (const origin of [9007199254740993n, -9007199254740993n]) {
    const map = mapVideoFrames(
      source([origin.toString(), (origin + 1n).toString()], "1"),
      { numerator: 24, denominator: 1 },
    );
    assert.equal(map.startPts, origin.toString());
    assert.equal(map.frameCount, 2);
    assert.deepEqual(
      map.spans.map((s) => s.outputStartFrame),
      [0, 1],
    );
  }
});

test("ambiguous timing, missing final duration, subframe media and unsafe profiles fail explicitly", () => {
  for (const value of [
    source(["0", "0"], "1"),
    source(["1", "0"], "1"),
    source(["N/A"], "1"),
    source(["0"]),
    source(["0"], "0"),
    source(["0"], "-1"),
  ]) {
    assert.throws(
      () => mapVideoFrames(value, { numerator: 24, denominator: 1 }),
      { code: "MEDIA_TIMING_INVALID" },
    );
  }
  assert.throws(
    () =>
      mapVideoFrames(
        {
          ...source(["0"], "1"),
          timeBase: { numerator: 1, denominator: 1000 },
        },
        { numerator: 24, denominator: 1 },
      ),
    { code: "MEDIA_SOURCE_TOO_SHORT" },
  );
  assert.throws(
    () => mapVideoFrames(source(["0"], "1"), { numerator: 48, denominator: 2 }),
    { code: "MEDIA_PROFILE_INVALID" },
  );
  assert.throws(
    () =>
      mapVideoFrames(source(["0"], "1"), { numerator: 29.97, denominator: 1 }),
    { code: "MEDIA_TIMING_INVALID" },
  );
});
