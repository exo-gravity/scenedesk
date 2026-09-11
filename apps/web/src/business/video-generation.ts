import type { components } from "@drama/contracts";
import type { PromptDraft } from "./prompt-draft.js";
import {
  imageOutput,
  type ImageCapability,
  type ImageRequest,
} from "./image-generation.js";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
export function executableVideos(capabilities: readonly ImageCapability[]) {
  return capabilities.filter(
    (c) =>
      c.enabled &&
      c.purpose === "video" &&
      c.mode !== "target_profile_fixture" &&
      (c.executionMode === "verified_provider" ||
        (c.executionMode === "test_fixture" && c.mode === "video_fixture_v1")),
  );
}
export function videoOutput(
  capability: ImageCapability,
  output: Schema<"OutputOptions">,
): Schema<"OutputOptions"> {
  const { durationSeconds, withAudio, ...visual } = output;
  const resolved = imageOutput(capability, visual, "视频");
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
    throw Error("请选择当前模型支持的视频时长。");
  if (withAudio && capability.audioOutput !== true)
    throw Error("当前模型尚未支持生成声音，请核对输入。");
  return {
    ...resolved,
    durationSeconds: duration,
    withAudio: withAudio === true,
  };
}
export function shotVideoRequest(
  creation: PromptDraft,
  projectId: string,
  capability: ImageCapability,
  output: Schema<"OutputOptions">,
): ImageRequest {
  if (!executableVideos([capability]).length)
    throw Error("请选择已验证可执行的视频模型。");
  if (!creation.prompt.trim()) throw Error("请先填写本次提示。");
  return {
    kind: "shot",
    label: creation.label,
    input: {
      scope: "project",
      projectId,
      connectionId: capability.connectionId,
      capabilityId: capability.id,
      purpose: "video",
      prompt: creation.prompt,
      shotSources: [structuredClone(creation.source)],
      output: videoOutput(capability, output),
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
export function canvasVideoRequest(
  canvas: Schema<"Canvas">,
  sceneId: string,
  nodeId: string,
  capabilities: readonly ImageCapability[],
): ImageRequest {
  const node = canvas.document.nodes.find((node) => node.id === nodeId);
  if (!node || node.kind !== "video" || node.content.type !== "draft")
    throw Error("请选择已保存的视频草稿。");
  const content = node.content;
  const capability = executableVideos(capabilities).find(
    (c) => c.id === content.capabilityId,
  );
  if (!capability || capability.connectionId !== content.connectionId)
    throw Error("请先为视频草稿选择可执行的模型。");
  videoOutput(capability, content.output);
  return {
    kind: "canvas",
    canvasId: canvas.id,
    sceneId,
    canvasRevision: canvas.revision,
    label: node.title,
    input: {
      nodeId,
      shotSources: [],
      referenceOverrides: [],
      promptPolicy: "append",
    },
  };
}
