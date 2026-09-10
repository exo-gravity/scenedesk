import { randomBytes } from "node:crypto";
import { access, unlink, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { sqlIdentifier } from "@drama/database";
import {
  defaultQueueSchema,
  grantQueueAccess,
  installQueue,
} from "@drama/queue";

if (
  process.env.APP_ENV !== "local" ||
  !process.env.DATABASE_URL ||
  !process.env.RUNTIME_DATABASE_URL
)
  throw new Error("Load existing local .env and .env.business first");
const migration = new URL(process.env.DATABASE_URL),
  runtime = new URL(process.env.RUNTIME_DATABASE_URL);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(migration.hostname) ||
  !migration.pathname.startsWith("/drama_") ||
  migration.host !== runtime.host ||
  migration.pathname !== runtime.pathname
)
  throw new Error(
    "Local queue setup requires the same loopback drama_* database",
  );
const output = new URL("../.env.queue", import.meta.url);
try {
  await access(output);
  throw new Error(".env.queue already exists; reuse it with queue:check");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const role = `scenedesk_scheduler_${randomBytes(6).toString("hex")}`,
  password = randomBytes(32).toString("hex");
const pool = new Pool({ connectionString: migration.href, max: 2 });
try {
  const installed = await installQueue(pool);
  const sql = await pool.connect();
  let written = false;
  try {
    await sql.query("BEGIN");
    await sql.query(
      `CREATE ROLE ${sqlIdentifier(role)} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '${password}'`,
    );
    await grantQueueAccess(
      sql,
      defaultQueueSchema,
      decodeURIComponent(runtime.username),
      role,
    );
    const connection = new URL(migration);
    connection.username = role;
    connection.password = password;
    await writeFile(
      output,
      `QUEUE_SCHEMA=${defaultQueueSchema}\nSCHEDULER_DATABASE_URL=${connection.href}\n`,
      { mode: 0o600, flag: "wx" },
    );
    written = true;
    await sql.query("COMMIT");
  } catch (error) {
    await sql.query("ROLLBACK");
    if (written) await unlink(output);
    throw error;
  } finally {
    sql.release();
  }
  console.log(
    JSON.stringify({
      ...installed,
      localConfig: ".env.queue",
      schedulerProvisioned: true,
      paidProvidersEnabled: false,
    }),
  );
} finally {
  await pool.end();
}
