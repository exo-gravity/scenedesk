import type { components } from "@drama/contracts";
import type { PromptDraft } from "./prompt-draft.js";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
export type ImageCapability = Schema<"Capability"> & {
  executionMode?: "test_fixture" | "verified_provider";
};
export type ImageRequest =
  | { kind: "shot"; input: Schema<"PlanInput">; label: string }
  | {
      kind: "canvas";
      canvasId: string;
      sceneId: string;
      canvasRevision: number;
      input: Schema<"PrepareCanvasGeneration">;
      label: string;
    };
export type ImageDraft = {
  capabilityId: string;
  output: Schema<"OutputOptions">;
  archiveRequest?:
    { key: string; jobId: string; checked?: boolean } | undefined;
  placement?:
    | {
        phase: "review" | "unknown" | "conflict" | "placed";
        key: string;
        canvasId: string;
        revision: number;
        input: Schema<"MaterializeCanvasResults">;
        checked?: boolean;
        placed?: Schema<"CanvasResultPlacement">;
      }
    | undefined;
};
export function executableImages(capabilities: readonly ImageCapability[]) {
  return capabilities.filter(
    (c) =>
      c.enabled &&
      c.purpose === "image" &&
      c.mode !== "target_profile_fixture" &&
      (c.executionMode === "verified_provider" ||
        (c.executionMode === "test_fixture" && c.mode === "image_fixture_v1")),
  );
}
export function imageOutput(
  capability: ImageCapability,
  output: Schema<"OutputOptions">,
): Schema<"OutputOptions"> {
  const resolution =
    output.resolution ||
    (capability.allowedResolutions?.length === 1
      ? capability.allowedResolutions[0]
      : undefined);
  if (!resolution || !capability.allowedResolutions?.includes(resolution))
    throw new Error("请选择当前模型支持的图片尺寸。");
  const match = /^(\d+)x(\d+)$/.exec(resolution);
  if (!match || !Number(match[1]) || !Number(match[2]))
    throw new Error("图片尺寸不可用，请重新读取模型能力。");
  const aspectRatio = output.aspectRatio;
  if (aspectRatio) {
    const ratio = /^(\d+):(\d+)$/.exec(aspectRatio);
    if (
      !capability.allowedAspectRatios?.includes(aspectRatio) ||
      !ratio ||
      Number(match[1]) * Number(ratio[2]) !==
        Number(match[2]) * Number(ratio[1])
    )
      throw new Error("画幅与所选图片尺寸不匹配。");
  }
  if (output.durationSeconds !== undefined || output.withAudio)
    throw new Error("本次仅生成单张图片，请核对参数。");
  return {
    resolution,
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(output.seed === undefined ? {} : { seed: output.seed }),
  };
}
export function shotImageRequest(
  creation: PromptDraft,
  projectId: string,
  capability: ImageCapability,
  output: Schema<"OutputOptions">,
): ImageRequest {
  if (!executableImages([capability]).length)
    throw new Error("当前能力只能描述提示目标，不能执行图片生成。");
  if (!creation.prompt.trim()) throw new Error("请先填写本次提示。");
  return {
    kind: "shot",
    label: creation.label,
    input: {
      scope: "project",
      projectId,
      connectionId: capability.connectionId,
      capabilityId: capability.id,
      purpose: "image",
      prompt: creation.prompt,
      shotSources: [structuredClone(creation.source)],
      output: imageOutput(capability, output),
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
export function canvasImageRequest(
  canvas: Schema<"Canvas">,
  sceneId: string,
  nodeId: string,
  capabilities: readonly ImageCapability[],
): ImageRequest {
  const node = canvas.document.nodes.find((node) => node.id === nodeId);
  if (!node || node.kind !== "image" || node.content.type !== "draft")
    throw new Error("请选择已保存的图片草稿。");
  const content = node.content;
  const capability = executableImages(capabilities).find(
    (c) => c.id === content.capabilityId,
  );
  if (!capability || capability.connectionId !== node.content.connectionId)
    throw new Error("请先为图片草稿选择可执行的模型。");
  imageOutput(capability, node.content.output);
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
