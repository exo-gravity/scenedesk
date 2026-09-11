import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { imageGenerationFixture } from "../support/image-generation.js";

test("single image fixed plan, archive protocol and explicit canvas results", async (t) => {
  const f = await imageGenerationFixture(t);
  let verifiedMediaId = "";
  const prepare = async (extra: Record<string, unknown> = {}) => {
    const p = await f.plan(extra);
    assert.equal(p.status, "ready");
    return p;
  };
  // This helper verifies restricted SQL state transitions only. Real decoding is in tests/media/image-generation.test.ts.
  const accept = async (id: string) => {
    const step = await f.envelope(id),
      token = randomUUID();
    const claim = (
      await f.mediaDb.query(
        `SELECT ${f.scope}.claim_generated_media($1,$2,$3,$4) AS claim`,
        [id, step.stepRevision, step.epoch, token],
      )
    ).rows[0].claim;
    assert.ok(claim);
    return (
      await f.mediaDb.query(
        `SELECT ${f.scope}.finish_generated_media($1,$2,$3,NULL) AS envelope`,
        [
          id,
          token,
          {
            object: {
              key: `originals/${randomUUID()}`,
              versionId: "relational-archive-fixture",
              bytes: claim.source.object.bytes,
              sha256: claim.source.sha256,
            },
            probe: {
              kind: "image",
              mime: "image/png",
              width: 32,
              height: 32,
              hasAudio: false,
            },
          },
        ],
      )
    ).rows[0].envelope;
  };
  await t.test(
    "old target descriptors, missing sources and unsupported output cannot execute",
    async () => {
      const id = randomUUID();
      await f.admin.query(
        `INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
        [
          id,
          f.tenant.id,
          f.input.connectionId,
          randomUUID(),
          { ...f.definition, mode: "target_profile_fixture" },
        ],
      );
      for (const [extra, status, code] of [
        [{ capabilityId: id }, 503, "IMAGE_CAPABILITY_NOT_EXECUTABLE"],
        [{ shotSources: [] }, 422, "IMAGE_SOURCE_REQUIRED"],
        [{ output: { resolution: "64x64" } }, 422, "IMAGE_OUTPUT_UNSUPPORTED"],
      ] as const) {
        const r = await f.request("POST", `${f.base}/generation-plans`, {
          ...f.input,
          ...extra,
        });
        assert.equal(r.statusCode, status, r.body);
        assert.equal(r.json().code, code);
      }
      assert.equal(f.calls(), 0);
    },
  );
  await t.test(
    "one submission records a private source but exposes media only after verification",
    async () => {
      const p = await prepare(),
        j = await f.execute(p.id);
      assert.equal(p.resolvedInput.output.resolution, "32x32");
      assert.equal(p.resolvedInput.capabilitySnapshot.mode, "image_fixture_v1");
      await f.worker.process(j.id);
      const pending = await f.job(j.id);
      assert.equal(pending.status, "archiving");
      assert.deepEqual(pending.mediaIds, []);
      assert.equal(pending.resolvedInput, undefined);
      await f.worker.process(j.id);
      assert.equal(f.calls(), 1);
      assert.equal((await f.execute(p.id)).id, j.id);
      const poster = await accept(j.id);
      assert.equal(poster.taskKind, "media_derivative");
      const ready = await f.job(j.id);
      assert.equal(ready.status, "succeeded");
      assert.deepEqual(ready.mediaIds, [j.id]);
      const media = await f.ok("GET", `${f.base}/media/${j.id}`);
      verifiedMediaId = j.id;
      assert.equal(media.sourceJobId, j.id);
      assert.equal(media.sourceUploadId, undefined);
      assert.equal(media.immutableKey, undefined);
      assert.equal(media.storageVersionId, undefined);
      assert.equal(media.derivatives[0].status, "queued");
      const listing = await f.ok("GET", `${f.base}/media?sourceJobId=${j.id}`);
      assert.deepEqual(
        listing.items.map((m: any) => m.id),
        [j.id],
      );
      await assert.rejects(
        f.runtime.query(
          `SELECT ${f.scope}.finish_generated_media($1,$2,NULL,NULL)`,
          [j.id, randomUUID()],
        ),
        /permission denied/,
      );
    },
  );
  await t.test(
    "lost archive queue write preserves receipt and retries local finalization without submit",
    async () => {
      const j = await f.execute((await prepare()).id),
        before = f.calls();
      f.setQueueFailure(true);
      await assert.rejects(
        f.worker.process(j.id),
        /Injected archive queue failure/,
      );
      assert.equal(f.calls(), before + 1);
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int AS n FROM ${f.scope}.generation_media_outputs WHERE job_id=$1`,
            [j.id],
          )
        ).rows[0].n,
        0,
      );
      f.setQueueFailure(false);
      await f.worker.process(j.id);
      assert.equal(f.calls(), before + 1);
      assert.equal((await f.job(j.id)).status, "archiving");
      await accept(j.id);
    },
  );
  await t.test(
    "unknown submission cannot be converted to archive retry and recovery uses evidence only",
    async () => {
      f.setUnknown(true);
      const j = await f.execute((await prepare()).id),
        before = f.calls();
      await f.worker.process(j.id);
      await f.worker.process(j.id);
      assert.equal(f.calls(), before + 1);
      assert.equal((await f.job(j.id)).status, "submission_unknown");
      const r = await f.request(
        "POST",
        `${f.base}/generation-jobs/${j.id}/recover-archive`,
      );
      assert.equal(r.statusCode, 409, r.body);
      f.setUnknown(false);
      await f.worker.reconcile(j.id);
      assert.equal(f.calls(), before + 1);
      assert.equal((await f.job(j.id)).status, "archiving");
      await accept(j.id);
    },
  );
  await t.test(
    "conflicting late evidence keeps the first verified Media and never declares success",
    async () => {
      const j = await f.execute((await prepare()).id);
      await f.worker.process(j.id);
      const attempt = f.last()!;
      await f.generationDb.query(
        `SELECT ${f.scope}.record_generation_evidence($1,$2,$3)`,
        [
          attempt.attemptId,
          randomUUID(),
          {
            kind: "rejected",
            correlation: attempt.attemptId,
            code: "LATE_CONFLICT_FIXTURE",
          },
        ],
      );
      assert.equal((await f.job(j.id)).status, "reconciliation_required");
      await accept(j.id);
      const done = await f.job(j.id);
      assert.equal(done.status, "reconciliation_required");
      assert.deepEqual(done.mediaIds, [j.id]);
      assert.equal(
        (await f.ok("GET", `${f.base}/media/${j.id}`)).status,
        "ready",
      );
    },
  );
  await t.test(
    "provider URLs and incomplete output never create an archive source",
    async () => {
      f.setOutput({
        images: [{ kind: "url", url: "https://example.invalid/unsafe.png" }],
      });
      const j = await f.execute((await prepare()).id);
      await f.worker.process(j.id);
      const done = await f.job(j.id);
      assert.equal(done.status, "failed");
      assert.equal(done.errorCode, "INVALID_IMAGE_OUTPUT");
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int AS n FROM ${f.scope}.media WHERE source_job_id=$1`,
            [j.id],
          )
        ).rows[0].n,
        0,
      );
      f.setOutput({
        images: [
          {
            kind: "fixture_object",
            object: {
              key: `originals/${randomUUID()}`,
              versionId: "relational-fixture-only",
              bytes: 100,
            },
            sha256: "a".repeat(64),
            mime: "image/png",
          },
        ],
      });
    },
  );
  await t.test(
    "reference archival after execute cancels first dispatch without consuming an attempt",
    async () => {
      const p = await prepare({
        additionalReferences: [
          { mediaId: verifiedMediaId, purpose: "composition" },
        ],
      });
      assert.equal(
        p.resolvedInput.references[0].reference.mediaId,
        verifiedMediaId,
      );
      const j = await f.execute(p.id),
        before = f.calls(),
        m = await f.ok("GET", `${f.base}/media/${verifiedMediaId}`);
      await f.ok(
        "POST",
        `${f.base}/media/${verifiedMediaId}/archive`,
        undefined,
        m.revision,
      );
      await f.worker.process(j.id);
      const done = await f.job(j.id);
      assert.equal(done.status, "cancelled");
      assert.equal(done.errorCode, "EXECUTION_SOURCE_UNAVAILABLE");
      assert.equal(f.calls(), before);
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int AS n FROM ${f.scope}.generation_attempts WHERE job_id=$1`,
            [j.id],
          )
        ).rows[0].n,
        0,
      );
      const outsider = await f.identity("outside-image-project");
      for (const url of [
        `${f.base}/generation-jobs/${j.id}`,
        `${f.base}/media/${verifiedMediaId}`,
      ])
        assert.equal(
          (
            await f.request(
              "GET",
              url,
              undefined,
              undefined,
              randomUUID(),
              outsider,
            )
          ).statusCode,
          404,
        );
    },
  );
  await t.test(
    "ready plan invariant rejects null cost even through direct SQL",
    async () => {
      const p = await prepare();
      const columns = (
        await f.admin.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='generation_plans' AND is_generated='NEVER' ORDER BY ordinal_position",
          [f.schema],
        )
      ).rows.map((row) => row.column_name as string);
      const sql = await f.admin.connect();
      try {
        await sql.query("BEGIN");
        await sql.query(`SET LOCAL search_path TO ${f.scope},pg_catalog`);
        await assert.rejects(
          sql.query(
            `INSERT INTO ${f.scope}.generation_plans(${columns.map((c) => '"' + c + '"').join(",")}) SELECT ${columns.map((c) => (c === "id" ? "gen_random_uuid()" : c === "cost_estimate" ? "NULL" : '"' + c + '"')).join(",")} FROM ${f.scope}.generation_plans WHERE id=$1`,
            [p.id],
          ),
          /generation_plans_ready_cost_check/,
        );
      } finally {
        await sql.query("ROLLBACK");
        sql.release();
      }
    },
  );
  await t.test(
    "canvas fixes only semantic draft inputs; results require explicit stable placement",
    async () => {
      const response = await f.request(
        "POST",
        `${f.path}/scenes/${f.scene.id}/canvas`,
      );
      assert.equal(response.statusCode, 200, response.body);
      let canvas = response.json().canvas;
      const draftId = randomUUID(),
        textId = randomUUID();
      let document = {
        nodes: [
          {
            id: textId,
            kind: "text",
            title: "标题",
            position: { x: 0, y: 0 },
            width: 280,
            content: { type: "text", text: "明确选择的暖光" },
          },
          {
            id: draftId,
            kind: "image",
            title: "图像草稿",
            position: { x: 400, y: 0 },
            width: 280,
            content: {
              type: "draft",
              prompt: f.input.prompt,
              output: f.input.output,
              connectionId: f.input.connectionId,
              capabilityId: f.input.capabilityId,
            },
          },
        ],
        edges: [
          {
            id: randomUUID(),
            sourceNodeId: textId,
            targetNodeId: draftId,
            purpose: "prompt",
            enabled: true,
            position: 0,
          },
        ],
        groups: [],
      };
      const save = async () =>
        (canvas = await f.ok(
          "PUT",
          `${f.path}/canvases/${canvas.id}`,
          { schemaVersion: 1, document },
          canvas.revision,
        ));
      await save();
      const prepareCanvas = () =>
        f.ok(
          "POST",
          `${f.path}/scenes/${f.scene.id}/canvas/generation-plans`,
          {
            nodeId: draftId,
            shotSources: [],
            referenceOverrides: [],
            promptPolicy: "replace",
          },
          canvas.revision,
        );
      const p = await prepareCanvas();
      assert.deepEqual(p.origin.sourceNodeIds, [textId]);
      assert.match(p.plan.resolvedInput.prompt, /明确选择的暖光/);
      document.nodes[0]!.position = { x: 90, y: 50 };
      document.nodes[0]!.title = "新布局标题";
      await save();
      const moved = await prepareCanvas();
      assert.equal(moved.origin.inputFingerprint, p.origin.inputFingerprint);
      const j = await f.execute(p.plan.id);
      await f.worker.process(j.id);
      await accept(j.id);
      assert.equal((await f.job(j.id)).inputOutdated, false);
      assert.equal(
        (await f.ok("GET", `${f.path}/canvases/${canvas.id}`)).document.nodes
          .length,
        2,
      );
      const entries = await f.ok(
        "GET",
        `${f.path}/canvases/${canvas.id}/generation-plans?nodeId=${draftId}`,
      );
      assert.ok(entries.items.some((item: any) => item.jobId === j.id));
      const firstPage = await f.ok(
        "GET",
        `${f.path}/canvases/${canvas.id}/generation-plans?limit=1`,
      );
      assert.ok(firstPage.nextCursor);
      const otherScene = await f.ok(
        "POST",
        `${f.path}/scenes`,
        {
          episodeId: f.scene.episodeId,
          title: "同项目另一个画布",
          position: 1,
          summary: "独立分页范围",
          state: {},
          status: "active",
        },
        await f.next(),
      );
      const otherResponse = await f.request(
        "POST",
        `${f.path}/scenes/${otherScene.id}/canvas`,
      );
      assert.equal(otherResponse.statusCode, 200, otherResponse.body);
      const foreignCursor = await f.request(
        "GET",
        `${f.path}/canvases/${otherResponse.json().canvas.id}/generation-plans?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
      );
      assert.equal(foreignCursor.statusCode, 422, foreignCursor.body);
      assert.equal(foreignCursor.json().code, "INVALID_CURSOR");

      const body = {
        jobId: j.id,
        mediaIds: [j.id],
        position: { x: 800, y: 0 },
      };
      const placed = await f.ok(
        "POST",
        `${f.path}/canvases/${canvas.id}/results`,
        body,
        canvas.revision,
      );
      canvas = placed.canvas;
      const nodeId = placed.placements[0].nodeId;
      assert.equal(canvas.document.nodes.length, 3);
      document = canvas.document;
      document.nodes = document.nodes.filter((n) => n.id !== nodeId);
      await save();
      const restored = await f.ok(
        "POST",
        `${f.path}/canvases/${canvas.id}/results`,
        body,
        canvas.revision,
      );
      assert.equal(restored.placements[0].nodeId, nodeId);
      canvas = restored.canvas;
      const stale = await f.request(
        "POST",
        `${f.path}/canvases/${canvas.id}/results`,
        body,
        canvas.revision - 1,
      );
      assert.equal(stale.statusCode, 412);
      document = canvas.document;
      document.nodes.find((n) => n.id === textId)!.content = {
        type: "text",
        text: "已经变化的选定输入",
      };
      await save();
      assert.equal((await f.job(j.id)).inputOutdated, true);
      const outdated = await f.request("POST", `${f.base}/generation-jobs`, {
        planId: moved.plan.id,
      });
      assert.equal(outdated.statusCode, 409, outdated.body);
    },
  );
});
