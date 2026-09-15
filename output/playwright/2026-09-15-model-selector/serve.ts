/** Isolated model-selector UI acceptance: real HTTP/API/Postgres, no storage or provider executor. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import type { TestContext } from "node:test";
import { businessFixture } from "../../../tests/support/business.js";
import { buildApp } from "../../../apps/api/src/app.js";

const exec = promisify(execFile);
const runId = randomUUID(), pgName = `scenedesk-model-ui-${runId}`;
const directory = resolve(`.runtime/model-ui-${runId}`);
const evidence = resolve("output/playwright/2026-09-15-model-selector", runId);
const origin = "http://localhost:4347";
const dist = resolve(process.env.MODEL_UI_DIST!);
const sourceCommit = process.env.MODEL_UI_SHA!;
assert(/^[a-f0-9]{40}$/.test(sourceCommit));
await exec("git", ["cat-file", "-e", `${sourceCommit}^{commit}`]);
await readFile(resolve(dist, "index.html"));
await mkdir(directory, { recursive: true, mode: 0o700 });
await mkdir(evidence, { recursive: true });
const control = resolve(directory, "capabilities.json");
await writeFile(control, JSON.stringify({ mode: "normal" }), { mode: 0o600 });
const cleanup: Array<() => Promise<unknown>> = [];
const requests: Array<{ method: string; path: string; status: number }> = [];
let closing = false, created = false, started = false, stopRequested = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
  stopRequested = true;
  if (started) void close().then(() => process.exit(0));
});
async function close() {
  if (closing) return;
  closing = true;
  const failures: string[] = [];
  for (const fn of [...cleanup].reverse()) {
    try { await fn(); } catch { failures.push("RESOURCE_CLEANUP_FAILED"); }
  }
  if (created) {
    try {
      const label = (await exec("docker", ["inspect", "--format", '{{index .Config.Labels "io.scenedesk.e2e.run"}}', pgName], { timeout: 30000 })).stdout.trim();
      assert.equal(label, runId);
      await exec("docker", ["rm", "-f", "-v", pgName], { timeout: 30000 });
    } catch (error) {
      if (!/No such (object|container)/i.test(String((error as { stderr?: string }).stderr)))
        failures.push("CONTAINER_CLEANUP_FAILED");
    }
  }
  await writeFile(resolve(evidence, "requests.json"), JSON.stringify(requests, null, 2));
  await writeFile(resolve(evidence, "cleanup.json"), JSON.stringify({ closed: !failures.length, failures, providerCalls: 0 }, null, 2));
}
async function start() {
  const password = randomBytes(24).toString("hex");
  created = true;
  await exec("docker", ["run", "-d", "--name", pgName, "--label", `io.scenedesk.e2e.run=${runId}`, "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_DB=drama_model_ui", "-p", "127.0.0.1::5432", "postgres:17-alpine"], { env: { ...process.env, POSTGRES_PASSWORD: password }, timeout: 60000 });
  const ports = JSON.parse((await exec("docker", ["inspect", "--format", "{{json .NetworkSettings.Ports}}", pgName])).stdout);
  process.env.DATABASE_URL = `postgres://postgres:${password}@127.0.0.1:${ports["5432/tcp"][0].HostPort}/drama_model_ui`;
  for (let i = 0; ; i++) {
    try { await exec("docker", ["exec", pgName, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], { timeout: 5000 }); break; }
    catch { assert(i < 30); await new Promise(r => setTimeout(r, 250)); }
  }
  const context = { after: (fn: () => Promise<unknown>) => cleanup.push(fn) } as unknown as TestContext;
  const f = await businessFixture(context);
  const episode = await f.ok("POST", `${f.path}/episodes`, { title: "模型选择器验收", position: 0, status: "active" }, await f.next());
  const scene = await f.ok("POST", `${f.path}/scenes`, { episodeId: episode.id, title: "模型菜单", position: 1, summary: "独立 UI 验收，无外部模型调用", state: {}, status: "active" }, await f.next());
  const ensured = await f.request("POST", `${f.path}/scenes/${scene.id}/canvas`);
  assert([200, 201].includes(ensured.statusCode));
  const canvas = ensured.json().canvas;
  const options = [
    { id: randomUUID(), purpose: "creative_assistance", mode: "fixture", modelVersion: "本地技术测试" },
    { id: randomUUID(), purpose: "image", mode: "image_fixture_v1", modelVersion: "本地图片技术模型" },
    ...Array.from({ length: 20 }, (_, i) => ({ id: randomUUID(), purpose: "video", mode: "target_profile_fixture", modelVersion: `Local Video Profile ${String(i + 1).padStart(2, "0")} - Cinematic Camera and Character Continuity Preview v2026.09.15 (No Media Execution)` })),
  ];
  const connection = randomUUID(), version = randomUUID();
  for (const option of options) await f.admin.query(
    `INSERT INTO "${f.schema}".generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
    [option.id, f.tenant.id, connection, version, { purpose: option.purpose, mode: option.mode, modelVersion: option.modelVersion, supportedPurposes: ["composition"], maxReferences: 20 }],
  );
  const app = buildApp(f.runtime, { schema: f.schema, origin, secret: randomBytes(32).toString("base64url"), localIdentity: true });
  cleanup.push(async () => { app.server.closeIdleConnections(); app.server.closeAllConnections(); await app.close(); });
  app.addHook("onRequest", async (req, reply) => {
    if (req.method !== "GET" || req.url.split("?")[0] !== `/v1/tenants/${f.tenant.id}/capabilities`) return;
    const { mode } = JSON.parse(await readFile(control, "utf8"));
    if (mode === "delay") await new Promise(r => setTimeout(r, 3000));
    if (mode === "empty") return reply.send({ items: [] });
    if (mode === "error") return reply.code(503).send({ code: "FIXTURE_CAPABILITIES_UNAVAILABLE", message: "隔离验收：模型列表暂时不可用", requestId: req.id });
  });
  app.addHook("onResponse", async (req, reply) => {
    if (req.url.startsWith("/v1/")) requests.push({ method: req.method, path: req.url.split("?")[0]!, status: reply.statusCode });
  });
  app.get("/__model_fixture/login", async (_, reply) => reply.header("set-cookie", `session=${f.owner.token}; Path=/; HttpOnly; SameSite=Lax`).redirect(`/#/app/t/${f.tenant.id}/p/${f.project.id}/production?scene=${scene.id}&mode=canvas`));
  app.get("/__fixture/evidence", async () => ({
    runId, sourceCommit, indexSha256: createHash("sha256").update(await readFile(resolve(dist, "index.html"))).digest("hex"),
    requests, providerCalls: 0, options,
    plans: (await f.admin.query(`SELECT count(*)::int AS count FROM "${f.schema}".generation_plans`)).rows[0].count,
    jobs: (await f.admin.query(`SELECT count(*)::int AS count FROM "${f.schema}".generation_jobs`)).rows[0].count,
  }));
  app.get("/*", async (req, reply) => {
    if (req.url.startsWith("/v1/")) return reply.code(404).send();
    let file = resolve(dist, "." + decodeURIComponent(req.url.split("?")[0]!));
    if (!file.startsWith(dist + "/") && file !== dist) return reply.code(404).send();
    if (!(await stat(file).catch(() => undefined))?.isFile()) file = resolve(dist, "index.html");
    return reply.header("cache-control", "no-store").type(({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" } as Record<string, string>)[extname(file)] ?? "application/octet-stream").send(await readFile(file));
  });
  await app.listen({ host: "127.0.0.1", port: 4347 });
  await writeFile(resolve(evidence, "fixture.json"), JSON.stringify({ runId, sourceCommit, origin, tenantId: f.tenant.id, projectId: f.project.id, sceneId: scene.id, canvasId: canvas.id, options }, null, 2));
  await writeFile(resolve(directory, "resources.json"), JSON.stringify({ pid: process.pid, pgName, schema: f.schema, control }), { mode: 0o600 });
  console.log(`MODEL_FIXTURE_READY ${origin}/__model_fixture/login ${runId}`);
  started = true;
  if (stopRequested) await close();
}
start().catch(async e => { await writeFile(resolve(directory, "failure.txt"), String(e?.stack ?? e), { mode: 0o600 }); console.log(`MODEL_FIXTURE_FAILED ${runId}`); await close(); process.exitCode = 1; });
