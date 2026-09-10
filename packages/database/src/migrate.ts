import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import type { Pool } from "pg";

export async function migrate(pool: Pool, directory: URL, schema = "drama") {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema))
    throw new Error("Invalid migration schema");
  const names = (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const migrations = await Promise.all(
    names.map(async (name) => {
      const sql = await readFile(new URL(name, directory), "utf8");
      return {
        name,
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      `drama:migrate:${schema}`,
    ]);
    locked = true;
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS "${schema}".schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const applied = await client.query<{ name: string; checksum: string }>(
      `SELECT name, checksum FROM "${schema}".schema_migrations ORDER BY name`,
    );
    for (const row of applied.rows) {
      const migration = migrations.find((item) => item.name === row.name);
      if (!migration || migration.checksum !== row.checksum)
        throw new Error(`Applied migration changed or missing: ${row.name}`);
    }
    const last = applied.rows.at(-1)?.name;
    const pending = migrations.filter(
      (item) => !applied.rows.some((row) => row.name === item.name),
    );
    if (last && pending.some((item) => item.name < last))
      throw new Error("Out-of-order migration refused");
    for (const migration of pending) {
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO "${schema}".schema_migrations (name, checksum) VALUES ($1, $2)`,
          [migration.name, migration.checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return {
      applied: pending.map((item) => item.name),
      total: applied.rows.length + pending.length,
    };
  } finally {
    // If unlock fails, destroy the connection rather than return a locked session to the pool.
    let broken = false;
    if (locked) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [`drama:migrate:${schema}`],
        );
      } catch {
        broken = true;
      }
    }
    client.release(broken);
  }
}
