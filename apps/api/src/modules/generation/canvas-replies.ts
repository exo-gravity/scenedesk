import type { Transaction } from "../../kernel/database.js";
import { requireThat } from "../../kernel/errors.js";
import type { Schema } from "../content/model.js";

/** Prior advice is fixed history; only the newly selected canvas sources must be current. */
export async function resolveCanvasReply(tx: Transaction, input: Schema<"PlanInput">) {
  if (!input.canvasSources || !input.assistanceSource) return undefined;
  const row = (await tx.sql.query(
    "SELECT canvas_assistance_reply_snapshot($1,$2,$3) AS snapshot,canvas_assistance_reply_access($1,$2,$3) AS accessible",
    [tx.tenantId,tx.projectId,input.assistanceSource],
  )).rows[0];
  requireThat(row?.snapshot && row.accessible,409,"ASSISTANCE_REPLY_UNAVAILABLE",
    "原建议修订未完成、已不可用或其固定来源已无访问权限，请保留本次要求并核对。");
  const snapshot = row.snapshot as {
    body: Schema<"AssistanceBody">;
    instruction: string;
    dependency: Schema<"SourceDependency">;
    targetCapabilityId: string;
    targetCapabilityRevision: number;
  };
  requireThat(snapshot.targetCapabilityId.toLowerCase() === input.assistance!.targetCapabilityId.toLowerCase() &&
    snapshot.targetCapabilityRevision === input.assistance!.targetCapabilityRevision,
    409,"ASSISTANCE_REPLY_TARGET_MISMATCH","继续改稿须保留原目标能力及版本；更换模型前请明确取消上轮建议来源。");
  return snapshot;
}
