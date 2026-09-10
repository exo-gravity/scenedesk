import { Pool } from "pg";
import {
  grantRuntimeAccess,
  hardenAuthorizationFunctions,
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
    const owner = await sql.query<{ role: string }>(
      "SELECT r.rolname AS role FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='drama' AND p.proname='authenticate_session' AND p.prosecdef",
    );
    if (owner.rows.length !== 1)
      throw new Error("Existing authorization owner could not be resolved");
    await hardenAuthorizationFunctions(sql, "drama", owner.rows[0]!.role);
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
