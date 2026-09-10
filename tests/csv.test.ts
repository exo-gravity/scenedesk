import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { csvProposal } from "../apps/api/src/modules/content/csv.js";
import type { components } from "@drama/contracts";
type ShotInput = components["schemas"]["ShotInput"];
const newStructure = { mode: "new_structure" } as const;
const header =
  "episode,scene,shot_label,intent,dialogue,duration_seconds,notes";
test("the published CSV template becomes an additive proposal graph with exact duration and no inferred assets", () => {
  const ops = csvProposal(
    readFileSync(
      new URL(
        "../docs/implementation/templates/shot-list-import.csv",
        import.meta.url,
      ),
      "utf8",
    ),
    newStructure,
  );
  assert.equal(ops.filter((o) => o.kind === "episode").length, 1);
  assert.equal(ops.filter((o) => o.kind === "scene").length, 2);
  const shots = ops
    .filter((o) => o.kind === "shot")
    .map((o) => o.proposed as ShotInput);
  assert.equal(shots.length, 6);
  assert.equal(shots[0]!.spec.plannedDurationUs, 7_000_000);
  assert.deepEqual(shots[0]!.spec.references, []);
  assert.equal(shots[0]!.spec.dialogue![0]!.characterAssetId, undefined);
  assert.equal(new Set(ops.map((o) => o.opId)).size, ops.length);
  assert.equal(new Set(ops.map((o) => o.temporaryId)).size, ops.length);
  for (const shot of shots)
    assert.ok(
      ops.some((o) => o.kind === "scene" && o.temporaryId === shot.sceneId),
    );
});
test("CSV quoting, BOM, line breaks and decimal microseconds are retained without executing text", () => {
  const ops = csvProposal(
    `\ufeff${header}\r\nE01,A,01,"甲,乙😀","他说：""回来""\n她点头",0.000001,=1+1\r\n`,
    newStructure,
  );
  const shot = ops.find((o) => o.kind === "shot")!.proposed as ShotInput;
  assert.equal(shot.spec.intent, "甲,乙😀");
  assert.equal(shot.spec.dialogue![0]!.text, '他说："回来"\n她点头');
  assert.equal(shot.spec.plannedDurationUs, 1);
  assert.equal(shot.spec.notes, "=1+1");
});
test("CSV errors reject the whole input instead of skipping rows or guessing a mapping", () => {
  for (const input of [
    header,
    "episode,scene,shot_label,intent,intent\nE,A,01,x,y",
    "episode,scene,shot_label,intent,secret\nE,A,01,x,y",
    `${header}\nE,A,01,x`,
    `${header}\nE,A,01,"unclosed`,
    `${header}\nE,A,01,x,,1e3,`,
    `${header}\nE,A,01,x,,-1,`,
    `${header}\nE,A,01,x,,0.0000001,`,
    `${header}\nE,A,01,x,,9007199254.740992,`,
    `${header}\nE,A,01,,x,1,`,
    `${header}\nE,A,01,\u0000,,1,`,
  ])
    assert.throws(() => csvProposal(input, newStructure));
});
test("append mode names a real target and refuses a CSV with several source scenes", () => {
  const target = {
    mode: "append_to_scene",
    episodeId: randomUUID(),
    sceneId: randomUUID(),
    sceneRevision: 3,
  } as const;
  const ops = csvProposal(
    `${header}\nE,A,01,入屋,,4.2,\nE,A,02,回头,,,`,
    target,
  );
  assert.equal(ops.length, 2);
  assert.ok(
    ops.every(
      (o) =>
        o.kind === "shot" &&
        (o.proposed as ShotInput).sceneId === target.sceneId,
    ),
  );
  assert.equal(
    (ops[1]!.proposed as ShotInput).spec.plannedDurationUs,
    undefined,
  );
  assert.throws(
    () => csvProposal(`${header}\nE,A,01,入屋,,,\nE,B,02,回头,,,`, target),
    /只能包含一个来源场次/,
  );
});
