import {
  migrate,
  hardenAuthorizationFunctions,
  grantRuntimeAccess,
  grantAuthAccess,
  grantMediaWorkerAccess,
  sqlIdentifier,
} from "@drama/database";
import { installQueue, grantQueueAccess } from "@drama/queue";
import {
  configuration,
  keys,
  field,
  database,
  pool,
  fail,
  diagnostic,
} from "./config.js";

let stage = "provision_configuration";
let connection: ReturnType<typeof pool> | undefined;
try {
  if (!process.argv.includes("--apply")) fail("EXPLICIT_APPLY_REQUIRED");
  const config = await configuration();
  keys(config, [
    "databaseUrl",
    "apiRole",
    "authRole",
    "mediaRole",
    "schedulerRole",
    "authorizationOwner",
  ]);
  const roles = [
    "apiRole",
    "authRole",
    "mediaRole",
    "schedulerRole",
    "authorizationOwner",
  ].map((key) => field(config, key));
  roles.forEach(sqlIdentifier);
  if (new Set(roles).size !== roles.length) fail("PROVISION_ROLES_MUST_DIFFER");
  connection = pool(database(field(config, "databaseUrl")), 2);
  stage = "existing_database_roles";
  const found = await connection.query(
    "SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])",
    [roles],
  );
  if (found.rowCount !== roles.length)
    fail("PRECREATE_DATABASE_ROLES_REQUIRED");
  stage = "versioned_migrations";
  const migrations = await migrate(
    connection,
    new URL("../../packages/database/migrations/", import.meta.url),
  );
  stage = "queue_provisioning";
  await installQueue(connection);
  stage = "explicit_runtime_grants";
  const sql = await connection.connect();
  try {
    await sql.query("BEGIN");
    await hardenAuthorizationFunctions(sql, "drama", roles[4]!);
    await grantRuntimeAccess(sql, "drama", roles[0]!);
    await grantAuthAccess(sql, "drama", roles[1]!);
    await grantMediaWorkerAccess(sql, "drama", roles[2]!, roles[3]!);
    await grantQueueAccess(sql, "scenedesk_queue", roles[0]!, roles[3]!);
    await grantQueueAccess(sql, "scenedesk_queue", roles[2]!, roles[3]!);
    await sql.query("COMMIT");
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  } finally {
    sql.release();
  }
  console.log(
    JSON.stringify({
      status: "ok",
      scope: "database_provisioning",
      migrationCount: migrations.total,
      appliedCount: migrations.applied.length,
      paidProvidersEnabled: false,
    }),
  );
} catch (error) {
  diagnostic(error, stage);
  process.exitCode = 1;
} finally {
  await connection?.end();
}
