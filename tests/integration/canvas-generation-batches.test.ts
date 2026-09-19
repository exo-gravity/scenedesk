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
    await f.ok(
      "POST",
      routes.run(batch.id),
      { nodeIds: [runnable[0]!.id] },
      undefined,
    );
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
      { nodeIds: [runnable[0]!.id, runnable[2]!.id] },
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
      { nodeIds: [runnable[0]!.id] },
      undefined,
    )) as Batch;
    assert.ok(itemOf(first, runnable[0]!.id).jobId);
    const jobs = await f.admin.query(
      `SELECT count(*)::int AS total FROM ${f.scope}.generation_jobs`,
    );
    // Re-running must reuse the item's existing job, never submit a second one.
    await f.ok(
      "POST",
      routes.run(batch.id),
      { nodeIds: [runnable[0]!.id] },
      undefined,
    );
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

  await t.test("an empty selection cannot mean the whole batch", async () => {
    const batch = batchOf(await prepare(runnable.map((node) => node.id)));
    const before = await f.admin.query(
      `SELECT count(*)::int AS total FROM ${f.scope}.generation_jobs`,
    );
    for (const body of [{}, { nodeIds: [] }]) {
      const response = await f.request(
        "POST",
        routes.run(batch.id),
        body,
        undefined,
      );
      assert.equal(response.statusCode, 422, response.body);
      assert.equal(response.json().code, "INVALID_REQUEST");
    }
    const after = await f.admin.query(
      `SELECT count(*)::int AS total FROM ${f.scope}.generation_jobs`,
    );
    assert.equal(
      after.rows[0].total,
      before.rows[0].total,
      "nothing may be submitted without an explicit selection",
    );
    const items = (await f.ok("GET", routes.read(batch.id))) as Batch;
    for (const item of items.items)
      assert.equal(item.jobId, undefined, "no item of this batch may have run");
  });

  await t.test("prepare refuses a canvas revision the caller did not observe", async () => {
    const response = await prepare([runnable[0]!.id], saved.revision + 5);
    assert.equal(response.statusCode, 412, response.body);
    assert.equal(response.json().code, "VERSION_CONFLICT");
  });

  await t.test("a refused item stays retryable and its neighbours survive", async () => {
    // A capability whose single daily job is already spent refuses a second
    // submission with the real server-side quota guard.
    const limitedCapability = randomUUID(),
      limitedConnection = randomUUID();
    await f.admin.query(
      `INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,1)`,
      [
        limitedCapability,
        f.tenant.id,
        limitedConnection,
        randomUUID(),
        f.definition,
      ],
    );
    const limited = draft("限额模型下的画面");
    limited.content = {
      type: "draft",
      prompt: "限额模型下的画面",
      connectionId: limitedConnection,
      capabilityId: limitedCapability,
      output: f.input.output,
    };
    document = { ...document, nodes: [...document.nodes, limited] };
    saved = await f.ok(
      "PUT",
      `${f.path}/canvases/${canvas.id}`,
      { schemaVersion: 1, document },
      saved.revision,
    );
    const spentPlan = await f.ok("POST", `${f.base}/generation-plans`, {
      ...f.input,
      capabilityId: limitedCapability,
      connectionId: limitedConnection,
      // The plan's model, prompt and output must match the saved draft exactly.
      prompt: "限额模型下的画面",
      shotSources: [],
      contextSources: [
        { kind: "canvas_draft", objectId: limited.id, revision: saved.revision },
      ],
    });
    assert.equal(spentPlan.status, "ready", spentPlan.blockingReasons);
    const spentJob = (await f.execute(spentPlan.id)) as { id: string };

    const batch = batchOf(await prepare([runnable[0]!.id, limited.id]));
    const run = (await f.ok(
      "POST",
      routes.run(batch.id),
      { nodeIds: [runnable[0]!.id, limited.id] },
      undefined,
    )) as Batch;
    const neighbour = itemOf(run, runnable[0]!.id),
      refused = itemOf(run, limited.id);
    // The refusal hit exactly one item; its neighbour kept its job.
    assert.ok(neighbour.jobId, "the neighbouring item must still be submitted");
    assert.equal(neighbour.status, "executed");
    assert.equal(refused.status, "refused", "a refusal must not park the item");
    assert.equal(refused.problemCode, "GENERATION_USAGE_LIMIT");
    assert.equal(refused.jobId, undefined);
    // Its plan verdict is untouched, so the item stays executable.
    const plan = await f.ok(
      "GET",
      `${f.base}/generation-plans/${refused.plan!.id}`,
    );
    assert.equal(plan.status, "ready");

    // Free the cause, then retry the same batch: only the refused item is left to run.
    await f.admin.query(
      `DELETE FROM ${f.scope}.generation_work WHERE job_id=$1`,
      [spentJob.id],
    );
    await f.admin.query(`DELETE FROM ${f.scope}.generation_jobs WHERE id=$1`, [
      spentJob.id,
    ]);
    const retried = (await f.ok(
      "POST",
      routes.run(batch.id),
      { nodeIds: [limited.id] },
      undefined,
    )) as Batch;
    assert.equal(
      itemOf(retried, limited.id).status,
      "executed",
      "a refused item must be retryable through the same batch",
    );
    assert.ok(itemOf(retried, limited.id).jobId);
    assert.equal(itemOf(retried, limited.id).problemCode, undefined);
    // The neighbour's job is not re-created by the retry.
    assert.equal(
      itemOf(retried, runnable[0]!.id).jobId,
      neighbour.jobId,
    );
  });

  await t.test("a batch of another project cannot be read or executed", async () => {
    const batch = batchOf(await prepare([runnable[0]!.id]));
    const other = await f.createProject("另一个项目");
    const foreign = `${f.base}/projects/${other.id}/canvas-generation-batches/${batch.id}`;
    const read = await f.request("GET", foreign, undefined);
    assert.equal(read.statusCode, 404, read.body);
    const run = await f.request("POST", foreign + "/execute", {
      nodeIds: [runnable[0]!.id],
    });
    assert.equal(run.statusCode, 404, run.body);
    // The batch's own project still resolves, so the 404 above is scoping, not a
    // broken id.
    const own = (await f.ok("GET", routes.read(batch.id))) as Batch;
    assert.equal(own.id, batch.id);
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
