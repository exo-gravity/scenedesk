/** Isolated actual API/DB/worker browser fixture. Never a deployment entry point. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import { Pool } from "pg";
import { grantGenerationWorkerAccess, sqlIdentifier } from "@drama/database";
import { buildApp } from "../../../apps/api/src/app.js";
import { Secrets } from "../../../apps/api/src/kernel/crypto.js";
import { issueSession } from "../../../apps/api/src/modules/identity/sessions.js";
import { createAssistanceWorker } from "../../../apps/api/src/modules/generation/worker.js";
import { databaseFixture } from "../../../tests/support/database.js";
import { asyncProviderHttpFixture } from "../../../tests/helpers/async-provider-http.js";

const directory = resolve(process.argv[2] ?? ".runtime/async-browser-fixture");
assert(directory.includes("/.runtime/"));
await mkdir(directory, { recursive: true, mode: 0o700 });
const cleanup: (() => unknown)[] = [];
let closing = false,
  timer: NodeJS.Timeout | undefined,
  active: Promise<void> | undefined;
async function releaseResources() {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  await active;
  const errors: unknown[] = [];
  for (const run of cleanup.reverse()) {
    try {
      await run();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, "Isolated fixture cleanup failed");
}
async function start() {
  const db = await databaseFixture({
    after: (f: () => unknown) => cleanup.push(f),
  } as unknown as TestContext);
  const origin = "http://127.0.0.1:4319";
  const secret = randomBytes(32).toString("base64url");
  const secrets = new Secrets(secret);
  const app = buildApp(db.runtime, {
    schema: db.schema,
    origin,
    secret,
    localIdentity: true,
  });
  cleanup.push(() => app.close());
  const dist = fileURLToPath(
    new URL("../../../apps/web/dist/", import.meta.url),
  );
  app.get("/", async (_, reply) =>
    reply.type("text/html").send(await readFile(resolve(dist, "index.html"))),
  );
  app.get<{ Params: { "*": string } }>("/assets/*", async (request, reply) => {
    const root = resolve(dist, "assets"),
      path = resolve(root, request.params["*"]);
    if (!path.startsWith(`${root}/`)) return reply.code(404).send();
    const mime: Record<string, string> = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
      ".png": "image/png",
    };
    return reply
      .type(mime[extname(path)] ?? "application/octet-stream")
      .send(await readFile(path));
  });
  const owner = await issueSession(
    db.auth,
    {
      issuer: "urn:scenedesk:isolated-async-browser-fixture",
      subject: "fixture-owner",
      email: "async-browser@example.test",
      emailVerified: true,
      displayName: "异步流程技术验收",
    },
    { schema: db.schema },
  );
  const workerRole = `browsergen_${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  await db.admin.query(
    `CREATE ROLE ${sqlIdentifier(workerRole)} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT PASSWORD '${password}'`,
  );
  cleanup.push(async () => {
    await db.admin.query(`DROP OWNED BY ${sqlIdentifier(workerRole)}`);
    await db.admin.query(`DROP ROLE ${sqlIdentifier(workerRole)}`);
  });
  const url = new URL(process.env.DATABASE_URL!);
  url.username = workerRole;
  url.password = password;
  const pool = new Pool({ connectionString: url.href, max: 3 });
  cleanup.push(() => pool.end());
  const provision = await db.admin.connect();
  try {
    await grantGenerationWorkerAccess(provision, db.schema, workerRole);
  } finally {
    provision.release();
  }
  const connectionVersionId = randomUUID(),
    connectionId = randomUUID(),
    capabilityId = randomUUID();
  const provider = await asyncProviderHttpFixture(connectionVersionId);
  cleanup.push(() => provider.close());
  const worker = await createAssistanceWorker({
    pool,
    schema: db.schema,
    adapters: [provider.adapter],
  });
  let paused = true;
  const workerErrors: string[] = [];
  function scan() {
    if (closing) return;
    active = (paused ? Promise.resolve() : worker.scan().then(() => undefined))
      .catch(() => {
        workerErrors.push("WORKER_STEP_FAILED");
      })
      .finally(() => {
        if (!closing) timer = setTimeout(scan, 500);
      });
  }
  // Controls only the synthetic external service. All business actions use the original API.
  app.post<{ Body: { action: string; providerJobId?: string } }>(
    "/__fixture/control",
    async (request) => {
      const { action, providerJobId } = request.body;
      if (action === "pause") paused = true;
      else if (action === "resume") paused = false;
      else {
        assert(providerJobId);
        if (
          action === "pending" ||
          action === "running" ||
          action === "cancelled"
        )
          provider.setState(providerJobId, { kind: action });
        else if (action === "complete")
          provider.setState(providerJobId, {
            kind: "completed",
            output: {
              shots: [
                {
                  label: "异步技术建议",
                  intent:
                    "显式本机 HTTP fixture：保留原输入，核对钥匙所在位置。",
                },
              ],
            },
          });
        else throw new Error("UNKNOWN_FIXTURE_ACTION");
      }
      return { paused };
    },
  );
  app.get("/__fixture/state", async () => ({
    paused,
    jobs: provider
      .creations()
      .map((j) => ({
        providerJobId: j.providerJobId,
        jobId: j.submission.jobId,
        attemptId: j.submission.attemptId,
      })),
    requests: provider.requests(),
    workerErrors,
  }));
  await app.ready();
  async function call(
    method: "GET" | "POST",
    path: string,
    payload?: unknown,
    revision?: number,
  ) {
    const result = await app.inject({
      method,
      url: path,
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
      headers: {
        cookie: `session=${owner.token}`,
        origin,
        "x-csrf-token": secrets.csrf(owner.token),
        "idempotency-key": randomUUID(),
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(revision === undefined ? {} : { "if-match": `"${revision}"` }),
      },
    });
    assert.equal(result.statusCode, method === "POST" ? 201 : 200, result.body);
    return result.json();
  }
  const tenant = await call("POST", "/v1/tenants", {
    name: "异步技术验收",
    currency: "CNY",
  });
  const base = `/v1/tenants/${tenant.id}`;
  const member = (await call("GET", `${base}/members`)).items[0];
  const project = await call("POST", `${base}/projects`, {
    name: "异步生成独立验收",
    leadMembershipId: member.id,
    spec: {
      width: 1080,
      height: 1920,
      fpsNum: 24,
      fpsDen: 1,
      language: "zh-CN",
    },
  });
  const path = `${base}/projects/${project.id}`;
  const next = async () => (await call("GET", `${path}/content`)).revision;
  const script = await call(
    "POST",
    `${path}/scripts`,
    { text: "她推门，看到桌上的钥匙，停顿后慢慢靠近。" },
    await next(),
  );
  const episode = await call(
    "POST",
    `${path}/episodes`,
    { title: "技术验收集", position: 0, status: "active" },
    await next(),
  );
  const scene = await call(
    "POST",
    `${path}/scenes`,
    {
      episodeId: episode.id,
      title: "异步任务验收场次",
      position: 0,
      summary: "只有技术夹具，无真实模型调用",
      state: {},
      status: "active",
    },
    await next(),
  );
  await db.admin.query(
    `INSERT INTO ${sqlIdentifier(db.schema)}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
    [
      capabilityId,
      tenant.id,
      connectionId,
      connectionVersionId,
      {
        purpose: "script_analysis",
        modelVersion: "异步 HTTP 技术夹具（无真实模型）",
        mode: "structured_text",
        supportedPurposes: [],
        cancelSupported: true,
        recoverySupported: true,
      },
    ],
  );
  await writeFile(
    resolve(directory, "session.json"),
    JSON.stringify({
      cookies: [
        {
          name: "session",
          value: owner.token,
          domain: "127.0.0.1",
          path: "/",
          httpOnly: true,
          secure: false,
        },
      ],
    }),
    { mode: 0o600 },
  );
  const identity = {
    origin,
    tenantId: tenant.id,
    projectId: project.id,
    sceneId: scene.id,
    episodeId: episode.id,
    scriptRevisionId: script.id,
    capabilityId,
    connectionVersionId,
    executionMode: "test_fixture",
    paidProvidersEnabled: false,
  };
  await writeFile(
    resolve(directory, "fixture.json"),
    JSON.stringify(identity, null, 2) + "\n",
    { mode: 0o600 },
  );
  await app.listen({ host: "127.0.0.1", port: 4319 });
  scan();
  async function close() {
    const state = {
      ...identity,
      workerErrors,
      requestCount: provider.requests().length,
      cleanup: "completed",
    };
    await releaseResources();
    await writeFile(
      resolve(directory, "cleanup.json"),
      JSON.stringify(state, null, 2) + "\n",
      { mode: 0o600 },
    );
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => void close());
  console.log(JSON.stringify({ status: "ready", ...identity }));
}
try {
  await start();
} catch (error) {
  await releaseResources();
  throw error;
}
