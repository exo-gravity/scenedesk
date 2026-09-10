import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { WorkDocument, WorkClip } from "@drama/domain";
import {
  replayWorkChanges,
  workChanges,
} from "../apps/web/src/business/cut-work-reconcile.js";

function document(): WorkDocument {
  return {
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
        {
          id: randomUUID(),
          kind: "subtitle",
          muted: false,
          items: [
            {
              id: randomUUID(),
              kind: "subtitle",
              timelineStartUs: 0,
              durationUs: 1_000_000,
              text: "共同基线",
            },
            {
              id: randomUUID(),
              kind: "subtitle",
              timelineStartUs: 1_000_000,
              durationUs: 1_000_000,
              text: "另一条",
            },
          ],
        },
      ],
    },
    dramaBindings: [],
    unresolvedEdits: [],
    timingOrigins: [],
  };
}
const items = (d: WorkDocument) =>
  d.timeline.tracks[0]!.items as Extract<WorkClip, { kind: "subtitle" }>[];

test("explicit work replay preserves unselected peer clips, new entries and independent order", () => {
  const base = document(),
    local = structuredClone(base),
    remote = structuredClone(base);
  items(local)[0]!.text = "我的文字";
  items(remote)[0]!.text = "同伴也改过";
  items(remote)[1]!.text = "同伴的另一条";
  const added = {
    ...items(remote)[1]!,
    id: randomUUID(),
    text: "同伴新加的条目",
  };
  items(remote).push(added);
  const changes = workChanges(base, local, remote);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.sharedChange, true);
  assert.deepEqual(replayWorkChanges(base, local, remote, new Set()), remote);
  const merged = replayWorkChanges(
    base,
    local,
    remote,
    new Set([changes[0]!.key]),
  );
  assert.deepEqual(
    items(merged).map((c) => c.text),
    ["我的文字", "同伴的另一条", "同伴新加的条目"],
  );
  assert.equal(items(remote)[0]!.text, "同伴也改过");
  items(local).reverse();
  const reordered = replayWorkChanges(
    base,
    local,
    remote,
    new Set([`order:${base.timeline.tracks[0]!.id}`]),
  );
  assert.deepEqual(
    items(reordered).map((c) => c.id),
    [items(base)[1]!.id, items(base)[0]!.id, added.id],
  );
});

test("track deletion and insertion require explicit related clip choices", () => {
  const base = document(),
    local = structuredClone(base),
    remote = structuredClone(base);
  local.timeline.tracks = [];
  const track = base.timeline.tracks[0]!;
  assert.throws(
    () =>
      replayWorkChanges(base, local, remote, new Set([`track:${track.id}`])),
    /片段缺少对应轨道/,
  );
  const merged = replayWorkChanges(
    base,
    local,
    remote,
    new Set(workChanges(base, local, remote).map((c) => c.key)),
  );
  assert.equal(merged.timeline.tracks.length, 0);
  const fresh = document().timeline.tracks[0]!;
  local.timeline.tracks = [fresh];
  assert.throws(
    () =>
      replayWorkChanges(
        base,
        local,
        remote,
        new Set([`clip:${fresh.items[0]!.id}`]),
      ),
    /片段缺少对应轨道/,
  );
  const all = replayWorkChanges(
    base,
    local,
    remote,
    new Set(workChanges(base, local, remote).map((c) => c.key)),
  );
  assert.deepEqual(all, local);
  assert.throws(
    () => replayWorkChanges(base, local, remote, new Set(["fake-change"])),
    /不属于当前比较/,
  );
});
