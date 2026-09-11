import assert from "node:assert/strict";
import { test } from "node:test";
import type { components } from "@drama/contracts";
import {
  fixedShotSources,
  selectShotSource,
  moveShotSource,
} from "../apps/web/src/business/canvas-shot-sources.js";
import {
  canvasImageRequest,
  type ImageDraft,
  type ImageRequest,
  type ImageCapability,
} from "../apps/web/src/business/image-generation.js";
import { canvasVideoRequest } from "../apps/web/src/business/video-generation.js";
import { canvasAudioRequest } from "../apps/web/src/business/audio-generation.js";
import {
  AssistantSession,
  type AssistantRecord,
  type AssistantTransport,
} from "../apps/web/src/business/assistant-session.js";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
const sources = [
  { shotId: "shot-other-scene", shotRevisionId: "old-v1" },
  { shotId: "shot-current-scene", shotRevisionId: "fixed-v2" },
];
const draft: ImageDraft = {
  capabilityId: "image",
  output: {},
  shotSources: sources,
};
function request(kind: "image" | "video" | "audio", selected = sources) {
  const cap = {
    id: kind,
    connectionId: "connection",
    purpose: kind,
    mode: `${kind}_fixture_v1`,
    enabled: true,
    executionMode: "test_fixture",
    allowedResolutions: ["256x256"],
    minDurationSeconds: 2,
    maxDurationSeconds: 2,
  } as ImageCapability;
  const canvas = {
    id: "canvas",
    projectId: "project",
    schemaVersion: 1,
    documentHash: "controlled",
    updatedAt: "2026-09-12T00:00:00Z",
    revision: 7,
    document: {
      nodes: [
        {
          id: "node",
          kind,
          title: "draft",
          position: {x: 0, y: 0},
          width: 360,
          content: {
            type: "draft",
            connectionId: "connection",
            capabilityId: kind,
            prompt: "manual text",
            output: {},
          },
        },
      ],
      edges: [],
      groups: [],
    },
  } as Schema<"Canvas">;
  return {
    image: canvasImageRequest,
    video: canvasVideoRequest,
    audio: canvasAudioRequest,
  }[kind](canvas, "scene", "node", [cap], selected);
}
test("canvas sources support independent creation and 100 ordered distinct fixed shots; replacement is explicit", () => {
  assert.deepEqual(fixedShotSources(), []);
  const max = Array.from({ length: 100 }, (_, i) => ({
    shotId: `s${i}`,
    shotRevisionId: `v${i}`,
  }));
  assert.equal(fixedShotSources(max).length, 100);
  assert.throws(
    () => selectShotSource(max, { shotId: "extra", shotRevisionId: "v" }),
    /100/,
  );
  assert.throws(
    () =>
      fixedShotSources([
        ...sources,
        { shotId: sources[0]!.shotId, shotRevisionId: "new-v3" },
      ]),
    /一个固定版本/,
  );
  assert.throws(() => fixedShotSources(null as never), /核对/);
  const replaced = selectShotSource(sources, {
    shotId: sources[0]!.shotId,
    shotRevisionId: "explicit-v3",
  });
  assert.equal(replaced[0]?.shotRevisionId, "explicit-v3");
  assert.equal(sources[0]?.shotRevisionId, "old-v1");
  assert.deepEqual(moveShotSource(sources, 1, -1), [...sources].reverse());
});
for (const kind of ["image", "video", "audio"] as const)
  test(`${kind} canvas plan preserves original ordered versions and saved CAS without mutating selection`, () => {
    const selected = structuredClone(sources),
      prepared = request(kind, selected);
    assert.equal(prepared.kind, "canvas");
    if (prepared.kind !== "canvas") throw Error("wrong route");
    selected.reverse();
    selected[0]!.shotRevisionId = "later-current";
    assert.deepEqual(prepared.input.shotSources, sources);
    assert.equal(prepared.canvasRevision, 7);
    assert.deepEqual(request(kind, []).input.shotSources, []);
  });
function fixture() {
  let saved: AssistantRecord<ImageDraft, ImageRequest> | undefined,
    failWrite = false;
  const calls: { key: string; input: ImageRequest }[] = [];
  const storage = {
    read: async () => structuredClone(saved),
    write: async (value: AssistantRecord<ImageDraft, ImageRequest>) => {
      if (failWrite) throw Error("disk unavailable");
      saved = structuredClone(value);
    },
    clear: async () => {
      saved = undefined;
    },
  };
  const transport: AssistantTransport<ImageRequest> = {
    checkAccess: async () => {},
    createPlan: async (input, key) => {
      calls.push({ input: structuredClone(input), key });
      throw Error("response lost after actual controlled plan creation");
    },
    getPlan: async () => {
      throw Error("no id received");
    },
    findJob: async () => undefined,
    execute: async () => {
      throw Error("no automatic execute");
    },
    cancelJob: async () => {
      throw Error("no cancel");
    },
    getJob: async () => {
      throw Error("no job");
    },
  };
  return {
    storage,
    transport,
    calls,
    current: () => saved,
    setFail: () => {
      failWrite = true;
    },
    controller: new AssistantSession(storage, transport),
  };
}
test("lost canvas plan response and refresh preserve selection, original key/body/CAS despite a newer canvas and sources", async () => {
  const f = fixture();
  await f.controller.load(draft);
  await f.controller.prepareFrom(draft, async () => request("image"));
  const original = structuredClone(f.current()?.planRequest);
  assert.ok(original);
  assert.deepEqual(f.current()?.draft.shotSources, sources);
  const restored = new AssistantSession(f.storage, f.transport);
  await restored.load({ ...draft, shotSources: [] });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(restored.getSnapshot().record?.draft.shotSources, sources);
  let resolves = 0;
  await restored.prepareFrom(restored.getSnapshot().record!.draft, async () => {
    resolves++;
    return request("image", []);
  });
  assert.equal(resolves, 0);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0], f.calls[1]);
  assert.deepEqual(f.current()?.planRequest, original);
});
test("preparing captures sources before a deferred canvas save; later navigation/edits cannot enter the pending plan", async () => {
  const f = fixture();
  await f.controller.load(draft);
  const captured = fixedShotSources(draft.shotSources);
  let release!: () => void, started!: () => void;
  const seen = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = f.controller.prepareFrom(draft, async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return request("image", captured);
  });
  await seen;
  f.controller.updateDraft({ ...draft, shotSources: [] });
  release();
  await pending;
  assert.deepEqual(f.calls[0]?.input.input.shotSources, sources);
});
test("a failed durable source/request write prevents a canvas plan POST", async () => {
  const f = fixture();
  await f.controller.load(draft);
  await f.controller.commitDraft(draft, draft, async () => draft);
  f.setFail();
  await f.controller.prepareFrom(draft, async () => request("audio"));
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.current()?.draft.shotSources, sources);
});
test("historical plan snapshot stays distinct from editable fixed source draft; next plan keeps explicit selection", async () => {
  const f = fixture();
  await f.controller.load(draft);
  const plan = {
    id: "historical",
    input: { purpose: "image", shotSources: [] },
    resolvedInput: { shots: [] },
    status: "ready",
  } as unknown as Schema<"GenerationPlan">;
  f.transport.getPlan = async () => plan;
  await f.controller.openExisting(plan.id, () => {});
  assert.deepEqual(f.controller.getSnapshot().plan?.resolvedInput.shots, []);
  assert.deepEqual(f.current()?.draft.shotSources, sources);
  await f.controller.revise(
    { ...draft, shotSources: fixedShotSources(draft.shotSources) },
    draft,
  );
  assert.deepEqual(f.current()?.draft.shotSources, sources);
  assert.equal(f.current()?.previous[0]?.planId, "historical");
});
