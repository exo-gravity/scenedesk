import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capabilityForModel,
  modeLabel,
  modelEntries,
  type PresentedCapability,
} from "../apps/web/src/business/capability-presentation.js";

const base = {
  id: "", revision: 1, connectionId: "c", purpose: "video" as const,
  mode: "frames_v1", enabled: true, supportedPurposes: [],
};
const seedanceFrames: PresentedCapability = {
  ...base, id: "a", modelVersion: "volcengine/doubao-seedance-2-0-mini-260615",
  displayName: "Seedance 2.0 Mini", mode: "frames_v1", executionMode: "verified_provider",
};
const seedanceReference: PresentedCapability = { ...seedanceFrames, id: "b", mode: "reference_v1" };
const h3: PresentedCapability = {
  ...base, id: "c", modelVersion: "minimax/MiniMax-H3", displayName: "MiniMax H3",
  mode: "frames_v1", executionMode: "verified_provider",
};

test("two modes of one model collapse into a single entry, in arrival order", () => {
  const entries = modelEntries([seedanceFrames, h3, seedanceReference]);
  assert.deepEqual(entries.map((e) => e.name), ["Seedance 2.0 Mini", "MiniMax H3"]);
  assert.deepEqual(entries[0]!.capabilities.map((c) => c.id), ["a", "b"]);
  assert.deepEqual(entries[1]!.capabilities.map((c) => c.id), ["c"]);
});

test("a record without a display name falls back to its model version, never to a blank row", () => {
  const legacy: PresentedCapability = { ...base, id: "d", modelVersion: "Local Video Demo", mode: "video_fixture_v1", executionMode: "test_fixture" };
  const [entry] = modelEntries([legacy]);
  assert.equal(entry!.name, "Local Video Demo");
  assert.equal(entry!.fixture, true);
});

test("a mode has a label only when it is one of ours", () => {
  assert.equal(modeLabel(seedanceFrames), "首尾帧");
  assert.equal(modeLabel(seedanceReference), "参考图");
  assert.equal(modeLabel({ ...base, id: "e", modelVersion: "x", mode: "video_fixture_v1" }), undefined);
});

test("choosing a model keeps the mode in hand when the new model has it, else takes its first", () => {
  const [seedance, minimax] = modelEntries([seedanceFrames, seedanceReference, h3]);
  assert.equal(capabilityForModel(seedance!, "reference_v1").id, "b");
  assert.equal(capabilityForModel(seedance!, undefined).id, "a");
  assert.equal(capabilityForModel(minimax!, "reference_v1").id, "c");
});
