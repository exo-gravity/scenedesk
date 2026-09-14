import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createAssistanceFixture } from "@drama/provider";
import { imageGenerationFixture } from "../support/image-generation.js";
import { createAssistanceWorker } from "../../apps/api/src/modules/generation/worker.js";

test("discussion guards preserve text-only effects and bounded authorized history", async (t) => {
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
        mode: "discussion_guard_fixture",
        modelVersion: "仅验证事务及固定讨论文本",
        supportedPurposes: [],
        maxReferences: 0,
      },
    ],
  );
  const ensure = await f.request(
    "POST",
    `${f.path}/scenes/${f.scene.id}/canvas`,
  );
  assert.equal(ensure.statusCode, 200, ensure.body);
  const canvas = ensure.json().canvas;
  const input = (extra: Record<string, unknown> = {}) => ({
    ...f.input,
    connectionId: connection,
    capabilityId: cap,
    purpose: "creative_assistance",
    output: {},
    shotSources: [],
    canvasSources: [],
    contextSources: [],
    prompt: "固定技术讨论",
    assistance: { kind: "discuss", canvasId: canvas.id },
    ...extra,
  });
  let message = "明确技术 fixture 回复，未修改任何内容";
  const worker = await createAssistanceWorker({
    pool: f.generationDb,
    schema: f.schema,
    adapters: [
      createAssistanceFixture(version, async (s) => ({
        kind: "completed",
        correlation: s.attemptId,
        output: {
          message,
          prompt: "",
          notes: "",
          retain: [],
          change: [],
          referenceSuggestions: [],
        },
      })),
    ],
  });
  const plan = (body = input()) =>
    f.ok("POST", `${f.base}/generation-plans`, body);
  const finish = async (p: any) => {
    const j = await f.execute(p.id);
    await worker.process(j.id);
    const done = await f.job(j.id);
    assert.equal(done.status, "succeeded", JSON.stringify(done));
    return done.assistanceArtifactId as string;
  };
  const original = await finish(await plan());
  await t.test(
    "runtime cannot append discussion edits or apply its message to a canvas",
    async () => {
      for (const mode of ["revision", "application"]) {
        const sql = await f.runtime.connect();
        try {
          await sql.query("BEGIN");
          await sql.query(`SET LOCAL search_path TO ${f.scope},pg_catalog`);
          await sql.query(
            "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",
            [f.owner.userId, f.tenant.id],
          );
          if (mode === "revision")
            await assert.rejects(
              sql.query(
                "INSERT INTO assistance_artifact_revisions(tenant_id,project_id,artifact_id,number,body,edited_by) SELECT tenant_id,project_id,artifact_id,2,body,$2 FROM assistance_artifact_revisions WHERE artifact_id=$1 AND number=1",
                [original, f.owner.userId],
              ),
              (e: any) => e.code === "23514",
            );
          else
            await assert.rejects(
              sql.query(
                "INSERT INTO canvas_assistance_applications(id,tenant_id,project_id,canvas_id,node_id,artifact_id,artifact_revision,mode,base_revision,result_revision,before_prompt,after_prompt,created_by) VALUES($1,$2,$3,$4,$5,$6,1,'replace',1,2,'','invalid application',$7)",
                [
                  randomUUID(),
                  f.tenant.id,
                  f.project.id,
                  canvas.id,
                  randomUUID(),
                  original,
                  f.owner.userId,
                ],
              ),
              (e: any) => e.code === "23514",
            );
        } finally {
          await sql.query("ROLLBACK");
          sql.release();
        }
      }
      assert.equal(
        (await f.ok("GET", `${f.path}/canvases/${canvas.id}`)).revision,
        canvas.revision,
      );
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int n FROM ${f.scope}.assistance_artifact_revisions WHERE artifact_id=$1`,
            [original],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "trusted worker SQL cannot turn a discussion receipt into an applicable prompt",
    async () => {
      const j = await f.execute((await plan()).id),
        s = (
          await f.generationDb.query(
            `SELECT ${f.scope}.claim_generation_job($1,$2) AS data`,
            [j.id, randomUUID()],
          )
        ).rows[0].data;
      const output = {
        message: "原讨论正文",
        prompt: "禁止混入可应用文字",
        notes: "",
        retain: [],
        change: [],
        referenceSuggestions: [],
      };
      const receipt = (
        await f.generationDb.query(
          `SELECT ${f.scope}.record_generation_evidence($1,$2,$3) AS id`,
          [
            s.attemptId,
            randomUUID(),
            { kind: "completed", correlation: s.attemptId, output },
          ],
        )
      ).rows[0].id;
      await assert.rejects(
        f.generationDb.query(
          `SELECT ${f.scope}.finish_generation_job($1,$2,$3,NULL)`,
          [j.id, receipt, output],
        ),
        (e: any) => e.code === "23514",
      );
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int n FROM ${f.scope}.assistance_artifacts WHERE generation_job_id=$1`,
            [j.id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "a real completed foreign-project discussion cannot enter the fixed ancestor chain",
    async () => {
      const project = await f.createProject("独立讨论项目"),
        path = `${f.base}/projects/${project.id}`;
      const episode = await f.ok(
        "POST",
        `${path}/episodes`,
        { title: "一", position: 0, status: "active" },
        (await f.ok("GET", `${path}/content`)).revision,
      );
      const scene = await f.ok(
        "POST",
        `${path}/scenes`,
        {
          episodeId: episode.id,
          title: "另一个讨论范围",
          summary: "",
          position: 0,
          status: "active",
          state: {},
        },
        (await f.ok("GET", `${path}/content`)).revision,
      );
      const c = await f.request("POST", `${path}/scenes/${scene.id}/canvas`);
      assert.equal(c.statusCode, 200, c.body);
      const foreign = await finish(
        await plan(
          input({
            projectId: project.id,
            assistance: { kind: "discuss", canvasId: c.json().canvas.id },
          }),
        ),
      );
      const denied = await f.request(
        "POST",
        `${f.base}/generation-plans`,
        input({ assistanceSource: { artifactId: foreign, revision: 1 } }),
      );
      assert.equal(
        denied.json().code,
        "ASSISTANCE_REPLY_UNAVAILABLE",
        denied.body,
      );
    },
  );
  await t.test(
    "the complete fixed text budget rejects excess rather than dropping an ancestor",
    async () => {
      message = "m".repeat(18000);
      const prompt = "u".repeat(15000);
      const first = await finish(await plan(input({ prompt })));
      const secondPlan = await plan(
        input({ prompt, assistanceSource: { artifactId: first, revision: 1 } }),
      );
      assert.ok(
        Buffer.byteLength(JSON.stringify(secondPlan.resolvedInput)) <= 100000,
      );
      const second = await finish(secondPlan);
      const denied = await f.request(
        "POST",
        `${f.base}/generation-plans`,
        input({
          prompt,
          assistanceSource: { artifactId: second, revision: 1 },
        }),
      );
      assert.equal(denied.json().code, "ASSISTANCE_INPUT_LIMIT", denied.body);
    },
  );
});
