import { editingCanonical } from "@drama/domain";
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
  sources: CanvasAssistantSource[];
  instruction: string;
  capabilityId: string;
  targetCapabilityId: string;
  targetCapabilityRevision?: number;
  artifact?: Schema<"AssistanceArtifact"> | undefined;
  application?: CanvasApplication | undefined;
  previousApplications?: CanvasApplication[] | undefined;
};
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
  target: Schema<"Capability">,
): CanvasAssistanceInput {
  if (!draft.sources.length || draft.sources.length > 20)
    throw Error("请先加入明确的画布上下文。");
  if (
    !assistant.enabled ||
    assistant.id !== draft.capabilityId ||
    assistant.purpose !== "creative_assistance"
  )
    throw Error("请选择可用的助手能力。");
  if (
    !target.enabled ||
    target.id !== draft.targetCapabilityId ||
    target.revision !== draft.targetCapabilityRevision ||
    !["image", "video", "audio"].includes(target.purpose)
  )
    throw Error("目标能力或版本已经改变，请重新选择。");
  return {
    scope: "project",
    projectId,
    connectionId: assistant.connectionId,
    capabilityId: assistant.id,
    purpose: "creative_assistance",
    prompt: draft.instruction,
    shotSources: [],
    output: {},
    additionalReferences: [],
    referenceOverrides: [],
    promptPolicy: "append",
    contextSources: [],
    canvasSources: draft.sources.map((s) => structuredClone(s.source)),
    assistance: {
      kind: "prepare_prompt",
      targetCapabilityId: target.id,
      targetCapabilityRevision: target.revision,
    },
  };
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
  for (const source of draft.sources) {
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
