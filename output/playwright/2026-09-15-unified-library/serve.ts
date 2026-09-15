/** Isolated synthetic library UI acceptance: actual API/PG/private storage, no model executor.
 * Start with LIBRARY_UI_DIST/LIBRARY_UI_SHA, or LIBRARY_UI_PENDING=1 until a build exists.
 * READY reports the private directory containing dist.json, lists.json and resources.json.
 * SIGTERM/SIGINT closes only the exact resources registered by this fixture run.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import type { TestContext } from "node:test";
import { Pool } from "pg";
import { createMediaProcessor } from "@drama/media";
import { createScheduler, runInternalWorker, installQueue, grantQueueAccess } from "@drama/queue";
import { grantMediaWorkerAccess, sqlIdentifier } from "@drama/database";
import { buildApp } from "../../../apps/api/src/app.js";
import { businessFixture } from "../../../tests/support/business.js";
import { storageFixture } from "../../../tests/support/storage.js";

const exec = promisify(execFile);
const runId = randomUUID(), pgName = `scenedesk-library-ui-${runId}`;
const directory = resolve(`.runtime/library-ui-${runId}`);
const evidence = resolve("output/playwright/2026-09-15-unified-library", runId);
const port = Number(process.env.LIBRARY_UI_PORT ?? "4347");
assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
const origin = `http://localhost:${port}`;
await mkdir(directory, { recursive: true, mode: 0o700 });
await mkdir(evidence, { recursive: true });
const distControl = resolve(directory, "dist.json");
const listControl = resolve(directory, "lists.json");
type Build = { pending?: false; path: string; sourceCommit: string } | { pending: true };
async function validateBuild(input: unknown): Promise<Build> {
  const value = input as Partial<{ pending: boolean; path: string; sourceCommit: string }>;
  if (value.pending === true) return { pending: true };
  assert(typeof value.path === "string" && value.path.length > 0, "UI dist path required");
  assert(typeof value.sourceCommit === "string" && /^[a-f0-9]{40}$/.test(value.sourceCommit), "Exact UI source SHA required");
  await exec("git", ["cat-file", "-e", `${value.sourceCommit}^{commit}`]);
  const path = resolve(value.path);
  assert((await stat(resolve(path, "index.html"))).isFile());
  return { path, sourceCommit: value.sourceCommit };
}
const initialBuild = await validateBuild(process.env.LIBRARY_UI_PENDING === "1"
  ? { pending: true }
  : { path: process.env.LIBRARY_UI_DIST, sourceCommit: process.env.LIBRARY_UI_SHA });
await writeFile(distControl, JSON.stringify(initialBuild), { flag: "wx", mode: 0o600 });
await writeFile(listControl, JSON.stringify({ assets: "normal", media: "normal", imports: "normal" }), { flag: "wx", mode: 0o600 });
const fixtureCleanup: Array<() => unknown> = [];
const ownCleanup: Array<() => unknown> = [];
const context = { after: (fn: () => unknown) => fixtureCleanup.push(fn) } as unknown as TestContext;
const requests: Array<{ method: string; path: string; status: number }> = [];
const errors: string[] = [];
let pgAttempted = false, closing = false, started = false, stopRequested = false;
function checkStop() {
  if (stopRequested) throw Error("FIXTURE_START_CANCELLED");
}
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  stopRequested = true;
  if (started) void close().then(() => process.exit(process.exitCode === 1 ? 1 : 0));
});
async function close() {
  if (closing) return;
  closing = true;
  const failures: string[] = [];
  for (const fn of [...ownCleanup].reverse().concat([...fixtureCleanup].reverse())) {
    try { await fn(); } catch { failures.push("FIXTURE_RESOURCE_CLEANUP_FAILED"); }
  }
  if (pgAttempted) try {
    const label = (await exec("docker", ["inspect", "--format", '{{index .Config.Labels "io.scenedesk.e2e.run"}}', pgName], { timeout: 30000 })).stdout.trim();
    assert.equal(label, runId, "Refusing cleanup outside this run");
    await exec("docker", ["rm", "--force", "--volumes", pgName], { timeout: 30000 });
  } catch (error) {
    if (!/No such (object|container)/i.test(String((error as { stderr?: string }).stderr)))
      failures.push("FIXTURE_DATABASE_CLEANUP_FAILED");
  }
  await writeFile(resolve(evidence, "requests.json"), JSON.stringify(requests, null, 2), { flag: "wx" });
  await writeFile(resolve(evidence, "cleanup.json"), JSON.stringify({ closed: !failures.length, failures, errors, providerCalls: 0 }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ fixture: "closed", runId, failures, providerCalls: 0 }));
  if (failures.length) process.exitCode = 1;
}
function technicalWave() {
  const sampleRate = 24000, count = sampleRate * 2;
  const buffer = Buffer.alloc(44 + count * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const fade = Math.min(1, i / 600, (count - i) / 600);
    buffer.writeInt16LE(Math.round(2800 * fade * Math.sin(2 * Math.PI * 440 * i / sampleRate)), 44 + i * 2);
  }
  return buffer;
}
async function start() {
  const password = randomBytes(24).toString("hex");
  pgAttempted = true;
  await exec("docker", ["run", "--detach", "--name", pgName,
    "--label", `io.scenedesk.e2e.run=${runId}`, "--publish", "127.0.0.1::5432",
    "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB=drama_library_ui",
    "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,nodev,size=536870912",
    "postgres:16.15-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685"],
    { env: { ...process.env, POSTGRES_PASSWORD: password }, timeout: 60000 });
  const ports = JSON.parse((await exec("docker", ["inspect", "--format", "{{json .NetworkSettings.Ports}}", pgName])).stdout);
  process.env.DATABASE_URL = `postgres://postgres:${password}@127.0.0.1:${ports["5432/tcp"][0].HostPort}/drama_library_ui`;
  for (let i = 0; ; i++) {
    checkStop();
    try { await exec("docker", ["exec", pgName, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], { timeout: 5000 }); break; }
    catch { assert(i < 40, "Isolated PostgreSQL not ready"); await new Promise(done => setTimeout(done, 250)); }
  }
  console.log("library fixture: isolated PostgreSQL ready");
  const storage = await storageFixture(context, { storageCapacityMiB: 2048 });
  checkStop();
  const suffix = randomBytes(5).toString("hex"), queueSchema = `scenedesk_queue_${suffix}`;
  const mediaRole = `library_media_${suffix}`, schedulerRole = `library_sched_${suffix}`;
  const pools: Pool[] = [], roles: string[] = [];
  let scheduler!: Awaited<ReturnType<typeof createScheduler>>;
  const f = await businessFixture(context, async db => {
    ownCleanup.push(async () => {
      for (const pool of pools) await pool.end();
      await db.admin.query(`DROP SCHEMA IF EXISTS ${sqlIdentifier(queueSchema)} CASCADE`);
      for (const role of roles) {
        await db.admin.query(`DROP OWNED BY ${sqlIdentifier(role)}`);
        await db.admin.query(`DROP ROLE ${sqlIdentifier(role)}`);
      }
    });
    for (const role of [mediaRole, schedulerRole]) {
      const secret = randomBytes(24).toString("hex");
      await db.admin.query(`CREATE ROLE ${sqlIdentifier(role)} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '${secret}'`);
      roles.push(role);
      const url = new URL(process.env.DATABASE_URL!); url.username = role; url.password = secret;
      pools.push(new Pool({ connectionString: url.href, max: 3 }));
    }
    await installQueue(db.admin, queueSchema);
    const sql = await db.admin.connect();
    try {
      await grantMediaWorkerAccess(sql, db.schema, mediaRole, schedulerRole);
      for (const role of [db.apiRole, mediaRole]) await grantQueueAccess(sql, queueSchema, role, schedulerRole);
    } finally { sql.release(); }
    scheduler = await createScheduler(db.runtime, { schema: queueSchema, onError: () => errors.push("QUEUE_ERROR") });
    ownCleanup.push(() => scheduler.close());
    return { media: { store: storage.api, schedule: scheduler.schedule } };
  });
  const producer = await createScheduler(pools[0]!, { schema: queueSchema, onError: () => errors.push("MEDIA_QUEUE_ERROR") });
  ownCleanup.push(() => producer.close());
  const processor = await createMediaProcessor({ pool: pools[0]!, schema: f.schema, store: storage.processing, schedule: producer.schedule });
  const worker = await runInternalWorker(pools[1]!, processor, { schema: queueSchema, concurrency: 1, onError: () => errors.push("MEDIA_WORKER_ERROR") });
  ownCleanup.push(() => worker.close());
  const base = `/v1/tenants/${f.tenant.id}`;
  const media: Record<string, any> = {};
  async function upload(key: string, scope: "project" | "shared", bytes: Buffer, fileName: string, mime: string) {
    checkStop();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const intent = await f.ok("POST", `${base}/uploads`, {
      scope, ...(scope === "project" ? { projectId: f.project.id } : {}),
      fileName, displayName: fileName, mime, bytes: bytes.length, sha256, tags: ["隔离合成", "统一资产库"],
    });
    const form = new FormData();
    for (const [key, value] of Object.entries(intent.formFields)) form.append(key, String(value));
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), fileName);
    assert.equal((await fetch(intent.uploadUrl, { method: "POST", body: form, signal: AbortSignal.timeout(60000) })).status, 204);
    const response = await f.request("POST", `${base}/uploads/${intent.id}/complete`, { bytes: bytes.length, sha256 });
    assert.equal(response.statusCode, 202, response.body);
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      checkStop();
      const current = await f.ok("GET", `${base}/media/${response.json().mediaId}`);
      if (current.status === "ready" && current.derivatives.every((item: any) => item.status === "ready")) {
        assert.equal(current.sha256, sha256); assert.equal(current.bytes, bytes.length);
        if (current.kind !== "document") assert(current.derivatives.length > 0);
        media[key] = current;
        console.log(`library fixture: ${key} original and expected previews ready`);
        return current;
      }
      if (current.status === "rejected" || (current.issue && !current.issue.retryable)) {
        await writeFile(resolve(directory, `media-${key}-failure.json`), JSON.stringify({ status: current.status, issue: current.issue, derivatives: current.derivatives }), { flag: "wx", mode: 0o600 });
        throw Error(`FIXTURE_MEDIA_REJECTED_${key}`);
      }
      await new Promise(done => setTimeout(done, 500));
    }
    throw Error(`FIXTURE_MEDIA_TIMEOUT_${key}`);
  }
  const keyBytes = await readFile("apps/web/public/demo/workspace-v2/key-reference.png");
  const handBytes = await readFile("apps/web/public/demo/workspace-v2/key-candidate-c.png");
  const videoBytes = await readFile("apps/web/public/demo/technical-preview.mp4");
  const audioBytes = technicalWave();
  const documentBytes = Buffer.from("统一资产库 · 隔离合成文档\n此文件用于真实 UTF-8 原件读取和下载验证。\n不是剧本导入、AI 回复或正式项目资料。\n", "utf8");
  await upload("projectImage", "project", keyBytes, "项目图片 · 旧铜钥匙.png", "image/png");
  await upload("projectVideo", "project", videoBytes, "项目视频 · 预制技术预览（非模型）.mp4", "video/mp4");
  await upload("projectAudio", "project", audioBytes, "项目音频 · 440Hz 技术提示音（非人声）.wav", "audio/wav");
  await upload("projectDocument", "project", documentBytes, "项目文档 · 隔离说明.txt", "text/plain");
  await upload("sharedImageV1", "shared", keyBytes, "共享图片 · 旧钥匙全貌.png", "image/png");
  await upload("sharedImageV2", "shared", handBytes, "共享图片 · 手部构图.png", "image/png");
  await upload("sharedAudio", "shared", audioBytes, "共享声音 · 技术音色预览（非人声）.wav", "audio/wav");
  const assets: Record<string, any> = {};
  async function asset(key: string, scope: "project" | "shared", kind: string, name: string, definition: Record<string, unknown>) {
    checkStop();
    const root = await f.ok("POST", `${base}/assets`, {
      scope, ...(scope === "project" ? { projectId: f.project.id } : {}), kind, name,
      description: "隔离合成资产，用于统一资产库浏览、版本及草稿验证。", tags: ["隔离合成", kind],
    });
    const revision = await f.ok("POST", `${base}/assets/${root.id}/revisions`, { definition }, root.revision);
    assets[key] = { id: root.id, revisionId: revision.id, number: revision.number, scope, kind, name };
    return assets[key];
  }
  for (const scope of ["project", "shared"] as const) {
    const label = scope === "project" ? "项目" : "共享";
    const image = scope === "project" ? media.projectImage : media.sharedImageV1;
    const audio = scope === "project" ? media.projectAudio : media.sharedAudio;
    const voice = await asset(`${scope}Voice`, scope, "voice", `${label}声音 · 温和讲述（技术参考）`, {
      description: "沉稳、较慢的叙述设定；音频为合成测试音，不代表人声。",
      voiceDescription: "仅用于声音资产界面核验，不绑定或克隆真人声音。",
      references: [{ mediaId: audio.id, purpose: "voice" }],
    });
    const looks = [
      { id: randomUUID(), revision: 1, label: "造型一 · 原画参考", references: [{ mediaId: image.id, purpose: "look" }] },
      { id: randomUUID(), revision: 1, label: "造型二 · 手部参考", references: [{ mediaId: media.sharedImageV2.id, purpose: "look" }] },
    ];
    await asset(`${scope}Character`, scope, "character", `${label}角色 · 林夏（合成设定）`, {
      description: "克制、安静，灰色风衣。引用图像仅为技术排版参考，不代表角色成片。",
      references: [{ mediaId: image.id, purpose: "identity" }], looks, defaultVoiceAssetRevisionId: voice.revisionId,
    });
    assets[`${scope}Character`].lookIds = looks.map(item => item.id);
    await asset(`${scope}Location`, scope, "location", `${label}场景 · 午后的咖啡厅`, {
      description: "临街窗位、暖木桌面；可读的固定场景设定。", references: [{ mediaId: image.id, purpose: "location" }],
    });
    await asset(`${scope}Prop`, scope, "prop", `${label}道具 · 旧铜钥匙`, {
      description: "版本一：圆匙环、旧铜色和磨痕。", references: [{ mediaId: image.id, purpose: "prop" }],
    });
    await asset(`${scope}Style`, scope, "style", `${label}风格 · 胶片质感与自然窗光的克制叙事参考，长名称用于窄屏和多列资产卡片的换行与省略验证`, {
      description: "低饱和、自然窗光；合成资料，不代表模型输出。", references: [{ mediaId: image.id, purpose: "style" }],
    });
  }
  await asset("noReference", "project", "location", "无参考场景 · 等待创作的空白设定", { description: "没有图像、声音或其他参考。", references: [] });
  const shared = assets.sharedProp;
  const imported = await f.ok("POST", `${f.path}/shared-imports`, { assetRevisionId: shared.revisionId });
  const sharedRoot = await f.ok("GET", `${base}/assets/${shared.id}`);
  const sharedV2 = await f.ok("POST", `${base}/assets/${shared.id}/revisions`, {
    parentRevisionId: shared.revisionId,
    definition: { description: "版本二：补充手部构图；既有项目引入仍固定版本一。", references: [{ mediaId: media.sharedImageV2.id, purpose: "prop" }] },
  }, sharedRoot.revision);
  const imports = await f.ok("GET", `${f.path}/shared-imports`);
  assert(imports.items.some((item: any) => item.assetRevisionId === shared.revisionId));
  assert(!imports.items.some((item: any) => item.assetRevisionId === sharedV2.id));
  const emptyProject = await f.createProject("空资产库 · 隔离验收");
  const denied = await f.request("GET", `${base}/assets/${assets.projectProp.id}`, undefined, undefined, randomUUID(), await f.identity("library-outsider"));
  assert([403, 404].includes(denied.statusCode));
  const fixture = {
    runId, origin, tenantId: f.tenant.id, projectId: f.project.id, path: f.path,
    emptyProjectId: emptyProject.id, assets,
    sharedImport: { id: imported.id, assetId: shared.id, importedRevisionId: shared.revisionId, currentRevisionId: sharedV2.id },
    media: Object.fromEntries(Object.entries(media).map(([key, item]) => [key, {
      id: item.id, kind: item.kind, scope: item.scope, status: item.status, displayName: item.displayName,
      sha256: item.sha256, bytes: item.bytes, width: item.width, height: item.height, durationUs: item.durationUs,
      derivatives: item.derivatives.map((d: any) => ({ kind: d.kind, status: d.status })),
    }])),
    verification: { outsiderStatus: denied.statusCode, sharedImportStillV1: true, syntheticOnly: true, generationExecutorStarted: false, providerCalls: 0 },
  };
  const app = buildApp(f.runtime, { schema: f.schema, origin, secret: randomBytes(32).toString("base64url"), localIdentity: true, media: { store: storage.api, schedule: scheduler.schedule } });
  ownCleanup.push(async () => { app.server.closeIdleConnections(); app.server.closeAllConnections(); await app.close(); });
  app.addHook("onRequest", async (req, reply) => {
    if (req.method !== "GET") return;
    const path = req.url.split("?")[0];
    const kind = path === `${base}/assets` ? "assets" : path === `${base}/media` ? "media" : path === `${f.path}/shared-imports` ? "imports" : undefined;
    if (!kind) return;
    let mode: unknown;
    try {
      const content = await readFile(listControl, "utf8");
      assert(Buffer.byteLength(content) < 4096);
      mode = JSON.parse(content)[kind];
    } catch { mode = "error"; }
    if (mode === "normal") return;
    if (mode === "empty") return reply.header("cache-control", "no-store").send({ items: [] });
    return reply.code(503).header("cache-control", "no-store").send({ code: "FIXTURE_LIBRARY_UNAVAILABLE", message: "隔离验收：资产库列表暂时不可用，请重试。", requestId: req.id });
  });
  app.addHook("onResponse", async (req, reply) => {
    if (req.url.startsWith("/v1/")) requests.push({ method: req.method, path: req.url.split("?")[0]!, status: reply.statusCode });
  });
  app.get("/__library_fixture/login", async (_, reply) => reply
    .header("cache-control", "no-store")
    .header("set-cookie", `session=${f.owner.token}; Path=/; HttpOnly; SameSite=Lax`)
    .redirect(`/#/app/t/${f.tenant.id}/p/${f.project.id}/assets`));
  app.get("/__fixture/ids", async () => fixture);
  app.get("/__fixture/evidence", async () => ({
    ...fixture.verification, runId, requests, errors,
    counts: (await f.admin.query(`SELECT (SELECT count(*)::int FROM "${f.schema}".assets) AS assets, (SELECT count(*)::int FROM "${f.schema}".media) AS media, (SELECT count(*)::int FROM "${f.schema}".shared_imports) AS imports, (SELECT count(*)::int FROM "${f.schema}".generation_jobs) AS jobs`)).rows[0],
  }));
  app.get("/__fixture/build", async () => {
    const selected = await validateBuild(JSON.parse(await readFile(distControl, "utf8")));
    if (selected.pending) return selected;
    const html = await readFile(resolve(selected.path, "index.html"));
    return { sourceCommit: selected.sourceCommit, indexSha256: createHash("sha256").update(html).digest("hex"), scripts: [...html.toString().matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(item => item[1]) };
  });
  app.get("/*", async (req, reply) => {
    if (req.url.startsWith("/v1/")) return reply.code(404).send();
    const selected = await validateBuild(JSON.parse(await readFile(distControl, "utf8")));
    if (selected.pending) return reply.code(503).type("text/plain").send("Isolated library API ready; immutable UI build not yet selected.");
    const dist = selected.path;
    let file = resolve(dist, "." + decodeURIComponent(req.url.split("?")[0]!));
    if (!file.startsWith(dist + "/") && file !== dist) return reply.code(404).send();
    if (!(await stat(file).catch(() => undefined))?.isFile()) file = resolve(dist, "index.html");
    return reply.header("cache-control", "no-store").type(({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" } as Record<string, string>)[extname(file)] ?? "application/octet-stream").send(await readFile(file));
  });
  checkStop();
  await app.listen({ host: "127.0.0.1", port });
  await writeFile(resolve(evidence, "fixture.json"), JSON.stringify(fixture, null, 2), { flag: "wx" });
  await writeFile(resolve(directory, "resources.json"), JSON.stringify({ pid: process.pid, pgName, schema: f.schema, queueSchema, distControl, listControl }), { mode: 0o600, flag: "wx" });
  console.log(`LIBRARY_FIXTURE_READY ${origin}/__library_fixture/login ${runId} ${directory}`);
  started = true;
  if (stopRequested) await close();
}
start().catch(async error => {
  await writeFile(resolve(directory, "failure.txt"), String(error?.stack ?? error), { flag: "wx", mode: 0o600 });
  console.log(`LIBRARY_FIXTURE_FAILED ${runId}`);
  await close();
  process.exitCode = 1;
});
