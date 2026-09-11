import { MediaFailure, type ProbeResult } from "./policy.js";
export type GeneratedVisualOptions = {
  resolution: string;
  durationSeconds?: number;
  withAudio?: boolean;
};
/** Preserve actual source timing; never trim, pad or manufacture requested metadata. */
export function validateGeneratedVisual(
  probe: ProbeResult,
  mime: string,
  output: GeneratedVisualOptions,
) {
  const kind = mime === "video/mp4" ? "video" : "image";
  if (
    probe.kind !== kind ||
    `${probe.width}x${probe.height}` !== output.resolution
  )
    throw new MediaFailure(
      kind === "video" ? "VIDEO_OUTPUT_MISMATCH" : "IMAGE_OUTPUT_MISMATCH",
      "原输出类型或尺寸与固定计划不符，不能作为成功结果。",
    );
  if (kind === "video") {
    if (
      !Number.isSafeInteger(output.durationSeconds) ||
      !Number.isSafeInteger(probe.durationUs) ||
      !Number.isSafeInteger(probe.fpsNum) ||
      !Number.isSafeInteger(probe.fpsDen) ||
      output.durationSeconds! <= 0 ||
      probe.durationUs! <= 0 ||
      probe.fpsNum! <= 0 ||
      probe.fpsDen! <= 0 ||
      probe.hasAudio !== output.withAudio
    )
      throw new MediaFailure(
        "VIDEO_OUTPUT_MISMATCH",
        "原视频的时长、帧率或音频轨不符合固定请求。",
      );
    const delta =
      BigInt(probe.durationUs!) - BigInt(output.durationSeconds!) * 1000000n;
    if (
      (delta < 0n ? -delta : delta) * BigInt(probe.fpsNum!) >
      1000000n * BigInt(probe.fpsDen!)
    )
      throw new MediaFailure(
        "VIDEO_OUTPUT_MISMATCH",
        "原视频时长超出固定请求允许的一帧容器量化范围。",
      );
  }
}
