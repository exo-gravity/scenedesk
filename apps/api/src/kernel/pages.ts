import type { Transaction } from "./database.js";
import { record } from "./database.js";
import { canonical, Secrets } from "./crypto.js";
import { Problem, requireThat } from "./errors.js";

export async function page<T>(
  tx: Transaction,
  secrets: Secrets,
  operation: string,
  query: Record<string, unknown>,
  sql: string,
  values: unknown[] = [],
  map: (row: Record<string, unknown>) => T = record<T>,
) {
  requireThat(
    !tx.projectId || !query.projectId || query.projectId === tx.projectId,
    422,
    "PROJECT_FILTER_MISMATCH",
    "项目筛选必须与当前项目一致。",
  );
  const limit = typeof query.limit === "number" ? query.limit : 30;
  const context = canonical([
    operation,
    tx.session.userId,
    tx.tenantId ?? null,
    tx.projectId ?? null,
    Object.fromEntries(
      Object.entries(query).filter(
        ([key]) => key !== "cursor" && key !== "limit",
      ),
    ),
  ]);
  let after: { id: string; createdAt: string } | null = null;
  if (query.cursor !== undefined) {
    try {
      const cursor = secrets.open<{ id: string; createdAt: string }>(
        String(query.cursor),
        context,
      );
      requireThat(
        typeof cursor.id === "string" &&
          /^[0-9a-f-]{36}$/.test(cursor.id) &&
          typeof cursor.createdAt === "string" &&
          Number.isFinite(Date.parse(cursor.createdAt)),
        422,
        "INVALID_CURSOR",
        "列表游标无效。",
      );
      after = cursor;
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
    `SELECT *, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at FROM (${sql}) AS listed WHERE ($${index + 1}::uuid IS NULL OR (created_at,id) > ($${index + 2}::timestamptz,$${index + 1}::uuid)) ORDER BY created_at,id LIMIT $${index + 3}`,
    [...values, after?.id ?? null, after?.createdAt ?? null, limit + 1],
  );
  const rows = result.rows.slice(0, limit);
  return {
    items: rows.map(({ cursor_created_at: _cursor, ...r }) => map(r)),
    ...(result.rows.length > limit
      ? {
          nextCursor: secrets.seal(
            { id: rows.at(-1)!.id, createdAt: rows.at(-1)!.cursor_created_at },
            context,
          ),
        }
      : {}),
  };
}
export function searchPattern(query: Record<string, unknown>) {
  return `%${String(query.q ?? "").replace(/[\\%_]/g, "\\$&")}%`;
}
