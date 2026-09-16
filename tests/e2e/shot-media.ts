import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
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
    response.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": grant.bytes.length,
      "Content-Disposition": `${grant.disposition}; filename="${grant.name}"`,
      "Cache-Control": "private, no-store",
      "Access-Control-Allow-Origin": "*",
    });
    response.end(grant.bytes);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const store = {
    async verify() {},
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
