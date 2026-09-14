import assert from "node:assert/strict";
import { test } from "node:test";
import type { components } from "@drama/contracts";
import {
  AssistantSession,
  type AssistantRecord,
  type AssistantTransport,
} from "../apps/web/src/business/assistant-session.js";
import {
  canReviewCanvasResultPlacement,
  submitCanvasResultPlacement,
} from "../apps/web/src/business/canvas-result-placement.js";
import type {
  ImageDraft,
  ImageRequest,
} from "../apps/web/src/business/image-generation.js";

type Placement = NonNullable<ImageDraft["placement"]>;
const intent: Placement = {
  phase: "review",
  key: "fixed-placement-key",
  canvasId: "canvas",
  revision: 7,
  input: { jobId: "job", mediaIds: ["media"], position: { x: 1100, y: 80 } },
};
const receipt: components["schemas"]["CanvasResultPlacement"] = {
  canvas: {
    id: "canvas",
    projectId: "project",
    revision: 8,
    schemaVersion: 1,
    document: { nodes: [], edges: [], groups: [] },
    documentHash: "saved",
    updatedAt: "2026-09-14T00:00:00Z",
  },
  placements: [{ nodeId: "fixed-result-node", mediaId: "media" }],
};
function fixture(phase: Placement["phase"] = "review") {
  let stored: AssistantRecord<ImageDraft, ImageRequest> = {
    schemaVersion: 1,
    draft: {
      capabilityId: "video-fixture",
      output: { durationSeconds: 9 },
      placement: { ...structuredClone(intent), phase },
    },
    execution: { planId: "plan", jobId: "job", key: "fixed-execute-key" },
    previous: [],
  };
  const unexpected = async (): Promise<never> => {
    throw Error("Unexpected business request");
  };
  const transport: AssistantTransport<ImageRequest> = {
    checkAccess: async () => {},
    createPlan: unexpected,
    execute: unexpected,
    cancelJob: unexpected,
    getPlan: unexpected,
    findJob: unexpected,
    getJob: async () =>
      ({
        id: "job",
        planId: "plan",
        status: "succeeded",
        mediaIds: ["media"],
      }) as components["schemas"]["GenerationJob"],
  };
  const storage = {
    read: async () => structuredClone(stored),
    write: async (record: typeof stored) => {
      stored = structuredClone(record);
    },
    clear: unexpected,
  };
  return {
    saved: () => structuredClone(stored),
    load: async () => {
      const controller = new AssistantSession(storage, transport);
      await controller.load(stored.draft);
      return controller;
    },
  };
}

test("only an explicit first placement version rejection permits a new position review", async () => {
  const f = fixture();
  const controller = await f.load();
  await submitCanvasResultPlacement(
    controller,
    f.saved().draft,
    async (sent) => {
      assert.equal(f.saved().draft.placement?.phase, "unknown");
      assert.deepEqual(sent, intent);
      return { kind: "version_conflict" };
    },
  );
  assert.deepEqual(f.saved().draft.placement, { ...intent, phase: "conflict" });
  assert.equal(canReviewCanvasResultPlacement(f.saved().draft.placement), true);
});

test("unknown placement rejected after refresh retains its exact request and cannot choose another position", async () => {
  const f = fixture();
  const first = await f.load();
  let sends = 0;
  let effects = 0;
  await submitCanvasResultPlacement(first, f.saved().draft, async () => {
    sends++;
    effects++;
    throw Error("first result committed, response lost");
  });
  const original = f.saved();
  const controller = await f.load();
  assert.equal(sends, 1, "refresh must not resend the original operation");
  assert.equal(
    canReviewCanvasResultPlacement(f.saved().draft.placement),
    false,
  );
  await submitCanvasResultPlacement(
    controller,
    f.saved().draft,
    async (sent) => {
      sends++;
      assert.deepEqual(sent, original.draft.placement);
      return { kind: "version_conflict" };
    },
  );
  assert.equal(sends, 2);
  assert.equal(effects, 1);
  assert.deepEqual(f.saved(), original);
  assert.match(
    controller.getSnapshot().error ?? "",
    /此次拒绝不能说明第一次未添加/,
  );
  assert.equal(
    canReviewCanvasResultPlacement(f.saved().draft.placement),
    false,
  );
  const restored = await f.load();
  await restored.refresh();
  assert.equal(sends, 2, "reload and refresh must not send materialization");
  assert.deepEqual(restored.getSnapshot().record, original);
});

test("a committed placement with a lost reply recovers the same result once with the original key, body and revision", async () => {
  const f = fixture();
  const controller = await f.load();
  const requests: Placement[] = [];
  let effects = 0;
  await submitCanvasResultPlacement(
    controller,
    f.saved().draft,
    async (sent) => {
      requests.push(structuredClone(sent));
      assert.equal(f.saved().draft.placement?.phase, "unknown");
      effects++;
      throw Error("response lost after committing fixed-result-node");
    },
  );
  assert.equal(f.saved().draft.placement?.phase, "unknown");
  const restored = await f.load();
  assert.equal(requests.length, 1);
  await submitCanvasResultPlacement(restored, f.saved().draft, async (sent) => {
    requests.push(structuredClone(sent));
    return { kind: "placed", receipt };
  });
  const { phase: _first, ...firstRequest } = requests[0]!;
  const { phase: _second, ...secondRequest } = requests[1]!;
  assert.deepEqual(firstRequest, secondRequest);
  assert.equal(effects, 1);
  assert.deepEqual(f.saved().draft.placement, {
    ...intent,
    phase: "placed",
    placed: receipt,
  });
  assert.equal(f.saved().execution?.key, "fixed-execute-key");
  assert.equal(
    canReviewCanvasResultPlacement(f.saved().draft.placement),
    false,
  );
  await submitCanvasResultPlacement(restored, f.saved().draft, async () => {
    throw Error("Already placed cannot submit again");
  });
});

test("an uncertain first response stays unknown rather than permitting re-positioning", async () => {
  const f = fixture();
  const controller = await f.load();
  await submitCanvasResultPlacement(controller, f.saved().draft, async () => {
    throw Object.assign(Error("proxy failed"), { status: 412 });
  });
  assert.deepEqual(f.saved().draft.placement, { ...intent, phase: "unknown" });
  assert.equal(
    canReviewCanvasResultPlacement(f.saved().draft.placement),
    false,
  );
  assert.match(controller.getSnapshot().error ?? "", /proxy failed/);
});
