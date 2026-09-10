export const MEDIA_LIMITS = Object.freeze({
  bytes: 256 * 1024 * 1024,
  durationUs: 2 * 60 * 60 * 1_000_000,
  pixels: 4096 * 4096,
  dimension: 8192,
  uploadSeconds: 15 * 60,
  accessSeconds: 5 * 60,
  processMilliseconds: 180_000,
  processMemoryBytes: 768 * 1024 * 1024,
  processOutputBytes: 4 * 1024 * 1024,
});

// The manifest pins both Linux architectures; runtime never pulls a floating tag.
export const FFMPEG_IMAGE =
  "mwader/static-ffmpeg@sha256:54e55b0cb8f672870fc38ceb2e6c411855cb3b39c505f5f3b2505ee01ed5f2b7";

export const ALLOWED_UPLOAD_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp4",
  "audio/flac",
  "audio/ogg",
  "text/plain",
  "application/x-subrip",
] as const;

export class MediaFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MediaFailure";
  }
}
export function validateByteCount(bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MEDIA_LIMITS.bytes)
    throw new MediaFailure(
      "FILE_SIZE_REJECTED",
      "文件大小须在 1 字节至 256 MiB 之间。",
    );
}
export function validateSha256(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value))
    throw new MediaFailure("INVALID_SHA256", "文件摘要必须是小写 SHA-256。");
}
export function safeFileName(value: string) {
  const result = value
    .normalize("NFC")
    .replace(/[\x00-\x1f\x7f/\\<>:"|?*\u202a-\u202e\u2066-\u2069]/g, "_")
    .trim()
    .replace(/^\.+/, "_");
  return Array.from(result).slice(0, 180).join("") || "未命名素材";
}

export type ObjectVersion = { key: string; versionId: string; bytes: number };
export type VerifiedObject = ObjectVersion & { sha256: string };
export type MediaKind = "image" | "video" | "audio" | "document";
export type ProbeResult = {
  kind: MediaKind;
  mime: string;
  hasAudio: boolean;
  durationUs?: number;
  width?: number;
  height?: number;
  fpsNum?: number;
  fpsDen?: number;
  timing?: {
    frameRateMode: "unknown";
    timeBaseNum?: number;
    timeBaseDen?: number;
    startPts?: string;
    audioSampleRate?: number;
    audioChannels?: number;
  };
};
