import assert from "node:assert/strict";
import { test } from "node:test";
import type { components } from "@drama/contracts";
import {
  executableVideos,
  videoOutput,
  shotVideoRequest,
  canvasVideoRequest,
} from "../apps/web/src/business/video-generation.js";
import type { ImageCapability } from "../apps/web/src/business/image-generation.js";
import type { PromptDraft } from "../apps/web/src/business/prompt-draft.js";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
const capability: ImageCapability = {
  id: "video",
  connectionId: "connection",
  revision: 1,
  purpose: "video",
  mode: "video_fixture_v1",
  enabled: true,
  modelVersion: "fixture",
  executionMode: "test_fixture",
  supportedPurposes: [],
  allowedResolutions: ["256x144"],
  allowedAspectRatios: ["16:9"],
  minDurationSeconds: 2,
  maxDurationSeconds: 4,
  audioOutput: true,
};
const creation: PromptDraft = {
  source: { shotId: "shot", shotRevisionId: "fixed" },
  label: "A",
  intent: "turn",
  prompt: "manual",
  references: [{ mediaId: "ref", purpose: "start_frame" }],
  assistanceSource: { artifactId: "suggestion", revision: 2 },
  instruction: "",
  capabilityId: "text",
  targetCapabilityId: "video",
};
test("video execution requires its own executable capability, never an image or target profile", () => {
  assert.deepEqual(
    executableVideos([
      capability,
      { ...capability, id: "image", mode: "image_fixture_v1" },
      { ...capability, id: "target", mode: "target_profile_fixture" },
      { ...capability, id: "off", enabled: false },
      { ...capability, id: "wrong-purpose", purpose: "image" },
    ]).map((c) => c.id),
    ["video"],
  );
});
test("video output fixes integer duration, supported geometry and explicitly selected audio", () => {
  assert.deepEqual(
    videoOutput(capability, { durationSeconds: 2, aspectRatio: "16:9" }),
    {
      resolution: "256x144",
      aspectRatio: "16:9",
      durationSeconds: 2,
      withAudio: false,
    },
  );
  assert.equal(
    videoOutput(capability, { durationSeconds: 3, withAudio: true }).withAudio,
    true,
  );
  for (const durationSeconds of [0, 1, 2.5, 5, Infinity])
    assert.throws(() => videoOutput(capability, { durationSeconds }), /时长/);
  assert.throws(() => videoOutput(capability, {}), /时长/);
  assert.throws(
    () => videoOutput(capability, { durationSeconds: 2, aspectRatio: "1:1" }),
    /不匹配/,
  );
  assert.throws(
    () =>
      videoOutput(
        { ...capability, audioOutput: false },
        { durationSeconds: 2, withAudio: true },
      ),
    /声音/,
  );
});
test("video plan preserves manual text, fixed references and historical assistance source", () => {
  const source = structuredClone(creation),
    request = shotVideoRequest(source, "project", capability, {
      durationSeconds: 2,
    });
  assert.equal(request.kind, "shot");
  if (request.kind !== "shot") return;
  source.prompt = "later";
  source.source.shotRevisionId = "later";
  source.references[0]!.mediaId = "later";
  source.assistanceSource!.revision = 3;
  assert.equal(request.input.purpose, "video");
  assert.equal(request.input.prompt, "manual");
  assert.deepEqual(request.input.shotSources, [
    { shotId: "shot", shotRevisionId: "fixed" },
  ]);
  assert.equal(request.input.additionalReferences[0]?.mediaId, "ref");
  assert.deepEqual(request.input.assistanceSource, {
    artifactId: "suggestion",
    revision: 2,
  });
});
test("canvas video preparation binds the saved draft version and rejects an image source", () => {
  const canvas = {
    id: "canvas",
    projectId: "project",
    revision: 7,
    schemaVersion: 1,
    documentHash: "fixed",
    updatedAt: "2026-09-11T00:00:00Z",
    document: {
      nodes: [
        {
          id: "node",
          kind: "video",
          title: "video",
          position: { x: 0, y: 0 },
          width: 360,
          content: {
            type: "draft",
            prompt: "movement",
            connectionId: "connection",
            capabilityId: "video",
            output: { resolution: "256x144", durationSeconds: 2 },
          },
        },
      ],
      edges: [],
      groups: [],
    },
  } as Schema<"Canvas">;
  const request = canvasVideoRequest(canvas, "scene", "node", [capability]);
  assert.equal(request.kind, "canvas");
  if (request.kind !== "canvas") return;
  assert.equal(request.canvasRevision, 7);
  assert.deepEqual(request.input.shotSources, []);
  canvas.document.nodes[0]!.kind = "image";
  assert.throws(
    () => canvasVideoRequest(canvas, "scene", "node", [capability]),
    /视频草稿/,
  );
});
