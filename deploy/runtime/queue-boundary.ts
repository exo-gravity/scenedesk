import type { Pool } from "pg";
import { DeploymentError } from "./config.js";
/** Read-only preflight. This cannot prove other processes will never publish new task kinds. */
export async function verifyImportQueue(pool: Pool) {
  const result = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM scenedesk_queue.job WHERE name='media-probe' AND state < 'completed' AND (data->>'taskKind' IS NULL OR data->>'taskKind' NOT IN ('media_probe','media_derivative'))) AS incompatible`,
  );
  if (result.rows[0]?.incompatible)
    throw new DeploymentError("QUEUE_CONTAINS_UNSUPPORTED_WORK");
  const production = await pool.query(
    "SELECT * FROM drama.scan_media_production(1)",
  );
  if (production.rowCount)
    throw new DeploymentError("PENDING_POST_PRODUCTION_WORK");
}
