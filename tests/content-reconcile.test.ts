import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileContent } from "../apps/web/src/business/content-reconcile.js";

test("reviewing concurrent look changes keeps the selected look and its fixed parent as one choice", () => {
  const base = {
    characterAssetId: "c",
    lookId: "daily",
    lookAssetRevisionId: "v1",
    voiceAssetRevisionId: "voice1",
  };
  const local = { ...base, lookAssetRevisionId: "v2" };
  const remote = { ...base, lookId: "evening", voiceAssetRevisionId: "voice2" };
  assert.deepEqual(reconcileContent(base, local, remote), {
    ...local,
    voiceAssetRevisionId: "voice2",
  });
});

test("reviewed content rebase retains local look edits, remote voice edits and independent dialogue changes", () => {
  const base = {
    state: {
      characters: [
        {
          characterAssetId: "c",
          lookId: "daily",
          lookAssetRevisionId: "v1",
          voiceAssetRevisionId: "voice1",
        },
      ],
    },
    dialogue: [{ id: "line1", text: "原句", performance: "低声" }],
    references: ["ref1"],
  };
  const local = structuredClone(base);
  local.state.characters[0]!.lookId = "evening";
  local.state.characters[0]!.lookAssetRevisionId = "v2";
  local.dialogue[0]!.text = "我的台词";
  const remote = structuredClone(base);
  remote.state.characters[0]!.voiceAssetRevisionId = "voice2";
  remote.dialogue[0]!.performance = "停顿";
  remote.dialogue.push({ id: "line2", text: "同伴的新台词", performance: "" });
  remote.references.push("ref2");
  const result = reconcileContent(base, local, remote);
  assert.deepEqual(result.state.characters, [
    {
      characterAssetId: "c",
      lookId: "evening",
      lookAssetRevisionId: "v2",
      voiceAssetRevisionId: "voice2",
    },
  ]);
  assert.deepEqual(result.dialogue, [
    { id: "line1", text: "我的台词", performance: "停顿" },
    { id: "line2", text: "同伴的新台词", performance: "" },
  ]);
  assert.deepEqual(result.references, ["ref1", "ref2"]);
});
test("explicit removals and null holder survive rebase, while untouched remote removal is respected", () => {
  type State = {
    props: { propAssetId: string; holderCharacterAssetId?: string | null }[];
    defaults: string[];
  };
  const base: State = {
    props: [
      { propAssetId: "key", holderCharacterAssetId: "c1" },
      { propAssetId: "bag", holderCharacterAssetId: "c1" },
    ],
    defaults: ["v1", "v2"],
  };
  const local: State = {
    props: [
      { propAssetId: "key", holderCharacterAssetId: null },
      { propAssetId: "bag", holderCharacterAssetId: "c1" },
    ],
    defaults: ["v2"],
  };
  const remote: State = {
    props: [{ propAssetId: "key", holderCharacterAssetId: "c2" }],
    defaults: ["v1", "v2", "v3"],
  };
  assert.deepEqual(reconcileContent(base, local, remote), {
    props: [{ propAssetId: "key", holderCharacterAssetId: null }],
    defaults: ["v2", "v3"],
  });
});
