import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { MediaStore } from "@drama/media";
import { fixtureVideo } from "../support/selected-media.js";

/** Only synthetic checked-in bytes. No business route or production bootstrap. */
export async function startShotMedia() {
  const blue = await fixtureVideo("blue"),
    orange = await fixtureVideo("orange");
  const grants = new Map<
    string,
    { bytes: Buffer; name: string; disposition: string; expires: number }
  >();
  const server = createServer((request, response) => {
    const token = request.url?.slice(1) ?? "",
      grant = grants.get(token);
    if (!grant || grant.expires < Date.now()) {
      response.writeHead(404);
      response.end();
      return;
    }
    // Browser seeks use byte ranges, just like the real signed S3 original.
    // Returning 200 for every range can leave a clipped preview seeking forever.
    const headers = {
      "Content-Type": "video/mp4",
      "Content-Disposition": `${grant.disposition}; filename="${grant.name}"`,
      "Cache-Control": "private, no-store",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
    };
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = match?.[1]
        ? Number(match[1])
        : Math.max(0, grant.bytes.length - Number(match?.[2]));
      const end = match?.[1] && match[2]
        ? Number(match[2])
        : grant.bytes.length - 1;
      if (
        !match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) || start < 0 || start > end || start >= grant.bytes.length
      ) {
        response.writeHead(416, {
          ...headers, "Content-Range": `bytes */${grant.bytes.length}`,
        });
        response.end();
        return;
      }
      const last = Math.min(end, grant.bytes.length - 1);
      response.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${start}-${last}/${grant.bytes.length}`,
        "Content-Length": last - start + 1,
      });
      response.end(request.method === "HEAD"
        ? undefined
        : grant.bytes.subarray(start, last + 1));
      return;
    }
    response.writeHead(200, { ...headers, "Content-Length": grant.bytes.length });
    response.end(request.method === "HEAD" ? undefined : grant.bytes);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const store = {
    async verify() {},
    async download(
      source: { key: string; versionId: string; bytes: number },
      path: string,
      sha256: string,
      signal?: AbortSignal,
    ) {
      signal?.throwIfAborted();
      assert.equal(source.versionId, "synthetic-v1");
      assert.ok(source.key.startsWith("originals/"));
      const bytes = [blue, orange].find((candidate) =>
        createHash("sha256").update(candidate).digest("hex") === sha256,
      );
      assert.ok(bytes, "Only a fixed synthetic original may be downloaded");
      assert.equal(source.bytes, bytes.length);
      await writeFile(path, bytes, { flag: "wx", mode: 0o600, signal });
    },
    async access(
      source: { key: string; versionId: string; bytes: number },
      name: string,
      mime: string,
      disposition: string,
    ) {
      assert.equal(source.versionId, "synthetic-v1");
      assert.ok(source.key.startsWith("originals/"));
      assert.equal(mime, "video/mp4");
      assert.ok(["synthetic-blue.mp4", "synthetic-orange.mp4"].includes(name));
      const bytes = name === "synthetic-blue.mp4" ? blue : orange;
      assert.equal(source.bytes, bytes.length);
      const token = randomBytes(24).toString("base64url"),
        expires = Date.now() + 300_000;
      grants.set(token, { bytes, name, disposition, expires });
      return {
        url: `${origin}/${token}`,
        expiresAt: new Date(expires).toISOString(),
      };
    },
  } as unknown as MediaStore;
  return {
    media: {
      store,
      async schedule() {
        throw new Error("This fixture must not submit media work");
      },
    },
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
