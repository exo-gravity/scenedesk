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

test("fixed script analysis plans execute once and produce persistent editable proposals", async (t) => {
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
  assert.deepEqual(
    (
      await ok(
        "GET",
        `${base}/capabilities?projectId=${project.id}&purpose=script_analysis`,
      )
    ).items,
    [],
  );
  const capabilityId = randomUUID(),
    connectionId = randomUUID(),
    connectionVersionId = randomUUID();
  await admin.query(
    `INSERT INTO "${schema}".generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
    [
      capabilityId,
      tenant.id,
      connectionId,
      connectionVersionId,
      {
        purpose: "script_analysis",
        modelVersion: "显式测试 fixture，不是真实模型",
        mode: "structured_text",
        supportedPurposes: [],
      },
    ],
  );
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
                    shots: [
                      {
                        label: "01",
                        intent: "错误引用",
                        sceneId: randomUUID(),
                      },
                    ],
                  }
                : {
                    shots: [
                      {
                        label: "01",
                        intent: "她推门进屋",
                        dialogue: ["钥匙在哪里？"],
                        plannedDurationUs: 4000000,
                      },
                      { label: "02", intent: "看见抽屉里的钥匙" },
                    ],
                  },
          };
    },
    async (submission) => {
      recoverCalls++;
      return behavior === "success"
        ? {
            kind: "completed",
            correlation: submission.attemptId,
            output: {
              shots: [{ label: "核对结果", intent: "原 attempt 的迟到建议" }],
            },
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
    purpose: "script_analysis",
    prompt: "准备两个分镜建议",
    output: {},
    additionalReferences: [],
    referenceOverrides: [],
    promptPolicy: "append",
    sourceScriptRevisionId: script.id,
    scriptRange: { startOffset: 2, endOffset: 16 },
    proposalTarget: {
      mode: "append_to_scene",
      sceneId: scene.id,
      sceneRevision: scene.revision,
      episodeId: episode.id,
    },
    contextSources: [
      { kind: "scene", objectId: scene.id, revision: scene.revision },
    ],
  });
  const prepare = () => ok("POST", `${base}/generation-plans`, input());
  const execute = (planId: string) =>
    ok("POST", `${base}/generation-jobs`, { planId }, undefined, 202);
  let plan: any, job: any;
  await t.test(
    "explicit selection is resolved and frozen before a separate execute confirmation",
    async () => {
      const listed = (
        await ok("GET", `${base}/capabilities?projectId=${project.id}`)
      ).items;
      assert.equal(listed[0].executionMode, "test_fixture");
      plan = await prepare();
      assert.equal(plan.status, "ready");
      assert.equal(plan.executionMode, "test_fixture");
      assert.equal(
        plan.resolvedInput.sourceExcerpt.quote,
        Array.from(script.text).slice(2, 16).join(""),
      );
      assert.equal(plan.resolvedInput.contextSnapshots.length, 1);
      assert.equal(calls, 0);
      assert.equal((await tree()).shots.length, 0);
      const saved = (
        await admin.query(
          `SELECT input_hash,resolved_input FROM "${schema}".generation_plans WHERE id=$1`,
          [plan.id],
        )
      ).rows[0];
      assert.equal(saved.input_hash, plan.inputHash);
      assert.deepEqual(saved.resolved_input, plan.resolvedInput);
      assert.equal(
        (
          await request("POST", `${base}/generation-plans`, {
            ...input(),
            scriptRange: { startOffset: 16, endOffset: 2 },
          })
        ).statusCode,
        422,
      );
      assert.equal(
        (
          await request("POST", `${base}/generation-plans`, {
            ...input(),
            contextSources: [
              { kind: "scene", objectId: randomUUID(), revision: 1 },
            ],
          })
        ).statusCode,
        404,
      );
    },
  );
  await t.test(
    "concurrent consumes, expired replay cache, and concurrent workers cannot buy another attempt",
    async () => {
      const responses = await Promise.all([
        request("POST", `${base}/generation-jobs`, { planId: plan.id }),
        request("POST", `${base}/generation-jobs`, { planId: plan.id }),
      ]);
      responses.forEach((r) => assert.equal(r.statusCode, 202, r.body));
      job = responses[0]!.json();
      assert.equal(job.id, responses[1]!.json().id);
      await Promise.all([worker.process(job.id), worker.process(job.id)]);
      assert.equal(calls, 1);
      assert.equal(last?.requestHash, plan.inputHash);
      assert.deepEqual(last?.resolvedInput, plan.resolvedInput);
      job = await ok("GET", `${base}/generation-jobs/${job.id}`);
      assert.equal(job.status, "succeeded");
      assert.equal(job.inputOutdated, false);
      assert.equal(job.proposalId, job.id);
      assert.equal((await tree()).shots.length, 0);
      await admin.query(
        `DELETE FROM "${schema}".idempotency_records WHERE operation_id='executeGenerationPlan'`,
      );
      assert.equal((await execute(plan.id)).id, job.id);
      assert.equal(calls, 1);
      const found = await ok(
        "GET",
        `${base}/generation-jobs?projectId=${project.id}&planId=${plan.id}`,
      );
      assert.equal(found.items.length, 1);
      assert.equal(found.items[0].id, job.id);
      assert.equal(
        (
          await admin.query(
            `SELECT count(*) FROM "${schema}".generation_attempts WHERE job_id=$1`,
            [job.id],
          )
        ).rows[0].count,
        "1",
      );
    },
  );
  await t.test(
    "AI proposal retains original source through edit and explicit adoption without auto-changing shots",
    async () => {
      let proposal = await ok("GET", `${path}/proposals/${job.proposalId}`);
      assert.equal(proposal.sourceKind, "ai_analysis");
      assert.equal(proposal.sourceScriptRevisionId, script.id);
      assert.deepEqual(proposal.scriptRange, input().scriptRange);
      assert.deepEqual(proposal.operations[0].sourceExcerpts, [
        plan.resolvedInput.sourceExcerpt,
      ]);
      const operations = structuredClone(proposal.operations);
      operations[0].proposed.spec.intent = "人工修改：先看门把手";
      proposal = await ok(
        "PUT",
        `${path}/proposals/${proposal.id}`,
        {
          baseContentRevision: proposal.baseContentRevision,
          target: proposal.target,
          operations,
        },
        proposal.revision,
      );
      const original = await ok(
        "GET",
        `${path}/proposals/${proposal.id}?revisionNumber=1`,
      );
      assert.equal(original.operations[0].proposed.spec.intent, "她推门进屋");
      const applied = await ok(
        "POST",
        `${path}/proposals/${proposal.id}/apply`,
        {
          proposalRevision: proposal.revision,
          selectedOperationIds: [proposal.operations[0].opId],
        },
        await next(),
        201,
      );
      assert.equal(applied.shots.length, 1);
      assert.equal(applied.shots[0].spec.intent, "人工修改：先看门把手");
      assert.deepEqual(applied.shots[0].spec.sourceExcerpts, [
        plan.resolvedInput.sourceExcerpt,
      ]);
    },
  );
  await t.test(
    "unknown submission remains unresolved, cannot be cancelled as free, and recovers only original attempt",
    async () => {
      behavior = "unknown";
      const p = await prepare(),
        j = await execute(p.id),
        before = calls;
      await worker.process(j.id);
      assert.equal(calls, before + 1);
      assert.equal(
        (await ok("GET", `${base}/generation-jobs/${j.id}`)).status,
        "submission_unknown",
      );
      const reconciling = await request(
        "POST",
        `${base}/generation-jobs/${j.id}/reconcile`,
      );
      assert.equal(reconciling.statusCode, 202, reconciling.body);
      await worker.process(j.id);
      await worker.reconcile(j.id);
      assert.equal(calls, before + 1);
      assert.equal(recoverCalls, 1);
      assert.equal(
        (await request("POST", `${base}/generation-jobs/${j.id}/cancel`))
          .statusCode,
        409,
      );
      behavior = "success";
      await worker.reconcile(j.id);
      assert.equal(calls, before + 1);
      assert.equal(
        (await ok("GET", `${base}/generation-jobs/${j.id}`)).status,
        "succeeded",
      );
    },
  );
  await t.test(
    "invalid output fails without creating a partial proposal or applying model-supplied identities",
    async () => {
      behavior = "invalid";
      const p = await prepare(),
        j = await execute(p.id);
      await worker.process(j.id);
      const result = await ok("GET", `${base}/generation-jobs/${j.id}`);
      assert.equal(result.status, "failed");
      assert.equal(result.errorCode, "INVALID_ASSISTANCE_OUTPUT");
      assert.equal(
        (
          await admin.query(
            `SELECT count(*) FROM "${schema}".analysis_proposals WHERE source_generation_job_id=$1`,
            [j.id],
          )
        ).rows[0].count,
        "0",
      );
    },
  );
  await t.test(
    "changed selected content blocks execution but does not erase the fixed plan",
    async () => {
      const p = await prepare();
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
      const response = await request("POST", `${base}/generation-jobs`, {
        planId: p.id,
      });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().code, "PLAN_INPUT_CHANGED");
      assert.equal(
        (await ok("GET", `${base}/generation-jobs/${job.id}`)).inputOutdated,
        true,
      );
      assert.equal(
        (
          await ok(
            "GET",
            `${base}/generation-jobs?projectId=${project.id}&planId=${plan.id}`,
          )
        ).items[0].inputOutdated,
        true,
      );
      assert.equal(
        (await ok("GET", `${base}/generation-plans/${p.id}`)).resolvedInput
          .contextSnapshots[0].text,
        p.resolvedInput.contextSnapshots[0].text,
      );
    },
  );

  await t.test(
    "a process lost after durable dispatch is never resubmitted, and late evidence completes the original job",
    async () => {
      behavior = "success";
      const p = await prepare(),
        j = await execute(p.id),
        token = randomUUID(),
        before = calls;
      const submission = (
        await pool.query(
          `SELECT "${schema}".claim_generation_job($1,$2) AS value`,
          [j.id, token],
        )
      ).rows[0].value;
      assert.equal(submission.attemptId, token);
      // Isolated fault fixture: advance only this durable attempt's deadline to model a dead process.
      const fault = await admin.connect();
      try {
        await fault.query("BEGIN");
        await fault.query(
          `ALTER TABLE "${schema}".generation_attempts DISABLE TRIGGER generation_attempt_fixed`,
        );
        await fault.query(
          `UPDATE "${schema}".generation_attempts SET deadline=now()-interval '1 second' WHERE id=$1`,
          [token],
        );
        await fault.query(
          `ALTER TABLE "${schema}".generation_attempts ENABLE TRIGGER generation_attempt_fixed`,
        );
        await fault.query("COMMIT");
      } finally {
        fault.release();
      }
      await worker.process(j.id);
      assert.equal(calls, before);
      assert.equal(
        (await ok("GET", `${base}/generation-jobs/${j.id}`)).status,
        "submission_unknown",
      );
      const receipt = {
        kind: "completed",
        correlation: token,
        output: { shots: [{ label: "迟到 01", intent: "原进程的晚到结果" }] },
      };
      await pool.query(
        `SELECT "${schema}".record_generation_evidence($1,$2,$3)`,
        [token, randomUUID(), receipt],
      );
      await worker.process(j.id);
      assert.equal(calls, before);
      assert.equal(
        (await ok("GET", `${base}/generation-jobs/${j.id}`)).status,
        "succeeded",
      );
      await pool.query(
        `SELECT "${schema}".record_generation_evidence($1,$2,$3)`,
        [token, randomUUID(), receipt],
      );
      assert.equal(
        (
          await admin.query(
            `SELECT count(*) FROM "${schema}".generation_submission_evidence WHERE attempt_id=$1`,
            [token],
          )
        ).rows[0].count,
        "1",
      );
    },
  );
  await t.test(
    "permission revocation rejects cached responses and cancels undispatched work without calling the adapter",
    async () => {
      const collaborator = await issueSession(
        auth,
        {
          issuer: "urn:test",
          subject: "generation-collaborator",
          email: "collaborator@example.test",
          emailVerified: true,
          displayName: "协作者",
        },
        { schema },
      );
      const membershipId = randomUUID();
      await admin.query(
        `INSERT INTO "${schema}".memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')`,
        [membershipId, tenant.id, collaborator.userId],
      );
      await admin.query(
        `INSERT INTO "${schema}".project_memberships(id,tenant_id,project_id,membership_id,role) VALUES($1,$2,$3,$4,'collaborator')`,
        [randomUUID(), tenant.id, project.id, membershipId],
      );
      const call = (
        method: "GET" | "POST",
        url: string,
        payload?: unknown,
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
          },
        });
      const key = randomUUID(),
        pr = await call("POST", `${base}/generation-plans`, input(), key);
      assert.equal(pr.statusCode, 201, pr.body);
      const p = pr.json();
      const er = await call("POST", `${base}/generation-jobs`, {
        planId: p.id,
      });
      assert.equal(er.statusCode, 202, er.body);
      const j = er.json(),
        before = calls;
      await admin.query(
        `DELETE FROM "${schema}".project_memberships WHERE membership_id=$1`,
        [membershipId],
      );
      assert.equal(
        (await call("GET", `${base}/generation-plans/${p.id}`)).statusCode,
        404,
      );
      assert.equal(
        (await call("GET", `${base}/generation-jobs/${j.id}`)).statusCode,
        404,
      );
      assert.equal(
        (await call("POST", `${base}/generation-plans`, input(), key))
          .statusCode,
        404,
      );
      await worker.process(j.id);
      assert.equal(calls, before);
      assert.equal(
        (await ok("GET", `${base}/generation-jobs/${j.id}`)).status,
        "cancelled",
      );
    },
  );

  await t.test(
    "unknown submissions retain inflight capacity until original evidence resolves them",
    async () => {
      behavior = "unknown";
      const jobs = [];
      for (let i = 0; i < 3; i++)
        jobs.push(await execute((await prepare()).id));
      const before = calls;
      await worker.process(jobs[0].id);
      await worker.process(jobs[1].id);
      await worker.process(jobs[2].id);
      assert.equal(calls, before + 2);
      assert.equal(
        (await ok("GET", `${base}/generation-jobs/${jobs[2].id}`)).status,
        "queued",
      );
      behavior = "success";
      await worker.reconcile(jobs[0].id);
      await worker.process(jobs[2].id);
      assert.equal(calls, before + 3);
      await worker.reconcile(jobs[1].id);
    },
  );
  await t.test(
    "late conflicting evidence preserves the first proposal and exposes reconciliation instead of rewriting history",
    async () => {
      behavior = "success";
      const j = await execute((await prepare()).id);
      await worker.process(j.id);
      const completed = await ok("GET", `${base}/generation-jobs/${j.id}`),
        attempt = last!.attemptId;
      await assert.rejects(
        pool.query(`SELECT "${schema}".record_generation_evidence($1,$2,$3)`, [
          attempt,
          randomUUID(),
          {
            kind: "rejected",
            correlation: randomUUID(),
            code: "WRONG_CORRELATION",
          },
        ]),
        (e) => (e as { code: string }).code === "23514",
      );
      await pool.query(
        `SELECT "${schema}".record_generation_evidence($1,$2,$3)`,
        [
          attempt,
          randomUUID(),
          {
            kind: "completed",
            correlation: attempt,
            output: { shots: [{ label: "冲突", intent: "不同结果" }] },
          },
        ],
      );
      await worker.process(j.id);
      const conflict = await ok("GET", `${base}/generation-jobs/${j.id}`);
      assert.equal(conflict.status, "reconciliation_required");
      assert.equal(conflict.proposalId, completed.proposalId);
      assert.equal(conflict.errorCode, "CONFLICTING_SUBMISSION_EVIDENCE");
      const proposal = await ok(
        "GET",
        `${path}/proposals/${conflict.proposalId}`,
      );
      assert.equal(proposal.operations[0].proposed.spec.intent, "她推门进屋");
    },
  );
  await t.test(
    "disabled or unverified capabilities cannot be submitted as available models",
    async () => {
      const p = await prepare();
      await admin.query(
        `UPDATE "${schema}".generation_capabilities SET enabled=false WHERE id=$1`,
        [capabilityId],
      );
      assert.deepEqual(
        (await ok("GET", `${base}/capabilities?projectId=${project.id}`)).items,
        [],
      );
      assert.equal(
        (await request("POST", `${base}/generation-jobs`, { planId: p.id }))
          .statusCode,
        409,
      );
      const blocked = await prepare();
      assert.equal(blocked.status, "blocked");
      assert.ok(blocked.blockingReasons.includes("MODEL_DISABLED"));
      await admin.query(
        `UPDATE "${schema}".generation_capabilities SET enabled=true WHERE id=$1`,
        [capabilityId],
      );
    },
  );

  await t.test(
    "a shared capability daily limit serializes simultaneous submissions from two projects",
    async () => {
      const other = await ok("POST", `${base}/projects`, {
          name: "另一个场次项目",
          leadMembershipId: member.id,
          spec: {
            width: 1080,
            height: 1920,
            fpsNum: 24,
            fpsDen: 1,
            language: "zh-CN",
          },
        }),
        otherPath = `${base}/projects/${other.id}`;
      const otherNext = async () =>
        (await ok("GET", `${otherPath}/content`)).revision;
      const otherScript = await ok(
        "POST",
        `${otherPath}/scripts`,
        { text: script.text },
        await otherNext(),
      );
      const otherEpisode = await ok(
        "POST",
        `${otherPath}/episodes`,
        { title: "一集", position: 0, status: "active" },
        await otherNext(),
      );
      const otherScene = await ok(
        "POST",
        `${otherPath}/scenes`,
        {
          episodeId: otherEpisode.id,
          title: "场次",
          position: 0,
          status: "active",
          summary: "独立场次",
          state: {},
        },
        await otherNext(),
      );
      const limited = randomUUID();
      await admin.query(
        `INSERT INTO "${schema}".generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,1)`,
        [
          limited,
          tenant.id,
          connectionId,
          connectionVersionId,
          {
            purpose: "script_analysis",
            modelVersion: "daily-cap-fixture",
            mode: "structured_text",
            supportedPurposes: [],
          },
        ],
      );
      const one = await ok("POST", `${base}/generation-plans`, {
          ...input(),
          capabilityId: limited,
        }),
        two = await ok("POST", `${base}/generation-plans`, {
          ...input(),
          capabilityId: limited,
          projectId: other.id,
          sourceScriptRevisionId: otherScript.id,
          proposalTarget: {
            mode: "append_to_scene",
            sceneId: otherScene.id,
            sceneRevision: otherScene.revision,
            episodeId: otherEpisode.id,
          },
          contextSources: [],
        });
      const responses = await Promise.all([
        request("POST", `${base}/generation-jobs`, { planId: one.id }),
        request("POST", `${base}/generation-jobs`, { planId: two.id }),
      ]);
      assert.deepEqual(responses.map((r) => r.statusCode).sort(), [202, 429]);
      assert.equal(
        responses.find((r) => r.statusCode === 429)!.json().code,
        "GENERATION_USAGE_LIMIT",
      );
      const count = await admin.query(
        `SELECT count(*) FROM "${schema}".generation_jobs j JOIN "${schema}".generation_plans p ON p.id=j.plan_id WHERE p.capability_id=$1`,
        [limited],
      );
      assert.equal(count.rows[0].count, "1");
    },
  );

  await t.test(
    "queued cancellation prevents an attempt and keeps the consumed plan bound to its original job",
    async () => {
      const p = await prepare(),
        j = await execute(p.id),
        before = calls;
      const response = await request(
        "POST",
        `${base}/generation-jobs/${j.id}/cancel`,
      );
      assert.equal(response.statusCode, 202, response.body);
      assert.equal(response.json().status, "cancelled");
      await worker.process(j.id);
      assert.equal(calls, before);
      assert.equal((await execute(p.id)).id, j.id);
      assert.equal(
        (
          await admin.query(
            `SELECT count(*) FROM "${schema}".generation_attempts WHERE job_id=$1`,
            [j.id],
          )
        ).rows[0].count,
        "0",
      );
    },
  );

  await t.test(
    "separate AI attempts with identical input retain independently editable proposals",
    async () => {
      behavior = "success";
      const proposals = [];
      for (let i = 0; i < 2; i++) {
        const j = await execute((await prepare()).id);
        await worker.process(j.id);
        const current = await ok("GET", `${base}/generation-jobs/${j.id}`);
        assert.equal(current.status, "succeeded");
        proposals.push(
          await ok("GET", `${path}/proposals/${current.proposalId}`),
        );
      }
      assert.equal(proposals[0].sourceHash, proposals[1].sourceHash);
      for (const proposal of proposals) {
        const result = await ok(
          "PUT",
          `${path}/proposals/${proposal.id}`,
          {
            baseContentRevision: proposal.baseContentRevision,
            target: proposal.target,
            operations: proposal.operations,
          },
          proposal.revision,
        );
        assert.equal(result.revision, 2);
      }
    },
  );
  await t.test(
    "restricted runtime cannot forge worker receipts or rewrite attempts",
    async () => {
      await assert.rejects(
        runtime.query(
          `SELECT "${schema}".record_generation_evidence($1,$2,$3)`,
          [
            last!.attemptId,
            randomUUID(),
            { kind: "completed", output: { shots: [] } },
          ],
        ),
        (e) => (e as { code: string }).code === "42501",
      );
      await assert.rejects(
        runtime.query(
          `UPDATE "${schema}".generation_attempts SET request_hash='rewrite'`,
        ),
        (e) => (e as { code: string }).code === "42501",
      );
      await assert.rejects(
        pool.query(`SELECT * FROM "${schema}".script_revisions`),
        (e) => (e as { code: string }).code === "42501",
      );
    },
  );
});
