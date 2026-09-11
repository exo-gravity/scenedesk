import type { PoolClient } from "pg";
import { sqlIdentifier } from "@drama/database";
import { DeploymentError } from "./config.js";
import { supportedMediaTaskKinds } from "./queue-boundary.js";

/** Read business facts without repairing, claiming or changing any job or capability. */
export async function readGenerationAudit(sql: PoolClient, schema = "drama") {
  const scope = sqlIdentifier(schema);
  const result = await sql.query(`SELECT
    (SELECT count(*) FROM ${scope}.generation_capabilities WHERE enabled)::integer AS enabled_capabilities,
    count(*) FILTER(WHERE j.status IN ('archiving','archive_failed') AND EXISTS(
      SELECT 1 FROM ${scope}.generation_media_outputs o
      WHERE o.job_id=j.id AND o.tenant_id=j.tenant_id AND o.project_id=j.project_id
    ))::integer AS fixed_archive_jobs,
    count(*) FILTER(WHERE j.status IN ('archiving','archive_failed') AND NOT EXISTS(
      SELECT 1 FROM ${scope}.generation_media_outputs o
      WHERE o.job_id=j.id AND o.tenant_id=j.tenant_id AND o.project_id=j.project_id
    ))::integer AS missing_archive_sources,
    count(*) FILTER(WHERE j.status NOT IN ('succeeded','failed','cancelled','archiving','archive_failed'))::integer AS executor_required_jobs
    FROM ${scope}.generation_jobs j`);
  return result.rows[0] as {
    enabled_capabilities: number;
    fixed_archive_jobs: number;
    missing_archive_sources: number;
    executor_required_jobs: number;
  };
}

export function requireGenerationAudit(
  report: Awaited<ReturnType<typeof readGenerationAudit>>,
) {
  if (report.missing_archive_sources)
    throw new DeploymentError("GENERATION_ARCHIVE_SOURCE_MISSING");
  if (report.executor_required_jobs)
    throw new DeploymentError("GENERATION_EXECUTOR_UNAVAILABLE");
}

export async function readDeploymentAudit(sql: PoolClient) {
  const result = await sql.query(
    `SELECT
    (SELECT count(*) FROM drama.media_production_copies WHERE status='processing')::integer AS post_production,
    (SELECT count(*) FROM scenedesk_queue.job WHERE name='media-probe' AND state < 'completed' AND (data->>'taskKind' IS NULL OR NOT(data->>'taskKind'=ANY($1::text[]))))::integer AS unsupported_queue`,
    [supportedMediaTaskKinds],
  );
  return { ...result.rows[0], ...(await readGenerationAudit(sql)) };
}
