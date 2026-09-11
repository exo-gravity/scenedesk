import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  workDocumentIssues,
  type WorkDocument,
  type WorkMediaFact,
} from "@drama/domain";
import {
  applyWorkBinding,
  dialogueContext,
  originalSoundClips,
} from "../apps/web/src/business/cut-dialogue.js";

function fixture() {
  const native = {
    id: randomUUID(),
    kind: "video" as const,
    mediaId: randomUUID(),
    range: { inUs: 1_000_000, outUs: 3_000_000 },
    timelineStartUs: 0,
    gainDb: 0,
    muted: false,
    fit: "contain" as const,
    streamSelection: "default" as const,
  };
  const audio = {
    ...native,
    id: randomUUID(),
    kind: "audio" as const,
    mediaId: randomUUID(),
    range: { inUs: 0, outUs: 2_000_000 },
  };
  const binding = {
    id: randomUUID(),
    shotRevisionId: randomUUID(),
    dialogueId: randomUUID(),
    clipId: native.id,
    usage: "native_mixed" as const,
    sourceRange: { inUs: 1_000_000, outUs: 2_000_000 },
  };
  const replacement = {
    ...binding,
    id: randomUUID(),
    clipId: audio.id,
    usage: "dialogue" as const,
    sourceRange: { inUs: 500_000, outUs: 1_500_000 },
  };
  const document: WorkDocument = {
    timeline: {
      schemaVersion: "1",
      spec: {
        width: 1080,
        height: 1920,
        fpsNum: 24,
        fpsDen: 1,
        language: "zh-CN",
      },
      burnSubtitles: false,
      tracks: [
        { id: randomUUID(), kind: "video", muted: false, items: [native] },
        { id: randomUUID(), kind: "audio", muted: false, items: [audio] },
      ],
    },
    dramaBindings: [binding, replacement],
    timingOrigins: [],
    unresolvedEdits: [],
  };
  const media = new Map<string, WorkMediaFact>(
    [native, audio].map((c) => [
      c.mediaId,
      {
        id: c.mediaId,
        kind: c.kind,
        status: "ready",
        durationUs: 4_000_000,
        hasAudio: true,
      },
    ]),
  );
  return { document, media, native, audio, binding, replacement };
}
const duplicates = (f: ReturnType<typeof fixture>) =>
  workDocumentIssues(f.document, f.media).filter(
    (i) => i.code === "DUPLICATE_DIALOGUE_SOURCES",
  );

test("known dialogue overlap uses fixed source ranges, actual placement, and independent audible clips", () => {
  const f = fixture();
  assert.deepEqual(
    new Set(duplicates(f)[0]!.clipIds),
    new Set([f.native.id, f.audio.id]),
  );
  f.audio.timelineStartUs = 500_000;
  assert.deepEqual(
    duplicates(f),
    [],
    "adjacent half-open ranges do not overlap",
  );
  f.audio.timelineStartUs = 499_999;
  assert.equal(
    duplicates(f).length,
    1,
    "one-microsecond overlap survives arithmetic",
  );
  f.document.timeline.tracks[1]!.muted = true;
  assert.deepEqual(duplicates(f), []);
  f.document.timeline.tracks[1]!.muted = false;
  f.native.muted = true;
  assert.deepEqual(duplicates(f), []);
  f.native.muted = false;
  f.replacement.shotRevisionId = randomUUID();
  assert.deepEqual(
    duplicates(f),
    [],
    "a different fixed dialogue requirement is not inferred to be the same recording",
  );
  f.document.dramaBindings = [f.binding, { ...f.binding, id: randomUUID() }];
  assert.deepEqual(
    duplicates(f),
    [],
    "two annotations do not create another source",
  );
  f.media.set(f.native.mediaId, {
    ...f.media.get(f.native.mediaId)!,
    hasAudio: false,
  });
  assert.ok(
    workDocumentIssues(f.document, f.media).some(
      (i) => i.code === "BINDING_UNRESOLVED",
    ),
    "silent video cannot establish native dialogue",
  );
});

test("overlap diagnostics find all participating clips without quadratic pair expansion", () => {
  const f = fixture();
  f.document.dramaBindings = [f.binding];
  for (let i = 0; i < 1500; i++) {
    const clip = { ...f.audio, id: randomUUID(), timelineStartUs: i };
    (f.document.timeline.tracks[1]!.items as (typeof clip)[]).push(clip);
    f.document.dramaBindings.push({
      ...f.replacement,
      id: randomUUID(),
      clipId: clip.id,
    });
  }
  const issues = duplicates(f);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.clipIds.length, 1501);
});

test("binding application preserves explicit original-sound choices and unfinished decisions", () => {
  const f = fixture();
  f.document.dramaBindings = [f.binding];
  const before = structuredClone(f.document);
  assert.deepEqual(
    originalSoundClips(f.document, f.audio.id).map((c) => c.id),
    [f.native.id],
  );
  assert.throws(
    () => applyWorkBinding(f.document, f.replacement, {}, false),
    /先明确原声/,
  );
  const unfinished = applyWorkBinding(f.document, f.replacement, {}, true);
  assert.equal(unfinished.unresolvedEdits.length, 1);
  assert.equal(unfinished.dramaBindings.length, 2);
  assert.deepEqual(unfinished.unresolvedEdits[0]!.clipIds, [
    f.audio.id,
    f.native.id,
  ]);
  assert.equal(
    applyWorkBinding(unfinished, f.replacement, {}, true).unresolvedEdits
      .length,
    1,
    "same unfinished decision is not duplicated",
  );
  const muted = applyWorkBinding(
    f.document,
    f.replacement,
    { [f.native.id]: "mute" },
    false,
  );
  assert.equal(
    muted.timeline.tracks[0]!.items[0]!.kind === "video" &&
      muted.timeline.tracks[0]!.items[0]!.muted,
    true,
  );
  assert.equal(muted.unresolvedEdits.length, 0);
  const keep = applyWorkBinding(
    muted,
    f.replacement,
    { [f.native.id]: "keep" },
    false,
  );
  assert.equal(
    keep.timeline.tracks[0]!.items[0]!.kind === "video" &&
      keep.timeline.tracks[0]!.items[0]!.muted,
    true,
    "keep never unmutes implicitly",
  );
  assert.notEqual(
    dialogueContext(before, f.audio.id),
    dialogueContext(muted, f.audio.id),
  );
  assert.deepEqual(f.document, before, "fixed input is never mutated");
});
