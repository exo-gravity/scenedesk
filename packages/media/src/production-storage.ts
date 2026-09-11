import { createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectVersionsCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import {
  privateStorageClient,
  type StoreConfiguration,
} from "./storage-client.js";
import { MediaFailure, validateSha256, type VerifiedObject } from "./policy.js";
import { PRODUCTION_LIMITS } from "./source-timing.js";

export const PRODUCTION_PART_BYTES = 64 * 1024 * 1024;
export type ProductionArtifact = Readonly<{
  id: string;
  kind: "video" | "video_map" | "audio" | "audio_map";
  bytes: number;
  sha256: string;
}>;
export type ProductionPart = Readonly<{
  number: number;
  bytes: number;
  sha256: string;
  etag: string;
}>;
export type ProductionUploadState = Readonly<{
  artifact: ProductionArtifact;
  uploadId?: string;
  versionId?: string;
  retired: boolean;
}>;
/** The database owner must reserve the artifact before any storage operation. */
export interface ProductionUploadJournal {
  load(): Promise<ProductionUploadState>;
  assertActive(): Promise<void>;
  started(uploadId: string): Promise<void>;
  part(part: ProductionPart): Promise<void>;
  completing(): Promise<void>;
  verified(object: VerifiedObject): Promise<void>;
}

function artifactKey(artifact: ProductionArtifact) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      artifact.id,
    ) ||
    !["video", "video_map", "audio", "audio_map"].includes(artifact.kind) ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes < (artifact.kind === "audio" ? 0 : 1) ||
    artifact.bytes > PRODUCTION_LIMITS.artifactBytes ||
    (artifact.kind === "audio" && artifact.bytes % 16 !== 0) ||
    (artifact.kind.endsWith("_map") &&
      artifact.bytes > PRODUCTION_LIMITS.reportBytes)
  )
    throw new MediaFailure(
      "MEDIA_ARTIFACT_INVALID",
      "制作工件身份、格式或大小无效。",
    );
  validateSha256(artifact.sha256);
  return `productions/${artifact.id}`;
}
function storageId(value: string | undefined) {
  if (!value || value === "null" || value.length > 1024)
    throw new MediaFailure(
      "STORAGE_VERSION_REQUIRED",
      "存储未返回可固定的工件版本或上传身份。",
    );
  return value;
}
const mismatch = () =>
  new MediaFailure(
    "STORAGE_INTEGRITY_MISMATCH",
    "存储中的制作工件与已固定的内容不一致。",
  );
const conflict = () =>
  new MediaFailure(
    "MEDIA_ARTIFACT_STORAGE_CONFLICT",
    "制作工件存储状态不唯一，需要按任务记录恢复。",
  );
const b64 = (sha: string) => Buffer.from(sha, "hex").toString("base64");
const mime = (kind: ProductionArtifact["kind"]) =>
  kind.endsWith("_map")
    ? "application/json"
    : kind === "video"
      ? "video/x-nut"
      : "application/octet-stream";
async function deadline<T>(
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
) {
  const timerSignal = new AbortController();
  const timer = setTimeout(
    () =>
      timerSignal.abort(
        new MediaFailure(
          "MEDIA_ARTIFACT_TIMEOUT",
          "制作工件传输超过时限，可从已记录状态恢复。",
        ),
      ),
    20 * 60_000,
  );
  try {
    const combined = signal
      ? AbortSignal.any([signal, timerSignal.signal])
      : timerSignal.signal;
    combined.throwIfAborted();
    return await run(combined);
  } finally {
    clearTimeout(timer);
  }
}

/** A separate private bucket: neither signed media access nor staging grants can reach it. */
export class ProductionStore {
  private readonly client;
  private readonly allocator;
  readonly bucket: string;
  constructor(config: StoreConfiguration) {
    this.bucket = config.bucket;
    this.client = privateStorageClient(config);
    // Initiation is not idempotent. Unknown results are discovered under the reserved exact key.
    this.allocator = privateStorageClient(config, 1);
  }
  close() {
    this.client.destroy();
    this.allocator.destroy();
  }
  async verify(signal?: AbortSignal) {
    const state = await this.client.send(
      new GetBucketVersioningCommand({ Bucket: this.bucket }),
      { ...(signal ? { abortSignal: signal } : {}) },
    );
    if (state.Status !== "Enabled")
      throw new MediaFailure(
        "STORAGE_VERSION_REQUIRED",
        "制作工件存储必须启用对象版本管理。",
      );
  }
  private async readFixed(
    artifact: ProductionArtifact,
    versionId: string,
    signal: AbortSignal,
    destination?: string,
  ) {
    const key = artifactKey(artifact);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        VersionId: storageId(versionId),
      }),
      { abortSignal: signal },
    );
    const body = response.Body;
    if (!body || !(Symbol.asyncIterator in body)) throw mismatch();
    if (
      response.VersionId !== versionId ||
      response.ContentLength !== artifact.bytes ||
      response.Metadata?.["scenedesk-artifact"] !== artifact.id ||
      response.Metadata?.["scenedesk-kind"] !== artifact.kind ||
      response.Metadata?.["scenedesk-sha256"] !== artifact.sha256 ||
      response.ContentType !== mime(artifact.kind)
    ) {
      (body as Readable).destroy?.();
      throw mismatch();
    }
    let created = false;
    const output = destination
      ? createWriteStream(destination, { flags: "wx", mode: 0o600 })
      : undefined;
    output?.once("open", () => {
      created = true;
    });
    const hash = createHash("sha256");
    let bytes = 0;
    const verify = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > artifact.bytes) return callback(mismatch());
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        body as AsyncIterable<Uint8Array>,
        verify,
        output ??
          new Writable({
            write(_chunk, _encoding, callback) {
              callback();
            },
          }),
        { signal },
      );
      if (bytes !== artifact.bytes || hash.digest("hex") !== artifact.sha256)
        throw mismatch();
      return { key, versionId, bytes, sha256: artifact.sha256 };
    } catch (error) {
      if (created && destination) await rm(destination, { force: true });
      throw error;
    } finally {
      (body as Readable).destroy?.();
      output?.destroy();
      verify.destroy();
    }
  }
  private async discover(artifact: ProductionArtifact, signal: AbortSignal) {
    const key = artifactKey(artifact);
    // HEAD on an absent key can return403 without bucket-list permission. Never reinterpret403 as absence.
    const result = await this.client.send(
      new ListObjectVersionsCommand({
        Bucket: this.bucket,
        Prefix: key,
        MaxKeys: 2,
      }),
      { abortSignal: signal },
    );
    const versions = (result.Versions ?? []).filter((v) => v.Key === key);
    if (
      result.IsTruncated ||
      versions.length > 1 ||
      result.DeleteMarkers?.some((v) => v.Key === key)
    )
      throw conflict();
    return versions.length ? storageId(versions[0]!.VersionId) : undefined;
  }
  private async pending(artifact: ProductionArtifact, signal: AbortSignal) {
    const key = artifactKey(artifact);
    const result = await this.client.send(
      new ListMultipartUploadsCommand({
        Bucket: this.bucket,
        Prefix: key,
        MaxUploads: 100,
      }),
      { abortSignal: signal },
    );
    if (result.IsTruncated) throw conflict();
    return (result.Uploads ?? [])
      .filter((v) => v.Key === key)
      .map((v) => storageId(v.UploadId))
      .sort();
  }
  async download(
    artifact: ProductionArtifact,
    versionId: string,
    file: string,
    signal?: AbortSignal,
  ) {
    return deadline(signal, (current) =>
      this.readFixed(artifact, versionId, current, file),
    );
  }
  async publish(
    file: string | undefined,
    journal: ProductionUploadJournal,
    signal?: AbortSignal,
  ): Promise<VerifiedObject> {
    return deadline(signal, async (current) => {
      const state = await journal.load(),
        artifact = state.artifact;
      const key = artifactKey(artifact);
      if (state.retired)
        throw new MediaFailure(
          "MEDIA_ARTIFACT_RETIRED",
          "此制作工件尝试已退出，不能继续发布。",
        );
      await journal.assertActive();
      await this.verify(current);
      const existing =
        state.versionId ?? (await this.discover(artifact, current));
      if (existing) {
        const verified = await this.readFixed(artifact, existing, current);
        await journal.verified(verified);
        return verified;
      }
      if (!file)
        throw new MediaFailure(
          "MEDIA_ARTIFACT_LOCAL_MISSING",
          "制作工件尚未上传且本地文件不存在，需要恢复制作。",
        );
      const input = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await input.stat();
        if (!info.isFile() || info.size !== artifact.bytes) throw mismatch();
        // Hash the actual file before any upload. Recheck the bytes consumed for multipart completion too.
        const initial = createHash("sha256");
        for await (const chunk of input.createReadStream({
          autoClose: false,
          start: 0,
        })) {
          current.throwIfAborted();
          initial.update(chunk);
        }
        if (initial.digest("hex") !== artifact.sha256) throw mismatch();
        const metadata = {
          "scenedesk-artifact": artifact.id,
          "scenedesk-kind": artifact.kind,
          "scenedesk-sha256": artifact.sha256,
        };
        let version: string;
        if (artifact.bytes <= PRODUCTION_PART_BYTES) {
          await journal.completing();
          const body =
            artifact.bytes === 0
              ? Buffer.alloc(0)
              : input.createReadStream({
                  autoClose: false,
                  start: 0,
                  end: artifact.bytes - 1,
                });
          try {
            const result = await this.client.send(
              new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: body,
                ContentLength: artifact.bytes,
                ContentType: mime(artifact.kind),
                Metadata: metadata,
                IfNoneMatch: "*",
                ChecksumSHA256: b64(artifact.sha256),
              }),
              { abortSignal: current },
            );
            version = storageId(result.VersionId);
          } catch (error) {
            const found = await this.discover(artifact, current);
            if (!found) throw error;
            version = found;
          } finally {
            if (body instanceof Readable) body.destroy();
          }
        } else {
          let uploadId = state.uploadId;
          const pending = await this.pending(artifact, current);
          if (uploadId && !pending.includes(uploadId))
            throw new MediaFailure(
              "MEDIA_UPLOAD_MISSING",
              "已记录的分段上传不存在，请按任务记录恢复。",
            );
          if (!uploadId) {
            uploadId = pending[0];
            if (!uploadId) {
              await journal.assertActive();
              const result = await this.allocator.send(
                new CreateMultipartUploadCommand({
                  Bucket: this.bucket,
                  Key: key,
                  ContentType: mime(artifact.kind),
                  Metadata: metadata,
                  ChecksumAlgorithm: "SHA256",
                  ChecksumType: "COMPOSITE",
                }),
                { abortSignal: current },
              );
              uploadId = storageId(result.UploadId);
            }
            await journal.started(uploadId);
          }
          const remote = await this.client.send(
            new ListPartsCommand({
              Bucket: this.bucket,
              Key: key,
              UploadId: uploadId,
              MaxParts: 1000,
            }),
            { abortSignal: current },
          );
          if (
            remote.IsTruncated ||
            (remote.Parts?.length ?? 0) >
              Math.ceil(artifact.bytes / PRODUCTION_PART_BYTES)
          )
            throw conflict();
          const fullHash = createHash("sha256"),
            parts: ProductionPart[] = [];
          for (
            let offset = 0, number = 1;
            offset < artifact.bytes;
            offset += PRODUCTION_PART_BYTES, number++
          ) {
            current.throwIfAborted();
            await journal.assertActive();
            const size = Math.min(
                PRODUCTION_PART_BYTES,
                artifact.bytes - offset,
              ),
              bytes = Buffer.allocUnsafe(size);
            let read = 0;
            while (read < size) {
              const result = await input.read(
                bytes,
                read,
                size - read,
                offset + read,
              );
              if (!result.bytesRead) throw mismatch();
              read += result.bytesRead;
            }
            fullHash.update(bytes);
            const sha256 = createHash("sha256").update(bytes).digest("hex");
            const known = remote.Parts?.find((p) => p.PartNumber === number);
            let etag: string;
            if (known?.Size === size && known.ChecksumSHA256 === b64(sha256))
              etag = storageId(known.ETag);
            else {
              const result = await this.client.send(
                new UploadPartCommand({
                  Bucket: this.bucket,
                  Key: key,
                  UploadId: uploadId,
                  PartNumber: number,
                  ContentLength: size,
                  Body: bytes,
                  ChecksumSHA256: b64(sha256),
                }),
                { abortSignal: current },
              );
              if (result.ChecksumSHA256 !== b64(sha256)) throw mismatch();
              etag = storageId(result.ETag);
            }
            const part = { number, bytes: size, sha256, etag };
            await journal.part(part);
            parts.push(part);
          }
          if (
            fullHash.digest("hex") !== artifact.sha256 ||
            (await input.stat()).size !== artifact.bytes
          )
            throw mismatch();
          await journal.completing();
          try {
            const result = await this.client.send(
              new CompleteMultipartUploadCommand({
                Bucket: this.bucket,
                Key: key,
                UploadId: uploadId,
                IfNoneMatch: "*",
                MultipartUpload: {
                  Parts: parts.map((p) => ({
                    PartNumber: p.number,
                    ETag: p.etag,
                    ChecksumSHA256: b64(p.sha256),
                  })),
                },
              }),
              { abortSignal: current },
            );
            version = storageId(result.VersionId);
          } catch (error) {
            const found = await this.discover(artifact, current);
            if (!found) throw error;
            version = found;
          }
        }
        const verified = await this.readFixed(artifact, version, current);
        await journal.verified(verified);
        return verified;
      } finally {
        await input.close();
      }
    });
  }
  /** Only a verified or retired reserved artifact can be swept; tombstones must remain for late initiations. */
  async cleanup(journal: ProductionUploadJournal, signal?: AbortSignal) {
    return deadline(signal, async (current) => {
      const state = await journal.load();
      if (!state.retired && !state.versionId)
        throw new MediaFailure(
          "MEDIA_UPLOAD_ACTIVE",
          "尚在上传的制作工件不能清理。",
        );
      const key = artifactKey(state.artifact);
      for (const uploadId of await this.pending(state.artifact, current)) {
        await journal.assertActive();
        await this.client.send(
          new AbortMultipartUploadCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
          }),
          { abortSignal: current },
        );
      }
      return { pending: (await this.pending(state.artifact, current)).length };
    });
  }
}
