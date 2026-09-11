import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  normalizeSavedCut,
  normalizedSubtitlesSrt,
  CutNormalizationError,
  type WorkDocument,
  type NormalizationMedia,
  type ConfirmedTiming,
  type NormalizedCutContent,
} from "@drama/domain";
import { validateContract } from "@drama/contracts/validation";

function clip(start = 0, input = 0, output = 1_000_000) {
  return {
    id: randomUUID(),
    kind: "video" as const,
    mediaId: randomUUID(),
    timelineStartUs: start,
    range: { inUs: input, outUs: output },
    gainDb: 0,
    muted: false,
    fit: "contain" as const,
    streamSelection: "default" as const,
  };
}
function fixture(fpsNum = 30000, fpsDen = 1001) {
  const cutId = randomUUID(),
    requestId = randomUUID();
  const video = clip();
  const document: WorkDocument = {
    timeline: {
      schemaVersion: "1",
      spec: { width: 1080, height: 1920, fpsNum, fpsDen, language: "zh-CN" },
      tracks: [
        { id: randomUUID(), kind: "video", items: [video], muted: false },
      ],
      burnSubtitles: false,
    },
    dramaBindings: [],
    timingOrigins: [],
    unresolvedEdits: [],
  };
  const media = new Map<string, NormalizationMedia>();
  const addMedia = (
    id: string,
    kind: "video" | "audio" = "video",
    seconds = 10,
    hasAudio = true,
  ) => {
    const value: NormalizationMedia = {
      mediaId: id,
      kind,
      sourceSha256: createHash("sha256").update(id).digest("hex"),
      productionCopyId: randomUUID(),
      duration: { numerator: String(seconds), denominator: "1" },
      ...(kind === "video"
        ? {
            video: {
              sourceMapId: randomUUID(),
              frameCount: Math.floor((seconds * fpsNum) / fpsDen),
              fpsNum,
              fpsDen,
            },
          }
        : {}),
      ...(hasAudio
        ? { audio: { sourceMapId: randomUUID(), sampleCount: seconds * 48000 } }
        : {}),
    };
    media.set(id, value);
    return value;
  };
  addMedia(video.mediaId);
  const changeId = (semanticKey: string) => {
    const hex = createHash("sha256")
      .update(`${requestId}:${semanticKey}`)
      .digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  const run = (
    options: Partial<Parameters<typeof normalizeSavedCut>[0]> = {},
  ) => normalizeSavedCut({ cutId, document, media, changeId, ...options });
  const confirm = (result: NormalizedCutContent): ConfirmedTiming => ({
    id: randomUUID(),
    cutId,
    normalizationVersion: result.normalizationVersion,
    effectiveTimeline: result.effectiveTimeline,
    normalizedItems: result.normalizedItems,
  });
  return { document, video, media, addMedia, run, confirm, cutId };
}
const hasCode = (code: string) => (error: unknown) =>
  error instanceof CutNormalizationError && error.code === code;
const itemOf = (result: NormalizedCutContent, id: string) =>
  result.normalizedItems.find((i) => i.clipId === id)!;

test("saved 30000/1001 cut normalizes inward to 29 exact frames with stable changes and no input mutation", () => {
  const f = fixture();
  f.video.range = { inUs: 100000, outUs: 1100000 };
  const before = structuredClone(f.document),
    result = f.run();
  const item = itemOf(result, f.video.id);
  assert.equal(item.sourceInFrame, 3);
  assert.equal(item.sourceOutFrame, 32);
  assert.equal(result.lengthFrames, 29);
  assert.equal(result.durationUs, 967633);
  assert.deepEqual(result.effectiveTimeline.tracks[0]!.items[0], {
    ...f.video,
    range: { inUs: 100100, outUs: 1067733 },
  });
  assert.equal(result.changes[0]!.kind, "frame_snap");
  assert.equal(result.changes[0]!.requiresAcknowledgement, true);
  assert.deepEqual(result, f.run());
  assert.deepEqual(f.document, before);
  assert.equal(
    validateContract("Timeline", result.effectiveTimeline).valid,
    true,
  );
  result.normalizedItems.forEach((i) =>
    assert.equal(validateContract("NormalizedItem", i).valid, true),
  );
  result.changes.forEach((c) =>
    assert.equal(validateContract("NormalizationChange", c).valid, true),
  );
});

test("500 save/reopen cycles at every supported rate preserve source, placement, samples and subtitle frame boundaries", () => {
  for (const [num, den] of [
    [24, 1],
    [25, 1],
    [30, 1],
    [24000, 1001],
    [30000, 1001],
  ]) {
    const f = fixture(num, den);
    f.video.range = { inUs: 100000, outUs: 1100000 };
    const audio = { ...clip(100003, 1, 100019), kind: "audio" as const };
    f.addMedia(audio.mediaId, "audio");
    const subtitle = {
      id: randomUUID(),
      kind: "subtitle" as const,
      timelineStartUs: 103457,
      durationUs: 206789,
      text: "原文",
    };
    f.document.timeline.tracks.push(
      { id: randomUUID(), kind: "audio", muted: false, items: [audio] },
      { id: randomUUID(), kind: "subtitle", muted: false, items: [subtitle] },
    );
    let result = f.run(),
      confirmed = f.confirm(result);
    const expected = structuredClone(result.normalizedItems),
      srt = normalizedSubtitlesSrt(result);
    for (let n = 0; n < 500; n++) {
      f.document.timeline = structuredClone(
        result.effectiveTimeline,
      ) as WorkDocument["timeline"];
      f.document.timingOrigins = result.normalizedItems.map((i) => ({
        clipId: i.clipId,
        normalizationId: confirmed.id,
      }));
      const video = f.document.timeline.tracks[0]!.items[0]!;
      if (video.kind === "video") video.gainDb = -(n % 10);
      result = f.run({
        confirmedOrigins: [confirmed],
        confirmedBase: confirmed,
      });
      assert.deepEqual(
        result.normalizedItems,
        expected,
        `${num}/${den} iteration ${n}`,
      );
      assert.deepEqual(result.changes, [], `${num}/${den} repeat changes ${n}`);
      assert.equal(normalizedSubtitlesSrt(result), srt);
      confirmed = f.confirm(result);
    }
  }
});

test("changing one source endpoint never resnaps the unchanged endpoint; placement uses independent provenance", () => {
  const f = fixture();
  f.video.range = { inUs: 100000, outUs: 1100000 };
  const first = f.run(),
    base = f.confirm(first);
  f.document.timeline = structuredClone(
    first.effectiveTimeline,
  ) as WorkDocument["timeline"];
  const video = f.document.timeline.tracks[0]!.items[0]!;
  assert.ok(video.kind === "video");
  video.range.inUs = 200000;
  const changed = f.run({ confirmedBase: base });
  assert.equal(itemOf(changed, video.id).sourceInFrame, 6);
  assert.equal(itemOf(changed, video.id).sourceOutFrame, 32);
  assert.equal(itemOf(changed, video.id).timelineStartFrame, 0);

  const audio = { ...clip(100003, 21, 100019), kind: "audio" as const };
  f.addMedia(audio.mediaId, "audio");
  f.document.timeline.tracks.push({
    id: randomUUID(),
    kind: "audio",
    muted: false,
    items: [audio],
  });
  const second = f.run({ confirmedBase: base }),
    origin = f.confirm(second);
  f.document.timeline = structuredClone(
    second.effectiveTimeline,
  ) as WorkDocument["timeline"];
  const savedAudio = f.document.timeline.tracks[1]!.items[0]!;
  assert.ok(savedAudio.kind === "audio");
  savedAudio.timelineStartUs = 200001;
  const moved = f.run({ confirmedBase: origin });
  assert.equal(
    itemOf(moved, audio.id).sourceInSample,
    itemOf(second, audio.id).sourceInSample,
  );
  assert.equal(
    itemOf(moved, audio.id).sourceOutSample,
    itemOf(second, audio.id).sourceOutSample,
  );
  assert.equal(itemOf(moved, audio.id).timelineStartSample, 9600);
  assert.equal(moved.changes.filter((c) => c.clipId === audio.id).length, 1);
});

test("only exact microsecond echoes recover video adjacency, without hiding explicit gaps or overlaps", () => {
  const f = fixture(24, 1);
  f.video.range.outUs = 41667;
  const first = f.run(),
    base = f.confirm(first);
  f.document.timeline = structuredClone(
    first.effectiveTimeline,
  ) as WorkDocument["timeline"];
  const next = clip(41667, 0, 41667);
  f.addMedia(next.mediaId);
  const track = f.document.timeline.tracks[0]!;
  assert.ok(track.kind === "video");
  track.items.push(next);
  assert.equal(f.run({ confirmedBase: base }).lengthFrames, 2);
  next.timelineStartUs = 41668;
  assert.throws(() => f.run({ confirmedBase: base }), hasCode("TIMELINE_GAP"));
  next.timelineStartUs = 41666;
  assert.throws(
    () => f.run({ confirmedBase: base }),
    hasCode("TIMELINE_OVERLAP"),
  );
  next.timelineStartUs = 0;
  assert.throws(
    () => f.run({ confirmedBase: base }),
    hasCode("TIMELINE_OVERLAP"),
  );
});

test("video cumulative shifts are explicit while independently placed sounds and subtitles stay put", () => {
  const f = fixture();
  f.video.range = { inUs: 100000, outUs: 1100000 };
  const next = clip(1000000, 100000, 1100000);
  f.addMedia(next.mediaId);
  const track = f.document.timeline.tracks[0]!;
  assert.ok(track.kind === "video");
  track.items.push(next);
  const audio = { ...clip(1500000, 0, 100000), kind: "audio" as const };
  f.addMedia(audio.mediaId, "audio");
  f.document.timeline.tracks.push({
    id: randomUUID(),
    kind: "audio",
    muted: false,
    items: [audio],
  });
  const result = f.run();
  assert.equal(itemOf(result, next.id).timelineStartFrame, 29);
  assert.equal(
    result.changes.find(
      (c) => c.clipId === next.id && c.kind === "timeline_shift",
    )!.after.timelineStartUs,
    967633,
  );
  assert.equal(itemOf(result, audio.id).timelineStartSample, 72000);
});

test("out-of-bounds music and subtitles fail the whole cut even when muted, without truncation or video extension", () => {
  const f = fixture(25, 1);
  f.video.range.outUs = 46000000;
  f.addMedia(f.video.mediaId, "video", 60);
  const audio = { ...clip(0, 0, 60000000), kind: "audio" as const };
  f.addMedia(audio.mediaId, "audio", 60);
  f.document.timeline.tracks.push({
    id: randomUUID(),
    kind: "audio",
    muted: true,
    items: [audio],
  });
  const before = structuredClone(f.document);
  assert.throws(() => f.run(), hasCode("AUDIO_OUT_OF_BOUNDS"));
  assert.deepEqual(f.document, before);
  f.document.timeline.tracks.pop();
  f.document.timeline.tracks.push({
    id: randomUUID(),
    kind: "subtitle",
    muted: true,
    items: [
      {
        id: randomUUID(),
        kind: "subtitle",
        timelineStartUs: 45000000,
        durationUs: 2000000,
        text: "超出片尾",
      },
    ],
  });
  assert.throws(() => f.run(), hasCode("SUBTITLE_OUT_OF_BOUNDS"));
});

test("source bounds use exact verified duration, production length and candidate range", () => {
  const f = fixture(24, 1);
  f.video.range.outUs = 83334;
  const fact = f.media.get(f.video.mediaId)!;
  f.media.set(f.video.mediaId, {
    ...fact,
    duration: { numerator: "1", denominator: "12" },
    video: { ...fact.video!, frameCount: 2 },
  });
  assert.throws(() => f.run(), hasCode("SOURCE_RANGE_INVALID"));
  f.video.range.outUs = 83333;
  assert.equal(f.run().lengthFrames, 1);
  f.video.range.outUs = 41666;
  assert.throws(() => f.run(), hasCode("SOURCE_RANGE_INVALID"));
  f.video.range.outUs = 83333;
  const takeId = randomUUID();
  Object.assign(f.video, { takeId });
  assert.throws(() => f.run(), hasCode("SOURCE_RANGE_INVALID"));
  const takes = new Map([
    [
      takeId,
      {
        id: takeId,
        mediaId: f.video.mediaId,
        range: { inUs: 1, outUs: 100000 },
      },
    ],
  ]);
  assert.throws(() => f.run({ takes }), hasCode("SOURCE_RANGE_INVALID"));
});

test("time origins must resolve to a confirmed same-cut clip; version changes explicitly recompute", () => {
  const f = fixture();
  f.video.range = { inUs: 100000, outUs: 1100000 };
  const first = f.run(),
    origin = f.confirm(first);
  f.document.timeline = structuredClone(
    first.effectiveTimeline,
  ) as WorkDocument["timeline"];
  f.document.timingOrigins = [
    { clipId: f.video.id, normalizationId: origin.id },
  ];
  assert.throws(() => f.run(), hasCode("INVALID_TIMING_ORIGIN"));
  assert.throws(
    () => f.run({ confirmedOrigins: [{ ...origin, cutId: randomUUID() }] }),
    hasCode("INVALID_TIMING_ORIGIN"),
  );
  assert.throws(
    () => f.run({ confirmedOrigins: [{ ...origin, normalizedItems: [] }] }),
    hasCode("INVALID_TIMING_ORIGIN"),
  );
  const result = f.run({
    confirmedOrigins: [
      { ...origin, normalizationVersion: "normalization-old" },
    ],
  });
  assert.ok(
    result.changes.find((c) => c.before.note?.includes("normalization-old")),
  );
  assert.equal(itemOf(result, f.video.id).sourceOutFrame, 31);
});

test("native audio has exact global sample boundaries, bounded tail phase and explicit missing silence", () => {
  const f = fixture();
  f.video.range = { inUs: 34000, outUs: 101000 };
  const fact = f.media.get(f.video.mediaId)!;
  f.media.set(f.video.mediaId, {
    ...fact,
    audio: { ...fact.audio!, sampleCount: 100 },
  });
  const result = f.run(),
    item = itemOf(result, f.video.id);
  assert.equal(item.sourceInFrame, 2);
  assert.equal(item.sourceOutFrame, 3);
  assert.equal(item.sourceInSample, 3203);
  assert.equal(item.sourceOutSample, 4805);
  assert.equal(item.timelineStartSample, 0);
  assert.equal(item.timelineEndSample, 1602);
  assert.ok(Math.abs(item.tailAdjustmentSamples!) <= 1);
  assert.ok(
    result.changes.find((c) => c.after.note === "missingSourceSamples=1602"),
  );
  const { audio: _audio, ...silent } = fact;
  f.media.set(f.video.mediaId, silent);
  assert.ok(f.run().changes.find((c) => c.message.includes("没有音轨")));
});

test("subtitle overlaps are rejected on audible tracks and SRT shares exact global boundaries", () => {
  const f = fixture(24, 1);
  const one = {
      id: randomUUID(),
      kind: "subtitle" as const,
      timelineStartUs: 0,
      durationUs: 41667,
      text: "第一句",
    },
    two = { ...one, id: randomUUID(), timelineStartUs: 41667, text: "第二句" };
  const track = {
    id: randomUUID(),
    kind: "subtitle" as const,
    muted: false,
    items: [one, two],
  };
  f.document.timeline.tracks.push(track);
  const srt = normalizedSubtitlesSrt(f.run());
  assert.equal(
    srt,
    "1\n00:00:00,000 --> 00:00:00,042\n第一句\n\n2\n00:00:00,042 --> 00:00:00,083\n第二句\n",
  );
  two.timelineStartUs = 0;
  assert.throws(() => f.run(), hasCode("SUBTITLE_OVERLAP"));
  track.muted = true;
  assert.equal(normalizedSubtitlesSrt(f.run()), "");
});

test("explicit source provenance and confirmed-base placement can be reused independently", () => {
  const f = fixture();
  const audio = { ...clip(100003, 21, 100019), kind: "audio" as const };
  f.addMedia(audio.mediaId, "audio");
  f.document.timeline.tracks.push({
    id: randomUUID(),
    kind: "audio",
    muted: false,
    items: [audio],
  });
  const a = f.run(),
    origin = f.confirm(a);
  f.document.timeline = structuredClone(
    a.effectiveTimeline,
  ) as WorkDocument["timeline"];
  const moved = f.document.timeline.tracks[1]!.items[0]!;
  assert.ok(moved.kind === "audio");
  moved.timelineStartUs = 200003;
  moved.range.inUs = 1001;
  const b = f.run({ confirmedBase: origin }),
    base = f.confirm(b);
  f.document.timeline = structuredClone(
    b.effectiveTimeline,
  ) as WorkDocument["timeline"];
  const current = f.document.timeline.tracks[1]!.items[0]!,
    old = a.effectiveTimeline.tracks[1]!.items[0]!;
  assert.ok(current.kind === "audio" && old.kind === "audio");
  current.range = old.range;
  f.document.timingOrigins = [{ clipId: audio.id, normalizationId: origin.id }];
  const result = f.run({ confirmedOrigins: [origin], confirmedBase: base });
  assert.equal(
    itemOf(result, audio.id).sourceInSample,
    itemOf(a, audio.id).sourceInSample,
  );
  assert.equal(
    itemOf(result, audio.id).timelineStartSample,
    itemOf(b, audio.id).timelineStartSample,
  );
  assert.deepEqual(result.changes, []);
});

test("both native tail phases are explicit and repeated normalization does not change them", () => {
  const f = fixture();
  f.video.range = { inUs: 33300, outUs: 66800 };
  assert.equal(itemOf(f.run(), f.video.id).tailAdjustmentSamples, 1);
  f.video.range = { inUs: 0, outUs: 33400 };
  const next = clip(33400, 0, 33400);
  f.addMedia(next.mediaId);
  const track = f.document.timeline.tracks[0]!;
  assert.ok(track.kind === "video");
  track.items.push(next);
  const result = f.run();
  assert.equal(itemOf(result, next.id).tailAdjustmentSamples, -1);
  assert.ok(
    result.changes.find(
      (c) =>
        c.clipId === next.id && c.after.note === "tailAdjustmentSamples=-1",
    ),
  );
  const base = f.confirm(result);
  f.document.timeline = structuredClone(
    result.effectiveTimeline,
  ) as WorkDocument["timeline"];
  assert.deepEqual(f.run({ confirmedBase: base }).changes, []);
});

test("known duplicate dialogue and source ranges removed by normalization cannot silently pass", () => {
  const f = fixture(24, 1);
  const audio = { ...clip(), kind: "audio" as const };
  f.addMedia(audio.mediaId, "audio");
  f.document.timeline.tracks.push({
    id: randomUUID(),
    kind: "audio",
    muted: false,
    items: [audio],
  });
  const shotRevisionId = randomUUID(),
    dialogueId = randomUUID();
  f.document.dramaBindings = [
    {
      id: randomUUID(),
      shotRevisionId,
      dialogueId,
      clipId: f.video.id,
      usage: "native_mixed",
    },
    {
      id: randomUUID(),
      shotRevisionId,
      dialogueId,
      clipId: audio.id,
      usage: "dialogue",
    },
  ];
  assert.throws(() => f.run(), hasCode("DUPLICATE_DIALOGUE_SOURCES"));
  audio.muted = true;
  assert.equal(f.run().dramaBindings.length, 2);
  f.document.dramaBindings[0]!.sourceRange = { inUs: 1, outUs: 1000001 };
  assert.throws(() => f.run(), hasCode("BINDING_UNRESOLVED"));
});

test("unresolved work, multiple main tracks and unsupported rates cannot produce executable output", () => {
  const f = fixture();
  f.document.unresolvedEdits = [
    {
      id: randomUUID(),
      kind: "replacement",
      clipIds: [f.video.id],
      note: "尚待处理",
    },
  ];
  assert.throws(() => f.run(), hasCode("UNRESOLVED_EDIT"));
  f.document.unresolvedEdits = [];
  f.document.timeline.tracks.push({
    id: randomUUID(),
    kind: "video",
    muted: false,
    items: [clip()],
  });
  assert.throws(() => f.run(), hasCode("MAIN_VIDEO_REQUIRED"));
  f.document.timeline.tracks.pop();
  f.document.timeline.spec.fpsNum = 2997;
  f.document.timeline.spec.fpsDen = 100;
  assert.throws(() => f.run(), hasCode("NORMALIZATION_RATE_UNSUPPORTED"));
});
