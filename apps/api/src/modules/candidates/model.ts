import { randomUUID } from "node:crypto";
import type { Transaction } from "../../kernel/database.js";
import { requireThat } from "../../kernel/errors.js";
import { contentRecord, type Schema } from "../content/model.js";

export function takeRecord(row: Record<string, unknown>): Schema<"Take"> {
  const { in_us, out_us, ...fields } = row;
  return {
    ...contentRecord<Schema<"Take">>(fields),
    range: { inUs: Number(in_us), outUs: Number(out_us) },
  };
}
export async function getTake(tx: Transaction, id: string) {
  const result = await tx.sql.query(
    "SELECT * FROM takes WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
    [tx.tenantId, tx.projectId, id],
  );
  requireThat(result.rows[0], 404, "NOT_FOUND", "候选不存在或不属于当前项目。");
  return takeRecord(result.rows[0]);
}
export function validText(text?: string) {
  requireThat(
    !Array.from(text ?? "").some(
      (c) =>
        c === "\0" ||
        (c.codePointAt(0)! >= 0xd800 && c.codePointAt(0)! <= 0xdfff),
    ),
    422,
    "INVALID_CANDIDATE_TEXT",
    "请输入有效的候选说明。",
  );
}
/** Canvas binding may reuse an existing note, but never replace fixed provenance. */
export async function archiveTake(
  tx: Transaction,
  body: Schema<"TakeInput">,
  retainExistingNote = false,
) {
  validText(body.note);
  const values = [
    body.shotRevisionId,
    body.mediaId,
    body.range.inUs,
    body.range.outUs,
  ];
  // Identity deduplication survives a new request key. Immutable metadata
  // cannot be silently replaced by a second archive command.
  const old = await tx.sql.query(
    "SELECT * FROM takes WHERE tenant_id=$1 AND project_id=$2 AND shot_revision_id=$3 AND media_id=$4 AND in_us=$5 AND out_us=$6",
    [tx.tenantId, tx.projectId, ...values],
  );
  if (old.rows[0]) {
    const found = takeRecord(old.rows[0]);
    requireThat(
      found.shotId === body.shotId.toLowerCase() &&
        (found.sourceTakeId ?? null) ===
          (body.sourceTakeId?.toLowerCase() ?? null) &&
        (retainExistingNote || (found.note ?? null) === (body.note ?? null)),
      409,
      "TAKE_ALREADY_EXISTS",
      "这份要求和视频区间已有候选；说明与来源不能覆盖，请打开已有候选核对。",
    );
    return found;
  }
  const id = randomUUID();
  await tx.sql.query(
    "INSERT INTO takes(id,tenant_id,project_id,shot_id,shot_revision_id,media_id,in_us,out_us,source_take_id,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      id,
      tx.tenantId,
      tx.projectId,
      body.shotId,
      ...values,
      body.sourceTakeId ?? null,
      body.note ?? null,
      tx.session.userId,
    ],
  );
  return getTake(tx, id);
}
