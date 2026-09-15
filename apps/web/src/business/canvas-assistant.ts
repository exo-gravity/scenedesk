import { editingCanonical } from "@drama/domain";
import { jobFinished, type AssistantSession } from "./assistant-session.js";
import type { components } from "@drama/contracts";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
export type FixedCanvasSource = {
  canvasId: string;
  canvasRevision: number;
  nodeId: string;
  purpose?: Schema<"Reference">["purpose"];
};
export type CanvasAssistantSource = {
  source: FixedCanvasSource;
  title: string;
  content: Schema<"CanvasNode">["content"];
  kind: Schema<"CanvasNode">["kind"];
};
export type CanvasApplication = {
  phase: "review" | "unknown" | "missing" | "blocked" | "applied";
  key: string;
  revision: number;
  body: {
    applicationId: string;
    artifactId: string;
    artifactRevision: number;
    nodeId: string;
    mode: "replace" | "append";
  };
  beforePrompt: string;
  afterPrompt: string;
  targetTitle: string;
  result?: CanvasApplicationResult;
};
export type CanvasApplicationResult = {
  canvas: Schema<"Canvas">;
  application: {
    id: string;
    canvasId: string;
    nodeId: string;
    artifactId: string;
    artifactRevision: number;
    mode: "replace" | "append";
    baseCanvasRevision: number;
    resultCanvasRevision: number;
    beforePrompt: string;
    afterPrompt: string;
    appliedAt: string;
  };
};
export type CanvasAssistanceInput = Schema<"PlanInput"> & {
  canvasSources: FixedCanvasSource[];
};
export type CanvasAssistantDraft = {
  /** Missing on older records means their original prepare_prompt workflow. */
  kind?: "discuss" | "prepare_prompt";
  nextKind?: "discuss" | "prepare_prompt" | undefined;
  sources: CanvasAssistantSource[];
  instruction: string;
  nextInstruction?: string | undefined;
  nextSources?: CanvasAssistantSource[] | undefined;
  replyTo?: { artifactId: string; revision: number } | undefined;
  /** Explicit choices apply to the next message and win over a late result read. */
  replyChoice?: "automatic" | "explicit" | "none";
  /** Local presentation boundary only; server plans and artifacts remain historical facts. */
  conversationBoundary?: { planIds: string[]; artifactIds: string[] };
  capabilityId: string;
  targetCapabilityId: string;
  targetCapabilityRevision?: number;
  artifact?: Schema<"AssistanceArtifact"> | undefined;
  application?: CanvasApplication | undefined;
  previousApplications?: CanvasApplication[] | undefined;
};
export function canvasAssistantReply(
  artifact: Schema<"AssistanceArtifact">,
): string {
  if (artifact.request.kind !== "discuss") return artifact.body.prompt;
  const message = artifact.body.message;
  if (typeof message !== "string" || !message.trim())
    throw Error("讨论回复正文尚未核对，请重新读取原结果。");
  return message;
}
export function isCanvasDiscussion(
  artifact: Schema<"AssistanceArtifact">,
): boolean {
  return artifact.request.kind === "discuss";
}
function followsLatestReply(draft: CanvasAssistantDraft) {
  return (
    draft.replyChoice === "automatic" || (!draft.replyChoice && !draft.replyTo)
  );
}
/** Only a currently authorized, fixed result reaches this transition. */
export function retainCanvasAssistantReply(
  draft: CanvasAssistantDraft,
  artifact: Schema<"AssistanceArtifact">,
): CanvasAssistantDraft {
  if (draft.conversationBoundary?.artifactIds.includes(artifact.id))
    return draft;
  canvasAssistantReply(artifact);
  const next = { ...draft, artifact };
  if (
    isCanvasDiscussion(artifact) &&
    (draft.nextKind ?? draft.kind) === "discuss" &&
    followsLatestReply(draft)
  )
    return {
      ...next,
      replyChoice: "automatic",
      replyTo: { artifactId: artifact.id, revision: artifact.revision },
    };
  return next;
}
export function canvasReplyContinuationPending(draft: CanvasAssistantDraft) {
  if (
    !draft.artifact ||
    !isCanvasDiscussion(draft.artifact) ||
    (draft.nextKind ?? draft.kind) !== "discuss" ||
    !followsLatestReply(draft)
  )
    return false;
  return (
    draft.replyTo?.artifactId !== draft.artifact.id ||
    draft.replyTo?.revision !== draft.artifact.revision
  );
}
export function captureCanvasSources(
  canvas: Schema<"Canvas">,
  ids: readonly string[],
): CanvasAssistantSource[] {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 20)
    throw Error("请明确选择 1–20 个画布对象作为上下文。");
  return unique.map((id) => {
    const node = canvas.document.nodes.find((n) => n.id === id);
    if (!node) throw Error("所选对象已经移除，请重新选择。");
    return {
      source: {
        canvasId: canvas.id,
        canvasRevision: canvas.revision,
        nodeId: id,
        ...(node.content.type === "media"
          ? {
              purpose:
                node.kind === "audio"
                  ? ("voice" as const)
                  : ("composition" as const),
            }
          : {}),
      },
      title: node.title,
      kind: node.kind,
      content: structuredClone(node.content),
    };
  });
}
export function canvasAssistancePlan(
  draft: CanvasAssistantDraft,
  projectId: string,
  assistant: Schema<"Capability">,
  target?: Schema<"Capability">,
  canvasId?: string,
): CanvasAssistanceInput {
  const kind = draft.kind ?? "prepare_prompt";
  if (
    draft.sources.length > 20 ||
    (kind === "prepare_prompt" && !draft.sources.length)
  )
    throw Error("准备生成提示需要明确的画布上下文；自由讨论可不带附件。");
  if (kind === "discuss" && (!canvasId || !draft.instruction.trim()))
    throw Error("请在当前画布写下想讨论的内容。");
  if (
    canvasId &&
    draft.sources.some((item) => item.source.canvasId !== canvasId)
  )
    throw Error("消息附件不属于当前画布，尚未提交。");
  if (
    !assistant.enabled ||
    assistant.id !== draft.capabilityId ||
    assistant.purpose !== "creative_assistance"
  )
    throw Error("请选择可用的助手能力。");
  if (
    kind === "prepare_prompt" &&
    (!target ||
      !target.enabled ||
      target.id !== draft.targetCapabilityId ||
      target.revision !== draft.targetCapabilityRevision ||
      !["image", "video", "audio"].includes(target.purpose))
  )
    throw Error("目标能力或版本已经改变，请重新选择。");
  return {
    scope: "project",
    projectId,
    connectionId: assistant.connectionId,
    capabilityId: assistant.id,
    purpose: "creative_assistance",
    ...(draft.replyTo
      ? { assistanceSource: structuredClone(draft.replyTo) }
      : {}),
    prompt: draft.instruction,
    shotSources: [],
    output: {},
    additionalReferences: [],
    referenceOverrides: [],
    promptPolicy: "append",
    contextSources: [],
    canvasSources: draft.sources.map((s) => structuredClone(s.source)),
    assistance:
      kind === "discuss"
        ? { kind, canvasId: canvasId! }
        : {
            kind: "prepare_prompt",
            targetCapabilityId: target!.id,
            targetCapabilityRevision: target!.revision,
          },
  };
}
const sendingMessages = new WeakSet<object>();
function editableCanvasConversation(
  controller: AssistantSession<CanvasAssistantDraft, CanvasAssistanceInput>,
) {
  const state = controller.getSnapshot(),
    record = state.record;
  if (
    !record ||
    state.access !== "ready" ||
    state.busy ||
    sendingMessages.has(controller)
  )
    throw Error("请等待本次本机保留或访问核对完成。");
  if (record.planRequest && !record.planId)
    throw Error("原计划结果仍待核对，不能通过新话题或准备提示替换原请求。");
  if (record.execution && !jobFinished(state.job))
    throw Error("请先核对当前任务的最终结果，原消息与后续输入仍保留。");
  if (
    record.draft.application &&
    ["review", "unknown", "missing"].includes(record.draft.application.phase)
  )
    throw Error("请先完成或核对当前建议应用，原应用意图仍保留。");
  return { state, record };
}
function assertCanvasConversationRetained(
  controller: AssistantSession<CanvasAssistantDraft, CanvasAssistanceInput>,
  next: CanvasAssistantDraft,
) {
  const retained = controller.getSnapshot();
  if (
    retained.access !== "ready" ||
    !retained.draftSaved ||
    JSON.stringify(retained.record?.draft) !== JSON.stringify(next)
  )
    throw Error(retained.error ?? "本机尚未保留本次切换，原话题与输入仍保留。");
}
/** Begin a local topic without deleting history or sending any provider request. */
export async function beginCanvasAssistantTopic(
  controller: AssistantSession<CanvasAssistantDraft, CanvasAssistanceInput>,
  loadedArtifactIds: readonly string[] = [],
) {
  const { state, record } = editableCanvasConversation(controller);
  const draft = record.draft;
  const next: CanvasAssistantDraft = {
    ...draft,
    kind: "discuss",
    nextKind: undefined,
    instruction: "",
    nextInstruction:
      draft.nextInstruction ?? (record.planId ? "" : draft.instruction),
    sources: structuredClone(draft.nextSources ?? draft.sources),
    nextSources: undefined,
    replyTo: undefined,
    replyChoice: "none",
    artifact: undefined,
    application: undefined,
    previousApplications: draft.application
      ? [...(draft.previousApplications ?? []), draft.application]
      : draft.previousApplications,
    conversationBoundary: {
      planIds: [
        ...new Set([
          ...(draft.conversationBoundary?.planIds ?? []),
          ...record.previous.map((entry) => entry.planId),
          ...(record.planId ? [record.planId] : []),
        ]),
      ],
      artifactIds: [
        ...new Set([
          ...(draft.conversationBoundary?.artifactIds ?? []),
          ...loadedArtifactIds,
          ...(draft.artifact ? [draft.artifact.id] : []),
          ...(state.job?.assistanceArtifactId
            ? [state.job.assistanceArtifactId]
            : []),
        ]),
      ],
    },
  };
  if (record.planId) await controller.revise(next, draft);
  else await controller.commitDraft(draft, next);
  assertCanvasConversationRetained(controller, next);
}
/** Switch the next composition explicitly; fixed prior rounds are not rewritten. */
export async function beginCanvasAssistantPrompt(
  controller: AssistantSession<CanvasAssistantDraft, CanvasAssistanceInput>,
) {
  const { record } = editableCanvasConversation(controller),
    draft = record.draft;
  const next: CanvasAssistantDraft = {
    ...draft,
    nextKind: "prepare_prompt",
    ...((draft.nextKind ?? draft.kind ?? "prepare_prompt") === "discuss"
      ? { replyTo: undefined, replyChoice: "none" as const }
      : {}),
  };
  await controller.commitDraft(draft, next);
  assertCanvasConversationRetained(controller, next);
}
/** Return the next message to discussion without resetting the conversation view. */
export async function beginCanvasAssistantDiscussion(
  controller: AssistantSession<CanvasAssistantDraft, CanvasAssistanceInput>,
) {
  const { record } = editableCanvasConversation(controller),
    draft = record.draft;
  const next: CanvasAssistantDraft = {
    ...draft,
    nextKind: "discuss",
    ...((draft.nextKind ?? draft.kind ?? "prepare_prompt") !== "discuss"
      ? { replyTo: undefined, replyChoice: "none" as const }
      : {}),
  };
  await controller.commitDraft(draft, next);
  assertCanvasConversationRetained(controller, next);
}
/** A message archives only a known plan; unresolved requests keep their original identity. */
export async function sendCanvasAssistantMessage(
  controller: AssistantSession<CanvasAssistantDraft, CanvasAssistanceInput>,
  projectId: string,
  assistant: Schema<"Capability">,
  target: Schema<"Capability"> | undefined,
  verifySources?: (sources: CanvasAssistantSource[]) => Promise<void>,
  prepareNew?: (
    input: CanvasAssistanceInput,
    next: CanvasAssistantDraft,
  ) => Promise<void>,
  canvasId?: string,
) {
  if (sendingMessages.has(controller))
    throw Error("本条消息正在发送，请等待原请求核对。");
  sendingMessages.add(controller);
  try {
    const state = controller.getSnapshot(),
      record = state.record;
    if (!record || state.access !== "ready" || state.busy)
      throw Error("请等待本次本机保留或访问核对完成。");
    if (record.planRequest && !record.planId)
      throw Error("上一条消息的计划结果待核对；后续输入已保留，不会换新请求。");
    if (record.execution && !jobFinished(state.job))
      throw Error("请先核对上一轮任务的最终结果；后续输入会继续保留。");
    if (
      record.draft.application &&
      ["review", "unknown", "missing"].includes(record.draft.application.phase)
    )
      throw Error("请先完成或核对当前建议应用；后续输入会继续保留。");
    const draft = record.draft;
    const kind = draft.nextKind ?? draft.kind ?? "prepare_prompt";
    if (
      kind === "discuss" &&
      followsLatestReply(draft) &&
      state.job?.status === "succeeded" &&
      state.job.assistanceArtifactId &&
      (draft.artifact?.id !== state.job.assistanceArtifactId ||
        canvasReplyContinuationPending(draft))
    )
      throw Error(
        "最新回复及续聊上下文尚未完成本机保留，请先核对原回复；下一条文字已保留。",
      );
    const instruction =
      draft.nextInstruction ?? (record.planId ? "" : draft.instruction);
    if (!instruction.trim()) throw Error("先写下这次想讨论或调整的内容。");
    const next: CanvasAssistantDraft = {
      ...draft,
      sources: structuredClone(draft.nextSources ?? draft.sources),
      instruction,
      kind,
      ...(kind === "discuss" ? { replyChoice: "automatic" as const } : {}),
      nextKind: undefined,
      nextInstruction: "",
      nextSources: undefined,
      artifact: undefined,
      application: undefined,
      previousApplications: draft.application
        ? [...(draft.previousApplications ?? []), draft.application]
        : draft.previousApplications,
    };
    const input = canvasAssistancePlan(
      next,
      projectId,
      assistant,
      target,
      canvasId,
    );
    await verifySources?.(next.sources);
    if (record.planId) await controller.revise(next, draft);
    else await controller.commitDraft(draft, next);
    const retained = controller.getSnapshot();
    if (
      retained.access !== "ready" ||
      !retained.draftSaved ||
      JSON.stringify(retained.record?.draft) !== JSON.stringify(next) ||
      retained.record?.planId
    )
      throw Error(retained.error ?? "消息尚未完成本机保留，未发送新请求。");
    if (prepareNew) await prepareNew(input, next);
    else await controller.prepareFrom(next, async () => input);
    if (next.kind === "discuss") {
      const confirmed = controller.getSnapshot();
      if (
        confirmed.access !== "ready" ||
        confirmed.busy ||
        !confirmed.draftSaved ||
        confirmed.error ||
        !confirmed.record?.planId ||
        confirmed.record.execution ||
        confirmed.plan?.id !== confirmed.record.planId ||
        editingCanonical(confirmed.plan.input) !== editingCanonical(input) ||
        JSON.stringify(confirmed.record.draft) !== JSON.stringify(next)
      )
        throw Error(
          confirmed.error ??
            "本条讨论计划尚未完整核对，未继续执行；原消息已保留。",
        );
      // Sending this discussion authorizes this one reply. A restored plan never
      // enters this branch automatically; execute persists its original key first.
      await controller.execute();
    }
  } finally {
    sendingMessages.delete(controller);
  }
}
export function applicationPrompt(
  before: string,
  suggestion: string,
  mode: "replace" | "append",
) {
  return mode === "replace"
    ? suggestion
    : [before, suggestion].filter((part) => part.length > 0).join("\n\n");
}
export function assertCanvasApplication(
  intent: CanvasApplication,
  result: CanvasApplicationResult,
  canvasId: string,
) {
  const receipt = result?.application;
  if (
    !receipt ||
    result.canvas?.id !== canvasId ||
    receipt.id !== intent.body.applicationId ||
    receipt.canvasId !== canvasId ||
    receipt.nodeId !== intent.body.nodeId ||
    receipt.artifactId !== intent.body.artifactId ||
    receipt.artifactRevision !== intent.body.artifactRevision ||
    receipt.mode !== intent.body.mode ||
    receipt.baseCanvasRevision !== intent.revision ||
    receipt.resultCanvasRevision !== intent.revision + 1 ||
    receipt.beforePrompt !== intent.beforePrompt ||
    receipt.afterPrompt !== intent.afterPrompt ||
    !Number.isSafeInteger(result.canvas.revision) ||
    result.canvas.revision < receipt.resultCanvasRevision
  )
    throw Error("应用回执尚未核对，原请求仍保留；请读取同一次应用。");
}
export function sameCanvasSources(
  left: FixedCanvasSource[],
  right: FixedCanvasSource[],
) {
  return editingCanonical(left) === editingCanonical(right);
}

/** Restoring a canvas does not grant continued access to privately sourced media. */
export async function verifyCanvasAssistantSources(
  draft: CanvasAssistantDraft | undefined,
  canvasId: string,
  read: (
    kind: "media" | "asset-revisions" | "assistance-artifacts",
    id: string,
    revision?: number,
  ) => Promise<unknown>,
) {
  if (!draft) return;
  if (!Array.isArray(draft.sources) || draft.sources.length > 20)
    throw Error("本机助手上下文需要核对，尚未显示原内容。");
  const checked = new Set<string>();
  if (
    draft.nextSources &&
    (!Array.isArray(draft.nextSources) || draft.nextSources.length > 20)
  )
    throw Error("下一条消息的节点附件需要核对，尚未显示原内容。");
  for (const source of [...draft.sources, ...(draft.nextSources ?? [])]) {
    if (source.source?.canvasId !== canvasId)
      throw Error("本机来源不属于当前画布，尚未显示原内容。");
    if (source.content?.type !== "media") continue;
    for (const [kind, id] of [
      ["media", source.content.mediaId],
      ["asset-revisions", source.content.assetRevisionId],
    ] as const) {
      if (!id || checked.has(`${kind}:${id}`)) continue;
      await read(kind, id);
      checked.add(`${kind}:${id}`);
    }
  }
  if (draft.replyTo)
    await read(
      "assistance-artifacts",
      draft.replyTo.artifactId,
      draft.replyTo.revision,
    );
  if (draft.artifact)
    await read(
      "assistance-artifacts",
      draft.artifact.id,
      draft.artifact.revision,
    );
  if (draft.application)
    await read(
      "assistance-artifacts",
      draft.application.body.artifactId,
      draft.application.body.artifactRevision,
    );
}

export class CanvasApplicationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly verified: boolean,
    message: string,
  ) {
    super(message);
  }
}
/** Only a first, verified refusal after the endpoint's receipt lookup can release review. */
export function canvasApplicationWasRefused(
  intent: CanvasApplication,
  cause: unknown,
): boolean {
  if (
    intent.phase !== "review" ||
    !(cause instanceof CanvasApplicationError) ||
    !cause.verified
  )
    return false;
  if (cause.status === 412) return cause.code === "VERSION_CONFLICT";
  if (cause.status === 409)
    return ["PLAN_INPUT_CHANGED", "TARGET_CAPABILITY_CHANGED"].includes(
      cause.code,
    );
  if (cause.status === 422)
    return [
      "CANVAS_ASSISTANCE_TARGET_MISMATCH",
      "CANVAS_CONTEXT_UNAVAILABLE",
      "GENERATION_CONTEXT_TOO_LARGE",
    ].includes(cause.code);
  return false;
}

/** A proxy status or a partial Problem cannot authorize replacing an uncertain intent. */
export function canvasApplicationError(status: number, body: unknown) {
  const problem = body as Partial<Schema<"Error">> | null;
  const verified =
    !!problem &&
    typeof problem.code === "string" &&
    typeof problem.message === "string" &&
    typeof problem.requestId === "string" &&
    problem.requestId.length > 0;
  return new CanvasApplicationError(
    status,
    verified ? problem.code! : "UNVERIFIED_RESPONSE",
    verified,
    verified
      ? problem.message!
      : "应用响应未能核对，请保留原请求并查询原记录。",
  );
}
export async function requestCanvasApplication(
  path: string,
  options: RequestInit = {},
): Promise<CanvasApplicationResult> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw canvasApplicationError(response.status, body);
  return body as CanvasApplicationResult;
}
