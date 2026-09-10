import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import {
  createScheduler,
  grantQueueAccess,
  installQueue,
  internalQueue,
  parseEnvelope,
  runInternalWorker,
  type StepEnvelope,
} from "@drama/queue";
import { sqlIdentifier } from "@drama/database";
import { Database } from "../../apps/api/src/kernel/database.js";
import { businessFixture } from "../support/business.js";
import { processProbe } from "../support/queue-work.js";

async function eventually(check: () => Promise<boolean>, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error("Queue condition timed out");
    await delay(50);
  }
}

test("pg-boss gate: atomic enqueue, minimum roles, durable delay and crash replay", async (t) => {
  const f = await businessFixture(t),
    suffix = randomBytes(5).toString("hex"),
    queueSchema = `scenedesk_queue_${suffix}`,
    scope = sqlIdentifier(f.schema);
  const schedulerRole = `scheduler_${suffix}`,
    workerRole = `worker_${suffix}`;
  const urls = new Map<string, string>();
  const pools: Pool[] = [];
  const close: (() => Promise<void>)[] = [];
  const errors: Error[] = [];
  try {
    for (const role of [schedulerRole, workerRole]) {
      const secret = randomBytes(24).toString("hex");
      await f.admin.query(
        `CREATE ROLE ${sqlIdentifier(role)} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '${secret}'`,
      );
      const url = new URL(process.env.DATABASE_URL!);
      url.username = role;
      url.password = secret;
      urls.set(role, url.href);
    }
    const schedulerDb = new Pool({
        connectionString: urls.get(schedulerRole)!,
        max: 4,
      }),
      workerDb = new Pool({ connectionString: urls.get(workerRole)!, max: 3 });
    pools.push(schedulerDb, workerDb);
    const installed = await installQueue(f.admin, queueSchema);
    assert.equal(installed.schemaVersion, 40);
    assert.deepEqual(await installQueue(f.admin, queueSchema), installed);
    const grant = await f.admin.connect();
    try {
      await grantQueueAccess(grant, queueSchema, f.apiRole, schedulerRole);
    } finally {
      grant.release();
    }
    await f.admin.query(`CREATE TABLE ${scope}.queue_probe_fixture (
      id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,
      epoch uuid NOT NULL,step_revision int NOT NULL DEFAULT 1,status text NOT NULL DEFAULT 'pending',effects int NOT NULL DEFAULT 0,
      FOREIGN KEY(tenant_id,project_id) REFERENCES ${scope}.projects(tenant_id,id));
      ALTER TABLE ${scope}.queue_probe_fixture ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${scope}.queue_probe_fixture FORCE ROW LEVEL SECURITY;
      CREATE POLICY api_scope ON ${scope}.queue_probe_fixture TO ${sqlIdentifier(f.apiRole)}
        USING (${scope}.project_role(project_id) IS NOT NULL)
        WITH CHECK (tenant_id=${scope}.tenant_scope() AND ${scope}.project_role(project_id) IS NOT NULL);
      CREATE POLICY worker_scope ON ${scope}.queue_probe_fixture TO ${sqlIdentifier(workerRole)}
        USING (tenant_id=nullif(current_setting('app.worker_tenant',true),'')::uuid AND project_id=nullif(current_setting('app.worker_project',true),'')::uuid);
      GRANT SELECT,INSERT,UPDATE ON ${scope}.queue_probe_fixture TO ${sqlIdentifier(f.apiRole)};
      GRANT USAGE ON SCHEMA ${scope} TO ${sqlIdentifier(workerRole)};
      GRANT SELECT,UPDATE ON ${scope}.queue_probe_fixture TO ${sqlIdentifier(workerRole)};
      GRANT SELECT ON ${scope}.queue_probe_fixture TO ${sqlIdentifier(f.authorizerRole)};
      CREATE FUNCTION ${scope}.resolve_probe_scope(uuid) RETURNS TABLE(tenant_id uuid,project_id uuid)
        LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,${scope},pg_temp AS
        'SELECT tenant_id,project_id FROM ${scope}.queue_probe_fixture WHERE id=$1';
      ALTER FUNCTION ${scope}.resolve_probe_scope(uuid) OWNER TO ${sqlIdentifier(f.authorizerRole)};
      REVOKE ALL ON FUNCTION ${scope}.resolve_probe_scope(uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION ${scope}.resolve_probe_scope(uuid) TO ${sqlIdentifier(workerRole)};`);
    const producer = await createScheduler(f.runtime, {
      schema: queueSchema,
      onError: (e) => errors.push(e),
    });
    close.push(producer.close);
    const db = new Database(f.runtime, f.schema);
    const transaction = <T>(fn: (sql: import("pg").PoolClient) => Promise<T>) =>
      db.transaction(
        f.owner.token,
        { tenantId: f.tenant.id, projectId: f.project.id, write: true },
        (tx) => fn(tx.sql),
      );
    const step = (): StepEnvelope => ({
      taskKind: "media_probe",
      businessId: randomUUID(),
      stepRevision: 1,
      epoch: randomUUID(),
    });
    const insert = (sql: import("pg").PoolClient, s: StepEnvelope) =>
      sql.query(
        `INSERT INTO ${scope}.queue_probe_fixture(id,tenant_id,project_id,epoch) VALUES($1,$2,$3,$4)`,
        [s.businessId, f.tenant.id, f.project.id, s.epoch],
      );
    const state = async (s: StepEnvelope) =>
      (
        await f.admin.query(
          `SELECT * FROM ${scope}.queue_probe_fixture WHERE id=$1`,
          [s.businessId],
        )
      ).rows[0];
    const queued = async (s: StepEnvelope) =>
      (
        await f.admin.query(
          `SELECT * FROM ${queueSchema}.job_common WHERE data->>'businessId'=$1`,
          [s.businessId],
        )
      ).rows;
    const library = (pool: Pool) =>
      new PgBoss({
        schema: queueSchema,
        db: { executeSql: (text, values) => pool.query(text, values) },
        migrate: false,
        supervise: false,
        schedule: false,
        reindex: false,
      });
    const consumer = library(schedulerDb);
    consumer.on("error", (e) => errors.push(e));
    await consumer.start();
    close.push(() => consumer.stop());
    const migration = library(f.admin);
    migration.on("error", (e) => errors.push(e));
    await migration.start();
    close.push(() => migration.stop());

    await t.test(
      "business write and enqueue share the caller connection and roll back either failure",
      async () => {
        const a = step();
        await assert.rejects(
          transaction(async (sql) => {
            await insert(sql, a);
            await producer.schedule(sql, a);
            throw new Error("rollback");
          }),
          /rollback/,
        );
        assert.equal(await state(a), undefined);
        assert.equal((await queued(a)).length, 0);
        await f.admin.query(
          `REVOKE INSERT ON ${queueSchema}.job_common FROM ${sqlIdentifier(f.apiRole)}`,
        );
        try {
          await assert.rejects(
            transaction(async (sql) => {
              await insert(sql, a);
              await producer.schedule(sql, a);
            }),
            /permission denied/,
          );
        } finally {
          await f.admin.query(
            `GRANT INSERT ON ${queueSchema}.job_common TO ${sqlIdentifier(f.apiRole)}`,
          );
        }
        assert.equal(await state(a), undefined);
        await transaction(async (sql) => {
          await insert(sql, a);
          await producer.schedule(sql, a);
        });
        assert.equal((await queued(a)).length, 1);
        assert.equal((await state(a)).status, "pending");
        await f.admin.query(
          `DELETE FROM ${queueSchema}.job_common WHERE data->>'businessId'=$1`,
          [a.businessId],
        );
      },
    );
    await t.test(
      "producer cannot read payloads, claim work or migrate; scheduler cannot read business data",
      async () => {
        await assert.rejects(
          f.runtime.query(`SELECT data FROM ${queueSchema}.job_common`),
          /permission denied/,
        );
        await assert.rejects(
          f.runtime.query(
            `UPDATE ${queueSchema}.job_common SET state='active'`,
          ),
          /permission denied/,
        );
        await assert.rejects(
          f.runtime.query(`CREATE TABLE ${queueSchema}.forbidden(id int)`),
          /permission denied/,
        );
        await assert.rejects(
          schedulerDb.query(`SELECT * FROM ${scope}.projects`),
          /permission denied/,
        );
        await assert.rejects(
          schedulerDb.query(`CREATE TABLE ${queueSchema}.forbidden(id int)`),
          /permission denied/,
        );
        assert.equal(
          (await workerDb.query(`SELECT * FROM ${scope}.queue_probe_fixture`))
            .rowCount,
          0,
        );
        await assert.rejects(
          workerDb.query(`SELECT * FROM ${queueSchema}.job_common`),
          /permission denied/,
        );
        const clean = new PgBoss({
          schema: `${queueSchema}x`,
          db: { executeSql: (text, values) => schedulerDb.query(text, values) },
          migrate: false,
          supervise: false,
          schedule: false,
        });
        await assert.rejects(clean.start(), /not installed/);
        await clean.stop();
        assert.equal(
          (
            await f.admin.query("SELECT to_regnamespace($1) AS name", [
              `${queueSchema}x`,
            ])
          ).rows[0].name,
          null,
        );
        assert.throws(
          () => parseEnvelope({ ...step(), tenantId: f.tenant.id }),
          /Invalid/,
        );
        assert.throws(
          () => parseEnvelope({ ...step(), prompt: "private" }),
          /Invalid/,
        );
      },
    );
    await t.test(
      "delay survives producer restart; duplicates and stale epochs cannot repeat business effects",
      async () => {
        const s = step();
        await transaction(async (sql) => {
          await insert(sql, s);
          await producer.schedule(sql, s, new Date(Date.now() + 700));
        });
        assert.equal((await consumer.fetch(internalQueue)).length, 0);
        await producer.close();
        await delay(750);
        const [job] = await consumer.fetch<StepEnvelope>(internalQueue);
        assert.ok(job);
        await processProbe(workerDb, f.schema, job.data);
        await consumer.complete(internalQueue, job.id);
        const resumed = await createScheduler(f.runtime, {
          schema: queueSchema,
          onError: (e) => errors.push(e),
        });
        close.push(resumed.close);
        const worker = await runInternalWorker(
          schedulerDb,
          (data) => processProbe(workerDb, f.schema, data),
          {
            schema: queueSchema,
            onError: (e) => errors.push(e),
            concurrency: 2,
          },
        );
        close.push(worker.close);
        await transaction(async (sql) => {
          await resumed.schedule(sql, s);
          await resumed.schedule(sql, { ...s, epoch: randomUUID() });
        });
        await eventually(async () =>
          (await queued(s)).every((j) => j.state === "completed"),
        );
        assert.equal((await state(s)).effects, 1);
        await worker.close();
      },
    );
    await t.test(
      "SIGKILL before business commit rolls back; lost acknowledgement replays without another effect",
      async () => {
        // Compress only the library's timeout in this isolated test queue.
        await migration.updateQueue(internalQueue, {
          expireInSeconds: 2,
          heartbeatSeconds: 10,
          retryDelay: 0,
          retryBackoff: false,
        });
        for (const checkpoint of ["locked", "committed"] as const) {
          const producer2 = await createScheduler(f.runtime, {
            schema: queueSchema,
            onError: (e) => errors.push(e),
          });
          close.push(producer2.close);
          const s = step();
          await transaction(async (sql) => {
            await insert(sql, s);
            await producer2.schedule(sql, s);
          });
          const child = fork(
            fileURLToPath(
              new URL("../support/queue-crash-worker.ts", import.meta.url),
            ),
            [],
            {
              execArgv: ["--import", "tsx"],
              stdio: ["ignore", "ignore", "pipe", "ipc"],
              env: {
                PATH: process.env.PATH!,
                QUEUE_TEST_SCHEDULER_URL: urls.get(schedulerRole)!,
                QUEUE_TEST_WORKER_URL: urls.get(workerRole)!,
                QUEUE_TEST_SCHEMA: queueSchema,
                QUEUE_TEST_BUSINESS_SCHEMA: f.schema,
                QUEUE_TEST_CHECKPOINT: checkpoint,
              },
            },
          );
          const childErrors: string[] = [];
          child.stderr?.on("data", (chunk) => childErrors.push(String(chunk)));
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 6000);
            let message: unknown;
            try {
              [message] = await once(child, "message", {
                signal: controller.signal,
              });
            } catch {
              throw new Error(
                `Child did not reach checkpoint: ${childErrors.join("")}`,
              );
            } finally {
              clearTimeout(timer);
            }
            assert.deepEqual(message, { checkpoint });
          } finally {
            if (child.exitCode === null && child.signalCode === null) {
              const exit = once(child, "exit");
              child.kill("SIGKILL");
              await exit;
            }
          }
          assert.equal(
            (await state(s)).effects,
            checkpoint === "committed" ? 1 : 0,
          );
          await delay(2100);
          await consumer.supervise(internalQueue);
          // Supervisor's 60-second per-queue claim is reset by the migration fixture, not production code.
          if (!(await queued(s)).some((j) => j.state === "retry")) {
            await f.admin.query(
              `UPDATE ${queueSchema}.queue SET monitor_on=NULL,monitor_claim_on=NULL WHERE name=$1`,
              [internalQueue],
            );
            await consumer.supervise(internalQueue);
          }
          const worker = await runInternalWorker(
            schedulerDb,
            (data) => processProbe(workerDb, f.schema, data),
            {
              schema: queueSchema,
              onError: (e) => errors.push(e),
              concurrency: 1,
            },
          );
          close.push(worker.close);
          await eventually(async () =>
            (await queued(s)).every((j) => j.state === "completed"),
          );
          assert.equal((await state(s)).effects, 1);
          assert.equal((await state(s)).step_revision, 2);
          await worker.close();
        }
      },
    );
    await t.test(
      "retry exhaustion keeps a failed queue record without private error text or business success",
      async () => {
        await migration.updateQueue(internalQueue, {
          expireInSeconds: 30,
          retryLimit: 1,
          retryDelay: 0,
          retryBackoff: false,
        });
        const resumed = await createScheduler(f.runtime, {
          schema: queueSchema,
          onError: (e) => errors.push(e),
        });
        close.push(resumed.close);
        const s = step();
        await transaction(async (sql) => {
          await insert(sql, s);
          await resumed.schedule(sql, s);
        });
        const failures: Error[] = [];
        const worker = await runInternalWorker(
          schedulerDb,
          async () => {
            throw new Error("private signed URL fixture");
          },
          {
            schema: queueSchema,
            onError: (e) => failures.push(e),
            concurrency: 1,
          },
        );
        close.push(worker.close);
        await eventually(async () =>
          (await queued(s)).some((j) => j.state === "failed"),
        );
        await worker.close();
        assert.equal(failures.length, 2);
        const jobs = await queued(s);
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0].retry_count, 1);
        assert.equal(
          JSON.stringify(jobs[0].output).includes("private signed URL fixture"),
          false,
        );
        assert.equal((await state(s)).status, "pending");
        assert.equal((await state(s)).effects, 0);
      },
    );
    assert.deepEqual(errors, []);
  } finally {
    for (const stop of close.reverse()) await stop();
    for (const pool of pools) await pool.end();
    await f.admin.query(`DROP SCHEMA IF EXISTS ${queueSchema} CASCADE`);
    for (const role of [schedulerRole, workerRole]) {
      await f.admin.query(`DROP OWNED BY ${sqlIdentifier(role)}`);
      await f.admin.query(`DROP ROLE IF EXISTS ${sqlIdentifier(role)}`);
    }
  }
});
