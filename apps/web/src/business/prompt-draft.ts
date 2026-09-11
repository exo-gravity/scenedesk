import type { components } from "@drama/contracts";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
export type IdentifiedArtifact = Schema<"AssistanceArtifact"> & {
  executionMode?: "test_fixture" | "verified_provider";
};
export type PromptDraft = {
  source: Schema<"ShotSource">;
  previousInputs?: {
    source: Schema<"ShotSource">;
    prompt: string;
    references: Schema<"Reference">[];
    assistanceSource?: Schema<"ArtifactSource"> | undefined;
  }[];
  label: string;
  intent: string;
  prompt: string;
  references: Schema<"Reference">[];
  assistanceSource?: Schema<"ArtifactSource"> | undefined;
  instruction: string;
  capabilityId: string;
  targetCapabilityId: string;
  targetCapabilityRevision?: number | undefined;
  artifact?: IdentifiedArtifact | undefined;
  historyArtifact?: IdentifiedArtifact | undefined;
  retainedEdits?: {
    artifactId: string;
    revision: number;
    body: Schema<"AssistanceBody">;
  }[];
  editBody?: Schema<"AssistanceBody"> | undefined;
  saveIntent?:
    | { revision: number; body: Schema<"AssistanceBody">; checked?: boolean }
    | undefined;
};
export function sameValue(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): string =>
    JSON.stringify(value, (_key, item: unknown) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
          )
        : item,
    );
  return canonical(a) === canonical(b);
}
export function promptPlan(
  draft: PromptDraft,
  projectId: string,
  assistant: Schema<"Capability">,
  target: Schema<"Capability">,
): Schema<"PlanInput"> {
  if (
    !assistant.enabled ||
    assistant.purpose !== "creative_assistance" ||
    assistant.id !== draft.capabilityId
  )
    throw new Error("请选择可用的提示准备能力。");
  if (
    !target.enabled ||
    !["image", "video", "audio"].includes(target.purpose) ||
    target.id !== draft.targetCapabilityId ||
    target.revision !== draft.targetCapabilityRevision
  )
    throw new Error("目标生成能力已改变，请重新选择并核对。");
  return {
    scope: "project",
    projectId,
    connectionId: assistant.connectionId,
    capabilityId: assistant.id,
    purpose: "creative_assistance",
    prompt: draft.instruction,
    output: {},
    shotSources: [draft.source],
    additionalReferences: [],
    referenceOverrides: [],
    promptPolicy: "append",
    contextSources: [],
    assistance: {
      kind: "prepare_prompt",
      targetCapabilityId: target.id,
      targetCapabilityRevision: target.revision,
    },
  };
}
export function validateArtifact(
  draft: PromptDraft,
  artifact: IdentifiedArtifact,
) {
  if (
    artifact.request.kind !== "prepare_prompt" ||
    artifact.shotSources.length !== 1 ||
    artifact.shotSources[0]?.shotId !== draft.source.shotId ||
    artifact.shotSources[0]?.shotRevisionId !== draft.source.shotRevisionId
  )
    throw new Error("这份建议不属于当前固定镜头输入。");
}
export function applyPrompt(
  draft: PromptDraft,
  artifact: IdentifiedArtifact,
): PromptDraft {
  validateArtifact(draft, artifact);
  if (artifact.inputOutdated) throw new Error("建议来源已改变，请先重新准备。");
  if (draft.saveIntent || !sameValue(draft.editBody, artifact.body))
    throw new Error("请先保存并核对建议修订，再应用到输入。");
  if (draft.assistanceSource)
    throw new Error(
      "本次输入已应用过建议。请保留当前输入，另开一次输入后再应用其他建议。",
    );
  if (!artifact.body.prompt.trim()) throw new Error("建议提示不能为空。");
  const references = [...draft.references];
  for (const reference of artifact.body.referenceSuggestions)
    if (!references.some((existing) => sameValue(existing, reference)))
      references.push(structuredClone(reference));
  return {
    ...draft,
    prompt: [draft.prompt, artifact.body.prompt].filter(Boolean).join("\n\n"),
    references,
    assistanceSource: { artifactId: artifact.id, revision: artifact.revision },
  };
}
export function recoverArtifactSave(
  draft: PromptDraft,
  current: IdentifiedArtifact,
): PromptDraft {
  validateArtifact(draft, current);
  const intent = draft.saveIntent;
  if (!intent) {
    if (
      draft.artifact &&
      current.revision !== draft.artifact.revision &&
      !sameValue(draft.editBody, draft.artifact.body)
    )
      throw new Error("建议已有其他修订。本机编辑仍保留，请打开最新修订核对。");
    return {
      ...draft,
      artifact: current,
      editBody:
        draft.artifact && current.revision === draft.artifact.revision
          ? (draft.editBody ?? current.body)
          : current.body,
    };
  }
  if (
    current.revision === intent.revision + 1 &&
    sameValue(current.body, intent.body)
  )
    return {
      ...draft,
      artifact: current,
      editBody: current.body,
      saveIntent: undefined,
    };
  if (current.revision === intent.revision)
    return {
      ...draft,
      artifact: current,
      saveIntent: { ...intent, checked: true },
    };
  throw new Error("建议已有其他修订。本机编辑仍保留，请打开最新修订核对。");
}

export function nextPromptInput(
  draft: PromptDraft,
  shot: Schema<"Shot">,
): PromptDraft {
  return {
    source: { shotId: shot.id, shotRevisionId: shot.specRevisionId },
    label: shot.label,
    intent: shot.spec.intent,
    prompt: "",
    references: [],
    instruction: "",
    capabilityId: draft.capabilityId,
    targetCapabilityId: draft.targetCapabilityId,
    targetCapabilityRevision: draft.targetCapabilityRevision,
    ...(draft.retainedEdits ? { retainedEdits: draft.retainedEdits } : {}),
    previousInputs: [
      ...(draft.previousInputs ?? []),
      {
        source: draft.source,
        prompt: draft.prompt,
        references: draft.references,
        assistanceSource: draft.assistanceSource,
      },
    ],
  };
}
