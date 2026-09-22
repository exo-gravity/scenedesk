import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileMode } from "./profiles.js";

export type ResolvedMedia = { id: string; kind: string; mime: string; bytes: number; sha256: string; width?: number; height?: number; object: { key: string; versionId: string } };
export type MediaResolver = (jobId: string) => Promise<ResolvedMedia[]>;
export type ReferenceRole = "first_frame" | "last_frame" | "reference_image";
export type MappedReference = { mediaId: string; purpose: string; role: ReferenceRole; index: number };
export type ByteStore = { download(source: { key: string; versionId: string; bytes: number }, file: string, expectedSha256: string, signal?: AbortSignal): Promise<unknown> };
export class VerifiedInputError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = "VerifiedInputError"; }
}
const PURPOSE_LABEL: Record<string, string> = {
  identity: "角色形象参考", look: "造型参考", style: "风格参考", location: "场景地点参考", prop: "道具参考", composition: "构图参考",
};
export function referenceRoles(mode: ProfileMode, references: { reference: { mediaId: string; purpose: string } }[]): MappedReference[] {
  if (mode === "frames_v1") {
    const first = references.filter((r) => r.reference.purpose === "start_frame");
    const last = references.filter((r) => r.reference.purpose === "end_frame");
    if (first.length > 1 || last.length > 1 || first.length + last.length !== references.length) throw new VerifiedInputError("REFERENCE_ROLE_INVALID");
    const mapped: MappedReference[] = [];
    if (first[0]) mapped.push({ mediaId: first[0].reference.mediaId, purpose: "start_frame", role: "first_frame", index: 1 });
    if (last[0]) mapped.push({ mediaId: last[0].reference.mediaId, purpose: "end_frame", role: "last_frame", index: mapped.length + 1 });
    return mapped;
  }
  return references.map((r, i) => {
    if (!(r.reference.purpose in PURPOSE_LABEL)) throw new VerifiedInputError("REFERENCE_ROLE_INVALID");
    return { mediaId: r.reference.mediaId, purpose: r.reference.purpose, role: "reference_image" as const, index: i + 1 };
  });
}
export function referenceLegend(mapped: MappedReference[]): string {
  const images = mapped.filter((m) => m.role === "reference_image");
  if (!images.length) return "";
  return `参考素材：${images.map((m) => `图片${m.index}为${PURPOSE_LABEL[m.purpose] ?? m.purpose}`).join("；")}。`;
}
export function dataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime.toLowerCase()};base64,${Buffer.from(bytes).toString("base64")}`;
}
export async function loadMediaBytes(store: ByteStore, tmpdir: string, media: ResolvedMedia, signal: AbortSignal): Promise<Buffer> {
  const file = join(tmpdir, `verified-input-${randomUUID()}`);
  try {
    await store.download({ key: media.object.key, versionId: media.object.versionId, bytes: media.bytes }, file, media.sha256, signal);
    return await readFile(file);
  } finally {
    await rm(file, { force: true });
  }
}
