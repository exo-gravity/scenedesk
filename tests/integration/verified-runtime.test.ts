import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { grantGenerationWorkerAccess, sqlIdentifier } from "@drama/database";
import { capabilityDefinition, findProfile, parseGenerationVendors } from "@drama/provider";
import { businessFixture } from "../support/business.js";
import { imageGenerationFixture } from "../support/image-generation.js";
import { createVerifiedGenerationRuntime } from "../../apps/worker/src/verified-runtime.js";
import { fakeArk } from "../helpers/fake-ark.js";

test("read_generation_media_sources is worker-only and returns [] for unknown jobs; lease is 180s", async (t) => {
  const f = await businessFixture(t);
  const role = `vgen_${randomBytes(6).toString("hex")}`, password = randomBytes(24).toString("hex");
  await f.admin.query(`CREATE ROLE ${sqlIdentifier(role)} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT PASSWORD '${password}'`);
  const grant = await f.admin.connect();
  try { await grantGenerationWorkerAccess(grant, f.schema, role); } finally { grant.release(); }
  const url = new URL(process.env.DATABASE_URL!); url.username = role; url.password = password;
  const worker = new Pool({ connectionString: url.href, max: 1 });
  t.after(async () => { await worker.end(); const c = new Pool({ connectionString: process.env.DATABASE_URL }); try { await c.query(`DROP OWNED BY ${sqlIdentifier(role)}`); await c.query(`DROP ROLE ${sqlIdentifier(role)}`); } finally { await c.end(); } });
  const empty = await worker.query(`SELECT ${sqlIdentifier(f.schema)}.read_generation_media_sources($1) AS v`, [randomUUID()]);
  assert.deepEqual(empty.rows[0].v, []);
  // f.admin is a Postgres superuser and bypasses REVOKE ALL ... FROM PUBLIC, so this 42501
  // can only come from the function body's own generation_worker_login() check, not the grant.
  await assert.rejects(
    f.admin.query(`SELECT ${sqlIdentifier(f.schema)}.read_generation_media_sources($1)`, [randomUUID()]),
    (e: unknown) => (e as { code?: string }).code === "42501" && /Worker access required/.test(String(e)),
  );
  const source = await f.admin.query(
    `SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname='claim_generation_observation' AND n.nspname=$1`,
    [f.schema],
  );
  assert.match(source.rows[0].prosrc, /interval '180 seconds'/);
});

test("verified runtime: Seedance job with a reference image is accepted, polled, archived into the private store and reaches archiving", async (t) => {
  const published: unknown[] = [];
  const png = Buffer.from("png-bytes");
  const store = {
    verify: async () => undefined,
    async publish(_file: string, data: { bytes: number; sha256: string; mime: string }) {
      published.push(data);
      return { key: `originals/${randomUUID()}`, versionId: "v1", bytes: data.bytes, sha256: data.sha256 };
    },
    async download(_source: unknown, file: string) {
      await writeFile(file, png);
    },
    close() {},
  } as any;
  const f = await imageGenerationFixture(t, store, { purpose: "video", generationExecutor: true });
  const ark = await fakeArk();
  t.after(ark.close);
  const connectionVersionId = randomUUID(), capabilityId = randomUUID();
  await f.admin.query(
    `INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'verified_provider',true,3,200)`,
    [
      capabilityId,
      f.tenant.id,
      f.input.connectionId,
      connectionVersionId,
      capabilityDefinition(findProfile("volcengine/doubao-seedance-2-0-mini-260615")!, "reference_v1", { verifiedAt: new Date().toISOString() }),
    ],
  );
  // The production executor learns provisioned verified connections through this worker-only
  // function rather than reading the tenant-scoped generation_capabilities table directly.
  const verifiedConnections = await f.generationDb.query(
    `SELECT ${f.scope}.list_verified_connection_versions()::text AS id`,
  );
  assert.ok(verifiedConnections.rows.some((row) => row.id === connectionVersionId));
  // Seed one ready reference image, following the upload_intents + media pattern used by
  // tests/integration/canvas-assistance-replies.test.ts, but sized to satisfy the profile's
  // 300px minimum side so read_generation_media_sources' real body actually runs.
  const mediaId = randomUUID(), uploadId = randomUUID(), sha256 = createHash("sha256").update(png).digest("hex");
  await f.admin.query(
    `INSERT INTO ${f.scope}.upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch) VALUES($1,$2,$3,'project',$4,$5,$6,'reference.png','image/png','参考图片',$7,'accepted',now()+interval '15 minutes','fixture-version',1)`,
    [uploadId, f.tenant.id, f.project.id, `staging/${uploadId}`, png.length, sha256, f.owner.userId],
  );
  await f.admin.query(
    `INSERT INTO ${f.scope}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio) VALUES($1,$2,$3,'project','image','ready','参考图片','reference.png',$4,$5,$6,'fixture-version',$7,$8,'image/png',1024,1024,false)`,
    [mediaId, f.tenant.id, f.project.id, f.owner.userId, uploadId, `originals/${mediaId}`, sha256, png.length],
  );
  const plan = await f.ok("POST", `${f.base}/generation-plans`, {
    ...f.input,
    capabilityId,
    additionalReferences: [{ mediaId, purpose: "identity" }],
    output: { resolution: "720x1280", aspectRatio: "9:16", durationSeconds: 5, withAudio: true },
  });
  assert.equal(plan.status, "ready");
  const job = (await f.request("POST", `${f.base}/generation-jobs`, { planId: plan.id })).json();
  const runtime = await createVerifiedGenerationRuntime({
    pool: f.generationDb,
    schema: f.schema,
    queueSchema: f.queueSchema,
    store,
    tmpdir: await mkdtemp(join(tmpdir(), "verified-e2e-")),
    config: parseGenerationVendors({
      vendors: { volcengine: { apiKey: "k", baseUrl: `${ark.origin}/api/v3` } },
      connections: [{ vendor: "volcengine", connectionId: f.input.connectionId, connectionVersionId, accountIdentityLabel: "test" }],
    }),
  });
  t.after(runtime.close);
  await runtime.scanOnce();
  assert.equal((await f.job(job.id)).status, "provider_pending");
  const posts = ark.calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 1);
  const body = posts[0]!.body;
  assert.deepEqual([body.model, body.resolution, body.ratio], ["doubao-seedance-2-0-mini-260615", "720p", "9:16"]);
  assert.equal(body.content[1].role, "reference_image");
  assert.match(body.content[1].image_url.url, /^data:image\/png;base64,/);
  assert.ok(
    (body.content[0].text as string).endsWith("参考素材：图片1为角色形象参考。"),
    `unexpected prompt text: ${body.content[0].text}`,
  );
  ark.setStatus("succeeded");
  await f.admin.query(`UPDATE ${f.scope}.generation_observation_control SET next_observation_at=now() WHERE job_id=$1`, [job.id]);
  await runtime.scanOnce();
  const done = await f.job(job.id);
  assert.equal(done.status, "archiving");
  assert.equal(done.providerJobId, "cgt-1");
  assert.equal(published.length, 1);
  assert.equal((published[0] as { mime: string }).mime, "video/mp4");
});
