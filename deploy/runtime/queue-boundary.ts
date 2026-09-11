import type { Pool } from "pg";
import type { StepEnvelope } from "@drama/queue";
import { DeploymentError } from "./config.js";

// Each kind must be handled by createMediaProcessor and have provisioned runtime grants.
export const supportedMediaTaskKinds = [
  "media_probe",
  "media_derivative",
  "media_generation",
] as const satisfies readonly StepEnvelope["taskKind"][];
export const supportsMediaTask = (kind: string) =>
  supportedMediaTaskKinds.some((supported) => supported === kind);

/** Read-only preflight. This cannot prove other processes will never publish new task kinds. */
export async function verifyMediaQueue(pool: Pool) {
  const result = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM scenedesk_queue.job WHERE name='media-probe' AND state < 'completed' AND (data->>'taskKind' IS NULL OR NOT(data->>'taskKind'=ANY($1::text[])))) AS incompatible`,
    [supportedMediaTaskKinds],
  );
  if (result.rows[0]?.incompatible)
    throw new DeploymentError("QUEUE_CONTAINS_UNSUPPORTED_WORK");
  const production = await pool.query(
    "SELECT * FROM drama.scan_media_production(1)",
  );
  if (production.rowCount)
    throw new DeploymentError("PENDING_POST_PRODUCTION_WORK");
}
