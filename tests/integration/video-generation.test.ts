import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { imageGenerationFixture } from "../support/image-generation.js";

test("single video fixed sources, actual timing and stable explicit canvas results", async (t) => {
  const f = await imageGenerationFixture(t, undefined, { purpose: "video" });
  const prepare = async (extra: Record<string, unknown> = {}) => {
    const p = await f.plan(extra);
    assert.equal(p.status, "ready");
    return p;
  };
  const accept = async (id: string, verifyBoundary = false) => {
    const step = await f.envelope(id),
      token = randomUUID();
    const claim = (
      await f.mediaDb.query(
        `SELECT ${f.scope}.claim_generated_media($1,$2,$3,$4) AS claim`,
        [id, step.stepRevision, step.epoch, token],
      )
    ).rows[0].claim;
    assert.ok(claim);
    // This path verifies restricted SQL contracts only; real MP4 decode is separately exercised.
    const result = {
      object: {
        key: `originals/${randomUUID()}`,
        versionId: "relational-video-archive-fixture",
        bytes: claim.source.object.bytes,
        sha256: claim.source.sha256,
      },
      probe: {
        kind: "video",
        mime: "video/mp4",
        width: 32,
        height: 32,
        durationUs: 2000000,
        fpsNum: 24,
        fpsDen: 1,
        hasAudio: claim.output.withAudio,
      },
    };
    if (verifyBoundary) {
      for (const probe of [
        { ...result.probe, durationUs: 2041667 },
        { ...result.probe, hasAudio: !result.probe.hasAudio },
        { ...result.probe, fpsNum: null },
      ])
        await assert.rejects(
          f.mediaDb.query(
            `SELECT ${f.scope}.finish_generated_media($1,$2,$3,NULL)`,
            [id, token, { ...result, probe }],
          ),
          /Video duration|fixed image source/,
        );
    }
    return (
      await f.mediaDb.query(
        `SELECT ${f.scope}.finish_generated_media($1,$2,$3,NULL) AS result`,
        [id, token, result],
      )
    ).rows[0].result;
  };
  await t.test(
    "duration and native audio follow immutable capability limits; image and descriptors cannot execute video",
    async () => {
      const p = await prepare({
        output: { resolution: "32x32", aspectRatio: "1:1", durationSeconds: 2 },
      });
      assert.deepEqual(p.resolvedInput.output, {
        resolution: "32x32",
        aspectRatio: "1:1",
        durationSeconds: 2,
        withAudio: false,
      });
      assert.equal(p.resolvedInput.capabilitySnapshot.mode, "video_fixture_v1");
      for (const output of [
        { resolution: "32x32" },
        { resolution: "32x32", durationSeconds: 3 },
        { resolution: "64x64", durationSeconds: 2 },
        { resolution: "32x32", durationSeconds: 2, aspectRatio: "16:9" },
      ])
        assert.equal(
          (
            await f.request("POST", `${f.base}/generation-plans`, {
              ...f.input,
              output,
            })
          ).statusCode,
          422,
        );
      for (const extra of [
        { mode: "target_profile_fixture" },
        { mode: "image_fixture_v1" },
        { mode: "video_fixture_v1", audioOutput: false },
      ]) {
        const id = randomUUID();
        await f.admin.query(
          `INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
          [
            id,
            f.tenant.id,
            f.input.connectionId,
            randomUUID(),
            { ...f.definition, ...extra },
          ],
        );
        const r = await f.request("POST", `${f.base}/generation-plans`, {
          ...f.input,
          capabilityId: id,
          output: { ...f.input.output, withAudio: true },
        });
        assert.equal(
          r.statusCode,
          extra.audioOutput === false ? 422 : 503,
          r.body,
        );
      }
      assert.equal(f.calls(), 0);
    },
  );
  await t.test(
    "one durable attempt creates independent ready video, actual timing, poster and proxy only after verification",
    async () => {
      const j = await f.execute((await prepare()).id);
      await f.worker.process(j.id);
      assert.equal((await f.job(j.id)).status, "archiving");
      assert.deepEqual((await f.job(j.id)).mediaIds, []);
      const envelopes = await accept(j.id, true);
      assert.equal(envelopes.length, 2);
      assert.ok(envelopes.every((e: any) => e.taskKind === "media_derivative"));
      const done = await f.job(j.id);
      assert.equal(done.status, "succeeded");
      assert.deepEqual(done.mediaIds, [j.id]);
      const m = await f.ok("GET", `${f.base}/media/${j.id}`);
      assert.equal(m.kind, "video");
      assert.equal(m.durationUs, 2000000);
      assert.equal(m.fpsNum, 24);
      assert.equal(m.fpsDen, 1);
      assert.equal(m.hasAudio, false);
      assert.deepEqual(m.derivatives.map((d: any) => d.kind).sort(), [
        "poster",
        "proxy",
      ]);
      assert.equal(m.sourceJobId, j.id);
      assert.equal(m.sourceUploadId, undefined);
      assert.equal(m.immutableKey, undefined);
      await f.worker.process(j.id);
      assert.equal(f.calls(), 1);
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int AS n FROM ${f.scope}.takes WHERE media_id=$1`,
            [j.id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "unknown and failed queue finalization retain one submit; invalid result collection does not archive",
    async () => {
      f.setUnknown(true);
      const j = await f.execute((await prepare()).id),
        before = f.calls();
      await f.worker.process(j.id);
      await f.worker.process(j.id);
      assert.equal((await f.job(j.id)).status, "submission_unknown");
      assert.equal(f.calls(), before + 1);
      f.setUnknown(false);
      f.setQueueFailure(true);
      await assert.rejects(
        f.worker.reconcile(j.id),
        /Injected archive queue failure/,
      );
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
      await accept(j.id);
      f.setOutput({ images: [] });
      const bad = await f.execute((await prepare()).id);
      await f.worker.process(bad.id);
      assert.equal((await f.job(bad.id)).errorCode, "INVALID_VIDEO_OUTPUT");
      f.setOutput({
        videos: [
          {
            kind: "fixture_object",
            object: {
              key: `originals/${randomUUID()}`,
              versionId: "relational-fixture",
              bytes: 100,
            },
            sha256: "a".repeat(64),
            mime: "video/mp4",
          },
        ],
      });
    },
  );
  await t.test(
    "canvas snapshot remains fixed after execute and materialization restores video node identity without Take",
    async () => {
      const r = await f.request(
        "POST",
        `${f.path}/scenes/${f.scene.id}/canvas`,
      );
      assert.equal(r.statusCode, 200, r.body);
      let canvas = r.json().canvas;
      const nodeId = randomUUID(),
        textId = randomUUID();
      let document = {
        nodes: [
          {
            id: nodeId,
            kind: "video",
            title: "视频草稿",
            position: { x: 400, y: 0 },
            width: 320,
            content: {
              type: "draft",
              prompt: f.input.prompt,
              output: f.input.output,
              connectionId: f.input.connectionId,
              capabilityId: f.input.capabilityId,
            },
          },
          {
            id: textId,
            kind: "text",
            title: "选定输入",
            position: { x: 0, y: 0 },
            width: 280,
            content: { type: "text", text: "原来明确选定的运动方向" },
          },
        ],
        edges: [
          {
            id: randomUUID(),
            sourceNodeId: textId,
            targetNodeId: nodeId,
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
      const p = await f.ok(
        "POST",
        `${f.path}/scenes/${f.scene.id}/canvas/generation-plans`,
        {
          nodeId,
          shotSources: [],
          referenceOverrides: [],
          promptPolicy: "replace",
        },
        canvas.revision,
      );
      assert.equal(p.plan.input.purpose, "video");
      const j = await f.execute(p.plan.id);
      document.nodes[1]!.content = {
        type: "text",
        text: "execute 后的新方向不改写任务",
      };
      await save();
      await f.worker.process(j.id);
      assert.match(f.last()!.resolvedInput.prompt, /原来明确选定/);
      assert.equal((await f.job(j.id)).inputOutdated, true);
      await accept(j.id);
      document.nodes = document.nodes.filter((node) => node.id !== nodeId);
      document.edges = [];
      await save();
      const history = await f.ok(
        "GET",
        `${f.path}/canvases/${canvas.id}/generation-plans?nodeId=${nodeId}`,
      );
      assert.equal(history.items[0].jobId, j.id);
      const body = {
          jobId: j.id,
          mediaIds: [j.id],
          position: { x: 800, y: 0 },
        },
        first = await f.ok(
          "POST",
          `${f.path}/canvases/${canvas.id}/results`,
          body,
          canvas.revision,
        );
      canvas = first.canvas;
      const placement = first.placements[0];
      assert.equal(
        canvas.document.nodes.find((node: any) => node.id === placement.nodeId)
          .kind,
        "video",
      );
      document = canvas.document;
      document.nodes = document.nodes.filter(
        (node) => node.id !== placement.nodeId,
      );
      await save();
      const again = await f.ok(
        "POST",
        `${f.path}/canvases/${canvas.id}/results`,
        body,
        canvas.revision,
      );
      assert.equal(again.placements[0].nodeId, placement.nodeId);
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int AS n FROM ${f.scope}.takes WHERE media_id=$1`,
            [j.id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
});
