import { randomBytes } from "node:crypto";
import { writeFile, access } from "node:fs/promises";
import { Pool } from "pg";
import {
  migrate,
  grantRuntimeAccess,
  grantAuthAccess,
  hardenAuthorizationFunctions,
  sqlIdentifier,
} from "@drama/database";

if (process.env.APP_ENV !== "local" || !process.env.DATABASE_URL)
  throw new Error("Use the local .env with APP_ENV=local and DATABASE_URL");
const migrationUrl = new URL(process.env.DATABASE_URL);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(migrationUrl.hostname) ||
  !migrationUrl.pathname.startsWith("/drama_")
)
  throw new Error("Local setup accepts only a loopback drama_* database");
const output = new URL("../.env.business", import.meta.url);
try {
  await access(output);
  throw new Error(
    ".env.business already exists; reuse it or move it aside explicitly before provisioning another local setup",
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const suffix = randomBytes(6).toString("hex");
const apiRole = `scenedesk_api_${suffix}`,
  authRole = `scenedesk_auth_${suffix}`,
  guardRole = `scenedesk_guard_${suffix}`;
const apiPassword = randomBytes(32).toString("hex"),
  authPassword = randomBytes(32).toString("hex");
const pool = new Pool({ connectionString: migrationUrl.href, max: 2 });
try {
  await migrate(
    pool,
    new URL("../packages/database/migrations/", import.meta.url),
  );
  const sql = await pool.connect();
  try {
    await sql.query("BEGIN");
    for (const [role, password] of [
      [apiRole, apiPassword],
      [authRole, authPassword],
    ])
      await sql.query(
        `CREATE ROLE ${sqlIdentifier(role!)} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '${password}'`,
      );
    await sql.query(
      `CREATE ROLE ${sqlIdentifier(guardRole)} NOLOGIN NOINHERIT NOSUPERUSER BYPASSRLS NOCREATEROLE NOCREATEDB`,
    );
    await hardenAuthorizationFunctions(sql, "drama", guardRole);
    await grantRuntimeAccess(sql, "drama", apiRole);
    await grantAuthAccess(sql, "drama", authRole);
    const connection = (role: string, password: string) => {
      const url = new URL(migrationUrl);
      url.username = role;
      url.password = password;
      return url.href;
    };
    const env = {
      APP_ENV: "local",
      PROVIDER_MODE: "mock",
      HOST: "127.0.0.1",
      PORT: "4310",
      APP_ORIGIN: "http://127.0.0.1:4311",
      RUNTIME_DATABASE_URL: connection(apiRole, apiPassword),
      AUTH_DATABASE_URL: connection(authRole, authPassword),
      APP_SECRET: randomBytes(32).toString("base64url"),
      OIDC_ISSUER: "http://127.0.0.1:4320",
      OIDC_CLIENT_ID: "fixture-client",
      OIDC_CLIENT_SECRET: "fixture-secret",
      OIDC_ALLOW_LOCAL: "true",
    };
    await writeFile(
      output,
      Object.entries(env)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
      { mode: 0o600, flag: "wx" },
    );
    await sql.query("COMMIT");
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  } finally {
    sql.release();
  }
  console.log(
    "Local business roles and .env.business created. Run npm run dev:business; no external identity provider or model account is required.",
  );
} finally {
  await pool.end();
}
