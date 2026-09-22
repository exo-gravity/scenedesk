import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { grantGenerationWorkerAccess, sqlIdentifier } from "@drama/database";
import { businessFixture } from "../support/business.js";

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
