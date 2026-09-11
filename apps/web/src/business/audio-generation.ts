import { fixedShotSources } from "./canvas-shot-sources.js";
import type { components } from "@drama/contracts";
import type { PromptDraft } from "./prompt-draft.js";
import { type ImageCapability, type ImageRequest } from "./image-generation.js";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
export function executableAudios(capabilities: readonly ImageCapability[]) {
  return capabilities.filter(
    (c) =>
      c.enabled &&
      c.purpose === "audio" &&
      c.mode !== "target_profile_fixture" &&
      (c.executionMode === "verified_provider" ||
        (c.executionMode === "test_fixture" && c.mode === "audio_fixture_v1")),
  );
}
export function audioOutput(
  capability: ImageCapability,
  output: Schema<"OutputOptions">,
): Schema<"OutputOptions"> {
  if (
    output.resolution !== undefined ||
    output.aspectRatio !== undefined ||
    output.withAudio !== undefined
  )
    throw Error("音频生成不接受画面或附带声音选项，请核对输入。");
  const { durationSeconds } = output;
  const duration =
    durationSeconds ??
    (capability.minDurationSeconds === capability.maxDurationSeconds
      ? capability.minDurationSeconds
      : undefined);
  if (
    duration === undefined ||
    !Number.isInteger(duration) ||
    duration <= 0 ||
    capability.minDurationSeconds === undefined ||
    capability.maxDurationSeconds === undefined ||
    duration < capability.minDurationSeconds ||
    duration > capability.maxDurationSeconds
  )
    throw Error("请选择当前模型支持的音频时长。");
  return {
    durationSeconds: duration,
    ...(output.seed === undefined ? {} : { seed: output.seed }),
  };
}
export function shotAudioRequest(
  creation: PromptDraft,
  projectId: string,
  capability: ImageCapability,
  output: Schema<"OutputOptions">,
): ImageRequest {
  if (!executableAudios([capability]).length)
    throw Error("请选择已验证可执行的音频模型。");
  if (!creation.prompt.trim()) throw Error("请先填写本次提示。");
  return {
    kind: "shot",
    label: creation.label,
    input: {
      scope: "project",
      projectId,
      connectionId: capability.connectionId,
      capabilityId: capability.id,
      purpose: "audio",
      prompt: creation.prompt,
      shotSources: [structuredClone(creation.source)],
      output: audioOutput(capability, output),
      additionalReferences: structuredClone(creation.references),
      referenceOverrides: [],
      promptPolicy: "append",
      contextSources: [],
      ...(creation.assistanceSource
        ? { assistanceSource: structuredClone(creation.assistanceSource) }
        : {}),
    },
  };
}
export function canvasAudioRequest(
  canvas: Schema<"Canvas">,
  sceneId: string,
  nodeId: string,
  capabilities: readonly ImageCapability[],
  shotSources: readonly Schema<"ShotSource">[] = [],
): ImageRequest {
  const node = canvas.document.nodes.find((node) => node.id === nodeId);
  if (!node || node.kind !== "audio" || node.content.type !== "draft")
    throw Error("请选择已保存的音频草稿。");
  const content = node.content;
  const capability = executableAudios(capabilities).find(
    (c) => c.id === content.capabilityId,
  );
  if (!capability || capability.connectionId !== content.connectionId)
    throw Error("请先为音频草稿选择可执行的模型。");
  audioOutput(capability, content.output);
  return {
    kind: "canvas",
    canvasId: canvas.id,
    sceneId,
    canvasRevision: canvas.revision,
    label: node.title,
    input: {
      nodeId,
      shotSources: fixedShotSources(shotSources),
      referenceOverrides: [],
      promptPolicy: "append",
    },
  };
}
