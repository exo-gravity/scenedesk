import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  editingCanonical,
  inspectWorkDocument,
  workDocumentIssues,
  retainEditingHistory,
  type WorkDocument,
  type WorkMediaFact,
  type HistoryFact,
  type WorkClip,
} from "@drama/domain";
import { validateContract } from "@drama/contracts/validation";

const spec = {
  width: 1080,
  height: 1920,
  fpsNum: 24,
  fpsDen: 1,
  language: "zh-CN",
};
function document(): WorkDocument {
  return {
    timeline: { schemaVersion: "1", spec, tracks: [], burnSubtitles: false },
    dramaBindings: [],
    unresolvedEdits: [],
    timingOrigins: [],
  };
}
function video(start = 0, input = 0, output = 1_000_000) {
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
const fact = (
  clip: ReturnType<typeof video>,
  status = "ready",
): WorkMediaFact => ({
  id: clip.mediaId,
  kind: "video",
  status,
  durationUs: 4_000_000,
  hasAudio: true,
});

test("editing canonical JSON agrees with frozen scalar/number fixtures and Python UTF-8 hashes", () => {
  const path = new URL("./fixtures/editing-canonical.json", import.meta.url);
  const fixtures = JSON.parse(readFileSync(path, "utf8")) as {
    name: string;
    input: unknown;
    canonical: string;
  }[];
  // Python independently consumes the specified ECMAScript spellings. Python's
  // own float JSON printer is deliberately not used as an ECMAScript oracle.
  const python = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        `
import json, hashlib, sys
with open(sys.argv[1], encoding='utf-8') as f: cases=json.load(f)
print(json.dumps([{'hash': hashlib.sha256(c['canonical'].encode('utf-8')).hexdigest(),
 'bytes': len(c['canonical'].encode('utf-8')), 'equivalent': json.loads(c['canonical']) == c['input']} for c in cases]))
`,
        path.pathname,
      ],
      { encoding: "utf8" },
    ),
  );
  fixtures.forEach((fixture, i) => {
    const actual = editingCanonical(fixture.input);
    assert.equal(actual, fixture.canonical, fixture.name);
    assert.equal(
      createHash("sha256").update(actual, "utf8").digest("hex"),
      python[i].hash,
    );
    assert.equal(Buffer.byteLength(actual), python[i].bytes);
    assert.equal(python[i].equivalent, true);
  });
  const cyclic: any = {};
  cyclic.self = cyclic;
  for (const input of [
    NaN,
    Infinity,
    undefined,
    1n,
    new Date(),
    [undefined],
    Array(2),
    cyclic,
    "\ud800",
  ])
    assert.throws(() => editingCanonical(input), TypeError);
  assert.notEqual(editingCanonical(["é"]), editingCanonical(["é"]));
  assert.equal(
    editingCanonical({ b: 1, a: 2 }),
    editingCanonical({ a: 2, b: 1 }),
  );
});

test("editing canonical keeps scalar ordering across BMP, astral keys and shared prefixes", () => {
  // Frozen codepoint order: default UTF-16 sorting would put supplementary
  // characters before the BMP private-use keys. Prefixes must still sort first.
  const keys = [
    "",
    "a",
    "aa",
    "a\ue000",
    "a𐀀",
    "a💡",
    "z",
    "\ud7ff",
    "\ue000",
    "\ufffd",
    "𐀀",
    "𐀀a",
    "😀",
    "😀a",
  ];
  const expected = `{${keys.map((key, index) => `${JSON.stringify(key)}:${index}`).join(",")}}`;
  for (const order of [
    keys,
    [...keys].reverse(),
    [...keys.slice(7), ...keys.slice(0, 7)],
  ]) {
    assert.equal(
      editingCanonical(
        Object.fromEntries(order.map((key) => [key, keys.indexOf(key)])),
      ),
      expected,
    );
  }
  // A malformed scalar is still rejected even when encountered in key sorting.
  for (const key of ["\ud800", "\udfff", "a\ud800z", "😀\udfff"]) {
    assert.throws(
      () => editingCanonical({ [key]: 1, "\ue000": 2, "😀": 3 }),
      TypeError,
    );
  }
});

test("unfinished edits save structurally while diagnostics remain live and leave input unchanged", () => {
  const work = document(),
    first = video(0, 250001, 1000001),
    second = video(1_000_000, 0, 1_000_000);
  work.timeline.tracks.push(
    { id: randomUUID(), kind: "video", muted: false, items: [first, second] },
    {
      id: randomUUID(),
      kind: "subtitle",
      muted: false,
      items: [
        {
          id: randomUUID(),
          kind: "subtitle",
          timelineStartUs: 3_000_000,
          durationUs: 0,
          text: "",
        },
      ],
    },
  );
  work.dramaBindings.push({
    id: randomUUID(),
    clipId: randomUUID(),
    shotRevisionId: randomUUID(),
    dialogueId: randomUUID(),
    usage: "subtitle",
  });
  work.unresolvedEdits.push({
    id: randomUUID(),
    kind: "sound_placement",
    clipIds: [first.id],
    note: "等配音",
  });
  assert.equal(validateContract("CutWorkDocument", work).valid, true);
  const before = structuredClone(work),
    inspected = inspectWorkDocument(work);
  const media = new Map([
    [first.mediaId, fact(first)],
    [second.mediaId, fact(second)],
  ]);
  const codes = new Set(workDocumentIssues(work, media).map((i) => i.code));
  assert.deepEqual(
    codes,
    new Set([
      "TIMELINE_GAP",
      "EMPTY_CLIP",
      "SUBTITLE_OUT_OF_BOUNDS",
      "BINDING_UNRESOLVED",
      "UNRESOLVED_EDIT",
    ]),
  );
  media.set(first.mediaId, fact(first, "archived"));
  assert.ok(
    workDocumentIssues(work, media, true).some(
      (i) => i.code === "MEDIA_UNAVAILABLE",
    ),
  );
  assert.ok(
    workDocumentIssues(work, media, true).some(
      (i) => i.code === "CUT_BASE_CHANGED",
    ),
  );
  assert.equal(inspectWorkDocument(work).canonical, inspected.canonical);
  assert.deepEqual(work, before);
});

test("work-wide validation rejects reversed intervals, duplicate identity and missing exact sources", () => {
  const base = document(),
    clip = video();
  base.timeline.tracks.push({
    id: randomUUID(),
    kind: "video",
    muted: false,
    items: [clip],
  });
  const rejects = (change: (d: WorkDocument) => void) => {
    const work = structuredClone(base);
    change(work);
    assert.throws(() => inspectWorkDocument(work), {
      code: "INVALID_WORK_DOCUMENT",
    });
  };
  rejects((d) => {
    (d.timeline.tracks[0]!.items[0] as typeof clip).range = {
      inUs: 2,
      outUs: 1,
    };
  });
  rejects((d) => {
    d.timeline.tracks.push({
      id: randomUUID(),
      kind: "video",
      muted: false,
      items: [{ ...clip, id: clip.id.toUpperCase() }],
    });
  });
  rejects((d) => {
    d.timingOrigins = [{ clipId: randomUUID(), normalizationId: randomUUID() }];
  });
  rejects((d) => {
    (d.timeline.tracks[0]!.items[0] as typeof clip).streamSelection =
      "embedded_audio" as never;
  });
  rejects((d) => {
    d.unresolvedEdits = [
      { id: randomUUID(), kind: "replacement", clipIds: [], note: "\0" },
    ];
  });
  const empty = document();
  assert.doesNotThrow(() => inspectWorkDocument(empty));
  assert.deepEqual(
    workDocumentIssues(empty, new Map()).map((i) => i.code),
    ["MAIN_VIDEO_REQUIRED"],
  );
  const zero = structuredClone(base);
  (zero.timeline.tracks[0]!.items[0] as typeof clip).range = {
    inUs: 5,
    outUs: 5,
  };
  assert.doesNotThrow(() => inspectWorkDocument(zero));
  assert.ok(
    workDocumentIssues(zero, new Map([[clip.mediaId, fact(clip)]])).some(
      (i) => i.code === "EMPTY_CLIP",
    ),
  );
});

test("diagnostics preserve exact microseconds at large integer boundaries", () => {
  const work = document(),
    max = Number.MAX_SAFE_INTEGER;
  const clip = video(0, 0, max),
    adjacent = video(max, 0, 2);
  work.timeline.tracks.push(
    { id: randomUUID(), kind: "video", muted: false, items: [clip, adjacent] },
    {
      id: randomUUID(),
      kind: "subtitle",
      muted: false,
      items: [
        {
          id: randomUUID(),
          kind: "subtitle",
          timelineStartUs: max,
          durationUs: 3,
          text: "越界一微秒",
        },
      ],
    },
  );
  const facts = new Map([
    [clip.mediaId, { ...fact(clip), durationUs: max }],
    [adjacent.mediaId, fact(adjacent)],
  ]);
  const issues = workDocumentIssues(work, facts);
  assert.deepEqual(
    issues.map((i) => i.code),
    ["SUBTITLE_OUT_OF_BOUNDS"],
  );
  for (const issue of issues)
    assert.equal(validateContract("EditingIssue", issue).valid, true);
});

test("document limits count all tracks and canonical UTF-8 bytes", () => {
  const work = document();
  for (let track = 0; track < 2; track++)
    work.timeline.tracks.push({
      id: randomUUID(),
      kind: "video",
      muted: false,
      items: Array.from({ length: 2501 }, () => video()),
    });
  assert.throws(() => inspectWorkDocument(work), {
    code: "WORK_DOCUMENT_TOO_LARGE",
  });
  work.timeline.tracks = [
    {
      id: randomUUID(),
      kind: "subtitle",
      muted: false,
      items: Array.from({ length: 800 }, () => ({
        id: randomUUID(),
        kind: "subtitle" as const,
        timelineStartUs: 0,
        durationUs: 0,
        text: "中".repeat(2000),
      })),
    },
  ];
  assert.equal(validateContract("CutWorkDocument", work).valid, true);
  assert.throws(() => inspectWorkDocument(work), {
    code: "WORK_DOCUMENT_TOO_LARGE",
  });
});

test("history retains real recent revisions, UTC checkpoints and protected bodies within deduplicated budget", () => {
  const now = Date.UTC(2026, 8, 11),
    day = 86_400_000;
  const facts: HistoryFact[] = Array.from({ length: 140 }, (_, i) => ({
    revision: i + 1,
    documentHash: `h${i}`,
    canonicalBytes: 10,
    createdAt: now - (140 - i) * 1000,
    pinned: false,
  }));
  const full = retainEditingHistory(facts, now);
  assert.equal(full.retained.size, 100);
  assert.ok(full.retained.get(140)?.has("current"));
  assert.ok(full.retained.get(139)?.has("previous"));
  const tight = retainEditingHistory(facts, now, 20);
  assert.equal(tight.retained.size, 4);
  assert.equal(tight.unpinnedHistoryBytes, 20);
  const duplicate = facts.map((f) => ({ ...f, documentHash: "same" }));
  assert.equal(retainEditingHistory(duplicate, now, 0).retained.size, 100);
  const old: HistoryFact[] = [
    {
      revision: 1,
      documentHash: "pinned",
      canonicalBytes: 10000,
      createdAt: now - 80 * day,
      pinned: true,
    },
    {
      revision: 2,
      documentHash: "expired",
      canonicalBytes: 10,
      createdAt: now - 31 * day,
      pinned: false,
    },
    {
      revision: 3,
      documentHash: "daily-first",
      canonicalBytes: 10,
      createdAt: now - 20 * day + 1,
      pinned: false,
    },
    {
      revision: 4,
      documentHash: "daily-last",
      canonicalBytes: 10,
      createdAt: now - 20 * day + 2,
      pinned: false,
    },
    {
      revision: 5,
      documentHash: "quarter-first",
      canonicalBytes: 10,
      createdAt: now - 2 * day + 1,
      pinned: false,
    },
    {
      revision: 6,
      documentHash: "quarter-last",
      canonicalBytes: 10,
      createdAt: now - 2 * day + 2,
      pinned: false,
    },
    ...facts.map((f) => ({ ...f, revision: f.revision + 6 })),
  ];
  const result = retainEditingHistory(old, now);
  assert.ok(result.retained.get(1)?.has("pinned"));
  for (const revision of [2, 3, 5])
    assert.equal(result.retained.has(revision), false);
  for (const revision of [4, 6])
    assert.ok(result.retained.get(revision)?.has("checkpoint"));
  const budget = retainEditingHistory(old, now, 20);
  assert.ok(
    budget.retained.has(4) && budget.retained.has(6),
    "checkpoints outlast ordinary recent saves",
  );
  assert.ok(
    budget.retained.has(1) &&
      budget.retained.has(146) &&
      budget.retained.has(145),
  );
});
