import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { grantGenerationWorkerAccess, sqlIdentifier } from "@drama/database";
import {
  createAssistanceFixture,
  type AssistanceSubmission,
} from "@drama/provider";
import { databaseFixture } from "../support/database.js";
import { buildApp } from "../../apps/api/src/app.js";
import { issueSession } from "../../apps/api/src/modules/identity/sessions.js";
import { Secrets } from "../../apps/api/src/kernel/crypto.js";
import { createAssistanceWorker } from "../../apps/api/src/modules/generation/worker.js";

test("fixed prompt assistance preserves shot sources and immutable human-editable artifacts", async (t) => {
  const fixture = await databaseFixture(t),
    { schema, admin, runtime, auth } = fixture;
  const workerRole = `gen_${randomBytes(6).toString("hex")}`,
    password = randomBytes(24).toString("hex");
  await admin.query(
    `CREATE ROLE ${sqlIdentifier(workerRole)} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT PASSWORD '${password}'`,
  );
  const dburl = new URL(process.env.DATABASE_URL!);
  dburl.username = workerRole;
  dburl.password = password;
  const pool = new Pool({ connectionString: dburl.href, max: 3 });
  t.after(async () => {
    await pool.end();
    const cleanup = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await cleanup.query(`DROP OWNED BY ${sqlIdentifier(workerRole)}`);
      await cleanup.query(`DROP ROLE ${sqlIdentifier(workerRole)}`);
    } finally {
      await cleanup.end();
    }
  });
  const provision = await admin.connect();
  try {
    await grantGenerationWorkerAccess(provision, schema, workerRole);
  } finally {
    provision.release();
  }
  const secret = randomBytes(32).toString("base64url"),
    secrets = new Secrets(secret),
    origin = "http://127.0.0.1:4311";
  const app = buildApp(runtime, { schema, secret, origin });
  t.after(() => app.close());
  await app.ready();
  const owner = await issueSession(
    auth,
    {
      issuer: "urn:test",
      subject: "generation-owner",
      email: "generation@example.test",
      emailVerified: true,
      displayName: "分镜制作人",
    },
    { schema },
  );
  const request = (
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: unknown,
    version?: number,
    key = randomUUID(),
  ) =>
    app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
      headers: {
        cookie: `session=${owner.token}`,
        origin,
        "x-csrf-token": secrets.csrf(owner.token),
        "idempotency-key": key,
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(version === undefined ? {} : { "if-match": `"${version}"` }),
      },
    });
  const ok = async (
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: unknown,
    version?: number,
    status = method === "POST" ? 201 : 200,
  ) => {
    const r = await request(method, url, payload, version);
    assert.equal(r.statusCode, status, r.body);
    return r.json();
  };
  const tenant = await ok("POST", "/v1/tenants", {
      name: "AI 边界验收",
      currency: "CNY",
    }),
    base = `/v1/tenants/${tenant.id}`;
  const member = (await ok("GET", `${base}/members`)).items[0];
  const project = await ok("POST", `${base}/projects`, {
      name: "选定剧本",
      leadMembershipId: member.id,
      spec: {
        width: 1080,
        height: 1920,
        fpsNum: 24,
        fpsDen: 1,
        language: "zh-CN",
      },
    }),
    path = `${base}/projects/${project.id}`;
  const tree = () => ok("GET", `${path}/content`),
    next = async () => (await tree()).revision;
  const script = await ok(
    "POST",
    `${path}/scripts`,
    { text: "甲😀她推门进屋。她问：钥匙在哪里？尾声" },
    await next(),
  );
  const episode = await ok(
    "POST",
    `${path}/episodes`,
    { title: "第一集", position: 0, status: "active" },
    await next(),
  );
  let scene = await ok(
    "POST",
    `${path}/scenes`,
    {
      episodeId: episode.id,
      title: "旧公寓",
      position: 0,
      summary: "寻找钥匙",
      state: { spatialNotes: "门在左侧" },
      status: "active",
    },
    await next(),
  );

  const shot = await ok(
    "POST",
    `${path}/shots`,
    {
      sceneId: scene.id,
      label: "01",
      position: 0,
      status: "active",
      spec: { intent: "找到旧钥匙", action: "她推门进屋", references: [] },
    },
    await next(),
  );
  const capabilityId = randomUUID(),
    targetId = randomUUID(),
    connectionId = randomUUID(),
    connectionVersionId = randomUUID();
  assert.deepEqual(
    (await ok("GET", `${base}/capabilities?projectId=${project.id}`)).items,
    [],
  );
  for (const [id, purpose] of [
    [capabilityId, "creative_assistance"],
    [targetId, "image"],
  ])
    await admin.query(
      `INSERT INTO "${schema}".generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
      [
        id,
        tenant.id,
        connectionId,
        connectionVersionId,
        {
          purpose,
          modelVersion: "显式 fixture，仅验证事务",
          mode: "fixture",
          supportedPurposes: ["composition", "look"],
          maxReferences: 10,
        },
      ],
    );
  const original = {
    prompt: "显式测试：她推门，暖光照在钥匙上",
    referenceSuggestions: [] as { mediaId: string; purpose: "composition" }[],
    retain: ["钥匙的原位置"],
    change: ["突出手部动作"],
    notes: "仅用于事务和恢复测试，无真实模型",
  };
  let outputBody: typeof original = original;
  let calls = 0,
    recoverCalls = 0,
    last: AssistanceSubmission | undefined,
    behavior: "success" | "unknown" | "invalid" = "success";
  const adapter = createAssistanceFixture(
    connectionVersionId,
    async (submission) => {
      calls++;
      last = submission;
      return behavior === "unknown"
        ? { kind: "unknown", correlation: submission.attemptId }
        : {
            kind: "completed",
            correlation: submission.attemptId,
            output:
              behavior === "invalid"
                ? {
                    ...original,
                    referenceSuggestions: [
                      { mediaId: randomUUID(), purpose: "composition" },
                    ],
                  }
                : outputBody,
          };
    },
    async (submission) => {
      recoverCalls++;
      return behavior === "success"
        ? {
            kind: "completed",
            correlation: submission.attemptId,
            output: original,
          }
        : null;
    },
  );
  const worker = await createAssistanceWorker({
    pool,
    schema,
    adapters: [adapter],
  });
  const input = () => ({
    scope: "project",
    projectId: project.id,
    connectionId,
    capabilityId,
    purpose: "creative_assistance",
    prompt: "准备当前镜头的画面提示",
    output: {},
    shotSources: [{ shotId: shot.id, shotRevisionId: shot.specRevisionId }],
    additionalReferences: [],
    referenceOverrides: [],
    promptPolicy: "append",
    assistance: {
      kind: "prepare_prompt",
      targetCapabilityId: targetId,
      targetCapabilityRevision: 1,
    },
    contextSources: [
      { kind: "scene", objectId: scene.id, revision: scene.revision },
    ],
  });
  const prepare = (overrides = {}) =>
    ok("POST", `${base}/generation-plans`, { ...input(), ...overrides });
  const execute = (planId: string) =>
    ok("POST", `${base}/generation-jobs`, { planId }, undefined, 202);
  const result = (id: string) => ok("GET", `${base}/generation-jobs/${id}`);
  let plan: any, job: any, artifact: any;
  await t.test(
    "only explicit fixed shots and target capability become frozen input; execution creates no production edits",
    async () => {
      const before = await tree();
      plan = await prepare();
      assert.equal(plan.status, "ready");
      assert.equal(
        plan.resolvedInput.shots[0].shotRevisionId,
        shot.specRevisionId,
      );
      assert.deepEqual(plan.resolvedInput.shots[0].spec, shot.spec);
      assert.equal(plan.resolvedInput.targetCapabilitySnapshot.id, targetId);
      assert.equal(
        plan.resolvedInput.targetConnectionVersionId,
        connectionVersionId,
      );
      job = await execute(plan.id);
      await Promise.all([worker.process(job.id), worker.process(job.id)]);
      job = await result(job.id);
      assert.equal(job.status, "succeeded");
      assert.equal(job.proposalId, undefined);
      assert.equal(calls, 1);
      assert.equal(job.mediaIds.length, 0);
      assert.deepEqual(await tree(), before);
      artifact = await ok(
        "GET",
        `${path}/assistance-artifacts/${job.assistanceArtifactId}`,
      );
      assert.deepEqual(artifact.body, original);
      assert.deepEqual(artifact.shotSources, input().shotSources);
      assert.equal(artifact.executionMode, "test_fixture");
      assert.equal(artifact.inputOutdated, false);
      assert.equal(artifact.revision, 1);
      assert.equal(artifact.editedBy, undefined);
      assert.equal((await execute(plan.id)).id, job.id);
      assert.equal(calls, 1);
      const list = await ok(
        "GET",
        `${path}/assistance-artifacts?shotId=${shot.id}&kind=prepare_prompt`,
      );
      assert.equal(list.items.length, 1);
      assert.equal(list.items[0].id, artifact.id);
    },
  );
  await t.test(
    "the database rejects ready plans without an estimate or with blocking reasons",
    async () => {
      for (const [estimate, reasons] of [
        [null, []],
        [plan.costEstimate, ["CAPABILITY_UNAVAILABLE"]],
      ]) {
        await assert.rejects(
          admin.query(
            `INSERT INTO "${schema}".generation_plans
              (id,tenant_id,project_id,capability_id,connection_version_id,created_by,
               input,resolved_input,input_hash,capability_revision,base_content_snapshot,
               cost_estimate,blocking_reasons,execution_mode,status,expires_at)
             SELECT $1,tenant_id,project_id,capability_id,connection_version_id,created_by,
               input,resolved_input,input_hash,capability_revision,base_content_snapshot,
               $2::jsonb,$3::jsonb,execution_mode,'ready',expires_at
             FROM "${schema}".generation_plans WHERE id=$4`,
            [
              randomUUID(),
              estimate === null ? null : JSON.stringify(estimate),
              JSON.stringify(reasons),
              plan.id,
            ],
          ),
          { code: "23514", constraint: "generation_plans_ready_cost_check" },
        );
      }
    },
  );
  await t.test(
    "human edits append immutable revisions; conflicts and lost responses recover by authoritative reads",
    async () => {
      const edited = { ...original, prompt: "人工修改：镜头从门把手移到钥匙" };
      const responses = await Promise.all([
        request(
          "PUT",
          `${path}/assistance-artifacts/${artifact.id}`,
          { body: edited },
          1,
        ),
        request(
          "PUT",
          `${path}/assistance-artifacts/${artifact.id}`,
          { body: { ...edited, prompt: "冲突草稿" } },
          1,
        ),
      ]);
      assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 412]);
      artifact = await ok("GET", `${path}/assistance-artifacts/${artifact.id}`);
      assert.equal(artifact.revision, 2);
      assert.equal(artifact.editedBy, owner.userId);
      const old = await ok(
        "GET",
        `${path}/assistance-artifacts/${artifact.id}/revisions/1`,
      );
      assert.deepEqual(old.body, original);
      assert.equal(old.editedBy, undefined);
      assert.deepEqual(old.resolvedInput, artifact.resolvedInput);
      assert.equal(old.generationJobId, job.id);
      assert.equal(calls, 1);
      assert.equal(
        (
          await request(
            "PUT",
            `${path}/assistance-artifacts/${artifact.id}`,
            { body: edited, shotSources: [] },
            2,
          )
        ).statusCode,
        422,
      );
      assert.equal(
        (
          await request(
            "PUT",
            `${path}/assistance-artifacts/${artifact.id}`,
            { body: { ...edited, prompt: "invalid" + String.fromCharCode(0) } },
            2,
          )
        ).statusCode,
        422,
      );
    },
  );
  await t.test(
    "unknown execution cannot be resubmitted and resolves to the original single artifact",
    async () => {
      behavior = "unknown";
      const p = await prepare(),
        j = await execute(p.id),
        before = calls;
      await worker.process(j.id);
      assert.equal((await result(j.id)).status, "submission_unknown");
      await worker.process(j.id);
      await worker.reconcile(j.id);
      assert.equal(calls, before + 1);
      assert.equal(recoverCalls, 1);
      const cancellation = await request("POST", `${base}/generation-jobs/${j.id}/cancel`);
      assert.equal(cancellation.statusCode, 202, cancellation.body);
      assert.equal(cancellation.json().status, "submission_unknown");
      assert.equal(cancellation.json().cancelStatus, "requested");
      assert.equal(cancellation.json().reservationStatus, "held");
      behavior = "success";
      await worker.reconcile(j.id);
      const done = await result(j.id);
      assert.equal(done.status, "succeeded");
      assert.ok(done.assistanceArtifactId);
      assert.equal(calls, before + 1);
      await admin.query(
        `DELETE FROM "${schema}".idempotency_records WHERE operation_id='executeGenerationPlan'`,
      );
      assert.equal((await execute(p.id)).id, j.id);
      assert.equal(
        (
          await ok(
            "GET",
            `${base}/generation-jobs?projectId=${project.id}&planId=${p.id}`,
          )
        ).items[0].id,
        j.id,
      );
      assert.equal(
        (
          await admin.query(
            `SELECT count(*) FROM "${schema}".generation_attempts WHERE job_id=$1`,
            [j.id],
          )
        ).rows[0].count,
        "1",
      );
    },
  );
  await t.test(
    "model cannot add a reference identity outside fixed selected inputs",
    async () => {
      behavior = "invalid";
      const j = await execute((await prepare()).id);
      await worker.process(j.id);
      const done = await result(j.id);
      assert.equal(done.status, "failed");
      assert.equal(done.errorCode, "INVALID_ASSISTANCE_OUTPUT");
      assert.equal(
        (
          await admin.query(
            `SELECT count(*) FROM "${schema}".assistance_artifacts WHERE generation_job_id=$1`,
            [j.id],
          )
        ).rows[0].count,
        "0",
      );
      behavior = "success";
    },
  );
  await t.test(
    "fixed old shot revision stays fixed while selected mutable context makes input outdated",
    async () => {
      const p = await prepare();
      await ok(
        "PUT",
        `${path}/shots/${shot.id}`,
        {
          sceneId: scene.id,
          label: shot.label,
          position: shot.position,
          status: "active",
          spec: { ...shot.spec, intent: "新版本动作" },
        },
        shot.revision,
      );
      const j = await execute(p.id);
      await worker.process(j.id);
      assert.equal((await result(j.id)).inputOutdated, false);
      assert.equal(
        (
          await ok(
            "GET",
            `${path}/assistance-artifacts/${(await result(j.id)).assistanceArtifactId}`,
          )
        ).resolvedInput.shots[0].spec.intent,
        shot.spec.intent,
      );
      const stale = await prepare();
      scene = await ok(
        "PUT",
        `${path}/scenes/${scene.id}`,
        {
          episodeId: episode.id,
          title: scene.title,
          position: scene.position,
          summary: "她已找到钥匙",
          state: scene.state,
          status: "active",
        },
        scene.revision,
      );
      const r = await request("POST", `${base}/generation-jobs`, {
        planId: stale.id,
      });
      assert.equal(r.statusCode, 409, r.body);
      assert.equal(r.json().code, "PLAN_INPUT_CHANGED");
      assert.equal((await result(job.id)).inputOutdated, true);
      assert.equal(
        (
          await ok(
            "GET",
            `${path}/assistance-artifacts/${artifact.id}/revisions/1`,
          )
        ).inputOutdated,
        true,
      );
    },
  );
  await t.test(
    "missing fixed shots, review sources and target profiles cannot be invented",
    async () => {
      const missing = await request("POST", `${base}/generation-plans`, {
        ...input(),
        shotSources: [],
      });
      assert.equal(missing.statusCode, 422, missing.body);
      assert.equal(missing.json().code, "INVALID_REQUEST");
      const rework = await request("POST", `${base}/generation-plans`, {
        ...input(),
        assistance: {
          ...input().assistance,
          kind: "prepare_rework",
          feedback: {
            reviewId: randomUUID(),
            commentId: randomUUID(),
            commentRevision: 1,
          },
          sourceTakeId: randomUUID(),
        },
      });
      assert.equal(rework.statusCode, 404, rework.body);
      assert.equal(rework.json().code, "NOT_FOUND");
      const foreign = await request("POST", `${base}/generation-plans`, {
        ...input(),
        shotSources: [{ shotId: randomUUID(), shotRevisionId: randomUUID() }],
      });
      assert.equal(foreign.statusCode, 404, foreign.body);
      const stale = await request("POST", `${base}/generation-plans`, {
        ...input(),
        assistance: { ...input().assistance, targetCapabilityRevision: 2 },
      });
      assert.equal(stale.statusCode, 412, stale.body);
      const p = await prepare();
      await admin.query(
        `UPDATE "${schema}".generation_capabilities SET enabled=false WHERE id=$1`,
        [targetId],
      );
      assert.equal(
        (await request("POST", `${base}/generation-jobs`, { planId: p.id }))
          .statusCode,
        409,
      );
      await admin.query(
        `UPDATE "${schema}".generation_capabilities SET enabled=true WHERE id=$1`,
        [targetId],
      );
    },
  );

  await t.test(
    "canvas draft hashes include enabled semantic inputs and exclude layout, titles and disabled edges",
    async () => {
      let canvas = (
        await ok(
          "POST",
          `${path}/scenes/${scene.id}/canvas`,
          undefined,
          undefined,
          200,
        )
      ).canvas;
      const textId = randomUUID(),
        disabledId = randomUUID(),
        draftId = randomUUID();
      let document = {
        nodes: [
          {
            id: textId,
            title: "暖光",
            kind: "text",
            position: { x: 0, y: 0 },
            width: 280,
            content: { type: "text", text: "门后暖光。" },
          },
          {
            id: disabledId,
            title: "未选",
            kind: "text",
            position: { x: 0, y: 100 },
            width: 280,
            content: { type: "text", text: "不会参与。" },
          },
          {
            id: draftId,
            title: "提示草稿",
            kind: "image",
            position: { x: 400, y: 0 },
            width: 280,
            content: {
              type: "draft",
              prompt: "钥匙近景",
              output: {},
              connectionId,
              capabilityId: targetId,
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
          {
            id: randomUUID(),
            sourceNodeId: disabledId,
            targetNodeId: draftId,
            purpose: "prompt",
            enabled: false,
            position: 1,
          },
        ],
        groups: [],
      };
      const save = async () =>
        (canvas = await ok(
          "PUT",
          `${path}/canvases/${canvas.id}`,
          { schemaVersion: 1, document },
          canvas.revision,
        ));
      await save();
      const contextSources = [
          {
            kind: "canvas_draft",
            objectId: draftId,
            revision: canvas.revision,
          },
        ],
        p = await prepare({ contextSources });
      const snapshot = p.resolvedInput.contextSnapshots[0];
      assert.equal(snapshot.source.objectId, draftId);
      assert.ok(snapshot.text.includes("门后暖光。"));
      assert.ok(!snapshot.text.includes("不会参与。"));
      document = structuredClone(document);
      document.nodes[0]!.title = "改标题";
      document.nodes[0]!.position.x = 200;
      document.nodes[1]!.content.text = "停用内容变了";
      await save();
      const j = await execute(p.id);
      await worker.process(j.id);
      assert.equal((await result(j.id)).inputOutdated, false);
      const another = await prepare({
        contextSources: [{ ...contextSources[0], revision: canvas.revision }],
      });
      assert.equal(
        another.resolvedInput.contextSnapshots[0].source.contentHash,
        snapshot.source.contentHash,
      );
      document.nodes[0]!.content.text = "门后蓝光。";
      await save();
      const stale = await request("POST", `${base}/generation-jobs`, {
        planId: another.id,
      });
      assert.equal(stale.statusCode, 409, stale.body);
      assert.equal(stale.json().code, "PLAN_INPUT_CHANGED");
      assert.equal((await result(j.id)).inputOutdated, true);
      const textAsDraft = await request("POST", `${base}/generation-plans`, {
        ...input(),
        contextSources: [
          { kind: "canvas_draft", objectId: textId, revision: canvas.revision },
        ],
      });
      assert.equal(textAsDraft.statusCode, 422, textAsDraft.body);
      assert.equal(textAsDraft.json().code, "CANVAS_DRAFT_REQUIRED");
    },
  );
  await t.test(
    "authorized references are projected, archived existing advice remains editable, and new private references are rejected",
    async () => {
      // Relational fixture only. Actual object bytes and media decoding are outside this test.
      const createMedia = async (projectId: string) => {
        const id = randomUUID(),
          upload = randomUUID();
        await admin.query(
          `INSERT INTO "${schema}".upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch) VALUES($1,$2,$3,'project',$4,64,$5,'fixture.png','image/png','关系测试',$6,'accepted',now()+interval '15 minutes','fixture-version',1)`,
          [
            upload,
            tenant.id,
            projectId,
            `staging/${upload}`,
            "a".repeat(64),
            owner.userId,
          ],
        );
        await admin.query(
          `INSERT INTO "${schema}".media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio) VALUES($1,$2,$3,'project','image','ready','关系测试','fixture.png',$4,$5,$6,'fixture-version',$7,64,'image/png',32,32,false)`,
          [
            id,
            tenant.id,
            projectId,
            owner.userId,
            upload,
            `originals/${id}`,
            "a".repeat(64),
          ],
        );
        return id;
      };
      const mediaId = await createMedia(project.id),
        reference = { mediaId, purpose: "composition" as const };
      outputBody = { ...original, referenceSuggestions: [reference] };
      const p = await prepare({ additionalReferences: [reference] }),
        j = await execute(p.id);
      await worker.process(j.id);
      const a = await ok(
        "GET",
        `${path}/assistance-artifacts/${(await result(j.id)).assistanceArtifactId}`,
      );
      assert.deepEqual(a.body.referenceSuggestions, [reference]);
      assert.equal(
        (
          await admin.query(
            `SELECT media_id FROM "${schema}".assistance_revision_refs WHERE artifact_id=$1`,
            [a.id],
          )
        ).rows[0].media_id,
        mediaId,
      );
      await admin.query(
        `UPDATE "${schema}".media SET status='archived',revision=revision+1 WHERE id=$1`,
        [mediaId],
      );
      const edited = await ok(
        "PUT",
        `${path}/assistance-artifacts/${a.id}`,
        { body: { ...a.body, notes: "已归档参考仍保留原身份" } },
        1,
      );
      assert.equal(edited.revision, 2);
      assert.equal(edited.inputOutdated, true);
      assert.equal(
        (
          await request("POST", `${base}/generation-plans`, {
            ...input(),
            additionalReferences: [reference],
          })
        ).statusCode,
        422,
      );
      const other = await ok("POST", `${base}/projects`, {
          name: "其他私有项目",
          leadMembershipId: member.id,
          spec: project.spec,
        }),
        otherMedia = await createMedia(other.id);
      const denied = await request(
        "PUT",
        `${path}/assistance-artifacts/${a.id}`,
        {
          body: {
            ...edited.body,
            referenceSuggestions: [
              { mediaId: otherMedia, purpose: "composition" },
            ],
          },
        },
        2,
      );
      assert.equal(denied.statusCode, 422, denied.body);
      assert.equal(
        (await ok("GET", `${path}/assistance-artifacts/${a.id}`)).revision,
        2,
      );
      outputBody = original;
    },
  );
  await t.test(
    "current authorization protects artifact reads, history and edits and cancels queued work after revocation",
    async () => {
      const collaborator = await issueSession(
          auth,
          {
            issuer: "urn:test",
            subject: "prompt-collaborator",
            email: "prompt-collaborator@example.test",
            emailVerified: true,
            displayName: "协作者",
          },
          { schema },
        ),
        membershipId = randomUUID();
      await admin.query(
        `INSERT INTO "${schema}".memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')`,
        [membershipId, tenant.id, collaborator.userId],
      );
      await admin.query(
        `INSERT INTO "${schema}".project_memberships(id,tenant_id,project_id,membership_id,role) VALUES($1,$2,$3,$4,'collaborator')`,
        [randomUUID(), tenant.id, project.id, membershipId],
      );
      const call = (
        method: "GET" | "POST" | "PUT",
        url: string,
        payload?: unknown,
        version?: number,
        key = randomUUID(),
      ) =>
        app.inject({
          method,
          url,
          ...(payload ? { payload } : {}),
          headers: {
            cookie: `session=${collaborator.token}`,
            origin,
            "x-csrf-token": secrets.csrf(collaborator.token),
            "idempotency-key": key,
            ...(version ? { "if-match": `"${version}"` } : {}),
          },
        });
      assert.equal(
        (await call("GET", `${path}/assistance-artifacts/${artifact.id}`))
          .statusCode,
        200,
      );
      const key = randomUUID(),
        pr = await call(
          "POST",
          `${base}/generation-plans`,
          input(),
          undefined,
          key,
        );
      assert.equal(pr.statusCode, 201, pr.body);
      const jr = await call("POST", `${base}/generation-jobs`, {
        planId: pr.json().id,
      });
      assert.equal(jr.statusCode, 202, jr.body);
      await admin.query(
        `DELETE FROM "${schema}".project_memberships WHERE membership_id=$1`,
        [membershipId],
      );
      for (const url of [
        `${path}/assistance-artifacts`,
        `${path}/assistance-artifacts/${artifact.id}`,
        `${path}/assistance-artifacts/${artifact.id}/revisions/1`,
      ])
        assert.equal((await call("GET", url)).statusCode, 404);
      assert.equal(
        (
          await call(
            "PUT",
            `${path}/assistance-artifacts/${artifact.id}`,
            { body: original },
            artifact.revision,
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await call(
            "POST",
            `${base}/generation-plans`,
            input(),
            undefined,
            key,
          )
        ).statusCode,
        404,
      );
      const before = calls;
      await worker.process(jr.json().id);
      assert.equal(calls, before);
      assert.equal((await result(jr.json().id)).status, "cancelled");
    },
  );
  await t.test(
    "late conflicting evidence preserves the first artifact and exposes reconciliation",
    async () => {
      const j = await execute((await prepare()).id);
      await worker.process(j.id);
      const done = await result(j.id),
        attempt = last!.attemptId;
      await pool.query(
        `SELECT "${schema}".record_generation_evidence($1,$2,$3)`,
        [
          attempt,
          randomUUID(),
          {
            kind: "completed",
            correlation: attempt,
            output: { ...original, prompt: "冲突结果" },
          },
        ],
      );
      await worker.process(j.id);
      const conflict = await result(j.id);
      assert.equal(conflict.status, "reconciliation_required");
      assert.equal(conflict.assistanceArtifactId, done.assistanceArtifactId);
      assert.deepEqual(
        (
          await ok(
            "GET",
            `${path}/assistance-artifacts/${done.assistanceArtifactId}`,
          )
        ).body,
        original,
      );
    },
  );
  await t.test(
    "restricted identities cannot rewrite original artifact or read arbitrary source tables",
    async () => {
      await assert.rejects(
        runtime.query(
          `UPDATE "${schema}".assistance_artifact_revisions SET body='{}'`,
        ),
        (e) => (e as { code: string }).code === "42501",
      );
      await assert.rejects(
        pool.query(`SELECT * FROM "${schema}".shot_revisions`),
        (e) => (e as { code: string }).code === "42501",
      );
    },
  );
});
