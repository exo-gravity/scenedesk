import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CANVAS_RESULT_LAYOUT } from "@drama/domain";
import type { components } from "@drama/contracts";
import { canvasResultPosition } from "../apps/web/src/business/canvas-result-position.js";
import {
  AssistantSession,
  type AssistantRecord,
  type AssistantTransport,
} from "../apps/web/src/business/assistant-session.js";
import type {
  ImageDraft,
  ImageRequest,
} from "../apps/web/src/business/image-generation.js";

const contract = JSON.parse(
  readFileSync(
    new URL("../docs/implementation/openapi.json", import.meta.url),
    "utf8",
  ),
).components.schemas.CanvasPoint.properties;
const node = (id: string, x: number, y = 80, width = 320) => ({
  id,
  position: { x, y },
  width,
});
function assertGroupFits(
  nodes: ReturnType<typeof node>[],
  position: { x: number; y: number },
  count: number,
) {
  for (let index = 0; index < count; index++) {
    const x = position.x + index * CANVAS_RESULT_LAYOUT.stepX;
    assert.ok(x >= contract.x.minimum && x <= contract.x.maximum);
    assert.ok(
      position.y >= contract.y.minimum && position.y <= contract.y.maximum,
    );
    for (const occupied of nodes)
      assert.ok(
        x + CANVAS_RESULT_LAYOUT.width <= occupied.position.x ||
          x >= occupied.position.x + occupied.width,
        `result ${index} overlaps ${occupied.id}`,
      );
  }
}

test("a result goes beyond the already occupied right side, preserving origin y and existing nodes", () => {
  const nodes = [node("draft", 0, 120), node("existing-video", 384, 0)];
  const before = structuredClone(nodes);
  const position = canvasResultPosition(nodes, "draft", 1);
  assert.deepEqual(position, { x: 768, y: 120 });
  assertGroupFits(nodes, position, 1);
  assert.deepEqual(nodes, before);
});

test("missing source drafts still receive a clear position beyond current contents", () => {
  assert.deepEqual(canvasResultPosition([], "deleted", 1), { x: 80, y: 80 });
  const nodes = [node("existing-video", 80, -500)];
  const position = canvasResultPosition(nodes, "deleted", 3);
  assert.deepEqual(position, { x: 464, y: 80 });
  assertGroupFits(nodes, position, 3);
});

test("boundary fallback reserves the complete horizontal result group rather than one result", () => {
  const nodes = [node("left", 999_000, 0, 400), node("draft", 999_900, -700)];
  // The small gap between these nodes fits a single result, not three.
  const position = canvasResultPosition(nodes, "draft", 3);
  assert.equal(position.y, -700);
  assert.ok(position.x + 2 * CANVAS_RESULT_LAYOUT.stepX + 320 < 999_000);
  assertGroupFits(nodes, position, 3);
});

test("opposite legal extremes never produce an out-of-range first or subsequent result", () => {
  for (const x of [contract.x.minimum, contract.x.maximum]) {
    for (const y of [contract.y.minimum, contract.y.maximum]) {
      const nodes = [node("draft", x, y)];
      const position = canvasResultPosition(nodes, "draft", 100);
      assert.equal(position.y, y);
      assertGroupFits(nodes, position, 100);
    }
  }
  assert.throws(() => canvasResultPosition([], "none", 0), /结果数量不可用/);
});

const full = Array.from({ length: 1251 }, (_, index) =>
  node(`full-${index}`, contract.x.minimum + index * 1600, 80, 1600),
);
test("no complete legal horizontal gap reports an actionable error without moving contents", () => {
  const before = structuredClone(full);
  assert.throws(
    () => canvasResultPosition(full, "full-1", 2),
    /横向没有容纳整组结果的空位.*原任务与结果仍保留/,
  );
  assert.deepEqual(full, before);
});

test("placement refusal retains the durable draft, original request and completed execution identity", async () => {
  const original: AssistantRecord<ImageDraft, ImageRequest> = {
    schemaVersion: 1,
    draft: {
      capabilityId: "video-fixture",
      output: { durationSeconds: 9 },
      placement: {
        phase: "conflict",
        key: "original-placement-key",
        canvasId: "canvas",
        revision: 4,
        input: {
          jobId: "job",
          mediaIds: ["media"],
          position: { x: 384, y: 80 },
        },
      },
    },
    planRequest: {
      key: "original-plan-key",
      input: {
        kind: "canvas",
        canvasId: "canvas",
        sceneId: "scene",
        canvasRevision: 3,
        label: "Original draft",
        input: {
          nodeId: "draft",
          shotSources: [],
          referenceOverrides: [],
          promptPolicy: "append",
        },
      },
    },
    execution: { key: "original-execute-key", planId: "plan", jobId: "job" },
    previous: [],
  };
  let stored = structuredClone(original);
  let businessWrites = 0;
  const unexpected = async (): Promise<never> => {
    businessWrites++;
    throw Error(
      "No generation or materialization is authorized by a position review",
    );
  };
  const transport: AssistantTransport<ImageRequest> = {
    checkAccess: async () => {},
    createPlan: unexpected,
    execute: unexpected,
    cancelJob: unexpected,
    getPlan: unexpected,
    getJob: async () =>
      ({
        id: "job",
        planId: "plan",
        status: "succeeded",
        mediaIds: ["media"],
      }) as components["schemas"]["GenerationJob"],
    findJob: unexpected,
  };
  const controller = new AssistantSession<ImageDraft, ImageRequest>(
    {
      read: async () => structuredClone(stored),
      write: async (record) => {
        stored = structuredClone(record);
      },
      clear: unexpected,
    },
    transport,
  );
  await controller.load(original.draft);
  await controller.commitDraft(
    original.draft,
    original.draft,
    async (current) => {
      canvasResultPosition(full, "draft", 1);
      return current;
    },
  );
  assert.match(
    controller.getSnapshot().error ?? "",
    /横向没有容纳整组结果的空位/,
  );
  assert.deepEqual(stored, original);
  assert.equal(businessWrites, 0);
  assert.equal(controller.getSnapshot().job?.id, "job");
});
