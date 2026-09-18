import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { CanvasDocument, CanvasNode } from "@drama/domain";
import { imageGenerationFixture } from "../support/image-generation.js";
import type { Schema } from "../../apps/api/src/modules/content/model.js";

/**
 * A batch is grouping over the existing one-plan-per-job facts. These tests run the
 * real HTTP path: prepare fixes one plan per selected node against a single canvas
 * revision, execute submits only the runnable items, and a retry never re-runs an
 * item that already has a job.
 */
test("canvas generation batch groups per-node plans without a second scheduler", async (t) => {
  const f = await imageGenerationFixture(t);
  const created = await f.request(
    "POST",
    `${f.path}/scenes/${f.scene.id}/canvas`,
  );
  assert.equal(created.statusCode, 200, created.body);
  const canvas = created.json().canvas;
  const routes = {
    prepare: `${f.path}/scenes/${f.scene.id}/canvas/generation-batches`,
    read: (id: string) => `${f.path}/canvas-generation-batches/${id}`,
    run: (id: string) => `${f.path}/canvas-generation-batches/${id}/execute`,
  };
  const draft = (prompt: string, extra: Partial<CanvasNode> = {}): CanvasNode =>
    ({
      id: randomUUID(),
      kind: "image",
      title: prompt,
      width: 320,
      position: { x: 0, y: 0 },
      content: {
        type: "draft",
        prompt,
        connectionId: f.input.connectionId,
        capabilityId: f.input.capabilityId,
        output: f.input.output,
      },
      ...extra,
    }) as CanvasNode;
  /** One node per failure mode the confirmation screen has to report. */
  const runnable = [draft("镜头一的画面"), draft("镜头二的画面"), draft("镜头三的画面")];
  const noCapability = draft("没选模型");
  noCapability.content = { type: "draft", prompt: "没选模型", output: {} };
  const notDraft: CanvasNode = {
    id: randomUUID(),
    kind: "text",
    title: "只是说明",
    width: 320,
    position: { x: 0, y: 400 },
    content: { type: "text", text: "不能生成" },
  };
  // The first draft composes its prompt from an upstream canvas text node, the way
  // a real canvas does; the others stand alone.
  const sourceText: CanvasNode = {
    id: randomUUID(),
    kind: "text",
    title: "镜头一说明",
    width: 320,
    position: { x: 0, y: -200 },
    content: { type: "text", text: "雨夜便利店门口，女主回头" },
  };
  const nodes = [sourceText, ...runnable, noCapability, notDraft];
  let document: CanvasDocument = {
    nodes,
    edges: [
      {
        id: randomUUID(),
        sourceNodeId: sourceText.id,
        targetNodeId: runnable[0]!.id,
        enabled: true,
        position: 0,
        purpose: "prompt",
      },
    ],
    groups: [],
  };
  let saved = await f.ok(
    "PUT",
    `${f.path}/canvases/${canvas.id}`,
    { schemaVersion: 1, document },
    canvas.revision,
  );
  type Batch = Schema<"CanvasGenerationBatch">;
  type Item = Schema<"CanvasGenerationBatchItem">;
  const batchOf = (response: { json: () => unknown }) => response.json() as Batch;
  const byNode = (batch: Batch) =>
    new Map<string, Item>(batch.items.map((item) => [item.nodeId, item]));
  const itemOf = (batch: Batch, nodeId: string) => {
    const found = byNode(batch).get(nodeId);
    assert.ok(found, `batch must account for node ${nodeId}`);
    return found;
  };
  const prepare = (nodeIds: string[], version = saved.revision) =>
    f.request(
      "POST",
      routes.prepare,
      {
        nodeIds,
        shotSources: [],
        referenceOverrides: [],
        promptPolicy: "replace",
      },
      version,
    );

  await t.test("prepare fixes one plan per node and reports every blocker", async () => {
    const response = await prepare(nodes.map((node) => node.id));
    assert.equal(response.statusCode, 201, response.body);
    const batch = batchOf(response);
    assert.equal(batch.canvasRevision, saved.revision);
    assert.equal(batch.currentCanvasRevision, saved.revision);
    assert.equal(batch.items.length, nodes.length);
    for (const node of runnable)
      assert.equal(itemOf(batch, node.id).status, "ready", response.body);
    // A selected node that never became a plan still accounts for itself.
    assert.equal(itemOf(batch, noCapability.id).status, "invalid");
    assert.equal(itemOf(batch, noCapability.id).problemCode, "CANVAS_DRAFT_REQUIRED");
    // The unusable node keeps a durable blocked plan stating why, so the reason
    // survives a reload instead of living only in the response.
    assert.equal(itemOf(batch, noCapability.id).plan?.status, "blocked");
    assert.deepEqual(itemOf(batch, noCapability.id).plan?.blockingReasons, [
      "CANVAS_DRAFT_REQUIRED",
    ]);
    assert.equal(itemOf(batch, notDraft.id).status, "invalid");
    assert.equal(itemOf(batch, notDraft.id).problemCode, "CANVAS_DRAFT_REQUIRED");
    // One plan per item, and the origin keeps the node it was fixed against.
    const plans = batch.items.flatMap((item) => (item.plan ? [item.plan.id] : []));
    assert.equal(new Set(plans).size, plans.length);
    for (const node of runnable)
      assert.equal(itemOf(batch, node.id).origin?.nodeId, node.id);
    assert.deepEqual(
      itemOf(batch, runnable[0]!.id).origin?.sourceNodeIds,
      [sourceText.id],
      "the origin keeps the ordered upstream nodes the plan was fixed against",
    );
    // The running adapter is the explicit local fixture, so the estimate is a real
    // sum of the items' own zero reservations and says so.
    assert.ok(batch.estimate, "a certified adapter must produce a stated total");
    assert.equal(batch.estimate.totalReservation.amountMicros, "0");
    assert.match(
      batch.estimate.basisNote,
      new RegExp(`${runnable.length}/${nodes.length} 项`),
    );
  });

  await t.test("a node the canvas moved past is stale, not executed", async () => {
    // The batch observes the canvas as it is now; the canvas then moves on. The
    // item must be reported stale rather than run against input it never fixed.
    const batch = batchOf(await prepare([runnable[0]!.id, runnable[1]!.id]));
    assert.equal(batch.currentCanvasRevision, saved.revision);
    document = {
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === runnable[0]!.id ? { ...node, title: "改过标题" } : node,
      ),
    };
    saved = await f.ok(
      "PUT",
      `${f.path}/canvases/${canvas.id}`,
      { schemaVersion: 1, document },
      saved.revision,
    );
    const moved = (await f.ok("GET", routes.read(batch.id))) as Batch;
    assert.equal(moved.currentCanvasRevision, saved.revision);
    assert.equal(
      itemOf(moved, runnable[0]!.id).status,
      "stale",
      "a moved canvas must not execute old input",
    );
    await f.ok("POST", routes.run(batch.id), { nodeIds: [] }, undefined);
    const after = (await f.ok("GET", routes.read(batch.id))) as Batch;
    assert.equal(
      itemOf(after, runnable[0]!.id).status,
      "stale",
      "the moved item stays stale after execution",
    );
    assert.equal(
      itemOf(after, runnable[0]!.id).jobId,
      undefined,
      "a stale item must not have a job",
    );
  });

  await t.test("execute submits only the selected runnable items", async () => {
    const batch = batchOf(await prepare(runnable.map((node) => node.id)));
    const run = (await f.ok(
      "POST",
      routes.run(batch.id),
      { nodeIds: [runnable[0]!.id, runnable[1]!.id] },
      undefined,
    )) as Batch;
    assert.equal(run.items.length, batch.items.length);
    assert.equal(itemOf(run, runnable[0]!.id).status, "executed");
    assert.equal(itemOf(run, runnable[1]!.id).status, "executed");
    assert.ok(itemOf(run, runnable[0]!.id).jobId);
    assert.equal(
      itemOf(run, runnable[2]!.id).status,
      "ready",
      "an item outside the request must stay untouched",
    );
    // Retrying must not create a second job for an item that already ran.
    const again = (await f.ok(
      "POST",
      routes.run(batch.id),
      { nodeIds: [] },
      undefined,
    )) as Batch;
    assert.equal(
      itemOf(again, runnable[0]!.id).jobId,
      itemOf(run, runnable[0]!.id).jobId,
    );
    assert.ok(
      itemOf(again, runnable[2]!.id).jobId,
      "the remaining ready item runs on retry",
    );
  });

  await t.test("a batch is never a second scheduler", async () => {
    const batch = batchOf(await prepare([runnable[0]!.id]));
    const planId = batch.items[0]!.plan!.id;
    const first = (await f.ok(
      "POST",
      routes.run(batch.id),
      { nodeIds: [] },
      undefined,
    )) as Batch;
    assert.ok(itemOf(first, runnable[0]!.id).jobId);
    const jobs = await f.admin.query(
      `SELECT count(*)::int AS total FROM ${f.scope}.generation_jobs`,
    );
    // Re-running must reuse the item's existing job, never submit a second one.
    await f.ok("POST", routes.run(batch.id), { nodeIds: [] }, undefined);
    const after = await f.admin.query(
      `SELECT count(*)::int AS total FROM ${f.scope}.generation_jobs`,
    );
    assert.equal(
      after.rows[0].total,
      jobs.rows[0].total,
      "re-running a consumed item must not add a job",
    );
    const plan = await f.ok("GET", `${f.base}/generation-plans/${planId}`);
    assert.equal(plan.status, "consumed");
  });

  await t.test("an oversized selection is refused before anything is fixed", async () => {
    const before = await f.admin.query(
      `SELECT count(*)::int AS total FROM ${f.scope}.generation_batches`,
    );
    const response = await prepare(
      Array.from({ length: 101 }, () => randomUUID()),
    );
    // The contract caps nodeIds at 100, so the request is refused before the
    // handler runs and no batch row is created.
    assert.equal(response.statusCode, 422, response.body);
    const after = await f.admin.query(
      `SELECT count(*)::int AS total FROM ${f.scope}.generation_batches`,
    );
    assert.equal(after.rows[0].total, before.rows[0].total);
  });

  await t.test("prepare refuses a canvas revision the caller did not observe", async () => {
    const response = await prepare([runnable[0]!.id], saved.revision + 5);
    assert.equal(response.statusCode, 412, response.body);
    assert.equal(response.json().code, "VERSION_CONFLICT");
  });

  await t.test("a batch item cannot be re-pointed at another plan", async () => {
    const batch = batchOf(await prepare([runnable[0]!.id]));
    const item = batch.items[0]!;
    await assert.rejects(
      f.admin.query(
        `UPDATE ${f.scope}.generation_batch_items SET plan_id=$1 WHERE batch_id=$2 AND node_id=$3`,
        [randomUUID(), batch.id, item.nodeId],
      ),
      /Batch item grouping is immutable/,
      "the grouping a batch fixed must not be silently replaced",
    );
  });
});
