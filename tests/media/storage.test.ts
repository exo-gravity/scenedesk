import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  PutBucketVersioningCommand,
} from "@aws-sdk/client-s3";
import { MediaStore } from "@drama/media";
import { storageFixture } from "../support/storage.js";

test("private versioned media storage", { timeout: 360_000 }, async (t) => {
  const fixture = await storageFixture(t);
  const { api, processing, admin, config } = fixture;
  const directory = await mkdtemp(join(tmpdir(), "scenedesk-storage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await api.verify();
  await processing.verify();
  const bytes = Buffer.from("original content"),
    changed = Buffer.from("replaced content");
  assert.equal(bytes.length, changed.length);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const key = `staging/${randomUUID()}`;
  const upload = await api.authorizeUpload(
    key,
    bytes.length,
    "text/plain",
    new Date(Date.now() + 60_000),
  );
  assert.equal(upload.method, "POST");
  const post = async (data: Buffer, fields = upload.formFields) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append("file", new Blob([new Uint8Array(data)]), "original.txt");
    return fetch(upload.uploadUrl, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
  };
  await t.test(
    "POST policy fixes key, content type and exact byte count",
    async () => {
      assert.equal((await post(bytes)).status, 204);
      assert.ok(!(await post(Buffer.concat([bytes, Buffer.from("!")]))).ok);
      assert.ok(
        !(
          await post(bytes, {
            ...upload.formFields,
            key: `originals/${randomUUID()}`,
          })
        ).ok,
      );
      assert.ok(
        !(
          await post(bytes, {
            ...upload.formFields,
            "Content-Type": "text/html",
          })
        ).ok,
      );
    },
  );
  const snapshot = await processing.snapshot(key, bytes.length);
  const file = join(directory, "source");
  await t.test(
    "fixed version survives reuse of an old staging upload authorization",
    async () => {
      assert.equal((await post(changed)).status, 204);
      const latest = await processing.snapshot(key, bytes.length);
      assert.notEqual(latest.versionId, snapshot.versionId);
      await processing.download(snapshot, file, sha256);
      assert.deepEqual(await readFile(file), bytes);
      await assert.rejects(
        processing.download(latest, join(directory, "wrong"), sha256),
        { code: "FILE_INTEGRITY_MISMATCH" },
      );
      await assert.rejects(readFile(join(directory, "wrong")), {
        code: "ENOENT",
      });
      await assert.rejects(processing.snapshot(key, bytes.length + 1), {
        code: "FILE_SIZE_MISMATCH",
      });
    },
  );
  const fixed = await processing.publish(
    file,
    { bytes: bytes.length, sha256, mime: "text/plain" },
    "originals",
  );
  await t.test(
    "published content has verified checksum and explicit version on every access",
    async () => {
      const access = await api.access(
        fixed,
        "旧钥匙\r\n剧本.txt",
        "text/plain",
        "attachment",
      );
      const url = new URL(access.url);
      assert.equal(url.searchParams.get("versionId"), fixed.versionId);
      const response = await fetch(access.url);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      assert.ok(
        response.headers.get("content-disposition")?.includes("attachment"),
      );
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const plain = new URL(access.url);
      plain.search = "";
      assert.equal((await fetch(plain)).status, 403);
      assert.equal((await post(changed)).status, 204);
      assert.deepEqual(
        Buffer.from(await (await fetch(access.url)).arrayBuffer()),
        bytes,
      );
    },
  );
  await t.test(
    "signing principal cannot overwrite accepted originals or read staging",
    async () => {
      for (const version of [undefined, "null"]) {
        await assert.rejects(
          async () => {
            const response = await fixture.workerClient.send(
              new GetObjectCommand({
                Bucket: config.bucket,
                Key: fixed.key,
                ...(version ? { VersionId: version } : {}),
              }),
              { abortSignal: t.signal },
            );
            (response.Body as Readable | undefined)?.destroy();
          },
          { name: "AccessDenied" },
        );
      }
      await assert.rejects(
        api.publish(
          file,
          { bytes: bytes.length, sha256, mime: "text/plain" },
          "originals",
        ),
      );
      await assert.rejects(api.snapshot(key, bytes.length));
      await assert.rejects(
        api.download(snapshot, join(directory, "unauthorized"), sha256),
      );
      await assert.rejects(
        api.access(snapshot, "source", "text/plain", "inline"),
        /Staging/,
      );
    },
  );
  await t.test(
    "checksum failures and pre-existing local files cannot be accepted",
    async () => {
      await assert.rejects(
        processing.publish(
          file,
          { bytes: bytes.length, sha256: "0".repeat(64), mime: "text/plain" },
          "originals",
        ),
      );
      const local = join(directory, "existing");
      await writeFile(local, "keep me");
      await assert.rejects(processing.download(snapshot, local, sha256), {
        code: "EEXIST",
      });
      assert.equal(await readFile(local, "utf8"), "keep me");
    },
  );
  await t.test(
    "missing source versions and suspended versioning fail closed",
    async () => {
      await admin.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: key,
          VersionId: snapshot.versionId,
        }),
      );
      await assert.rejects(
        processing.download(snapshot, join(directory, "gone"), sha256),
      );
      await admin.send(
        new PutBucketVersioningCommand({
          Bucket: config.bucket,
          VersioningConfiguration: { Status: "Suspended" },
        }),
      );
      await assert.rejects(processing.verify(), {
        code: "STORAGE_VERSION_REQUIRED",
      });
      await admin.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: `staging/${randomUUID()}`,
          Body: bytes,
        }),
      );
      const rootStore = new MediaStore(config);
      try {
        await assert.rejects(rootStore.verify(), {
          code: "STORAGE_VERSION_REQUIRED",
        });
      } finally {
        rootStore.close();
      }
      // Already pinned original versions remain readable while new work is blocked.
      assert.equal(
        (
          await admin.send(
            new GetObjectCommand({
              Bucket: config.bucket,
              Key: fixed.key,
              VersionId: fixed.versionId,
            }),
          )
        ).ContentLength,
        bytes.length,
      );
    },
  );
});
