import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getConstructionPlans, PgBoss } from "pg-boss";
import {
  internalQueue,
  queuePolicy,
  queueSchema,
  queueSchemaVersion,
  queueVersion,
  roleIdentifier,
} from "./config.js";

/** Migration identity only. Version changes require an explicit reviewed upgrade. */
export async function installQueue(pool: Pool, name?: string) {
  const schema = queueSchema(name),
    client = await pool.connect();
  const construction = getConstructionPlans(schema);
  let boss: PgBoss | undefined;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
      schema,
    ]);
    const present = await client.query("SELECT to_regclass($1) AS name", [
      `${schema}.version`,
    ]);
    if (!present.rows[0].name) await client.query(construction);
    const version = await client.query(`SELECT version FROM ${schema}.version`);
    if (
      version.rows.length !== 1 ||
      Number(version.rows[0].version) !== queueSchemaVersion
    )
      throw new Error("Queue schema upgrade requires a reviewed migration");
    boss = new PgBoss({
      db: { executeSql: (text, values) => client.query(text, values) },
      schema,
      migrate: false,
      supervise: false,
      schedule: false,
      reindex: false,
    });
    boss.on("error", () => {}); // Startup and provisioning queries are awaited below.
    await boss.start();
    await boss.createQueue(internalQueue, queuePolicy);
    const queue = await boss.getQueue(internalQueue);
    for (const [key, value] of Object.entries(queuePolicy))
      if (queue?.[key as keyof typeof queuePolicy] !== value)
        throw new Error(`Queue policy mismatch: ${key}`);
    await client.query(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC`);
    await client.query(
      `REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM PUBLIC`,
    );
    await client.query(
      `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schema} FROM PUBLIC`,
    );
    await client.query(
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM PUBLIC`,
    );
    return {
      packageVersion: queueVersion,
      schemaVersion: queueSchemaVersion,
      schema,
      constructionSha256: createHash("sha256")
        .update(construction)
        .digest("hex"),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    try {
      await boss?.stop();
    } finally {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1,0))",
          [schema],
        );
        client.release();
      } catch (error) {
        client.release(true);
        throw error;
      }
    }
  }
}

/** No queue DDL, stored-procedure execution, ownership or RLS bypass is granted. */
export async function grantQueueAccess(
  client: PoolClient,
  name: string,
  producerRole: string,
  schedulerRole: string,
) {
  const schema = queueSchema(name),
    producer = roleIdentifier(producerRole),
    scheduler = roleIdentifier(schedulerRole);
  if (producerRole === schedulerRole)
    throw new Error("Producer and scheduler identities must differ");
  await client.query(
    `GRANT USAGE ON SCHEMA ${schema} TO ${producer},${scheduler}`,
  );
  await client.query(
    `GRANT SELECT ON ${schema}.version,${schema}.queue TO ${producer},${scheduler}`,
  );
  // send() inserts into the pre-created partition and returns id. No envelope reads.
  await client.query(
    `GRANT INSERT,SELECT(id) ON ${schema}.job_common TO ${producer}`,
  );
  // Library retry moves rows by DELETE/INSERT. Supervision also cleans dependencies.
  await client.query(
    `GRANT SELECT,INSERT,UPDATE,DELETE ON ${schema}.job,${schema}.job_common TO ${scheduler}`,
  );
  await client.query(
    `GRANT SELECT,UPDATE,DELETE ON ${schema}.job_dependency TO ${scheduler}`,
  );
  await client.query(`GRANT UPDATE ON ${schema}.queue TO ${scheduler}`);
  await client.query(
    `GRANT UPDATE(flow_on,monitor_backoff_on) ON ${schema}.version TO ${scheduler}`,
  );
}

export async function verifyQueueRole(
  client: PoolClient,
  name: string,
  mode: "producer" | "scheduler",
) {
  const schema = queueSchema(name);
  const { rows } = await client.query(
    `SELECT
    r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb
    OR has_schema_privilege(current_user,n.oid,'CREATE')
    OR pg_has_role(r.oid,n.nspowner,'MEMBER')
    OR EXISTS (SELECT 1 FROM pg_roles p WHERE (p.rolsuper OR p.rolbypassrls OR p.rolcreaterole)
      AND pg_has_role(r.oid,p.oid,'MEMBER'))
    OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace=n.oid AND pg_has_role(r.oid,c.relowner,'MEMBER'))
    AS privileged
    FROM pg_roles r CROSS JOIN pg_namespace n WHERE r.rolname=current_user AND n.nspname=$1`,
    [schema],
  );
  if (rows.length !== 1 || rows[0].privileged)
    throw new Error(
      "Queue runtime requires an unprivileged non-owner identity",
    );
  const tables = mode === "producer" ? ["job_common"] : ["job_common", "job"];
  const privileges =
    mode === "producer" ? ["INSERT"] : ["SELECT", "INSERT", "UPDATE", "DELETE"];
  for (const table of tables)
    for (const privilege of privileges) {
      const result = await client.query(
        "SELECT has_table_privilege(current_user,$1,$2) AS allowed",
        [`${schema}.${table}`, privilege],
      );
      if (!result.rows[0].allowed)
        throw new Error(
          `Missing queue ${mode} permission: ${table} ${privilege}`,
        );
    }
  if (mode === "producer") {
    const rights = await client.query(
      `SELECT has_column_privilege(current_user,$1,'data','SELECT')
      OR has_any_column_privilege(current_user,$1,'UPDATE')
      OR has_table_privilege(current_user,$1,'DELETE,TRUNCATE') AS excessive`,
      [`${schema}.job_common`],
    );
    if (rights.rows[0].excessive)
      throw new Error("Producer must not consume or read queue envelopes");
  }
}
