import type { Transaction } from "../../kernel/database.js";
import { requireThat } from "../../kernel/errors.js";
import type { Schema } from "../content/model.js";
import { safeText } from "./input-sources.js";
import { resolveSelectedInput } from "./prompt-input.js";
import { resolveCanvasReply } from "./canvas-replies.js";

/** A canvas is an authority/history scope, not permission to read its contents. */
export async function discussionScope(
  tx: Transaction,
  canvasId: string,
  current: boolean,
) {
  const scope = (
    await tx.sql.query("SELECT discussion_canvas_scope($1,$2,$3,$4) AS scope", [
      tx.tenantId,
      tx.projectId,
      canvasId,
      current,
    ])
  ).rows[0]?.scope as Schema<"ResolvedInput">["canvasScope"];
  requireThat(
    scope,
    404,
    "CANVAS_CONTEXT_UNAVAILABLE",
    "讨论所属画布不存在、已归档或无访问权限。",
  );
  return scope;
}

export async function resolveDiscussion(
  tx: Transaction,
  input: Schema<"PlanInput">,
  cap: Record<string, any>,
) {
  const request = input.assistance!;
  requireThat(
    request.kind === "discuss" &&
      request.canvasId &&
      !request.targetCapabilityId &&
      !request.targetCapabilityRevision &&
      !request.feedback &&
      !request.sourceTakeId &&
      !request.sourceCutRevisionId &&
      !input.sourceScriptRevisionId &&
      !input.scriptRange &&
      !input.proposalTarget &&
      !input.shotSources?.length &&
      !input.contextSources?.length &&
      !input.additionalReferences.length &&
      !input.referenceOverrides.length &&
      Array.isArray(input.canvasSources) &&
      input.canvasSources.length <= 20 &&
      input.canvasSources.every(
        (s) => s.canvasId.toLowerCase() === request.canvasId!.toLowerCase(),
      ),
    422,
    "DISCUSSION_INPUT_UNSUPPORTED",
    "讨论只使用文字及本画布明确附加的 0–20 个节点，不接收媒体执行目标或隐式场次内容。",
  );
  requireThat(
    safeText(input.prompt).trim().length > 0,
    422,
    "DISCUSSION_PROMPT_REQUIRED",
    "请输入本轮要讨论的内容。",
  );
  const scope = await discussionScope(tx, request.canvasId, true);
  const result = await resolveSelectedInput(tx, input, cap);
  result.resolved.resolverVersion = "canvas-discussion/1";
  result.resolved.canvasScope = scope;
  delete result.resolved.targetCapabilitySnapshot;
  delete result.resolved.targetConnectionVersionId;
  const reply = await resolveCanvasReply(tx, input);
  if (reply) {
    result.resolved.assistanceSnapshot = reply.body;
    result.resolved.assistanceInstruction = reply.instruction;
    const history = (
      await tx.sql.query(
        "SELECT canvas_discussion_history($1,$2,$3) AS history",
        [tx.tenantId, tx.projectId, input.assistanceSource],
      )
    ).rows[0]?.history as {
      turns: Schema<"AssistanceTurn">[];
      dependencies: Schema<"SourceDependency">[];
      limitExceeded?: boolean;
    } | null;
    requireThat(
      history && !history.limitExceeded,
      422,
      "ASSISTANCE_HISTORY_LIMIT",
      "讨论历史最多保留 20 个旧回合，请保留输入并明确开始新话题。",
    );
    result.resolved.assistanceHistory = history.turns;
    result.resolved.dependencies.push(...history.dependencies);
  }
  requireThat(
    Buffer.byteLength(JSON.stringify(result.resolved), "utf8") <= 100000,
    422,
    "ASSISTANCE_INPUT_LIMIT",
    "本轮附件与固定历史合计过长，请缩小明确上下文。",
  );
  return result;
}
