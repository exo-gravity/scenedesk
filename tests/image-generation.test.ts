import assert from "node:assert/strict";
import { test } from "node:test";
import type { components } from "@drama/contracts";
import {
  AssistantSession,
  type AssistantRecord,
  type AssistantTransport,
} from "../apps/web/src/business/assistant-session.js";
import {
  executableImages,
  imageOutput,
  shotImageRequest,
  canvasImageRequest,
  type ImageCapability,
  type ImageDraft,
  type ImageRequest,
} from "../apps/web/src/business/image-generation.js";
import type { PromptDraft } from "../apps/web/src/business/prompt-draft.js";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
const capability = {
  id: "image",
  connectionId: "connection",
  revision: 2,
  purpose: "image",
  mode: "image_fixture_v1",
  enabled: true,
  executionMode: "test_fixture",
  allowedResolutions: ["256x256", "512x256"],
  allowedAspectRatios: ["1:1", "2:1"],
} as ImageCapability;
const creation: PromptDraft = {
  source: { shotId: "shot", shotRevisionId: "fixed" },
  label: "A",
  intent: "抬头",
  prompt: "manual input",
  references: [{ mediaId: "ref", purpose: "style" }],
  assistanceSource: { artifactId: "artifact", revision: 2 },
  instruction: "",
  capabilityId: "text",
  targetCapabilityId: "image",
};
const draft: ImageDraft = {
  capabilityId: "image",
  output: { resolution: "256x256" },
};
const request = shotImageRequest(creation, "project", capability, draft.output);
const plan = {
  id: "plan",
  revision: 1,
  input: request.kind === "shot" ? request.input : {},
  status: "ready",
  expiresAt: "2099-01-01T00:00:00Z",
} as Schema<"GenerationPlan">;
function fixture() {
  let saved: AssistantRecord<ImageDraft, ImageRequest> | undefined;
  const calls: string[] = [];
  const storage = {
    read: async () => structuredClone(saved),
    write: async (record: AssistantRecord<ImageDraft, ImageRequest>) => {
      saved = structuredClone(record);
    },
    clear: async () => {
      saved = undefined;
    },
  };
  const job = {
    id: "job",
    revision: 1,
    scope: "project",
    projectId: "project",
    reservationStatus: "held",
    inputOutdated: false,
    connectionVersionId: "connection-version",
    costStatus: "unavailable",
    confirmedCost: { currency: "CNY", amountMicros: "0" },
    reservationRemaining: { currency: "CNY", amountMicros: "0" },
    recoveryEpoch: 0,
    planId: "plan",
    status: "submission_unknown",
    mediaIds: [],
  } as Schema<"GenerationJob">;
  const transport: AssistantTransport<ImageRequest> = {
    checkAccess: async () => {},
    cancelJob: async () => {
      throw Error("cancel not expected");
    },
    createPlan: async () => {
      calls.push("plan");
      return plan;
    },
    getPlan: async () => {
      calls.push("get-plan");
      return plan;
    },
    execute: async () => {
      calls.push("execute");
      return job;
    },
    getJob: async () => {
      calls.push("get-job");
      return job;
    },
    findJob: async () => {
      calls.push("find-job");
      return job;
    },
  };
  return {
    storage,
    transport,
    calls,
    current: () => saved,
    controller: new AssistantSession(storage, transport),
  };
}
test("target descriptions and unverified image capabilities cannot become executable choices", () => {
  const { executionMode: _mode, ...unverified } = capability;
  assert.deepEqual(
    executableImages([
      capability,
      { ...capability, id: "profile", mode: "target_profile_fixture" },
      { ...capability, id: "off", enabled: false },
      { ...unverified, id: "unknown" },
    ]).map((c) => c.id),
    ["image"],
  );
  assert.throws(
    () =>
      shotImageRequest(
        creation,
        "project",
        { ...capability, mode: "target_profile_fixture" },
        draft.output,
      ),
    /不能执行/,
  );
});
test("image plan fixes manual text, references and assistance provenance without using suggestion body", () => {
  const source = structuredClone(creation);
  const prepared = shotImageRequest(
    source,
    "project",
    capability,
    draft.output,
  );
  assert.equal(prepared.kind, "shot");
  if (prepared.kind !== "shot") return;
  source.prompt = "later edit";
  source.references[0]!.mediaId = "later reference";
  assert.equal(prepared.input.prompt, "manual input");
  assert.equal(prepared.input.additionalReferences[0]?.mediaId, "ref");
  assert.deepEqual(prepared.input.assistanceSource, {
    artifactId: "artifact",
    revision: 2,
  });
  assert.deepEqual(prepared.input.shotSources, [creation.source]);
});
test("single-image output validates model dimensions, aspect ratio and prohibited duration/audio", () => {
  assert.deepEqual(
    imageOutput({ ...capability, allowedResolutions: ["256x256"] }, {}),
    { resolution: "256x256" },
  );
  assert.throws(() => imageOutput(capability, {}), /请选择/);
  assert.throws(
    () =>
      imageOutput(capability, { resolution: "512x256", aspectRatio: "1:1" }),
    /不匹配/,
  );
  assert.throws(
    () => imageOutput(capability, { resolution: "256x256", withAudio: true }),
    /单张图片/,
  );
  assert.throws(
    () =>
      imageOutput(capability, { resolution: "256x256", durationSeconds: 1 }),
    /单张图片/,
  );
});
test("canvas prepare fixes the saved canvas revision and selects no implicit shot", () => {
  const canvas = {
    id: "canvas",
    projectId: "project",
    schemaVersion: 1,
    documentHash: "hash",
    updatedAt: "2026-09-11T00:00:00Z",
    revision: 7,
    document: {
      nodes: [
        {
          id: "draft",
          kind: "image",
          title: "image draft",
          position: { x: 0, y: 0 },
          width: 360,
          content: {
            type: "draft",
            prompt: "image",
            connectionId: "connection",
            capabilityId: "image",
            output: draft.output,
          },
        },
      ],
      edges: [],
      groups: [],
    },
  } as Schema<"Canvas">;
  const prepared = canvasImageRequest(canvas, "scene", "draft", [capability]);
  assert.equal(prepared.kind, "canvas");
  if (prepared.kind !== "canvas") return;
  assert.equal(prepared.canvasRevision, 7);
  assert.deepEqual(prepared.input.shotSources, []);
  assert.throws(
    () =>
      canvasImageRequest(
        { ...canvas, document: { ...canvas.document, nodes: [] } },
        "scene",
        "draft",
        [capability],
      ),
    /已保存/,
  );
});
test("a late canvas save cannot start plan preparation after the session is retired", async () => {
  const f = fixture();
  await f.controller.load(draft);
  let release!: () => void, started!: () => void;
  const seen = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = f.controller.prepareFrom(draft, async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return request;
  });
  await seen;
  await f.controller.retire();
  release();
  await pending;
  assert.equal(f.calls.includes("plan"), false);
  assert.equal(f.current(), undefined);
});
test("late command follow-up cannot perform another side effect after an access epoch changes", async () => {
  const f = fixture();
  await f.controller.load(draft);
  let release!: () => void,
    started!: () => void,
    writes = 0;
  const seen = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = f.controller.commitDraft(
    draft,
    draft,
    async (current, checkCurrent) => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      checkCurrent();
      writes++;
      return current;
    },
  );
  await seen;
  f.controller.suspend();
  release();
  await pending;
  assert.equal(writes, 0);
  assert.equal(f.controller.getSnapshot().record, undefined);
});
test("opening an existing image task and refreshing performs reads without executing again", async () => {
  const f = fixture();
  await f.controller.load(draft);
  await f.controller.openExisting("plan", (p) =>
    assert.equal(p.input.purpose, "image"),
  );
  await f.controller.refresh();
  assert.equal(f.controller.getSnapshot().job?.id, "job");
  assert.equal(f.calls.includes("execute"), false);
  assert.equal(f.current()?.execution?.jobId, "job");
  assert.equal(f.current()?.draft.capabilityId, "image");
});
test("lost materialization result retains its exact operation identity across refresh with no POST", async () => {
  const f = fixture();
  await f.controller.load(draft);
  const placement: NonNullable<ImageDraft["placement"]> = {
    phase: "unknown",
    key: "same-placement",
    canvasId: "canvas",
    revision: 7,
    input: { jobId: "job", mediaIds: ["media"], position: { x: 500, y: 80 } },
  };
  await f.controller.commitDraft(draft, { ...draft, placement }, async () => {
    assert.equal(f.current()?.draft.placement?.key, "same-placement");
    throw Error("response lost");
  });
  const restored = new AssistantSession(f.storage, f.transport);
  await restored.load(draft);
  assert.deepEqual(restored.getSnapshot().record?.draft.placement, placement);
  assert.equal(f.calls.includes("execute"), false);
});

test("materialization acknowledgement is durable before a parent view can unmount", async () => {
  const f = fixture();
  await f.controller.load(draft);
  const placement: NonNullable<ImageDraft["placement"]> = {
    phase: "unknown",
    key: "same",
    canvasId: "canvas",
    revision: 7,
    input: { jobId: "job", mediaIds: ["media"], position: { x: 0, y: 0 } },
  };
  await f.controller.commitDraft(
    draft,
    { ...draft, placement },
    async (current) => ({
      ...current,
      placement: { ...placement, phase: "placed" },
    }),
  );
  f.controller.suspend();
  await f.controller.settle();
  assert.equal(f.current()?.draft.placement?.phase, "placed");
  assert.equal(f.controller.getSnapshot().record, undefined);
});
