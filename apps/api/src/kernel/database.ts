import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { sqlIdentifier, verifyRuntimeRole } from "@drama/database";
import { digest } from "./crypto.js";
import { requireThat } from "./errors.js";

export type SessionRecord = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  csrfSecretRef: string;
};
export function record<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      value instanceof Date
        ? value.toISOString()
        : key === "revision"
          ? Number(value)
          : value,
    ]),
  ) as T;
}
export type Transaction = {
  sql: PoolClient;
  session: SessionRecord;
  tenantId?: string;
  tenantRole?: string;
  projectId?: string;
  projectRole?: string;
};
export type Scope = { tenantId?: string; projectId?: string; write: boolean };
export class Database {
  constructor(
    readonly pool: Pool,
    readonly schema = "drama",
  ) {
    sqlIdentifier(schema);
  }
  async verify() {
    const client = await this.pool.connect();
    try {
      await verifyRuntimeRole(client, this.schema);
    } finally {
      client.release();
    }
  }
  async transaction<T>(
    sessionToken: string,
    scope: Scope,
    run: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    const sql = await this.pool.connect();
    try {
      await sql.query("BEGIN");
      await sql.query(
        `SET LOCAL search_path TO ${sqlIdentifier(this.schema)}, pg_catalog`,
      );
      await sql.query("SET LOCAL statement_timeout = '10s'");
      await sql.query("SET LOCAL lock_timeout = '5s'");
      const auth = await sql.query("SELECT * FROM authenticate_session($1)", [
        digest(sessionToken),
      ]);
      requireThat(auth.rows.length === 1, 401, "UNAUTHENTICATED", "请先登录。");
      const session = record<SessionRecord>(auth.rows[0]!);
      await sql.query(
        "SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)",
        [session.userId, scope.tenantId ?? ""],
      );
      const tx: Transaction = { sql, session };
      if (scope.tenantId) {
        // All membership/permission mutations share the tenant root lock.
        const found = await sql.query("SELECT lock_tenant($1, $2) AS role", [
          scope.tenantId,
          scope.write && !scope.projectId,
        ]);
        requireThat(
          found.rows[0]?.role,
          404,
          "NOT_FOUND",
          "工作室不存在或无访问权限。",
        );
        tx.tenantId = scope.tenantId;
        tx.tenantRole = found.rows[0].role;
      }
      if (scope.projectId) {
        const found = await sql.query("SELECT lock_project($1, $2) AS role", [
          scope.projectId,
          scope.write,
        ]);
        requireThat(
          found.rows[0]?.role,
          404,
          "NOT_FOUND",
          "项目不存在或无访问权限。",
        );
        tx.projectId = scope.projectId;
        tx.projectRole = found.rows[0].role;
      }
      const result = await run(tx);
      await sql.query("COMMIT");
      return result;
    } catch (error) {
      await sql.query("ROLLBACK");
      throw error;
    } finally {
      sql.release();
    }
  }
}
export async function audit(
  tx: Transaction,
  operation: string,
  objectId?: string,
  details: Record<string, unknown> = {},
) {
  await tx.sql.query(
    "INSERT INTO audit_events (id, actor_id, tenant_id, project_id, operation_id, object_id, details) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [
      randomUUID(),
      tx.session.userId,
      tx.tenantId ?? null,
      tx.projectId ?? null,
      operation,
      objectId ?? null,
      details,
    ],
  );
}
