import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import {
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectVersionsCommand,
  ListPartsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  ProductionStore,
  type ProductionArtifact,
  type ProductionPart,
  type ProductionUploadJournal,
  type ProductionUploadState,
  type VerifiedObject,
} from "@drama/media";
import { storageFixture } from "../support/storage.js";

class Journal implements ProductionUploadJournal {
  state: ProductionUploadState;
  parts: ProductionPart[] = [];
  completingCount = 0;
  failAt: "started" | "part" | "verified" | undefined;
  active = true;
  constructor(artifact: ProductionArtifact) {
    this.state = { artifact, retired: false };
  }
  async load() {
    return this.state;
  }
  async assertActive() {
    assert.ok(this.active, "lease expired");
  }
  fault(at: Journal["failAt"]) {
    if (this.failAt === at) {
      this.failAt = undefined;
      throw new Error(`journal ${at} unavailable`);
    }
  }
  async started(uploadId: string) {
    await this.assertActive();
    this.fault("started");
    this.state = { ...this.state, uploadId };
  }
  async part(part: ProductionPart) {
    await this.assertActive();
    this.fault("part");
    this.parts = [...this.parts.filter((p) => p.number !== part.number), part];
  }
  async completing() {
    await this.assertActive();
    this.completingCount++;
  }
  async verified(value: VerifiedObject) {
    await this.assertActive();
    this.fault("verified");
    this.state = { ...this.state, versionId: value.versionId };
  }
}
async function hash(file: string) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

test(
  "internal production storage preserves exact versions and resumable owned uploads",
  { timeout: 360_000 },
  async (t) => {
    const f = await storageFixture(t),
      directory = await mkdtemp(
        join(tmpdir(), "scenedesk-production-storage-"),
      );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const spec = async (
      file: string,
      bytes: number,
      kind: ProductionArtifact["kind"] = "video",
    ) => ({ id: randomUUID(), bytes, kind, sha256: await hash(file) });
    const sparse = async (name: string, bytes: number) => {
      const file = join(directory, name),
        fd = await open(file, "wx", 0o600);
      try {
        await fd.truncate(bytes);
      } finally {
        await fd.close();
      }
      return file;
    };
    const source = await sparse("multipart", 64 * 1024 * 1024 + 32),
      artifact = await spec(source, 64 * 1024 * 1024 + 32),
      journal = new Journal(artifact);
    let fixed: VerifiedObject;
    await t.test(
      "unknown initiation and interrupted parts resume under the already reserved key",
      async () => {
        journal.failAt = "started";
        await assert.rejects(
          f.production.publish(source, journal, t.signal),
          /journal started unavailable/,
        );
        const first = await f.workerClient.send(
          new ListMultipartUploadsCommand({
            Bucket: f.productionBucket,
            Prefix: `productions/${artifact.id}`,
          }),
        );
        assert.equal(first.Uploads?.length, 1);
        journal.failAt = "part";
        await assert.rejects(
          f.production.publish(source, journal, t.signal),
          /journal part unavailable/,
        );
        assert.equal(journal.state.uploadId, first.Uploads![0]!.UploadId);
        const parts = await f.workerClient.send(
          new ListPartsCommand({
            Bucket: f.productionBucket,
            Key: `productions/${artifact.id}`,
            UploadId: journal.state.uploadId,
          }),
        );
        assert.equal(parts.Parts?.length, 1);
        assert.equal(parts.Parts![0]!.Size, 64 * 1024 * 1024);
        fixed = await f.production.publish(source, journal, t.signal);
        assert.equal(journal.parts.length, 2);
        assert.equal(journal.parts[0]!.etag, parts.Parts![0]!.ETag);
        assert.equal(fixed.sha256, artifact.sha256);
        assert.equal(fixed.bytes, artifact.bytes);
        const downloaded = join(directory, "roundtrip");
        await f.production.download(
          artifact,
          fixed.versionId,
          downloaded,
          t.signal,
        );
        assert.equal(await hash(downloaded), artifact.sha256);
        const versions = await f.workerClient.send(
          new ListObjectVersionsCommand({
            Bucket: f.productionBucket,
            Prefix: fixed.key,
          }),
        );
        assert.equal(versions.Versions?.length, 1);
      },
    );
    await t.test(
      "lost final journal write recovers the stored fixed version without local files or another upload",
      async () => {
        const file = join(directory, "map.json");
        await writeFile(file, '{"version":"fixture"}');
        const expected = await spec(file, 21, "video_map"),
          interrupted = new Journal(expected);
        interrupted.failAt = "verified";
        await assert.rejects(
          f.production.publish(file, interrupted, t.signal),
          /journal verified unavailable/,
        );
        await rm(file);
        const result = await f.production.publish(
          undefined,
          interrupted,
          t.signal,
        );
        assert.equal(result.sha256, expected.sha256);
        const versions = await f.workerClient.send(
          new ListObjectVersionsCommand({
            Bucket: f.productionBucket,
            Prefix: result.key,
          }),
        );
        assert.equal(versions.Versions?.length, 1);
        assert.equal(versions.Versions![0]!.VersionId, result.versionId);
        assert.equal(interrupted.completingCount, 1);
      },
    );
    await t.test(
      "private bucket permissions exclude API signing, current object reads and unrelated media enumeration",
      async () => {
        await assert.rejects(f.productionApi.verify(t.signal), {
          name: "AccessDenied",
        });
        await assert.rejects(
          f.productionApi.download(
            artifact,
            fixed!.versionId,
            join(directory, "forbidden"),
            t.signal,
          ),
          { name: "AccessDenied" },
        );
        await assert.rejects(
          f.workerClient.send(
            new ListMultipartUploadsCommand({ Bucket: f.config.bucket }),
          ),
          { name: "AccessDenied" },
        );
        await assert.rejects(
          f.workerClient.send(
            new ListObjectVersionsCommand({
              Bucket: f.productionBucket,
              Prefix: "originals/",
            }),
          ),
          { name: "AccessDenied" },
        );
        for (const version of [undefined, "null"]) {
          await assert.rejects(
            async () => {
              const response = await f.workerClient.send(
                new GetObjectCommand({
                  Bucket: f.productionBucket,
                  Key: fixed!.key,
                  ...(version ? { VersionId: version } : {}),
                }),
                { abortSignal: t.signal },
              );
              // A failed permission assertion must still release an unexpected response body.
              (response.Body as Readable | undefined)?.destroy();
            },
            { name: "AccessDenied" },
          );
        }
        await assert.rejects(
          f.api.access(fixed!, "copy", "video/x-nut", "inline"),
          /Invalid server object identity/,
        );
      },
    );
    await t.test(
      "fixed versions survive a changed current object; conflicting unknown versions are never guessed",
      async () => {
        await f.admin.send(
          new PutObjectCommand({
            Bucket: f.productionBucket,
            Key: fixed!.key,
            Body: "unrelated content",
          }),
        );
        assert.equal(
          (await f.production.publish(undefined, journal, t.signal)).versionId,
          fixed!.versionId,
        );
        await assert.rejects(
          f.production.publish(undefined, new Journal(artifact), t.signal),
          { code: "MEDIA_ARTIFACT_STORAGE_CONFLICT" },
        );
        const existing = join(directory, "existing");
        await writeFile(existing, "keep me");
        await assert.rejects(
          f.production.download(artifact, fixed!.versionId, existing, t.signal),
          { code: "EEXIST" },
        );
        assert.equal(await readFile(existing, "utf8"), "keep me");
      },
    );
    await t.test(
      "cleanup only aborts uploads for its retired or verified reserved artifact",
      async () => {
        const ours = await f.admin.send(
          new CreateMultipartUploadCommand({
            Bucket: f.productionBucket,
            Key: fixed!.key,
            ChecksumAlgorithm: "SHA256",
          }),
        );
        const otherKey = `productions/${randomUUID()}`;
        const other = await f.admin.send(
          new CreateMultipartUploadCommand({
            Bucket: f.productionBucket,
            Key: otherKey,
            ChecksumAlgorithm: "SHA256",
          }),
        );
        const active = new Journal({ ...artifact, id: randomUUID() });
        await assert.rejects(f.production.cleanup(active, t.signal), {
          code: "MEDIA_UPLOAD_ACTIVE",
        });
        assert.deepEqual(await f.production.cleanup(journal, t.signal), {
          pending: 0,
        });
        const remaining = await f.admin.send(
          new ListMultipartUploadsCommand({ Bucket: f.productionBucket }),
        );
        assert.ok(
          !remaining.Uploads?.some((u) => u.UploadId === ours.UploadId),
        );
        assert.ok(
          remaining.Uploads?.some((u) => u.UploadId === other.UploadId),
        );
      },
    );
    await t.test(
      "cancellation keeps the uploaded part owned until explicit retirement cleanup",
      async () => {
        const controller = new AbortController();
        class CancelledJournal extends Journal {
          override async part(part: ProductionPart) {
            await super.part(part);
            controller.abort(new Error("fixture transport cancellation"));
          }
        }
        const cancelled = new CancelledJournal({
          ...artifact,
          id: randomUUID(),
        });
        await assert.rejects(
          f.production.publish(
            source,
            cancelled,
            AbortSignal.any([t.signal, controller.signal]),
          ),
          /fixture transport cancellation/,
        );
        assert.equal(cancelled.parts.length, 1);
        assert.equal(cancelled.state.versionId, undefined);
        const parts = await f.workerClient.send(
          new ListPartsCommand({
            Bucket: f.productionBucket,
            Key: `productions/${cancelled.state.artifact.id}`,
            UploadId: cancelled.state.uploadId,
          }),
          { abortSignal: t.signal },
        );
        assert.equal(parts.Parts?.length, 1);
        cancelled.state = { ...cancelled.state, retired: true };
        await assert.rejects(
          f.production.publish(source, cancelled, t.signal),
          {
            code: "MEDIA_ARTIFACT_RETIRED",
          },
        );
        assert.deepEqual(await f.production.cleanup(cancelled, t.signal), {
          pending: 0,
        });
      },
    );
    await t.test(
      "matching metadata cannot conceal changed content, and failed downloads leave no file",
      async () => {
        const bytes = Buffer.from('{"version":"fixture"}'),
          expected: ProductionArtifact = {
            id: randomUUID(),
            kind: "video_map",
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          };
        const corrupt = await f.admin.send(
          new PutObjectCommand({
            Bucket: f.productionBucket,
            Key: `productions/${expected.id}`,
            Body: Buffer.alloc(bytes.length),
            ContentType: "application/json",
            Metadata: {
              "scenedesk-artifact": expected.id,
              "scenedesk-kind": expected.kind,
              "scenedesk-sha256": expected.sha256,
            },
          }),
        );
        const destination = join(directory, "corrupt-download");
        await assert.rejects(
          f.production.download(
            expected,
            corrupt.VersionId!,
            destination,
            t.signal,
          ),
          {
            code: "STORAGE_INTEGRITY_MISMATCH",
          },
        );
        await assert.rejects(readFile(destination), { code: "ENOENT" });
        const recovery = new Journal(expected);
        await assert.rejects(
          f.production.publish(undefined, recovery, t.signal),
          {
            code: "STORAGE_INTEGRITY_MISMATCH",
          },
        );
        assert.equal(recovery.state.versionId, undefined);
      },
    );
    await t.test(
      "explicit empty PCM and actual files larger than the import limit are verified without widening imports",
      async () => {
        const empty = await sparse("empty", 0),
          emptySpec = await spec(empty, 0, "audio");
        const result = await f.production.publish(
          empty,
          new Journal(emptySpec),
          t.signal,
        );
        assert.equal(result.bytes, 0);
        assert.equal(result.sha256, createHash("sha256").digest("hex"));
        const size = 256 * 1024 * 1024 + 1,
          big = await sparse("beyond-import-limit", size);
        const expected = await spec(big, size),
          upload = new Journal(expected);
        await assert.rejects(
          f.processing.publish(
            big,
            { bytes: size, sha256: expected.sha256, mime: "video/x-nut" },
            "derivatives",
          ),
          { code: "FILE_SIZE_REJECTED" },
        );
        const stored = await f.production.publish(big, upload, t.signal);
        assert.equal(stored.bytes, size);
        assert.equal(upload.parts.length, 5);
        assert.equal(
          upload.parts.reduce((sum, p) => sum + p.bytes, 0),
          size,
        );
        assert.equal(stored.sha256, expected.sha256);
        await assert.rejects(
          f.production.publish(
            undefined,
            new Journal({
              ...expected,
              id: randomUUID(),
              bytes: 8 * 1024 ** 3 + 1,
            }),
            t.signal,
          ),
          { code: "MEDIA_ARTIFACT_INVALID" },
        );
      },
    );
    await t.test(
      "hash mismatch and expired ownership stop publication",
      async () => {
        await assert.rejects(
          f.production.publish(
            source,
            new Journal({
              ...artifact,
              id: randomUUID(),
              sha256: "0".repeat(64),
            }),
            t.signal,
          ),
          { code: "STORAGE_INTEGRITY_MISMATCH" },
        );
        const expired = new Journal({ ...artifact, id: randomUUID() });
        expired.active = false;
        await assert.rejects(
          f.production.publish(source, expired, t.signal),
          /lease expired/,
        );
      },
    );
  },
);
