import assert from "node:assert/strict";
import { test } from "node:test";
import type { components } from "@drama/contracts";
import {
  executableAudios,
  audioOutput,
  shotAudioRequest,
  canvasAudioRequest,
} from "../apps/web/src/business/audio-generation.js";
import type { ImageCapability } from "../apps/web/src/business/image-generation.js";
import type { PromptDraft } from "../apps/web/src/business/prompt-draft.js";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
const capability: ImageCapability = {
  id: "audio",
  connectionId: "connection",
  revision: 1,
  purpose: "audio",
  mode: "audio_fixture_v1",
  enabled: true,
  modelVersion: "fixture",
  executionMode: "test_fixture",
  supportedPurposes: ["voice"],
  minDurationSeconds: 2,
  maxDurationSeconds: 4,
};
const creation: PromptDraft = {
  source: { shotId: "shot", shotRevisionId: "fixed" },
  label: "A",
  intent: "turn",
  prompt: "manual audio",
  references: [
    {
      mediaId: "voice",
      purpose: "voice",
      assetRevisionId: "fixed-voice",
      subjectAssetId: "voice-asset",
    },
  ],
  assistanceSource: { artifactId: "suggestion", revision: 2 },
  instruction: "",
  capabilityId: "text",
  targetCapabilityId: "audio",
};
test("audio execution requires a distinct executable audio capability", () => {
  assert.deepEqual(
    executableAudios([
      capability,
      { ...capability, id: "video", mode: "video_fixture_v1" },
      { ...capability, id: "image", mode: "image_fixture_v1" },
      { ...capability, id: "target", mode: "target_profile_fixture" },
      { ...capability, id: "off", enabled: false },
      { ...capability, id: "wrong-purpose", purpose: "video" },
    ]).map((c) => c.id),
    ["audio"],
  );
});
test("audio output validates integer duration and rejects visual or withAudio fields instead of silently dropping them", () => {
  assert.deepEqual(audioOutput(capability, { durationSeconds: 3, seed: 0 }), {
    durationSeconds: 3,
    seed: 0,
  });
  assert.deepEqual(audioOutput({ ...capability, maxDurationSeconds: 2 }, {}), {
    durationSeconds: 2,
  });
  for (const durationSeconds of [0, 1, 2.5, 5, Infinity])
    assert.throws(() => audioOutput(capability, { durationSeconds }), /时长/);
  assert.throws(() => audioOutput(capability, {}), /时长/);
  for (const extra of [
    { resolution: "256x144" },
    { aspectRatio: "16:9" },
    { withAudio: true },
    { withAudio: false },
  ])
    assert.throws(
      () => audioOutput(capability, { durationSeconds: 2, ...extra }),
      /音频生成不接受/,
    );
});
test("audio plan fixes the selected shot and voice references without adding dialogue bindings or following later edits", () => {
  const source = structuredClone(creation),
    request = shotAudioRequest(source, "project", capability, {
      durationSeconds: 2,
    });
  assert.equal(request.kind, "shot");
  if (request.kind !== "shot") return;
  source.prompt = "later";
  source.source.shotRevisionId = "later";
  source.references[0]!.assetRevisionId = "later";
  source.assistanceSource!.revision = 3;
  assert.equal(request.input.purpose, "audio");
  assert.equal(request.input.prompt, "manual audio");
  assert.deepEqual(request.input.shotSources, [
    { shotId: "shot", shotRevisionId: "fixed" },
  ]);
  assert.equal(
    request.input.additionalReferences[0]?.assetRevisionId,
    "fixed-voice",
  );
  assert.equal(request.input.additionalReferences[0]?.purpose, "voice");
  assert.deepEqual(request.input.assistanceSource, {
    artifactId: "suggestion",
    revision: 2,
  });
  assert.equal("dialogueId" in request.input, false);
  assert.equal("voiceId" in request.input, false);
});
test("canvas ambience is independent of a shot and fixes a saved audio draft", () => {
  const canvas = {
    id: "canvas",
    projectId: "project",
    revision: 7,
    schemaVersion: 1,
    documentHash: "fixed",
    updatedAt: "2026-09-12T00:00:00Z",
    document: {
      nodes: [
        {
          id: "node",
          kind: "audio",
          title: "ambience",
          position: { x: 0, y: 0 },
          width: 360,
          content: {
            type: "draft",
            prompt: "wind",
            connectionId: "connection",
            capabilityId: "audio",
            output: { durationSeconds: 2 },
          },
        },
      ],
      edges: [],
      groups: [],
    },
  } as Schema<"Canvas">;
  const request = canvasAudioRequest(canvas, "scene", "node", [capability]);
  assert.equal(request.kind, "canvas");
  if (request.kind !== "canvas") return;
  assert.equal(request.canvasRevision, 7);
  assert.deepEqual(request.input.shotSources, []);
  canvas.document.nodes[0]!.kind = "video";
  assert.throws(
    () => canvasAudioRequest(canvas, "scene", "node", [capability]),
    /音频草稿/,
  );
});
