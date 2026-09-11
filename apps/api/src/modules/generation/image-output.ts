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
export function imageOutput(raw: unknown): ImageOutput {
  if (
    !keys(raw, ["images"]) ||
    !Array.isArray(raw.images) ||
    raw.images.length !== 1
  )
    throw new Error("INVALID_IMAGE_OUTPUT");
  const source = raw.images[0];
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
    !["image/png", "image/jpeg", "image/webp"].includes(String(source.mime))
  )
    throw new Error("INVALID_IMAGE_OUTPUT");
  validateByteCount(source.object.bytes);
  validateSha256(source.sha256);
  return raw as ImageOutput;
}
