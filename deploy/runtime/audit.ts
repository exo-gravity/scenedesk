import {
  configuration,
  field,
  database,
  pool,
  diagnostic,
  fail,
} from "./config.js";
import {
  readDeploymentAudit,
  requireGenerationAudit,
} from "./deployment-audit.js";
let connection: ReturnType<typeof pool> | undefined;
try {
  const config = await configuration();
  connection = pool(database(field(config, "databaseUrl")), 1);
  const sql = await connection.connect();
  try {
    const executorConfigured = process.argv.includes("--generation-executor");
    await sql.query("BEGIN READ ONLY");
    const report = await readDeploymentAudit(sql);
    await sql.query("COMMIT");
    console.log(
      JSON.stringify({
        status: "observed",
        scope: "read_only_deployment_audit",
        generationExecutor: executorConfigured ? "configured" : "unavailable",
        ...report,
      }),
    );
    if (report.post_production) fail("PENDING_POST_PRODUCTION_BUSINESS_WORK");
    if (report.unsupported_queue) fail("QUEUE_CONTAINS_UNSUPPORTED_WORK");
    requireGenerationAudit(report, { executorConfigured });
    console.log(
      JSON.stringify({
        status: "ok",
        scope: "read_only_deployment_audit",
        exclusiveProducersStillRequireOperatorIsolation: true,
        generationExecutor: executorConfigured ? "configured" : "unavailable",
        newGenerationSubmissionsEnabled: executorConfigured,
        enabledCapabilitiesDoNotGrantExecution: true,
        postProductionPending: false,
      }),
    );
  } finally {
    sql.release();
  }
} catch (error) {
  diagnostic(error, "deployment_audit");
  process.exitCode = 1;
} finally {
  await connection?.end();
}
