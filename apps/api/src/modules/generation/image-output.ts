import {
  validateByteCount,
  validateSha256,
  type ObjectVersion,
} from "@drama/media";

export type ImageOutput = {
  images: [
    {
      kind: "fixture_object";
      object: ObjectVersion;
      sha256: string;
      mime: "image/png" | "image/jpeg" | "image/webp";
    },
  ];
};
function keys(
  value: unknown,
  expected: string[],
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === expected.sort().join(",")
  );
}
function visualOutput(
  raw: unknown,
  kind: "image" | "video" | "audio",
): ImageOutput | VideoOutput | AudioOutput {
  const collection =
    kind === "image" ? "images" : kind === "video" ? "videos" : "audios";
  if (
    !keys(raw, [collection]) ||
    !Array.isArray(raw[collection]) ||
    raw[collection].length !== 1
  )
    throw new Error(`INVALID_${kind.toUpperCase()}_OUTPUT`);
  const source = raw[collection][0];
  if (
    !keys(source, ["kind", "object", "sha256", "mime"]) ||
    source.kind !== "fixture_object" ||
    !keys(source.object, ["key", "versionId", "bytes"]) ||
    typeof source.object.key !== "string" ||
    !/^(staging|originals)\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      source.object.key,
    ) ||
    typeof source.object.versionId !== "string" ||
    !source.object.versionId ||
    source.object.versionId === "null" ||
    source.object.versionId.length > 1024 ||
    /[\x00-\x1f\x7f]/.test(source.object.versionId) ||
    typeof source.object.bytes !== "number" ||
    typeof source.sha256 !== "string" ||
    !(
      kind === "image"
        ? ["image/png", "image/jpeg", "image/webp"]
        : kind === "video"
          ? ["video/mp4"]
          : ["audio/wav"]
    ).includes(String(source.mime))
  )
    throw new Error(`INVALID_${kind.toUpperCase()}_OUTPUT`);
  validateByteCount(source.object.bytes);
  validateSha256(source.sha256);
  return raw as ImageOutput | VideoOutput | AudioOutput;
}

export type VideoOutput = {
  videos: [Omit<ImageOutput["images"][0], "mime"> & { mime: "video/mp4" }];
};
export function imageOutput(raw: unknown): ImageOutput {
  return visualOutput(raw, "image") as ImageOutput;
}
export function videoOutput(raw: unknown): VideoOutput {
  return visualOutput(raw, "video") as VideoOutput;
}

export type AudioOutput = {
  audios: [Omit<ImageOutput["images"][0], "mime"> & { mime: "audio/wav" }];
};
export function audioOutput(raw: unknown): AudioOutput {
  return visualOutput(raw, "audio") as AudioOutput;
}
