import type { Transaction } from "./database.js";
import { record } from "./database.js";
import { Secrets } from "./crypto.js";
import { Problem, requireThat } from "./errors.js";

export async function page<T>(
  tx: Transaction,
  secrets: Secrets,
  operation: string,
  query: Record<string, unknown>,
  sql: string,
  values: unknown[] = [],
) {
  const limit = typeof query.limit === "number" ? query.limit : 30;
  const context = JSON.stringify([
    operation,
    tx.session.userId,
    tx.tenantId,
    tx.projectId,
    query.q ?? null,
    query.projectId ?? null,
  ]);
  let after: string | null = null;
  if (query.cursor !== undefined) {
    try {
      const cursor = secrets.open<{ id: string }>(
        String(query.cursor),
        context,
      );
      requireThat(
        typeof cursor.id === "string" && /^[0-9a-f-]{36}$/.test(cursor.id),
        422,
        "INVALID_CURSOR",
        "列表游标无效。",
      );
      after = cursor.id;
    } catch {
      throw new Problem(
        422,
        "INVALID_CURSOR",
        "列表已变化或游标不属于当前查询，请重新打开列表。",
      );
    }
  }
  const index = values.length;
  const result = await tx.sql.query(
    `SELECT * FROM (${sql}) AS listed WHERE ($${index + 1}::uuid IS NULL OR id > $${index + 1}) ORDER BY id LIMIT $${index + 2}`,
    [...values, after, limit + 1],
  );
  const rows = result.rows.slice(0, limit);
  return {
    items: rows.map((r) => record<T>(r)),
    ...(result.rows.length > limit
      ? { nextCursor: secrets.seal({ id: rows.at(-1)!.id }, context) }
      : {}),
  };
}
export function searchPattern(query: Record<string, unknown>) {
  return `%${String(query.q ?? "").replace(/[\\%_]/g, "\\$&")}%`;
}
