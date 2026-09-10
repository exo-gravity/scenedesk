import { Pool } from "pg";
import {
  grantRuntimeAccess,
  migrate,
  verifyRuntimeRole,
} from "@drama/database";

// Reapply explicit grants after migrations without creating identities or rotating secrets.
if (
  process.env.APP_ENV !== "local" ||
  !process.env.DATABASE_URL ||
  !process.env.RUNTIME_DATABASE_URL
)
  throw new Error("Load the existing local .env and .env.business first");
const migration = new URL(process.env.DATABASE_URL),
  runtime = new URL(process.env.RUNTIME_DATABASE_URL);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(migration.hostname) ||
  !migration.pathname.startsWith("/drama_") ||
  migration.host !== runtime.host ||
  migration.pathname !== runtime.pathname
)
  throw new Error("Local upgrade requires the same loopback drama_* database");
const admin = new Pool({ connectionString: migration.href, max: 2 }),
  api = new Pool({ connectionString: runtime.href, max: 1 });
try {
  const result = await migrate(
    admin,
    new URL("../packages/database/migrations/", import.meta.url),
  );
  const sql = await admin.connect();
  try {
    await sql.query("BEGIN");
    await grantRuntimeAccess(
      sql,
      "drama",
      decodeURIComponent(runtime.username),
    );
    await sql.query("COMMIT");
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  } finally {
    sql.release();
  }
  const client = await api.connect();
  try {
    await verifyRuntimeRole(client, "drama");
  } finally {
    client.release();
  }
  console.log(JSON.stringify({ ...result, runtimeAccessVerified: true }));
} finally {
  await api.end();
  await admin.end();
}
