import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  createAssistanceFixture,
  localAssistanceFixtureOutput,
  type AssistanceSubmission,
} from "@drama/provider";
import { imageGenerationFixture } from "../support/image-generation.js";
import { createAssistanceWorker } from "../../apps/api/src/modules/generation/worker.js";

test("canvas discussion persists source-less text, scoped history and exact follow-up execution", async (t) => {
  const f = await imageGenerationFixture(t),
    cap = randomUUID(),
    connection = randomUUID(),
    version = randomUUID();
  await f.admin.query(
    `INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
    [
      cap,
      f.tenant.id,
      connection,
      version,
      {
        purpose: "creative_assistance",
        mode: "discussion_fixture",
        modelVersion: "明确技术讨论fixture",
        supportedPurposes: ["composition"],
        maxReferences: 20,
      },
    ],
  );
  const ensured = await f.request(
    "POST",
    `${f.path}/scenes/${f.scene.id}/canvas`,
  );
  assert.equal(ensured.statusCode, 200, ensured.body);
  let canvas = ensured.json().canvas;
  const nodeId = randomUUID();
  const save = async (text: string) => {
    canvas = await f.ok(
      "PUT",
      `${f.path}/canvases/${canvas.id}`,
      {
        schemaVersion: 1,
        document: {
          nodes: [
            {
              id: nodeId,
              kind: "text",
              title: "不自动读取",
              position: { x: 0, y: 0 },
              width: 280,
              content: { type: "text", text },
            },
          ],
          edges: [],
          groups: [],
        },
      },
      canvas.revision,
    );
  };
  await save("未经选择的场次画面不得进入讨论");
  const input = (
    source?: { artifactId: string; revision: number },
    attach = false,
  ) => ({
    ...f.input,
    connectionId: connection,
    capabilityId: cap,
    purpose: "creative_assistance",
    output: {},
    shotSources: [],
    contextSources: [],
    prompt: source ? "继续讨论，但更简短" : "不附加节点的创作讨论",
    canvasSources: attach
      ? [{ canvasId: canvas.id, canvasRevision: canvas.revision, nodeId }]
      : [],
    assistance: { kind: "discuss", canvasId: canvas.id },
    ...(source ? { assistanceSource: source } : {}),
  });
  let calls = 0,
    unknown = false,
    invalid = false,
    last: AssistanceSubmission | undefined;
  const output = (s: AssistanceSubmission) =>
    invalid
      ? {
          ...localAssistanceFixtureOutput(s),
          message: "",
          prompt: "不得输出成可应用的提示",
        }
      : localAssistanceFixtureOutput(s);
  const worker = await createAssistanceWorker({
    pool: f.generationDb,
    schema: f.schema,
    adapters: [
      createAssistanceFixture(
        version,
        async (s) => {
          calls++;
          last = s;
          return unknown
            ? { kind: "unknown", correlation: s.attemptId }
            : {
                kind: "completed",
                correlation: s.attemptId,
                output: output(s),
              };
        },
        async (s) =>
          unknown
            ? null
            : {
                kind: "completed",
                correlation: s.attemptId,
                output: output(s),
              },
      ),
    ],
  });
  const plan = (body = input()) =>
    f.ok("POST", `${f.base}/generation-plans`, body);
  const finish = async (p: any) => {
    const j = await f.execute(p.id);
    await worker.process(j.id);
    const done = await f.job(j.id);
    assert.equal(done.status, "succeeded", JSON.stringify(done));
    return f.ok(
      "GET",
      `${f.path}/assistance-artifacts/${done.assistanceArtifactId}`,
    );
  };
  let first: any, second: any, firstPlan: any;
  await t.test(
    "zero attachments produce a true discussion reply, no implicit scene data or production effects",
    async () => {
      firstPlan = await plan();
      assert.equal(firstPlan.status, "ready");
      assert.deepEqual(firstPlan.resolvedInput.canvasScope, {
        canvasId: canvas.id,
        sceneId: f.scene.id,
      });
      assert.deepEqual(firstPlan.resolvedInput.shots, []);
      assert.deepEqual(firstPlan.resolvedInput.canvasSnapshots, []);
      assert.deepEqual(firstPlan.resolvedInput.references, []);
      assert.deepEqual(firstPlan.resolvedInput.contextSnapshots, []);
      assert.equal(firstPlan.resolvedInput.targetCapabilitySnapshot, undefined);
      first = await finish(firstPlan);
      assert.equal(first.request.kind, "discuss");
      assert.ok(first.body.message.includes("技术 fixture"));
      assert.equal(first.body.prompt, "");
      assert.deepEqual(last!.resolvedInput, firstPlan.resolvedInput);
      assert.equal(
        (await f.ok("GET", `${f.path}/canvases/${canvas.id}`)).revision,
        canvas.revision,
      );
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int n FROM ${f.scope}.generation_assistance_scopes WHERE plan_id=$1`,
            [firstPlan.id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int n FROM ${f.scope}.media WHERE source_job_id=$1`,
            [first.generationJobId],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "discussion cannot masquerade as a prepared media-prompt source",
    async () => {
      const denied = await f.request("POST", `${f.base}/generation-plans`, {
        ...f.input,
        assistanceSource: { artifactId: first.id, revision: 1 },
      });
      assert.equal(
        denied.json().code,
        "ASSISTANCE_SOURCE_UNAVAILABLE",
        denied.body,
      );
    },
  );
  await t.test(
    "fixed prior discussion survives node edits; new attachments remain independently explicit",
    async () => {
      const source = { artifactId: first.id, revision: 1 };
      await save("这次明确选择的新正文");
      const p = await plan(input(source, true));
      assert.deepEqual(p.resolvedInput.assistanceSnapshot, first.body);
      assert.equal(p.resolvedInput.assistanceInstruction, input().prompt);
      assert.equal(
        p.resolvedInput.canvasSnapshots[0].content.text,
        "这次明确选择的新正文",
      );
      second = await finish(p);
      assert.deepEqual(last!.resolvedInput.assistanceSnapshot, first.body);
      const history = await f.ok(
        "GET",
        `${f.path}/assistance-artifacts?canvasId=${canvas.id}&kind=discuss`,
      );
      assert.deepEqual(
        new Set(history.items.map((x: any) => x.id)),
        new Set([first.id, second.id]),
      );
      const other = await f.ok(
        "GET",
        `${f.path}/assistance-artifacts?canvasId=${randomUUID()}`,
      );
      assert.deepEqual(other.items, []);
      const edit = await f.request(
        "PUT",
        `${f.path}/assistance-artifacts/${first.id}`,
        { body: first.body },
        1,
      );
      assert.equal(edit.json().code, "DISCUSSION_IMMUTABLE");
      const apply = await f.request(
        "POST",
        `${f.path}/canvases/${canvas.id}/assistance-applications`,
        {
          applicationId: randomUUID(),
          artifactId: second.id,
          artifactRevision: 1,
          nodeId,
          mode: "replace",
        },
        canvas.revision,
      );
      assert.equal(
        apply.json().code,
        "CANVAS_ASSISTANCE_UNAVAILABLE",
        apply.body,
      );
    },
  );
  await t.test(
    "third-turn provider input contains both original exchanges in chronological order",
    async () => {
      const p = await plan(input({ artifactId: second.id, revision: 1 }));
      const expected = [
        {
          source: { artifactId: first.id, revision: 1 },
          instruction: input().prompt,
          message: first.body.message,
        },
        {
          source: { artifactId: second.id, revision: 1 },
          instruction: input({ artifactId: first.id, revision: 1 }).prompt,
          message: second.body.message,
        },
      ];
      assert.deepEqual(p.resolvedInput.assistanceHistory, expected);
      await finish(p);
      assert.deepEqual(last!.resolvedInput.assistanceHistory, expected);
      assert.deepEqual(
        last!.resolvedInput.dependencies
          .filter((d) => d.kind === "assistance_artifact")
          .map((d) => d.objectId),
        [first.id, second.id],
      );
    },
  );
  await t.test(
    "twenty fixed prior exchanges are accepted; the next round preserves input and fails explicitly",
    async () => {
      let advice = first;
      for (let n = 1; n <= 20; n++) {
        const p = await plan(input({ artifactId: advice.id, revision: 1 }));
        assert.equal(p.resolvedInput.assistanceHistory.length, n);
        advice = await finish(p);
      }
      const before = calls,
        body = input({ artifactId: advice.id, revision: 1 }),
        denied = await f.request("POST", `${f.base}/generation-plans`, body);
      assert.equal(denied.json().code, "ASSISTANCE_HISTORY_LIMIT", denied.body);
      assert.equal(calls, before);
      assert.equal(
        (await f.ok("GET", `${f.path}/assistance-artifacts/${advice.id}`)).body
          .message,
        advice.body.message,
      );
    },
  );
  await t.test(
    "new attachment freshness rejects changed nodes before execute, while historical text stays fixed",
    async () => {
      const p = await plan(input(undefined, true));
      await save("计划之后改变正文");
      const denied = await f.request("POST", `${f.base}/generation-jobs`, {
        planId: p.id,
      });
      assert.equal(denied.json().code, "PLAN_INPUT_CHANGED", denied.body);
      const p2 = await plan(input({ artifactId: second.id, revision: 1 }));
      assert.deepEqual(p2.resolvedInput.canvasSnapshots, []);
      assert.equal(
        p2.resolvedInput.assistanceSnapshot.message,
        second.body.message,
      );
    },
  );
  await t.test(
    "unknown discussion never resubmits and recovers its exact original output",
    async () => {
      unknown = true;
      const p = await plan(input({ artifactId: second.id, revision: 1 })),
        j = await f.execute(p.id),
        before = calls;
      await worker.process(j.id);
      await worker.process(j.id);
      assert.equal((await f.job(j.id)).status, "submission_unknown");
      unknown = false;
      await worker.reconcile(j.id);
      assert.equal((await f.job(j.id)).status, "succeeded");
      assert.equal(calls, before + 1);
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int n FROM ${f.scope}.generation_attempts WHERE job_id=$1`,
            [j.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "invalid discussion output fails without a misleading artifact",
    async () => {
      invalid = true;
      const j = await f.execute((await plan()).id);
      await worker.process(j.id);
      invalid = false;
      const result = await f.job(j.id);
      assert.equal(result.status, "failed");
      assert.equal(result.errorCode, "INVALID_ASSISTANCE_OUTPUT");
      assert.equal(result.assistanceArtifactId, undefined);
    },
  );
  await t.test(
    "restricted SQL rejects implicit source data, forged scope and missing typed scope",
    async () => {
      const original = await plan(),
        columns = (
          await f.admin.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='generation_plans' AND is_generated='NEVER' ORDER BY ordinal_position",
            [f.schema],
          )
        ).rows.map((r) => r.column_name as string);
      for (const change of ["implicit", "scope", "projection"]) {
        const sql = await f.runtime.connect();
        try {
          await sql.query("BEGIN");
          await sql.query(`SET LOCAL search_path TO ${f.scope},pg_catalog`);
          await sql.query(
            "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",
            [f.owner.userId, f.tenant.id],
          );
          const resolved = structuredClone(original.resolvedInput);
          if (change === "implicit") resolved.prompt = "未经过请求的场次内容";
          if (change === "scope") resolved.canvasScope.sceneId = randomUUID();
          const insert = () =>
            sql.query(
              `INSERT INTO generation_plans(${columns.map((c) => '"' + c + '"').join(",")}) SELECT ${columns.map((c) => (c === "id" ? "$2::uuid" : c === "resolved_input" ? "$3::jsonb" : c === "input_hash" ? "rework_input_hash(input,$3::jsonb,capability_revision,connection_version_id)" : '"' + c + '"')).join(",")} FROM generation_plans WHERE id=$1`,
              [original.id, randomUUID(), resolved],
            );
          if (change === "projection") {
            await insert();
            await assert.rejects(
              sql.query("SET CONSTRAINTS ALL IMMEDIATE"),
              (e: any) => e.code === "23514",
            );
          } else await assert.rejects(insert(), (e: any) => e.code === "23514");
        } finally {
          await sql.query("ROLLBACK");
          sql.release();
        }
      }
    },
  );
  await t.test(
    "restricted SQL cannot replace an ancestor question or answer under a recomputed hash",
    async () => {
      const original = await plan(
          input({ artifactId: second.id, revision: 1 }),
        ),
        columns = (
          await f.admin.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='generation_plans' AND is_generated='NEVER' ORDER BY ordinal_position",
            [f.schema],
          )
        ).rows.map((r) => r.column_name as string);
      for (const key of ["instruction", "message", "source"]) {
        const sql = await f.runtime.connect();
        try {
          await sql.query("BEGIN");
          await sql.query(`SET LOCAL search_path TO ${f.scope},pg_catalog`);
          await sql.query(
            "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",
            [f.owner.userId, f.tenant.id],
          );
          const resolved = structuredClone(original.resolvedInput);
          resolved.assistanceHistory[0][key] =
            key === "source"
              ? { artifactId: randomUUID(), revision: 1 }
              : "伪造祖先语境";
          await assert.rejects(
            sql.query(
              `INSERT INTO generation_plans(${columns.map((c) => '"' + c + '"').join(",")}) SELECT ${columns.map((c) => (c === "id" ? "$2::uuid" : c === "resolved_input" ? "$3::jsonb" : c === "input_hash" ? "rework_input_hash(input,$3::jsonb,capability_revision,connection_version_id)" : '"' + c + '"')).join(",")} FROM generation_plans WHERE id=$1`,
              [original.id, randomUUID(), resolved],
            ),
            (e: any) => e.code === "23514",
          );
        } finally {
          await sql.query("ROLLBACK");
          sql.release();
        }
      }
    },
  );
  await t.test(
    "scope is project-bound and a prior turn cannot cross projects or target modes",
    async () => {
      const elsewhere = await f.createProject("other discussion project");
      const foreign = await f.request("POST", `${f.base}/generation-plans`, {
        ...input(),
        projectId: elsewhere.id,
      });
      assert.equal(
        foreign.json().code,
        "CANVAS_CONTEXT_UNAVAILABLE",
        foreign.body,
      );
      const missing = await f.request(
        "POST",
        `${f.base}/generation-plans`,
        input({ artifactId: randomUUID(), revision: 1 }),
      );
      assert.equal(missing.json().code, "ASSISTANCE_REPLY_UNAVAILABLE");
      const wrong = await f.request("POST", `${f.base}/generation-plans`, {
        ...input({ artifactId: first.id, revision: 1 }, true),
        assistance: {
          kind: "prepare_prompt",
          targetCapabilityId: f.input.capabilityId,
          targetCapabilityRevision: 1,
        },
      });
      assert.equal(
        wrong.json().code,
        "ASSISTANCE_REPLY_TARGET_MISMATCH",
        wrong.body,
      );
    },
  );
  await t.test(
    "current revocation blocks cached prepare, history and the first queued provider call",
    async () => {
      const actor = await f.identity("discussion-collaborator"),
        membership = randomUUID();
      await f.admin.query(
        `INSERT INTO ${f.scope}.memberships(id,tenant_id,user_id,role,status) VALUES($1,$2,$3,'member','active')`,
        [membership, f.tenant.id, actor.userId],
      );
      await f.admin.query(
        `INSERT INTO ${f.scope}.project_memberships(id,tenant_id,project_id,membership_id,role) VALUES($1,$2,$3,$4,'collaborator')`,
        [randomUUID(), f.tenant.id, f.project.id, membership],
      );
      const body = input({ artifactId: first.id, revision: 1 }),
        key = randomUUID(),
        p = await f.request(
          "POST",
          `${f.base}/generation-plans`,
          body,
          undefined,
          key,
          actor,
        );
      assert.equal(p.statusCode, 201, p.body);
      const j = await f.request(
        "POST",
        `${f.base}/generation-jobs`,
        { planId: p.json().id },
        undefined,
        randomUUID(),
        actor,
      );
      assert.equal(j.statusCode, 202, j.body);
      await f.admin.query(
        `DELETE FROM ${f.scope}.project_memberships WHERE project_id=$1 AND membership_id=$2`,
        [f.project.id, membership],
      );
      for (const denied of [
        await f.request(
          "POST",
          `${f.base}/generation-plans`,
          body,
          undefined,
          key,
          actor,
        ),
        await f.request(
          "GET",
          `${f.path}/assistance-artifacts/${first.id}`,
          undefined,
          undefined,
          randomUUID(),
          actor,
        ),
      ])
        assert.ok([403, 404].includes(denied.statusCode), denied.body);
      const before = calls;
      await worker.process(j.json().id);
      assert.equal(calls, before);
      assert.equal(
        (
          await f.admin.query(
            `SELECT status FROM ${f.scope}.generation_jobs WHERE id=$1`,
            [j.json().id],
          )
        ).rows[0].status,
        "cancelled",
      );
    },
  );
  await t.test(
    "unavailable assistant blocks cached plan replay and queued discussion dispatch",
    async () => {
      const body = input(),
        key = randomUUID(),
        prepared = await f.request(
          "POST",
          `${f.base}/generation-plans`,
          body,
          undefined,
          key,
        );
      assert.equal(prepared.statusCode, 201, prepared.body);
      const j = await f.execute(prepared.json().id),
        before = calls;
      await f.admin.query(
        `UPDATE ${f.scope}.generation_capabilities SET enabled=false WHERE id=$1`,
        [cap],
      );
      assert.equal(
        (
          await f.request(
            "POST",
            `${f.base}/generation-plans`,
            body,
            undefined,
            key,
          )
        ).json().code,
        "MODEL_NOT_CONFIGURED",
      );
      await worker.process(j.id);
      assert.equal(calls, before);
      assert.equal((await f.job(j.id)).status, "cancelled");
      await f.admin.query(
        `UPDATE ${f.scope}.generation_capabilities SET enabled=true WHERE id=$1`,
        [cap],
      );
    },
  );
  await t.test(
    "a source-less continuation rechecks media in its fixed prior turn on replay, history and dispatch",
    async () => {
      const upload = randomUUID(),
        media = randomUUID(),
        mediaNode = randomUUID();
      await f.admin.query(
        `INSERT INTO ${f.scope}.upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch) VALUES($1,$2,$3,'project',$4,64,$5,'discussion.png','image/png','明确附件',$6,'accepted',now()+interval '15 minutes','fixture-version',1)`,
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
        `INSERT INTO ${f.scope}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio) VALUES($1,$2,$3,'project','image','ready','明确附件','discussion.png',$4,$5,$6,'fixture-version',$7,64,'image/png',32,32,false)`,
        [
          media,
          f.tenant.id,
          f.project.id,
          f.owner.userId,
          upload,
          `originals/${media}`,
          "a".repeat(64),
        ],
      );
      const document = structuredClone(canvas.document);
      document.nodes.push({
        id: mediaNode,
        kind: "image",
        title: "固定媒体附件",
        position: { x: 300, y: 0 },
        width: 280,
        content: { type: "media", mediaId: media },
      });
      canvas = await f.ok(
        "PUT",
        `${f.path}/canvases/${canvas.id}`,
        { schemaVersion: 1, document },
        canvas.revision,
      );
      const body = {
        ...input(),
        canvasSources: [
          {
            canvasId: canvas.id,
            canvasRevision: canvas.revision,
            nodeId: mediaNode,
            purpose: "composition",
          },
        ],
      };
      const originalAdvice = await finish(await plan(body)),
        advice = await finish(
          await plan(input({ artifactId: originalAdvice.id, revision: 1 })),
        ),
        reply = input({ artifactId: advice.id, revision: 1 }),
        key = randomUUID();
      const prepared = await f.request(
        "POST",
        `${f.base}/generation-plans`,
        reply,
        undefined,
        key,
      );
      assert.equal(prepared.statusCode, 201, prepared.body);
      const j = await f.execute(prepared.json().id),
        before = calls;
      await f.admin.query(
        `UPDATE ${f.scope}.media SET status='archived',revision=revision+1 WHERE id=$1`,
        [media],
      );
      for (const denied of [
        await f.request(
          "POST",
          `${f.base}/generation-plans`,
          reply,
          undefined,
          key,
        ),
        await f.request(
          "GET",
          `${f.base}/generation-plans/${prepared.json().id}`,
        ),
      ])
        assert.equal(
          denied.json().code,
          "ASSISTANCE_REPLY_UNAVAILABLE",
          denied.body,
        );
      await worker.process(j.id);
      assert.equal(calls, before);
      assert.equal(
        (
          await f.admin.query(
            `SELECT status FROM ${f.scope}.generation_jobs WHERE id=$1`,
            [j.id],
          )
        ).rows[0].status,
        "cancelled",
      );
    },
  );
  await t.test(
    "archived canvas parents reject preparation, execution and first dispatch; completed history is retained",
    async () => {
      const p = await plan(),
        queued = await f.execute((await plan()).id),
        before = calls;
      await f.ok(
        "PUT",
        `${f.path}/scenes/${f.scene.id}`,
        {
          episodeId: f.scene.episodeId,
          title: f.scene.title,
          summary: f.scene.summary,
          position: f.scene.position,
          state: f.scene.state,
          status: "archived",
        },
        f.scene.revision,
      );
      assert.equal(
        (await f.request("POST", `${f.base}/generation-plans`, input())).json()
          .code,
        "CANVAS_CONTEXT_UNAVAILABLE",
      );
      assert.equal(
        (
          await f.request("POST", `${f.base}/generation-jobs`, { planId: p.id })
        ).json().code,
        "CANVAS_CONTEXT_UNAVAILABLE",
      );
      await worker.process(queued.id);
      assert.equal(calls, before);
      assert.equal((await f.job(queued.id)).status, "cancelled");
      assert.equal(
        (await f.ok("GET", `${f.path}/assistance-artifacts/${first.id}`)).body
          .message,
        first.body.message,
      );
    },
  );
});
