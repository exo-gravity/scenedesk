import { MediaFailure, type ProbeResult } from "./policy.js";
export type GeneratedMediaOptions = {
  resolution?: string;
  durationSeconds?: number;
  withAudio?: boolean;
};
/** Preserve actual source timing; never trim, pad or manufacture requested metadata. */
export function validateGeneratedOutput(
  probe: ProbeResult,
  mime: string,
  output: GeneratedMediaOptions,
) {
  const kind =
    mime === "video/mp4" ? "video" : mime === "audio/wav" ? "audio" : "image";
  if (
    probe.kind !== kind ||
    (kind !== "audio" && `${probe.width}x${probe.height}` !== output.resolution)
  )
    throw new MediaFailure(
      `${kind.toUpperCase()}_OUTPUT_MISMATCH`,
      "原输出类型或尺寸与固定计划不符，不能作为成功结果。",
    );
  if (kind === "audio") {
    const rate = probe.timing?.audioSampleRate;
    if (
      !probe.hasAudio ||
      probe.width !== undefined ||
      probe.height !== undefined ||
      !Number.isSafeInteger(probe.durationUs) ||
      probe.durationUs! <= 0 ||
      !Number.isSafeInteger(rate) ||
      rate! <= 0 ||
      !Number.isSafeInteger(output.durationSeconds) ||
      output.durationSeconds! <= 0
    )
      throw new MediaFailure(
        "AUDIO_OUTPUT_MISMATCH",
        "原音频必须有合法采样率、时长和独立音轨。",
      );
    const delta =
      BigInt(probe.durationUs!) - BigInt(output.durationSeconds!) * 1000000n;
    if ((delta < 0n ? -delta : delta) * BigInt(rate!) > 1000000n)
      throw new MediaFailure(
        "AUDIO_OUTPUT_MISMATCH",
        "原音频时长超出固定请求允许的一采样容器量化范围。",
      );
  }
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

export const validateGeneratedVisual = validateGeneratedOutput;
export type GeneratedVisualOptions = GeneratedMediaOptions;
