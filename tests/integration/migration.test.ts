import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { migrate } from "@drama/database";
const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.startsWith("/drama_"))
  throw new Error("Integration test requires a dedicated drama_* database");
test("real PG migration: concurrent runners, rerun, modified history and failed DDL rollback", async () => {
  const pool = new Pool({
    connectionString: url,
    max: 3,
    connectionTimeoutMillis: 3000,
  });
  const schema = `test_${randomBytes(6).toString("hex")}`;
  const directory = await mkdtemp(join(tmpdir(), "drama-migrations-"));
  const base = pathToFileURL(directory + "/");
  try {
    await writeFile(
      join(directory, "0001_first.sql"),
      "CREATE TABLE first_table (id integer PRIMARY KEY);",
    );
    const results = await Promise.all([
      migrate(pool, base, schema),
      migrate(pool, base, schema),
    ]);
    assert.equal(results.flatMap((result) => result.applied).length, 1);
    assert.equal((await migrate(pool, base, schema)).applied.length, 0);
    await writeFile(
      join(directory, "0001_first.sql"),
      "CREATE TABLE tampered (id integer);",
    );
    await assert.rejects(migrate(pool, base, schema), /changed or missing/);
    await writeFile(
      join(directory, "0001_first.sql"),
      "CREATE TABLE first_table (id integer PRIMARY KEY);",
    );
    await writeFile(
      join(directory, "0002_failure.sql"),
      "CREATE TABLE should_rollback (id integer); SELECT * FROM definitely_missing_table;",
    );
    await assert.rejects(migrate(pool, base, schema));
    const actual = await pool.query("SELECT to_regclass($1) AS relation", [
      `${schema}.should_rollback`,
    ]);
    assert.equal(actual.rows[0].relation, null);
    const versions = await pool.query(
      `SELECT name FROM "${schema}".schema_migrations`,
    );
    assert.equal(versions.rowCount, 1);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
