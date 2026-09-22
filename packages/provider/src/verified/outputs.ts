import { createHash, randomUUID } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { join } from "node:path";

export type ArchiveStore = { publish(file: string, data: { bytes: number; sha256: string; mime: string }, kind: "originals", signal?: AbortSignal): Promise<{ key: string; versionId: string; bytes: number; sha256: string }> };
export type ArchivedOutput = { kind: "fixture_object"; object: { key: string; versionId: string; bytes: number }; sha256: string; mime: string };
export class VerifiedOutputError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = "VerifiedOutputError"; }
}
export async function archiveBytes(options: { store: ArchiveStore; tmpdir: string; mime: "video/mp4" | "image/png" | "image/jpeg"; bytes: Uint8Array; signal: AbortSignal }): Promise<ArchivedOutput> {
  const file = join(options.tmpdir, `verified-output-${randomUUID()}`);
  const sha256 = createHash("sha256").update(options.bytes).digest("hex");
  try {
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(options.bytes); } finally { await handle.close(); }
    const published = await options.store.publish(file, { bytes: options.bytes.byteLength, sha256, mime: options.mime }, "originals", options.signal);
    return { kind: "fixture_object", object: { key: published.key, versionId: published.versionId, bytes: published.bytes }, sha256: published.sha256, mime: options.mime };
  } finally {
    await rm(file, { force: true });
  }
}
export async function downloadBytes(fetchImpl: typeof fetch, url: string, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  const response = await fetchImpl(url, { signal, redirect: "follow" });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new VerifiedOutputError("DOWNLOAD_FAILED"); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.length;
    if (bytes > maxBytes) { await reader.cancel(); throw new VerifiedOutputError("DOWNLOAD_TOO_LARGE"); }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks);
}
