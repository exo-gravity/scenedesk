import {
  configuration,
  field,
  database,
  pool,
  diagnostic,
  fail,
} from "./config.js";
let connection: ReturnType<typeof pool> | undefined;
try {
  const config = await configuration();
  connection = pool(database(field(config, "databaseUrl")), 1);
  const sql = await connection.connect();
  try {
    await sql.query("BEGIN READ ONLY");
    const result = await sql.query(`SELECT
      (SELECT count(*) FROM drama.media_production_copies WHERE status='processing')::integer AS post_production,
      (SELECT count(*) FROM drama.generation_capabilities WHERE enabled)::integer AS enabled_generation,
      (SELECT count(*) FROM drama.generation_jobs WHERE status NOT IN ('succeeded','failed','cancelled'))::integer AS pending_generation,
      (SELECT count(*) FROM scenedesk_queue.job WHERE name='media-probe' AND state < 'completed' AND (data->>'taskKind' IS NULL OR data->>'taskKind' NOT IN ('media_probe','media_derivative')))::integer AS unsupported_queue`);
    await sql.query("COMMIT");
    if (result.rows[0].post_production)
      fail("PENDING_POST_PRODUCTION_BUSINESS_WORK");
    if (result.rows[0].unsupported_queue)
      fail("QUEUE_CONTAINS_UNSUPPORTED_WORK");
    if (result.rows[0].enabled_generation || result.rows[0].pending_generation)
      fail("GENERATION_EXECUTOR_NOT_PACKAGED");
    console.log(
      JSON.stringify({
        status: "ok",
        scope: "read_only_deployment_audit",
        exclusiveProducersStillRequireOperatorIsolation: true,
        generationEnabled: false,
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
