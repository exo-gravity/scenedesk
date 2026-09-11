import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { grantGenerationWorkerAccess, sqlIdentifier } from "@drama/database";
import { createAssistanceWorker } from "../../apps/api/src/modules/generation/worker.js";
import { businessFixture } from "../support/business.js";
import { asyncProviderHttpFixture } from "../helpers/async-provider-http.js";

async function isolatedWorkerProcess(configuration: {
  databaseUrl: string;
  schema: string;
  origin: string;
  connectionVersionId: string;
  action: "process" | "reconcile";
  jobId: string;
}) {
  // The only database credential passed to this fresh process is the generated,
  // restricted fixture worker login. No real application environment is inherited.
  const code = `
    import { Pool } from "pg";
    import { createAssistanceWorker } from "./apps/api/src/modules/generation/worker.ts";
    import { asyncProviderHttpAdapter } from "./tests/helpers/async-provider-http.ts";
    const config = JSON.parse(process.env.SCENEDESK_HTTP_TEST_WORKER);
    const pool = new Pool({ connectionString: config.databaseUrl, max: 2 });
    try {
      const adapter = asyncProviderHttpAdapter({ origin: config.origin, connectionVersionId: config.connectionVersionId, executionMode: "test_fixture" });
      const worker = await createAssistanceWorker({ pool, schema: config.schema, adapters: [adapter] });
      await worker[config.action](config.jobId);
      process.stdout.write(JSON.stringify({ pid: process.pid }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ errorCode: typeof error?.code === "string" ? error.code.slice(0, 40) : "WORKER_FAILED" }));
      process.exitCode = 1;
    } finally { await pool.end(); }
  `;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", code],
    {
      cwd: new URL("../../", import.meta.url),
      env: {
        PATH: process.env.PATH,
        SCENEDESK_HTTP_TEST_WORKER: JSON.stringify(configuration),
      },
      stdio: ["ignore", "pipe", "ignore"],
      signal: AbortSignal.timeout(20000),
    },
  );
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    if (output.length + chunk.length > 4096) child.kill("SIGKILL");
    else output += chunk.toString("utf8");
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status) => {
      if (status === 0) resolve();
      else
        reject(
          new Error(`Isolated fixture worker failed: ${status}, ${output}`),
        );
    });
  });
  const result: unknown = JSON.parse(output);
  assert.ok(
    result &&
      typeof result === "object" &&
      "pid" in result &&
      Number.isSafeInteger(result.pid),
  );
  return (result as { pid: number }).pid;
}

async function setup(t: TestContext) {
  const f = await businessFixture(t);
  const workerRole = `httpgen_${randomBytes(6).toString("hex")}`,
    password = randomBytes(24).toString("hex");
  await f.admin.query(
    `CREATE ROLE ${sqlIdentifier(workerRole)} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT PASSWORD '${password}'`,
  );
  const url = new URL(process.env.DATABASE_URL!);
  url.username = workerRole;
  url.password = password;
  const pool = new Pool({ connectionString: url.href, max: 4 });
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
  const grant = await f.admin.connect();
  try {
    await grantGenerationWorkerAccess(grant, f.schema, workerRole);
  } finally {
    grant.release();
  }
  const base = `/v1/tenants/${f.tenant.id}`;
  const script = await f.ok(
    "POST",
    `${f.path}/scripts`,
    { text: "她推门，找到桌上的钥匙。" },
    await f.next(),
  );
  const episode = await f.ok(
    "POST",
    `${f.path}/episodes`,
    { title: "HTTP 测试集", position: 0, status: "active" },
    await f.next(),
  );
  const scene = await f.ok(
    "POST",
    `${f.path}/scenes`,
    {
      episodeId: episode.id,
      title: "异步协议测试场次",
      position: 0,
      summary: "只验证本项目 loopback 协议，不是真实模型",
      state: {},
      status: "active",
    },
    await f.next(),
  );
  const capabilityId = randomUUID(),
    connectionId = randomUUID(),
    connectionVersionId = randomUUID();
  await f.admin.query(
    `INSERT INTO "${f.schema}".generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
    [
      capabilityId,
      f.tenant.id,
      connectionId,
      connectionVersionId,
      {
        purpose: "script_analysis",
        modelVersion: "SceneDesk loopback HTTP test fixture; no real provider",
        mode: "structured_text",
        supportedPurposes: [],
      },
    ],
  );
  const provider = await asyncProviderHttpFixture(connectionVersionId);
  t.after(() => provider.close());
  const newWorker = () =>
    createAssistanceWorker({
      pool,
      schema: f.schema,
      adapters: [provider.adapter],
    });
  const workerProcess = (action: "process" | "reconcile", jobId: string) =>
    isolatedWorkerProcess({
      databaseUrl: url.href,
      schema: f.schema,
      origin: provider.origin,
      connectionVersionId,
      action,
      jobId,
    });
  const createJob = async () => {
    const plan = await f.ok("POST", `${base}/generation-plans`, {
      scope: "project",
      projectId: f.project.id,
      connectionId,
      capabilityId,
      purpose: "script_analysis",
      prompt: "显式测试 fixture：准备一条分镜提案",
      output: {},
      additionalReferences: [],
      referenceOverrides: [],
      promptPolicy: "append",
      sourceScriptRevisionId: script.id,
      scriptRange: {
        startOffset: 0,
        endOffset: Array.from(script.text).length,
      },
      proposalTarget: {
        mode: "append_to_scene",
        sceneId: scene.id,
        sceneRevision: scene.revision,
        episodeId: episode.id,
      },
      contextSources: [],
    });
    const response = await f.request("POST", `${base}/generation-jobs`, {
      planId: plan.id,
    });
    assert.equal(response.statusCode, 202, response.body);
    return { plan, job: response.json() };
  };
  const read = (id: string) => f.ok("GET", `${base}/generation-jobs/${id}`);
  const due = (id: string) =>
    f.admin.query(
      `UPDATE "${f.schema}".generation_observation_control SET next_observation_at=now() WHERE job_id=$1`,
      [id],
    );
  // The provider's state is explicitly controlled; only durable worker scheduling
  // is polled. A provider cannot accidentally advance through intermediate states.
  async function drive(
    worker: Awaited<ReturnType<typeof newWorker>>,
    id: string,
    predicate: () => Promise<boolean> | boolean,
  ) {
    const deadline = Date.now() + 3000;
    do {
      // Only this isolated fixture's timer advances; the real lease and all
      // durable attempts/receipts are preserved. No production clock control.
      await due(id);
      await worker.scan();
      if (await predicate()) return;
      await delay(50);
    } while (Date.now() < deadline);
    assert.fail(
      "HTTP fixture worker did not reach the expected observed state",
    );
  }
  return {
    ...f,
    base,
    pool,
    provider,
    newWorker,
    workerProcess,
    createJob,
    read,
    drive,
    due,
  };
}

test("loopback async acceptance produces one persistent proposal through pending and running without another submit", async (t) => {
  const f = await setup(t),
    { plan, job } = await f.createJob(),
    worker = await f.newWorker();
  await worker.process(job.id);
  assert.equal(f.provider.creations().length, 1);
  const accepted = f.provider.creations()[0]!;
  assert.equal(accepted.submission.requestHash, plan.inputHash);
  assert.deepEqual(accepted.submission.resolvedInput, plan.resolvedInput);
  assert.equal(accepted.submission.executionMode, "test_fixture");
  await f.drive(worker, job.id, () =>
    f.provider.requests().some((event) => event.operation === "query"),
  );
  assert.equal((await f.read(job.id)).status, "provider_pending");
  f.provider.setState(accepted.providerJobId, { kind: "running" });
  await f.drive(
    worker,
    job.id,
    async () => (await f.read(job.id)).status === "provider_running",
  );
  f.provider.setState(accepted.providerJobId, {
    kind: "completed",
    output: {
      shots: [{ label: "HTTP 01", intent: "测试产物：她拾起桌上的钥匙" }],
    },
  });
  const restarted = await f.newWorker();
  await f.drive(
    restarted,
    job.id,
    async () => (await f.read(job.id)).status === "succeeded",
  );
  const result = await f.read(job.id);
  const proposal = await f.ok(
    "GET",
    `${f.path}/proposals/${result.proposalId}`,
  );
  assert.equal(
    proposal.operations[0].proposed.spec.intent,
    "测试产物：她拾起桌上的钥匙",
  );
  assert.equal((await f.tree()).shots.length, 0, "a proposal is not adoption");
  assert.equal(f.provider.creations().length, 1);
  assert.equal(
    f.provider.requests().filter((event) => event.operation === "submit")
      .length,
    1,
  );
  for (const event of f.provider.requests()) {
    assert.equal(event.attemptId, accepted.submission.attemptId);
    if (event.operation === "query")
      assert.equal(event.providerJobId, accepted.providerJobId);
  }
});

test("a lost HTTP creation reply is recovered by reading the original attempt, never by repeating POST", async (t) => {
  const f = await setup(t),
    { job } = await f.createJob(),
    worker = await f.newWorker();
  f.provider.dropNextCreationResponse();
  await worker.process(job.id);
  assert.equal((await f.read(job.id)).status, "submission_unknown");
  assert.equal(
    f.provider.creations().length,
    1,
    "the remote service did accept the lost response",
  );
  const accepted = f.provider.creations()[0]!;
  const restarted = await f.newWorker();
  await Promise.all([worker.process(job.id), restarted.process(job.id)]);
  await f.due(job.id);
  assert.notEqual(await f.workerProcess("reconcile", job.id), process.pid);
  assert.equal((await f.read(job.id)).status, "provider_pending");
  assert.equal((await f.read(job.id)).providerJobId, accepted.providerJobId);
  assert.equal(
    f.provider.requests().filter((event) => event.operation === "recover")
      .length,
    1,
  );
  f.provider.setState(accepted.providerJobId, {
    kind: "completed",
    output: {
      shots: [{ label: "Recovered HTTP", intent: "找回原受理任务的测试产物" }],
    },
  });
  await f.drive(
    restarted,
    job.id,
    async () => (await f.read(job.id)).status === "succeeded",
  );
  const result = await f.read(job.id);
  const proposal = await f.ok(
    "GET",
    `${f.path}/proposals/${result.proposalId}`,
  );
  assert.equal(
    proposal.operations[0].proposed.spec.intent,
    "找回原受理任务的测试产物",
  );
  assert.equal(f.provider.creations().length, 1);
  assert.equal(
    f.provider.requests().filter((event) => event.operation === "submit")
      .length,
    1,
  );
  for (const event of f.provider.requests()) {
    assert.equal(event.attemptId, accepted.submission.attemptId);
    assert.equal(event.providerJobId, accepted.providerJobId);
  }
});

test("a lost cancellation response permits one cancellation call and preserves a concurrent successful result", async (t) => {
  const f = await setup(t),
    { job } = await f.createJob(),
    worker = await f.newWorker();
  await worker.process(job.id);
  const accepted = f.provider.creations()[0]!;
  f.provider.dropCancellationResponse(accepted.providerJobId);
  const cancel = () =>
    f.request("POST", `${f.base}/generation-jobs/${job.id}/cancel`);
  const requested = await cancel();
  assert.equal(requested.statusCode, 202, requested.body);
  assert.equal(requested.json().cancelStatus, "requested");
  assert.equal(
    f.provider.requests().filter((event) => event.operation === "cancel")
      .length,
    0,
  );
  const second = await f.newWorker();
  await f.due(job.id);
  await Promise.all([worker.reconcile(job.id), second.reconcile(job.id)]);
  assert.equal((await f.read(job.id)).cancelStatus, "unknown");
  assert.equal((await f.read(job.id)).status, "cancel_requested");
  assert.equal(
    f.provider.requests().filter((event) => event.operation === "cancel")
      .length,
    1,
  );
  f.provider.setState(accepted.providerJobId, {
    kind: "completed",
    output: {
      shots: [
        { label: "Cancel race", intent: "取消未知期间已完成的真实测试结果" },
      ],
    },
  });
  const repeated = await cancel();
  assert.equal(repeated.statusCode, 202, repeated.body);
  await f.due(job.id);
  assert.notEqual(await f.workerProcess("reconcile", job.id), process.pid);
  const result = await f.read(job.id);
  const proposal = await f.ok(
    "GET",
    `${f.path}/proposals/${result.proposalId}`,
  );
  assert.equal(
    proposal.operations[0].proposed.spec.intent,
    "取消未知期间已完成的真实测试结果",
  );
  assert.equal(
    result.cancelStatus,
    "unknown",
    "success is not cancellation confirmation",
  );
  await worker.process(job.id);
  await second.reconcile(job.id);
  assert.equal(f.provider.creations().length, 1);
  assert.equal(
    f.provider.requests().filter((event) => event.operation === "cancel")
      .length,
    1,
  );
  for (const event of f.provider.requests()) {
    assert.equal(event.attemptId, accepted.submission.attemptId);
    assert.equal(event.providerJobId, accepted.providerJobId);
  }
});

test("HTTP errors and mismatched result identities preserve the original job and durable query backoff across workers", async (t) => {
  const f = await setup(t),
    { job } = await f.createJob(),
    worker = await f.newWorker();
  await worker.process(job.id);
  const accepted = f.provider.creations()[0]!;
  const queries = () =>
    f.provider.requests().filter((event) => event.operation === "query").length;
  for (const fault of [
    "http_503",
    "wrong_correlation",
    "wrong_provider_id",
  ] as const) {
    f.provider.failNextQuery(accepted.providerJobId, fault);
    const second = await f.newWorker(),
      before = queries();
    await f.due(job.id);
    await Promise.all([worker.reconcile(job.id), second.reconcile(job.id)]);
    assert.equal(
      queries(),
      before + 1,
      "concurrent workers share a durable observation lease",
    );
    const stillPending = await f.read(job.id);
    assert.equal(stillPending.status, "provider_pending");
    assert.equal(stillPending.providerJobId, accepted.providerJobId);
    assert.equal(stillPending.proposalId, undefined);
    const restarted = await f.newWorker();
    await restarted.reconcile(job.id);
    assert.equal(
      queries(),
      before + 1,
      "a new worker must respect the saved backoff",
    );
    assert.equal(f.provider.creations().length, 1);
  }
  f.provider.setState(accepted.providerJobId, {
    kind: "completed",
    output: {
      shots: [{ label: "Verified HTTP", intent: "原任务通过身份核对后的结果" }],
    },
  });
  await f.drive(
    worker,
    job.id,
    async () => (await f.read(job.id)).status === "succeeded",
  );
  const result = await f.read(job.id);
  const proposal = await f.ok(
    "GET",
    `${f.path}/proposals/${result.proposalId}`,
  );
  assert.equal(
    proposal.operations[0].proposed.spec.intent,
    "原任务通过身份核对后的结果",
  );
  assert.equal(
    f.provider.requests().filter((event) => event.operation === "submit")
      .length,
    1,
  );
});

test("independent worker processes concurrently submit once and reopen the original HTTP task after process exit", async (t) => {
  const f = await setup(t),
    { job } = await f.createJob();
  const initialPids = await Promise.all([
    f.workerProcess("process", job.id),
    f.workerProcess("process", job.id),
  ]);
  assert.notEqual(initialPids[0], initialPids[1]);
  assert.equal(f.provider.creations().length, 1);
  const accepted = f.provider.creations()[0]!;
  assert.equal((await f.read(job.id)).providerJobId, accepted.providerJobId);
  f.provider.setState(accepted.providerJobId, { kind: "running" });
  await f.due(job.id);
  const runningPid = await f.workerProcess("reconcile", job.id);
  assert.equal((await f.read(job.id)).status, "provider_running");
  assert.ok(!initialPids.includes(runningPid));
  f.provider.setState(accepted.providerJobId, {
    kind: "completed",
    output: {
      shots: [
        { label: "Process restart", intent: "进程退出后查询原任务保存的产物" },
      ],
    },
  });
  await f.due(job.id);
  const finalPid = await f.workerProcess("reconcile", job.id);
  assert.ok(![...initialPids, runningPid].includes(finalPid));
  const result = await f.read(job.id);
  assert.equal(result.status, "succeeded");
  const proposal = await f.ok(
    "GET",
    `${f.path}/proposals/${result.proposalId}`,
  );
  assert.equal(
    proposal.operations[0].proposed.spec.intent,
    "进程退出后查询原任务保存的产物",
  );
  assert.equal(f.provider.creations().length, 1);
  assert.equal(
    f.provider.requests().filter((event) => event.operation === "submit")
      .length,
    1,
  );
  for (const event of f.provider.requests()) {
    assert.equal(event.attemptId, accepted.submission.attemptId);
    assert.equal(event.providerJobId, accepted.providerJobId);
  }
});

test("a fresh worker recovers an already-completed lost submission through a read-only HTTP lookup", async (t) => {
  const f = await setup(t),
    { job } = await f.createJob(),
    worker = await f.newWorker();
  f.provider.dropNextCreationResponse();
  await worker.process(job.id);
  assert.equal((await f.read(job.id)).status, "submission_unknown");
  const accepted = f.provider.creations()[0]!;
  f.provider.setState(accepted.providerJobId, {
    kind: "completed",
    output: {
      shots: [
        { label: "Completed recovery", intent: "只读找回原提交的已完成产物" },
      ],
    },
  });
  await f.due(job.id);
  await f.workerProcess("reconcile", job.id);
  const result = await f.read(job.id);
  assert.equal(result.status, "succeeded");
  assert.equal(result.providerJobId, accepted.providerJobId);
  const proposal = await f.ok(
    "GET",
    `${f.path}/proposals/${result.proposalId}`,
  );
  assert.equal(
    proposal.operations[0].proposed.spec.intent,
    "只读找回原提交的已完成产物",
  );
  assert.deepEqual(
    f.provider.requests().map((event) => event.operation),
    ["submit", "recover"],
  );
  assert.equal(f.provider.creations().length, 1);
  for (const event of f.provider.requests()) {
    assert.equal(event.attemptId, accepted.submission.attemptId);
    assert.equal(event.providerJobId, accepted.providerJobId);
  }
});
