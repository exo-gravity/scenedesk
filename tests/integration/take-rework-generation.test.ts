import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createAssistanceFixture,
  localAssistanceFixtureOutput,
  type AssistanceSubmission,
} from "@drama/provider";
import { imageGenerationFixture } from "../support/image-generation.js";
import { createAssistanceWorker } from "../../apps/api/src/modules/generation/worker.js";
import { Database } from "../../apps/api/src/kernel/database.js";
import { canonical, digest } from "../../apps/api/src/kernel/crypto.js";

test("Take feedback fixes immutable rework sources through preparation, execution and recovery", async (t) => {
  const f = await imageGenerationFixture(t);
  const mediaId = randomUUID(),
    upload = randomUUID();
  // Relational video only: this suite proves provenance/authority, not decoding or AI quality.
  await f.admin.query(
    `INSERT INTO ${f.scope}.upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch) VALUES($1,$2,$3,'project',$4,64,$5,'fixture.mp4','video/mp4','关系测试片',$6,'accepted',now()+interval '15 minutes','fixture-version',1)`,
    [
      upload,
      f.tenant.id,
      f.project.id,
      `staging/${upload}`,
      "a".repeat(64),
      f.owner.userId,
    ],
  );
  await f.admin.query(
    `INSERT INTO ${f.scope}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio,duration_us,fps_num,fps_den) VALUES($1,$2,$3,'project','video','ready','关系测试片','fixture.mp4',$4,$5,$6,'fixture-version',$7,64,'video/mp4',32,32,false,4000000,24,1)`,
    [
      mediaId,
      f.tenant.id,
      f.project.id,
      f.owner.userId,
      upload,
      `originals/${mediaId}`,
      "a".repeat(64),
    ],
  );
  const take = await f.ok("POST", `${f.path}/takes`, {
    shotId: f.shot.id,
    shotRevisionId: f.shot.specRevisionId,
    mediaId,
    range: { inUs: 250000, outUs: 2250000 },
  });
  const review = await f.ok("POST", `${f.path}/reviews`, {
    subject: { takeId: take.id },
    sourceReviewIds: [],
    reworkItems: [],
  });
  const capabilityId = randomUUID(),
    connectionId = randomUUID(),
    connectionVersionId = randomUUID();
  await f.admin.query(
    `INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
    [
      capabilityId,
      f.tenant.id,
      connectionId,
      connectionVersionId,
      {
        purpose: "creative_assistance",
        mode: "structured_text_fixture",
        modelVersion: "本地事务测试，无真实模型",
        supportedPurposes: [],
      },
    ],
  );
  const comments = `${f.path}/reviews/${review.id}/comments`;
  const comment = (
    body = '保留😀暖光，放慢手部动作。\n引号"与反斜线\\保持原文',
  ) => f.ok("POST", comments, { body, startUs: 125000, endUs: 750000 });
  const input = (c: any) => ({
    ...f.input,
    purpose: "creative_assistance",
    capabilityId,
    connectionId,
    output: {},
    prompt: "请按原意见准备修改\t保持 é 与 é",
    assistance: {
      kind: "prepare_rework",
      targetCapabilityId: f.input.capabilityId,
      targetCapabilityRevision: 1,
      feedback: {
        reviewId: review.id,
        commentId: c.id,
        commentRevision: c.revision,
      },
      sourceTakeId: take.id,
    },
  });
  const prepare = (c: any, extra = {}) => f.plan({ ...input(c), ...extra });
  const artifact = (id: string, rev?: number) =>
    f.ok(
      "GET",
      `${f.path}/assistance-artifacts/${id}${rev ? `/revisions/${rev}` : ""}`,
    );
  let calls = 0,
    recovered = 0,
    unknown = false,
    invalid = false,
    last: AssistanceSubmission | undefined;
  const adapter = createAssistanceFixture(
    connectionVersionId,
    async (s) => {
      calls++;
      last = s;
      return unknown
        ? { kind: "unknown", correlation: s.attemptId }
        : {
            kind: "completed",
            correlation: s.attemptId,
            output: invalid
              ? {
                  ...localAssistanceFixtureOutput(s),
                  feedbackSnapshot: { body: "伪造" },
                }
              : localAssistanceFixtureOutput(s),
          };
    },
    async (s) => {
      recovered++;
      return unknown
        ? null
        : {
            kind: "completed",
            correlation: s.attemptId,
            output: localAssistanceFixtureOutput(s),
          };
    },
  );
  const worker = await createAssistanceWorker({
    pool: f.generationDb,
    schema: f.schema,
    adapters: [adapter],
  });
  const db = new Database(f.runtime, f.schema);
  const transaction = (run: Parameters<Database["transaction"]>[2]) =>
    db.transaction(
      f.owner.token,
      { tenantId: f.tenant.id, projectId: f.project.id, write: true },
      run,
    );
  let original: any, originalArtifact: any, originalComment: any;

  await t.test(
    "old Take shot, original Unicode/time range and canonical hash survive JSONB and durable output",
    async () => {
      await f.ok(
        "PUT",
        `${f.path}/shots/${f.shot.id}`,
        {
          sceneId: f.scene.id,
          label: f.shot.label,
          position: f.shot.position,
          status: "active",
          spec: { ...f.shot.spec, intent: "新的镜头要求" },
        },
        f.shot.revision,
      );
      const before = await f.tree();
      originalComment = await comment();
      original = await prepare(originalComment);
      const fixed = {
        reviewId: review.id,
        commentId: originalComment.id,
        commentRevision: 1,
        body: originalComment.body,
        subject: { takeId: take.id },
        startUs: 125000,
        endUs: 750000,
      };
      assert.deepEqual(original.resolvedInput.feedbackSnapshot, fixed);
      assert.equal(
        original.resolvedInput.shots[0].shotRevisionId,
        take.shotRevisionId,
      );
      assert.equal(original.resolvedInput.resolverVersion, "creative-rework/1");
      assert.deepEqual(
        original.resolvedInput.dependencies.filter(
          (d: any) => d.kind === "review_comment",
        ),
        [
          {
            kind: "review_comment",
            objectId: originalComment.id,
            revision: 1,
            tracking: "fixed",
            contentHash: digest(canonical(fixed)),
          },
        ],
      );
      const recomputed = (
        await f.admin.query(
          `SELECT ${f.scope}.rework_input_hash(input,resolved_input,capability_revision,connection_version_id) AS hash FROM ${f.scope}.generation_plans WHERE id=$1`,
          [original.id],
        )
      ).rows[0].hash;
      assert.equal(original.inputHash, recomputed);
      assert.deepEqual(original.input.output, {});
      // Serializer-only numeric roundtrip: the current public assistance input has no float field.
      const decimal = { value: 1e-7, other: 1.25, unicode: '😀\\"\n' };
      const hashes = await f.admin.query(
        `SELECT ${f.scope}.rework_input_hash($1::jsonb,$2::jsonb,1,$3) AS first, ${f.scope}.rework_input_hash(($1::jsonb)::text::jsonb,($2::jsonb)::text::jsonb,1,$3) AS roundtrip`,
        [decimal, decimal, connectionVersionId],
      );
      assert.equal(hashes.rows[0].first, hashes.rows[0].roundtrip);
      const j = await f.execute(original.id);
      await Promise.all([worker.process(j.id), worker.process(j.id)]);
      const done = await f.job(j.id);
      assert.equal(done.status, "succeeded");
      assert.equal(calls, 1);
      assert.equal(last!.requestHash, original.inputHash);
      originalArtifact = await artifact(done.assistanceArtifactId);
      assert.deepEqual(originalArtifact.resolvedInput.feedbackSnapshot, fixed);
      assert.equal(originalArtifact.inputOutdated, false);
      assert.equal(originalArtifact.executionMode, "test_fixture");
      assert.match(originalArtifact.body.change[0], /固定意见 r1/);
      assert.match(originalArtifact.body.notes, /无真实模型/);
      assert.deepEqual(await f.tree(), before);
      assert.equal((await f.ok("GET", comments)).items[0].resolved, false);
      assert.equal(
        (await f.admin.query(`SELECT count(*) FROM ${f.scope}.selections`))
          .rows[0].count,
        "0",
      );
    },
  );

  await t.test(
    "missing versions, foreign projects, mismatched Take/shot and generic comment contexts are rejected",
    async () => {
      const c = await comment();
      const base = input(c);
      const otherTake = await f.ok("POST", `${f.path}/takes`, {
        shotId: f.shot.id,
        shotRevisionId: f.shot.specRevisionId,
        mediaId,
        range: { inUs: 0, outUs: 1000000 },
      });
      for (const extra of [
        {
          assistance: {
            ...base.assistance,
            feedback: { reviewId: review.id, commentId: c.id },
          },
        },
        { assistance: { ...base.assistance, sourceTakeId: otherTake.id } },
        {
          assistance: { ...base.assistance, sourceCutRevisionId: randomUUID() },
        },
        {
          shotSources: [
            {
              shotId: f.shot.id,
              shotRevisionId: (await f.tree()).shots[0].specRevisionId,
            },
          ],
        },
        {
          contextSources: [
            { kind: "review_comment", objectId: c.id, revision: c.revision },
          ],
        },
      ]) {
        const r = await f.request("POST", `${f.base}/generation-plans`, {
          ...base,
          ...extra,
        });
        assert.equal(r.statusCode, 422, r.body);
      }
      const other = await f.createProject("跨项目隔离");
      const cross = await f.request("POST", `${f.base}/generation-plans`, {
        ...base,
        projectId: other.id,
      });
      assert.equal(cross.statusCode, 404, cross.body);
      const revision = await f.request("POST", `${f.base}/generation-plans`, {
        ...base,
        assistance: {
          ...base.assistance,
          feedback: { ...base.assistance.feedback, commentRevision: 999 },
        },
      });
      assert.equal(revision.statusCode, 404, revision.body);
    },
  );

  await t.test(
    "database rejects forged snapshots, dependencies, whole-input hashes and missing typed projection",
    async () => {
      const p = await prepare(await comment());
      async function clone(
        mutate: (input: any, resolved: any) => void,
        projection = true,
        badHash = false,
      ) {
        return transaction(async (tx) => {
          const originalRow = (
            await tx.sql.query("SELECT * FROM generation_plans WHERE id=$1", [
              p.id,
            ])
          ).rows[0];
          const i = structuredClone(originalRow.input),
            r = structuredClone(originalRow.resolved_input);
          mutate(i, r);
          const id = randomUUID();
          const hash = badHash
            ? "0".repeat(64)
            : (
                await tx.sql.query(
                  "SELECT rework_input_hash($1,$2,$3,$4) AS hash",
                  [
                    i,
                    r,
                    originalRow.capability_revision,
                    originalRow.connection_version_id,
                  ],
                )
              ).rows[0].hash;
          await tx.sql.query(
            `INSERT INTO generation_plans(id,tenant_id,project_id,capability_id,connection_version_id,created_by,input,resolved_input,input_hash,capability_revision,base_content_snapshot,cost_estimate,blocking_reasons,execution_mode,status,expires_at) SELECT $1,tenant_id,project_id,capability_id,connection_version_id,created_by,$2,$3,$4,capability_revision,base_content_snapshot,cost_estimate,blocking_reasons,execution_mode,status,expires_at FROM generation_plans WHERE id=$5`,
            [id, i, r, hash, p.id],
          );
          await tx.sql.query(
            "INSERT INTO generation_plan_shots SELECT tenant_id,project_id,$1,position,shot_id,shot_revision_id FROM generation_plan_shots WHERE plan_id=$2",
            [id, p.id],
          );
          if (projection)
            await tx.sql.query(
              "INSERT INTO generation_rework_inputs SELECT tenant_id,project_id,$1,review_id,comment_id,comment_revision,take_id,shot_id,shot_revision_id FROM generation_rework_inputs WHERE plan_id=$2",
              [id, p.id],
            );
        });
      }
      for (const mutation of [
        (i: any) => {
          i.purpose = "image";
        },
        (_i: any, r: any) => {
          r.feedbackSnapshot.body = "伪造意见";
        },
        (_i: any, r: any) => {
          r.feedbackSnapshot.startUs++;
        },
        (_i: any, r: any) => {
          r.feedbackSnapshot.subject.takeId = randomUUID();
        },
        (_i: any, r: any) => {
          r.dependencies.find(
            (d: any) => d.kind === "review_comment",
          ).contentHash = "b".repeat(64);
        },
        (i: any, r: any) => {
          i.assistance.feedback.commentRevision = 999;
          r.assistanceRequest = i.assistance;
        },
      ])
        await assert.rejects(clone(mutation), { code: "23514" });
      await assert.rejects(
        clone(() => {}, true, true),
        { code: "23514" },
      );
      await assert.rejects(
        clone(() => {}, false),
        { code: "23514" },
      );
      await assert.rejects(
        transaction((tx) =>
          tx.sql.query(
            "DELETE FROM generation_rework_inputs WHERE plan_id=$1",
            [p.id],
          ),
        ),
        { code: "42501" },
      );
      await assert.rejects(
        f.generationDb.query(
          `SELECT * FROM ${f.scope}.generation_rework_inputs`,
        ),
        { code: "42501" },
      );
    },
  );

  await t.test(
    "edited/resolved feedback never silently upgrades a plan; first dispatch checks current source",
    async () => {
      for (const change of [{ body: "新版动作意见" }, { resolved: true }]) {
        const c = await comment(),
          p = await prepare(c);
        await f.ok("PATCH", `${comments}/${c.id}`, change, c.revision);
        const r = await f.request("POST", `${f.base}/generation-jobs`, {
          planId: p.id,
        });
        assert.equal(r.statusCode, 409, r.body);
        assert.equal(r.json().code, "REWORK_FEEDBACK_CHANGED");
        const stale = await f.request(
          "POST",
          `${f.base}/generation-plans`,
          input(c),
        );
        assert.equal(stale.statusCode, 409, stale.body);
      }
      const c = await comment(),
        p = await prepare(c),
        j = await f.execute(p.id),
        before = calls;
      await f.ok(
        "PATCH",
        `${comments}/${c.id}`,
        { resolved: true },
        c.revision,
      );
      await worker.process(j.id);
      const cancelled = await f.job(j.id);
      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.errorCode, "REWORK_SOURCE_CHANGED");
      assert.equal(calls, before);
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*) FROM ${f.scope}.generation_attempts WHERE job_id=$1`,
            [j.id],
          )
        ).rows[0].count,
        "0",
      );
      const done = await f.ok(
        "PATCH",
        `${comments}/${originalComment.id}`,
        { body: "这条是后来编辑的意见" },
        originalComment.revision,
      );
      const old = await artifact(originalArtifact.id, 1);
      assert.equal(old.inputOutdated, true);
      assert.equal(
        old.resolvedInput.feedbackSnapshot.body,
        originalComment.body,
      );
      assert.equal(done.revision, 2);
    },
  );

  await t.test(
    "unknown submission keeps its attempt even when feedback changes; recovery creates only the original artifact",
    async () => {
      const c = await comment(),
        p = await prepare(c),
        j = await f.execute(p.id),
        before = calls;
      unknown = true;
      await worker.process(j.id);
      assert.equal((await f.job(j.id)).status, "submission_unknown");
      await f.ok(
        "PATCH",
        `${comments}/${c.id}`,
        { resolved: true },
        c.revision,
      );
      await worker.process(j.id);
      await worker.reconcile(j.id);
      assert.equal(calls, before + 1);
      assert.equal(recovered, 1);
      unknown = false;
      // Move only this isolated fixture's next read past the durable backoff; never resubmit.
      await f.admin.query(`UPDATE ${f.scope}.generation_observation_control SET next_observation_at=now() WHERE job_id=$1`, [j.id]);
      await worker.reconcile(j.id);
      await worker.reconcile(j.id);
      const result = await f.job(j.id);
      assert.equal(result.status, "succeeded");
      assert.equal(result.inputOutdated, true);
      assert.equal(calls, before + 1);
      const a = await artifact(result.assistanceArtifactId);
      assert.equal(a.resolvedInput.feedbackSnapshot.body, c.body);
      assert.equal(a.resolvedInput.feedbackSnapshot.commentRevision, 1);
      assert.equal((await f.execute(p.id)).id, j.id);
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*) FROM ${f.scope}.assistance_artifacts WHERE generation_job_id=$1`,
            [j.id],
          )
        ).rows[0].count,
        "1",
      );
    },
  );

  await t.test(
    "immutable rework artifact revisions remain usable as explicit media provenance without side effects",
    async () => {
      const edited = {
        ...originalArtifact.body,
        prompt: "人工核对后的新提示",
        retain: [],
        change: [],
      };
      const a = await f.ok(
        "PUT",
        `${f.path}/assistance-artifacts/${originalArtifact.id}`,
        { body: edited },
        1,
      );
      assert.equal(a.revision, 2);
      assert.equal(a.inputOutdated, true);
      assert.deepEqual(
        a.resolvedInput.feedbackSnapshot,
        originalArtifact.resolvedInput.feedbackSnapshot,
      );
      const before = await f.tree(),
        commentsBefore = await f.ok("GET", comments);
      const p = await f.plan({
        assistanceSource: { artifactId: a.id, revision: 2 },
        prompt: "只使用明确的人工媒体提示",
      });
      assert.equal(p.resolvedInput.prompt, "只使用明确的人工媒体提示");
      assert.deepEqual(p.resolvedInput.assistanceSnapshot, edited);
      assert.equal(p.resolvedInput.feedbackSnapshot, undefined);
      assert.equal(
        p.resolvedInput.dependencies.some(
          (d: any) => d.kind === "review_comment",
        ),
        false,
      );
      assert.deepEqual(await f.tree(), before);
      assert.deepEqual(await f.ok("GET", comments), commentsBefore);
      const other = await f.createProject("来源不可跨项目读取");
      const path = `${f.base}/projects/${other.id}`;
      const next = async () => (await f.ok("GET", `${path}/content`)).revision;
      const episode = await f.ok(
        "POST",
        `${path}/episodes`,
        { title: "隔离集", position: 0, status: "active" },
        await next(),
      );
      const scene = await f.ok(
        "POST",
        `${path}/scenes`,
        {
          episodeId: episode.id,
          title: "隔离场",
          position: 0,
          status: "active",
          summary: "",
          state: {},
        },
        await next(),
      );
      const shot = await f.ok(
        "POST",
        `${path}/shots`,
        {
          sceneId: scene.id,
          label: "隔离镜",
          position: 0,
          status: "active",
          spec: { intent: "当前项目自己的来源", references: [] },
        },
        await next(),
      );
      const r = await f.request("POST", `${f.base}/generation-plans`, {
        ...f.input,
        projectId: other.id,
        shotSources: [{ shotId: shot.id, shotRevisionId: shot.specRevisionId }],
        assistanceSource: { artifactId: a.id, revision: 2 },
      });
      assert.equal(r.statusCode, 404, r.body);
      assert.equal(r.json().code, "ASSISTANCE_SOURCE_UNAVAILABLE");
    },
  );

  await t.test(
    "concurrent comment edits and preparation cannot silently select the new revision",
    async () => {
      const c = await comment();
      const [planned, edited] = await Promise.all([
        f.request("POST", `${f.base}/generation-plans`, input(c)),
        f.request(
          "PATCH",
          `${comments}/${c.id}`,
          { body: "并发的新意见" },
          c.revision,
        ),
      ]);
      assert.equal(edited.statusCode, 200, edited.body);
      assert.equal(edited.json().revision, 2);
      if (planned.statusCode === 201) {
        assert.equal(
          planned.json().resolvedInput.feedbackSnapshot.body,
          c.body,
        );
        assert.equal(
          planned.json().resolvedInput.feedbackSnapshot.commentRevision,
          1,
        );
        const execute = await f.request("POST", `${f.base}/generation-jobs`, {
          planId: planned.json().id,
        });
        assert.equal(execute.statusCode, 409, execute.body);
      } else {
        assert.equal(planned.statusCode, 409, planned.body);
        assert.equal(planned.json().code, "REWORK_FEEDBACK_CHANGED");
      }
    },
  );

  await t.test(
    "invalid provider metadata cannot replace feedback; current source media is required until dispatch",
    async () => {
      const c = await comment(),
        p = await prepare(c),
        j = await f.execute(p.id);
      invalid = true;
      await worker.process(j.id);
      invalid = false;
      assert.equal((await f.job(j.id)).errorCode, "INVALID_ASSISTANCE_OUTPUT");
      const queued = await f.execute((await prepare(await comment())).id),
        before = calls;
      await f.admin.query(
        `UPDATE ${f.scope}.media SET status='archived',revision=revision+1,updated_at=now() WHERE id=$1`,
        [mediaId],
      );
      const blocked = await f.request(
        "POST",
        `${f.base}/generation-plans`,
        input(await comment()),
      );
      assert.equal(blocked.statusCode, 409, blocked.body);
      assert.equal(blocked.json().code, "REWORK_SOURCE_UNAVAILABLE");
      await worker.process(queued.id);
      assert.equal((await f.job(queued.id)).status, "cancelled");
      assert.equal(calls, before);
      assert.equal((await artifact(originalArtifact.id)).inputOutdated, true);
    },
  );
});
