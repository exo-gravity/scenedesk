import type { Pool } from "pg";
import type { StepEnvelope } from "@drama/queue";
import { sqlIdentifier } from "@drama/database";

/** Test-only business root. Production media handlers must enforce their own typed state. */
export async function processProbe(
  pool: Pool,
  schema: string,
  step: StepEnvelope,
  checkpoint?: (at: "locked" | "committed") => Promise<void>,
) {
  const scope = sqlIdentifier(schema),
    sql = await pool.connect();
  try {
    await sql.query("BEGIN");
    const trusted = await sql.query(
      `SELECT * FROM ${scope}.resolve_probe_scope($1)`,
      [step.businessId],
    );
    if (!trusted.rows.length) {
      await sql.query("COMMIT");
      return;
    }
    await sql.query(
      "SELECT set_config('app.worker_tenant',$1,true),set_config('app.worker_project',$2,true)",
      [trusted.rows[0].tenant_id, trusted.rows[0].project_id],
    );
    const { rows } = await sql.query(
      `SELECT * FROM ${scope}.queue_probe_fixture WHERE id=$1 FOR UPDATE`,
      [step.businessId],
    );
    const root = rows[0];
    if (
      !root ||
      root.epoch !== step.epoch ||
      root.step_revision !== step.stepRevision ||
      root.status !== "pending"
    ) {
      await sql.query("COMMIT");
      return;
    }
    await checkpoint?.("locked");
    await sql.query(
      `UPDATE ${scope}.queue_probe_fixture SET status='done',effects=effects+1,step_revision=step_revision+1 WHERE id=$1`,
      [step.businessId],
    );
    await sql.query("COMMIT");
    await checkpoint?.("committed");
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  } finally {
    sql.release();
  }
}
