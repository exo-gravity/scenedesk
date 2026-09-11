import { canvasDraftInput } from "./canvas-context.js";
import type { Transaction } from "../../kernel/database.js";
import { canonical, digest } from "../../kernel/crypto.js";
import { requireThat, versionMatches } from "../../kernel/errors.js";
import type { Schema } from "../content/model.js";
export function safeText(text: string, max = 20000) {
  requireThat(
    Array.from(text).length <= max &&
      !Array.from(text).some(
        (c) =>
          c === "\0" ||
          (c.codePointAt(0)! >= 0xd800 && c.codePointAt(0)! <= 0xdfff),
      ),
    422,
    "GENERATION_CONTEXT_TOO_LARGE",
    "所选文本过长或含无效字符，请缩小明确选区。",
  );
  return text;
}
export async function resolveContext(
  tx: Transaction,
  source: Schema<"ContextSourceInput">,
  checkVersion: boolean,
) {
  if (source.kind === "canvas_draft")
    return (await canvasDraftInput(tx, source, checkVersion)).snapshot;
  const id = source.objectId.toLowerCase();
  let row: Record<string, any> | undefined, value: unknown;
  if (source.kind === "scene" || source.kind === "production") {
    const table = source.kind === "scene" ? "scenes" : "productions";
    row = (
      await tx.sql.query(
        `SELECT * FROM ${table} WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,
        [tx.tenantId, tx.projectId, id],
      )
    ).rows[0];
    if (row)
      value =
        source.kind === "scene"
          ? { summary: row.summary, state: row.state }
          : { brief: row.brief };
  } else if (source.kind === "shot_revision") {
    row = (
      await tx.sql.query(
        "SELECT * FROM shot_revisions WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
        [tx.tenantId, tx.projectId, id],
      )
    ).rows[0];
    if (row) {
      const {
        references: _references,
        assetBindings: _bindings,
        ...text
      } = row.spec;
      value = text;
    }
  } else if (source.kind === "asset_revision") {
    row = (
      await tx.sql.query(
        "SELECT r.* FROM asset_revisions r WHERE r.tenant_id=$1 AND r.id=$2 AND asset_revision_usable($1,$3,r.id,false)",
        [tx.tenantId, id, tx.projectId],
      )
    ).rows[0];
    if (row) {
      const {
        references: _references,
        looks: _looks,
        ...text
      } = row.definition;
      value = text;
    }
  } else {
    requireThat(
      false,
      422,
      "ASSISTANCE_CONTEXT_NOT_SUPPORTED",
      "评论必须通过候选修改任务固定审阅和评论修订，不能作为其他上下文解析。",
    );
  }
  requireThat(
    row,
    404,
    "GENERATION_CONTEXT_UNAVAILABLE",
    "明确选择的上下文不存在或无访问权限。",
  );
  if (checkVersion) versionMatches(Number(row.revision), source.revision);
  const text = safeText(canonical(value));
  return {
    source: {
      kind: source.kind,
      objectId: id,
      revision: Number(row.revision),
      tracking:
        source.kind === "scene" || source.kind === "production"
          ? "current"
          : "fixed",
      contentHash: digest(text),
    },
    text,
  } as Schema<"ContextSnapshot">;
}
