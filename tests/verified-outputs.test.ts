import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { archiveBytes, downloadBytes, VerifiedOutputError } from "@drama/provider";

test("archiveBytes publishes a private temp file and returns the store locator", async () => {
  const dir = await mkdtemp(join(tmpdir(), "verified-outputs-"));
  const payload = Buffer.from("mp4-bytes");
  let seen: { mode: number; bytes: number; sha256: string; mime: string } | undefined;
  const store = {
    async publish(file: string, data: { bytes: number; sha256: string; mime: string }) {
      seen = { mode: (await stat(file)).mode & 0o777, ...data };
      return { key: "originals/00000000-0000-4000-8000-000000000000", versionId: "v1", bytes: data.bytes, sha256: data.sha256 };
    },
  };
  const out = await archiveBytes({ store, tmpdir: dir, mime: "video/mp4", bytes: payload, signal: AbortSignal.timeout(1000) });
  assert.equal(seen!.mode, 0o600);
  assert.equal(seen!.sha256, createHash("sha256").update(payload).digest("hex"));
  assert.deepEqual(out, { kind: "fixture_object", object: { key: "originals/00000000-0000-4000-8000-000000000000", versionId: "v1", bytes: 9 }, sha256: seen!.sha256, mime: "video/mp4" });
  assert.deepEqual(await readdir(dir), []);
});
test("downloadBytes enforces the byte cap and rejects non-2xx", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/big") res.writeHead(200).end(Buffer.alloc(2048));
    else if (req.url === "/gone") res.writeHead(404).end();
    else res.writeHead(200).end(Buffer.from("ok"));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  assert.deepEqual(await downloadBytes(fetch, `${origin}/ok`, 1024, AbortSignal.timeout(1000)), Buffer.from("ok"));
  await assert.rejects(downloadBytes(fetch, `${origin}/big`, 1024, AbortSignal.timeout(1000)), (e: VerifiedOutputError) => e.code === "DOWNLOAD_TOO_LARGE");
  await assert.rejects(downloadBytes(fetch, `${origin}/gone`, 1024, AbortSignal.timeout(1000)), (e: VerifiedOutputError) => e.code === "DOWNLOAD_FAILED");
});
