import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import {
  migrate,
  grantAuthAccess,
  grantRuntimeAccess,
  hardenAuthorizationFunctions,
  sqlIdentifier,
} from "@drama/database";

/** The same restricted-role database fixture can be owned by node:test or E2E. */
export type FixtureLifecycle = {
  after: (cleanup: () => void | Promise<void>) => void;
};

export async function databaseFixture(t: FixtureLifecycle) {
  const connectionString = process.env.DATABASE_URL;
  if (
    !connectionString ||
    !new URL(connectionString).pathname.startsWith("/drama_")
  )
    throw new Error("Integration test requires a dedicated drama_* database");
  const suffix = randomBytes(6).toString("hex"),
    schema = `identity_${suffix}`;
  const apiRole = `api_${suffix}`,
    authRole = `auth_${suffix}`,
    authorizerRole = `guard_${suffix}`;
  const admin = new Pool({ connectionString, max: 4 });
  const passwords = {
    api: randomBytes(24).toString("hex"),
    auth: randomBytes(24).toString("hex"),
  };
  const connection = (username: string, password: string) => {
    const url = new URL(connectionString);
    url.username = username;
    url.password = password;
    return url.href;
  };
  const runtime = new Pool({
    connectionString: connection(apiRole, passwords.api),
    max: 4,
  });
  const auth = new Pool({
    connectionString: connection(authRole, passwords.auth),
    max: 2,
  });
  t.after(async () => {
    await runtime.end();
    await auth.end();
    try {
      await admin.query(
        `DROP SCHEMA IF EXISTS ${sqlIdentifier(schema)} CASCADE`,
      );
      for (const role of [apiRole, authRole, authorizerRole])
        await admin.query(`DROP ROLE IF EXISTS ${sqlIdentifier(role)}`);
    } finally {
      await admin.end();
    }
  });
  // Passwords here are generated hexadecimal test secrets, never user input.
  for (const [role, password] of [
    [apiRole, passwords.api],
    [authRole, passwords.auth],
  ])
    await admin.query(
      `CREATE ROLE ${sqlIdentifier(role!)} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT PASSWORD '${password}'`,
    );
  await admin.query(
    `CREATE ROLE ${sqlIdentifier(authorizerRole)} NOLOGIN NOINHERIT NOSUPERUSER BYPASSRLS NOCREATEROLE NOCREATEDB`,
  );
  await migrate(
    admin,
    new URL("../../packages/database/migrations/", import.meta.url),
    schema,
  );
  const provision = await admin.connect();
  try {
    await hardenAuthorizationFunctions(provision, schema, authorizerRole);
    await grantRuntimeAccess(provision, schema, apiRole);
    await grantAuthAccess(provision, schema, authRole);
  } finally {
    provision.release();
  }
  return { admin, runtime, auth, schema, apiRole, authRole, authorizerRole };
}
