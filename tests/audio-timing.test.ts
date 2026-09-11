import assert from "node:assert/strict";
import test from "node:test";
import {
  mapAudioFrames,
  type AudioTiming,
} from "../packages/media/src/audio-timing.js";

function timing(
  pts: string[],
  options: Partial<AudioTiming> = {},
): AudioTiming {
  return {
    streamIndex: 0,
    timeBase: { numerator: 1, denominator: 48000 },
    sampleRate: 48000,
    channels: 1,
    sampleFormat: "dbl",
    channelLayout: "mono",
    frames: pts.map((pts) => ({ pts, samples: 1024, durationPts: "1024" })),
    ...options,
  };
}

test("audio uses decoded samples while explicit final presentation duration removes only known padding", () => {
  const map = mapAudioFrames(
    timing(["0", "1024"], {
      sampleRate: 44100,
      timeBase: { numerator: 1, denominator: 44100 },
      frames: [
        { pts: "0", samples: 1024, durationPts: "1024" },
        { pts: "1024", samples: 1024, durationPts: "314" },
      ],
    }),
  );
  assert.equal(map.decodedSamples, 2048);
  assert.equal(map.discardedTailSamples, 710);
  assert.equal(map.segments[0]!.sourceSamples, 1338);
  assert.equal(map.outputSamples, 1457);
  assert.throws(
    () =>
      mapAudioFrames(
        timing([], {
          frames: [
            { pts: "0", samples: 1024, durationPts: "314" },
            { pts: "314", samples: 1024, durationPts: "1024" },
          ],
        }),
      ),
    { code: "MEDIA_AUDIO_TIMING_INVALID" },
  );
});

test("coarse timestamps share one clock phase without adding per-frame silence or cumulative tolerance", () => {
  const map = mapAudioFrames(
    timing([], {
      timeBase: { numerator: 1, denominator: 1000 },
      frames: [5000, 5021, 5043, 5064, 5085].map((pts) => ({
        pts: String(pts),
        samples: 1024,
        durationPts: "21",
      })),
    }),
  );
  assert.equal(map.segments.length, 1);
  assert.equal(map.outputSamples, 5120);
  assert.equal(map.discardedTailSamples, 0);
  assert.deepEqual(map.silence, []);
  // Each neighbouring pair looks close, but the entire run cannot share one phase.
  assert.throws(
    () =>
      mapAudioFrames(
        timing([], {
          timeBase: { numerator: 1, denominator: 1000 },
          frames: [0, 21, 42, 63, 84].map((pts) => ({
            pts: String(pts),
            samples: 1024,
          })),
        }),
      ),
    { code: "MEDIA_AUDIO_TIMING_INVALID" },
  );
});

test("video zero, internal gaps and fractional negative cropping use exact rational sample positions", () => {
  const source = timing(["240000", "242048"]);
  const zero = { pts: "119", timeBase: { numerator: 1, denominator: 24 } };
  const positive = mapAudioFrames(source, zero);
  assert.deepEqual(positive.silence, [
    { startSample: 0, endSample: 2000 },
    { startSample: 3024, endSample: 4048 },
  ]);
  assert.equal(positive.outputSamples, 5072);
  const negative = mapAudioFrames(source, {
    pts: "5000009",
    timeBase: { numerator: 1, denominator: 1_000_000 },
  });
  assert.equal(negative.segments[0]!.croppedLeadingSamples, 1);
  assert.equal(negative.segments[0]!.outputStartSample, 1);
  assert.equal(negative.segments[0]!.outputEndSample, 1024);
  assert.deepEqual(negative.silence, [
    { startSample: 0, endSample: 1 },
    { startSample: 1024, endSample: 2048 },
  ]);
  assert.equal(
    mapAudioFrames(source, {
      pts: "6",
      timeBase: { numerator: 1, denominator: 1 },
    }).outputSamples,
    0,
  );
  for (const start of [9007199254740993n, -9007199254740993n]) {
    const precise = mapAudioFrames(
      timing([start.toString(), (start + 1024n).toString()]),
    );
    assert.equal(precise.outputSamples, 2048);
  }
});

test("missing, duplicate, overlapping, excessive and ambiguous sample intervals fail", () => {
  for (const source of [
    timing([]),
    timing(["N/A"]),
    timing(["0", "0"]),
    timing(["1024", "0"]),
    timing(["0", "1000"]),
    timing(["0", "345600001"]),
    timing([], { frames: [{ pts: "0", samples: 0 }] }),
    timing([], { frames: [{ pts: "0", samples: 1024, durationPts: "2048" }] }),
  ])
    assert.throws(() => mapAudioFrames(source));
});

test("a following PTS bounds a declared packet gap without stretching decoded samples", () => {
  const source = timing([], {
    frames: [
      { pts: "0", samples: 1024, durationPts: "4000" },
      { pts: "4000", samples: 1024, durationPts: "1024" },
    ],
  });
  const map = mapAudioFrames(source);
  assert.equal(map.decodedSamples, 2048);
  assert.equal(map.outputSamples, 5024);
  assert.deepEqual(map.silence, [{ startSample: 1024, endSample: 4000 }]);
  const atVideoZero = mapAudioFrames(source, {
    pts: "1",
    timeBase: { numerator: 1, denominator: 12 },
  });
  assert.equal(atVideoZero.outputSamples, 1024);
  assert.equal(atVideoZero.segments[0]!.croppedLeadingSamples, 1024);
  assert.equal(atVideoZero.segments[1]!.outputStartSample, 0);
  assert.throws(
    () =>
      mapAudioFrames({
        ...source,
        frames: [source.frames[0]!, { ...source.frames[1]!, pts: "2000" }],
      }),
    { code: "MEDIA_AUDIO_TIMING_INVALID" },
  );
  assert.throws(
    () => mapAudioFrames({ ...source, frames: [source.frames[0]!] }),
    { code: "MEDIA_AUDIO_TIMING_INVALID" },
  );
});
