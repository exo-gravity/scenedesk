import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { TestContext } from "node:test";
import type { LightMyRequestResponse } from "fastify";
import { Pool } from "pg";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { grantGenerationWorkerAccess, grantMediaWorkerAccess, sqlIdentifier } from "@drama/database";
import { createScheduler, grantQueueAccess, installQueue } from "@drama/queue";
import { createMediaProcessor, MediaStore } from "@drama/media";
import { businessFixture } from "../../../tests/support/business.js";
import { buildApp } from "../../../apps/api/src/app.js";
import { Secrets } from "../../../apps/api/src/kernel/crypto.js";
import type { RecoveryConfig } from "./fixture.js";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function tinyPng() {
  // Independently constructed, deterministic test pixels. No generated artwork or model.
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const tag = Buffer.from(type), n = Buffer.alloc(4), checksum = Buffer.alloc(4);
    n.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([tag, data])));
    return Buffer.concat([n, tag, data, checksum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(32, 0); ihdr.writeUInt32BE(32, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((32 * 3 + 1) * 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) raw.set([35, 85, 165], y * 97 + 1 + x * 3);
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const storeFor = (config: RecoveryConfig) => new MediaStore({ endpoint: config.storage.endpoint, region: config.storage.region, bucket: config.storage.bucket, credentials: { accessKeyId: config.storage.accessKeyId, secretAccessKey: config.storage.secretAccessKey }, local: true });

type Source = { config: RecoveryConfig; url: string; client: S3Client };
export async function seedBusiness(source: Source) {
  const closes: (() => Promise<unknown>)[] = [], stops: (() => Promise<unknown>)[] = [];
  try { return await seed(source, closes, stops); }
  finally {
    const failures: unknown[] = [];
    for (const close of [...stops.reverse(), ...closes]) await close().catch(error => failures.push(error));
    assert.equal(failures.length, 0, "All seed processes and connections must close before backup");
  }
}
async function seed(source: Source, closes: (() => Promise<unknown>)[], stops: (() => Promise<unknown>)[]) {
  const poolCredentials: { role: string; password: string }[] = [], errors: Error[] = [];
  // Fixture owns entire private Docker volumes; do not register shared-database cleanup.
  const context = { after: () => {} } as unknown as TestContext;
  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = source.url;
  const store = storeFor(source.config);
  closes.push(async () => store.close());
  const suffix = randomBytes(5).toString("hex"), queueSchema = `scenedesk_queue_${suffix}`;
  const mediaRole = `recovery_media_${suffix}`, schedulerRole = `recovery_sched_${suffix}`, generationRole = `recovery_gen_${suffix}`;
  let mediaDb!: Pool, generationDb!: Pool;
  let f: Awaited<ReturnType<typeof businessFixture>>;
  try {
    f = await businessFixture(context, async db => {
      closes.push(() => db.runtime.end(), () => db.auth.end(), () => db.admin.end());
      for (const role of [mediaRole, schedulerRole, generationRole]) {
        const password = randomBytes(24).toString("hex");
        await db.admin.query(`CREATE ROLE ${sqlIdentifier(role)} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '${password}'`);
        poolCredentials.push({ role, password });
        if (role !== schedulerRole) {
          const url = new URL(source.url); url.username = role; url.password = password;
          const pool = new Pool({ connectionString: url.href, max: 2 }); closes.push(() => pool.end());
          if (role === mediaRole) mediaDb = pool; else generationDb = pool;
        }
      }
      await installQueue(db.admin, queueSchema);
      const grant = await db.admin.connect();
      try {
        await grantMediaWorkerAccess(grant, db.schema, mediaRole, schedulerRole);
        await grantGenerationWorkerAccess(grant, db.schema, generationRole);
        await grantQueueAccess(grant, queueSchema, db.apiRole, schedulerRole);
        await grantQueueAccess(grant, queueSchema, mediaRole, schedulerRole);
      } finally { grant.release(); }
      const producer = await createScheduler(db.runtime, { schema: queueSchema, onError: error => errors.push(error) });
      stops.push(producer.close);
      return { media: { store, schedule: producer.schedule } };
    });
  } finally {
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
  }
  // Explicitly close every fixture handle before taking the cold paired backup.
  stops.push(() => f!.app.close());
  source.config.database.schema = f.schema;
  for (const pool of [f.runtime, f.auth]) {
    const url = new URL(pool.options.connectionString!);
    poolCredentials.push({ role: decodeURIComponent(url.username), password: decodeURIComponent(url.password) });
  }
  const scope = sqlIdentifier(f.schema), base = `/v1/tenants/${f.tenant.id}`;
  const episode = await f.ok("POST", `${f.path}/episodes`, { title: "恢复演练", position: 0, status: "active" }, await f.next());
  const scene = await f.ok("POST", `${f.path}/scenes`, { episodeId: episode.id, title: "原身份", summary: "合成私有内容", position: 0, state: {}, status: "active" }, await f.next());
  const shot = await f.ok("POST", `${f.path}/shots`, { sceneId: scene.id, label: "01", position: 0, status: "active", spec: { intent: "恢复前的固定原文", references: [] } }, await f.next());
  const newerShot = await f.ok("PUT", `${f.path}/shots/${shot.id}`, { sceneId: scene.id, label: "01", position: 0, status: "active", spec: { intent: "恢复前已更新的当前原文", references: [] } }, shot.revision);
  const ensured = await f.request("POST", `${f.path}/scenes/${scene.id}/canvas`); assert.equal(ensured.statusCode, 200);
  let canvas = ensured.json().canvas;
  const canvasPath = `${f.path}/canvases/${canvas.id}`, nodeId = randomUUID();
  const oldDocument = { nodes: [{ id: nodeId, kind: "text", title: "原记录", position: { x: -40, y: 80 }, width: 320, content: { type: "text", text: "备份前的画布历史，不得替换" } }], edges: [], groups: [] };
  canvas = await f.ok("PUT", canvasPath, { schemaVersion: 1, document: oldDocument }, canvas.revision);
  const historical = await f.ok("GET", `${canvasPath}/revisions/${canvas.revision}`);
  const currentDocument = structuredClone(oldDocument); currentDocument.nodes[0]!.content.text = "当前画布正文";
  canvas = await f.ok("PUT", canvasPath, { schemaVersion: 1, document: currentDocument }, canvas.revision);

  const producer = await createScheduler(mediaDb, { schema: queueSchema, onError: error => errors.push(error) }); stops.push(producer.close);
  const processMedia = await createMediaProcessor({ pool: mediaDb, schema: f.schema, store, schedule: producer.schedule });
  const bytes = tinyPng();
  const intent = await f.ok("POST", `${base}/uploads`, { scope: "project", projectId: f.project.id, fileName: "recovery-synthetic.png", mime: "image/png", bytes: bytes.length, sha256: sha(bytes) });
  const form = new FormData(); for (const [key, value] of Object.entries(intent.formFields)) form.append(key, String(value));
  form.append("file", new Blob([new Uint8Array(bytes)]), "recovery-synthetic.png");
  const uploaded = await fetch(intent.uploadUrl, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) }); assert.equal(uploaded.status, 204); await uploaded.body?.cancel();
  const completed = await f.request("POST", `${base}/uploads/${intent.id}/complete`, { bytes: bytes.length, sha256: sha(bytes) }); assert.equal(completed.statusCode, 202);
  const mediaId = completed.json().mediaId;
  await processMedia({ taskKind: "media_probe", businessId: intent.id, stepRevision: 1, epoch: 1 }, { signal: AbortSignal.timeout(90_000), queueJobId: randomUUID() });
  let media = await f.ok("GET", `${base}/media/${mediaId}`); assert.equal(media.status, "ready");
  for (const derivative of media.derivatives) await processMedia({ taskKind: "media_derivative", businessId: derivative.id, stepRevision: 1, epoch: 1 }, { signal: AbortSignal.timeout(90_000), queueJobId: randomUUID() });
  media = await f.ok("GET", `${base}/media/${mediaId}`); assert.equal(media.derivatives[0].status, "ready");
  const reference = (await f.admin.query(`SELECT immutable_key,storage_version_id,bytes,sha256 FROM ${scope}.media WHERE id=$1`, [mediaId])).rows[0];
  assert.equal(reference.sha256, sha(bytes));
  // A later version intentionally differs. Restoring latest-by-key is observably wrong.
  const latest = await source.client.send(new PutObjectCommand({ Bucket: source.config.storage.bucket, Key: reference.immutable_key, Body: Buffer.from("newer unrelated object version"), ContentType: "text/plain" }));
  assert.notEqual(latest.VersionId, reference.storage_version_id);
  const markerKey = `originals/${randomUUID()}`;
  const hiddenVersion = await source.client.send(new PutObjectCommand({ Bucket: source.config.storage.bucket, Key: markerKey, Body: Buffer.from("unreferenced historical bytes"), ContentType: "text/plain" }));
  const deleteMarker = await source.client.send(new DeleteObjectCommand({ Bucket: source.config.storage.bucket, Key: markerKey }));
  assert.equal(deleteMarker.DeleteMarker, true); assert.ok(deleteMarker.VersionId); assert.ok(hiddenVersion.VersionId);
  const exact = await source.client.send(new GetObjectCommand({ Bucket: source.config.storage.bucket, Key: reference.immutable_key, VersionId: reference.storage_version_id }));
  assert.deepEqual(Buffer.from(await exact.Body!.transformToByteArray()), bytes);
  const stranger = await f.identity("recovery-no-project-membership");
  assert.equal((await f.request("GET", canvasPath, undefined, undefined, undefined, stranger)).statusCode, 404);

  // These are synthetic durable facts through restricted functions, never an executor.
  const capabilityId = randomUUID(), connectionId = randomUUID(), connectionVersionId = randomUUID();
  await f.admin.query(`INSERT INTO ${scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,10)`, [capabilityId, f.tenant.id, connectionId, connectionVersionId, { purpose: "creative_assistance", mode: "structured_text_fixture", modelVersion: "仅备份恢复事实，无执行器", supportedPurposes: [] }]);
  const targetCapabilityId = randomUUID();
  await f.admin.query(`INSERT INTO ${scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,10)`, [targetCapabilityId, f.tenant.id, randomUUID(), randomUUID(), { purpose: "image", mode: "image_fixture_v1", modelVersion: "仅目标能力定义，无执行器", supportedPurposes: ["composition"], maxReferences: 2, allowedResolutions: ["32x32"], allowedAspectRatios: ["1:1"] }]);
  const planInput = { scope: "project", projectId: f.project.id, purpose: "creative_assistance", connectionId, capabilityId, shotSources: [{ shotId: shot.id, shotRevisionId: shot.specRevisionId }], contextSources: [], additionalReferences: [], referenceOverrides: [], prompt: "固定原请求", promptPolicy: "append", output: {}, assistance: { kind: "prepare_prompt", targetCapabilityId, targetCapabilityRevision: 1 } };
  const jobs: any[] = [];
  for (let i = 0; i < 2; i++) {
    const plan = await f.ok("POST", `${base}/generation-plans`, planInput); assert.equal(plan.status, "ready", JSON.stringify(plan.blockingReasons));
    const response = await f.request("POST", `${base}/generation-jobs`, { planId: plan.id }); assert.equal(response.statusCode, 202); jobs.push(response.json());
  }
  const claimed = (await generationDb.query(`SELECT ${scope}.claim_generation_job($1,$2) AS data`, [jobs[1].id, randomUUID()])).rows[0].data;
  const receipt = (await generationDb.query(`SELECT ${scope}.record_generation_evidence($1,$2,$3) AS id`, [claimed.attemptId, randomUUID(), { kind: "unknown", correlation: claimed.attemptId }])).rows[0].id;
  await generationDb.query(`SELECT ${scope}.finish_generation_job($1,$2,NULL,NULL)`, [jobs[1].id, receipt]);
  const queued = await f.ok("GET", `${base}/generation-jobs/${jobs[0].id}`), unknown = await f.ok("GET", `${base}/generation-jobs/${jobs[1].id}`);
  assert.equal(queued.status, "queued"); assert.equal(unknown.status, "submission_unknown");
  const roles = (await f.admin.query("SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles WHERE rolname !~ '^pg_' AND rolname<>'postgres' ORDER BY rolname")).rows;
  const readbacks = [
    { path: `${f.path}/shots/${shot.id}/revisions/${shot.specRevisionId}`, body: await f.ok("GET", `${f.path}/shots/${shot.id}/revisions/${shot.specRevisionId}`) },
    { path: `${f.path}/shots/${shot.id}/revisions/${newerShot.specRevisionId}`, body: await f.ok("GET", `${f.path}/shots/${shot.id}/revisions/${newerShot.specRevisionId}`) },
    { path: canvasPath, body: canvas }, { path: `${canvasPath}/revisions/${historical.revision}`, body: historical },
    { path: `${base}/media/${mediaId}`, body: media },
    { path: `${base}/generation-jobs/${queued.id}`, body: queued }, { path: `${base}/generation-jobs/${unknown.id}`, body: unknown },
  ];
  assert.deepEqual(errors, []);
  return { schema: f.schema, apiRole: f.apiRole, poolCredentials, owner: f.owner, stranger, projectPath: f.path, base, canvasPath, mediaId, reference, bytes, roles, readbacks, queueSchema, queuedId: queued.id, unknownId: unknown.id, unknownAttemptId: claimed.attemptId, marker: { key: markerKey, versionId: deleteMarker.VersionId!, previousVersionId: hiddenVersion.VersionId! }, noGenerationExecutorStarted: true as const };
}

export async function verifyBusiness(target: { config: RecoveryConfig; url: string; client: S3Client }, seeded: Awaited<ReturnType<typeof seedBusiness>>) {
  const admin = new Pool({ connectionString: target.url, max: 1 });
  const store = storeFor(target.config);
  let runtime: Pool | undefined, app: ReturnType<typeof buildApp> | undefined;
  try {
    const roles = (await admin.query("SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles WHERE rolname !~ '^pg_' AND rolname<>'postgres' ORDER BY rolname")).rows;
    assert.deepEqual(roles, seeded.roles, "Restore preserves precise role attributes before operator reprovision");
    // Private fixture credentials are supplied again; role passwords are absent from the bundle.
    for (const { role, password } of seeded.poolCredentials) await admin.query(`ALTER ROLE ${sqlIdentifier(role)} PASSWORD '${password}'`);
    const credential = seeded.poolCredentials.find(x => x.role === seeded.apiRole)!;
    const runtimeUrl = new URL(target.url); runtimeUrl.username = credential.role; runtimeUrl.password = credential.password;
    runtime = new Pool({ connectionString: runtimeUrl.href, max: 2 });
    const origin = "http://127.0.0.1:4399", secret = randomBytes(32).toString("base64url"), secrets = new Secrets(secret);
    app = buildApp(runtime, { schema: seeded.schema, origin, secret, media: { store, schedule: async () => { throw Error("RESTORE_WRITES_DISABLED"); } } });
    await app.ready();
    for (const read of seeded.readbacks) {
      const response: LightMyRequestResponse = await app.inject({ method: "GET", url: read.path, headers: { cookie: `session=${seeded.owner.token}` } });
      assert.equal(response.statusCode, 200, `Restored GET ${read.path}`); assert.deepEqual(response.json(), read.body);
    }
    for (const url of [seeded.canvasPath, `${seeded.base}/media/${seeded.mediaId}`]) {
      const response = await app.inject({ method: "GET", url, headers: { cookie: `session=${seeded.stranger.token}` } });
      assert.ok([403, 404].includes(response.statusCode), "Restored unprivileged identity cannot read private content");
    }
    const grant = await app.inject({ method: "POST", url: `${seeded.base}/media/${seeded.mediaId}/access`, payload: { variant: "original", disposition: "inline" }, headers: { cookie: `session=${seeded.owner.token}`, origin, "x-csrf-token": secrets.csrf(seeded.owner.token), "idempotency-key": randomUUID() } });
    assert.equal(grant.statusCode, 200);
    const url = new URL(grant.json().url); assert.equal(url.searchParams.get("versionId"), seeded.reference.storage_version_id);
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) }); assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.length, seeded.bytes.length); assert.equal(sha(bytes), seeded.reference.sha256); assert.deepEqual(bytes, seeded.bytes);
    const hidden = await target.client.send(new GetObjectCommand({ Bucket: target.config.storage.bucket, Key: seeded.marker.key, VersionId: seeded.marker.previousVersionId }));
    assert.equal(await hidden.Body!.transformToString(), "unreferenced historical bytes");
    await assert.rejects(target.client.send(new GetObjectCommand({ Bucket: target.config.storage.bucket, Key: seeded.marker.key })), (error: any) => error?.$metadata?.httpStatusCode === 404);
    const scope = sqlIdentifier(seeded.schema);
    await assert.rejects(runtime.query(`UPDATE ${scope}.generation_jobs SET status='queued' WHERE id=$1`, [seeded.unknownId]), /permission denied/);
    const attempts = await admin.query(`SELECT id FROM ${scope}.generation_attempts WHERE job_id=$1`, [seeded.unknownId]); assert.deepEqual(attempts.rows.map(row => row.id), [seeded.unknownAttemptId]);
    const noQueuedAttempt = await admin.query(`SELECT count(*)::int AS n FROM ${scope}.generation_attempts WHERE job_id=$1`, [seeded.queuedId]); assert.equal(noQueuedAttempt.rows[0].n, 0);
    return { publicReadbacks: seeded.readbacks.length, exactOriginalVersion: true, originalBytes: bytes.length, originalSha256: sha(bytes), hiddenHistoricalVersionAndDeleteMarker: true, historicalCanvas: true, historicalShot: true, originalUnknownAttempt: true, queuedWithoutAttempt: true, privateAuthorityPreserved: true, runtimeDirectRewriteRejected: true, generationExecutorStarted: false };
  } finally { await app?.close(); await runtime?.end(); await admin.end(); store.close(); }
}
