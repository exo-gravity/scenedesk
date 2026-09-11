import type { Pool, PoolClient } from "pg";
import { sqlIdentifier } from "@drama/database";
import { parseEnvelope, type StepEnvelope } from "@drama/queue";

/** Reconstruct lost scheduling hints from business state; never reads queue payloads as authority. */
export async function repairMediaWork(options: {
  pool: Pool;
  schema?: string;
  schedule(sql: PoolClient, step: StepEnvelope): Promise<unknown>;
  includeProduction?: boolean;
}) {
  const sql = await options.pool.connect();
  try {
    await sql.query("BEGIN");
    await sql.query("SET LOCAL statement_timeout='10s'");
    const rows = await sql.query(
      `SELECT * FROM ${sqlIdentifier(options.schema ?? "drama")}.scan_media_work(100) UNION ALL SELECT * FROM ${sqlIdentifier(options.schema ?? "drama")}.scan_generated_media(100)` +
        (options.includeProduction
          ? ` UNION ALL SELECT * FROM ${sqlIdentifier(options.schema ?? "drama")}.scan_media_production(100)`
          : ""),
    );
    for (const row of rows.rows)
      await options.schedule(
        sql,
        parseEnvelope({
          taskKind: row.task_kind,
          businessId: row.business_id,
          stepRevision: Number(row.step_revision),
          epoch: Number(row.epoch),
        }),
      );
    await sql.query("COMMIT");
    return rows.rowCount ?? 0;
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  } finally {
    sql.release();
  }
}
