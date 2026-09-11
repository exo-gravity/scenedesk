import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  S3Client,
  GetBucketVersioningCommand,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ALLOWED_UPLOAD_MIMES,
  MEDIA_LIMITS,
  MediaFailure,
  safeFileName,
  validateByteCount,
  validateSha256,
  type ObjectVersion,
  type VerifiedObject,
} from "./policy.js";
import {
  privateStorageClient,
  type StoreConfiguration,
} from "./storage-client.js";
export type { StoreConfiguration } from "./storage-client.js";

function objectKey(
  key: string,
  kind?: "staging" | "originals" | "derivatives",
) {
  if (
    !/^(staging|originals|derivatives)\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      key,
    ) ||
    (kind && !key.startsWith(`${kind}/`))
  )
    throw new Error("Invalid server object identity");
  return key;
}
function versionId(value?: string) {
  if (!value || value === "null" || value.length > 1024)
    throw new MediaFailure(
      "STORAGE_VERSION_REQUIRED",
      "存储未返回固定对象版本，不能验收素材。",
    );
  return value;
}

/** Caller authorizes the business resource. This module never accepts external media URLs. */
export class MediaStore {
  private readonly client: S3Client;
  readonly bucket: string;
  constructor(config: StoreConfiguration) {
    this.bucket = config.bucket;
    this.client = privateStorageClient(config);
  }
  close() {
    this.client.destroy();
  }
  async verify() {
    const state = await this.client.send(
      new GetBucketVersioningCommand({ Bucket: this.bucket }),
    );
    if (state.Status !== "Enabled")
      throw new MediaFailure(
        "STORAGE_VERSION_REQUIRED",
        "素材存储必须启用对象版本管理。",
      );
  }
  async authorizeUpload(
    key: string,
    bytes: number,
    mime: string,
    expiresAt: Date,
  ) {
    objectKey(key, "staging");
    validateByteCount(bytes);
    if (!(ALLOWED_UPLOAD_MIMES as readonly string[]).includes(mime))
      throw new MediaFailure("FILE_TYPE_REJECTED", "当前不支持此文件类型。");
    const seconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    if (
      !Number.isSafeInteger(seconds) ||
      seconds < 1 ||
      seconds > MEDIA_LIMITS.uploadSeconds
    )
      throw new MediaFailure("UPLOAD_EXPIRED", "上传凭证已过期，请重新导入。");
    const result = await createPresignedPost(this.client, {
      Bucket: this.bucket,
      Key: key,
      Expires: seconds,
      Fields: { "Content-Type": mime, success_action_status: "204" },
      Conditions: [
        ["content-length-range", bytes, bytes],
        ["eq", "$Content-Type", mime],
        ["eq", "$success_action_status", "204"],
      ],
    });
    return {
      uploadUrl: result.url,
      method: "POST" as const,
      formFields: result.fields,
    };
  }
  async snapshot(
    key: string,
    expectedBytes: number,
    signal?: AbortSignal,
  ): Promise<ObjectVersion> {
    objectKey(key, "staging");
    validateByteCount(expectedBytes);
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      {
        abortSignal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
          : AbortSignal.timeout(60_000),
      },
    );
    if (result.ContentLength !== expectedBytes)
      throw new MediaFailure(
        "FILE_SIZE_MISMATCH",
        "实际上传大小与声明不一致。",
      );
    return {
      key,
      versionId: versionId(result.VersionId),
      bytes: expectedBytes,
    };
  }
  /** Exclusively creates a worker-owned file; no unbounded response buffering. */
  async download(
    source: ObjectVersion,
    file: string,
    expectedSha256: string,
    signal?: AbortSignal,
  ) {
    objectKey(source.key);
    versionId(source.versionId);
    validateByteCount(source.bytes);
    validateSha256(expectedSha256);
    const timeout = AbortSignal.timeout(60_000);
    const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: source.key,
        VersionId: source.versionId,
      }),
      { abortSignal },
    );
    const body = response.Body;
    if (!body || !(Symbol.asyncIterator in body))
      throw new Error("Storage stream unavailable");
    let bytes = 0;
    const hash = createHash("sha256");
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > source.bytes)
          return callback(
            new MediaFailure("FILE_SIZE_MISMATCH", "下载内容超出声明大小。"),
          );
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    // Only remove files created by this call, never a pre-existing worker file.
    const output = createWriteStream(file, { flags: "wx", mode: 0o600 });
    let created = false;
    output.once("open", () => {
      created = true;
    });
    try {
      await pipeline(body as AsyncIterable<Uint8Array>, limiter, output, {
        signal: abortSignal,
      });
      if (
        response.VersionId !== source.versionId ||
        response.ContentLength !== source.bytes ||
        bytes !== source.bytes ||
        hash.digest("hex") !== expectedSha256
      )
        throw new MediaFailure(
          "FILE_INTEGRITY_MISMATCH",
          "文件内容与声明摘要不一致。",
        );
    } catch (error) {
      if (created) await rm(file, { force: true });
      throw error;
    }
  }
  /** Each attempt creates an exclusive server key. Business CAS decides which version is published. */
  async publish(
    file: string,
    data: { bytes: number; sha256: string; mime: string },
    kind: "originals" | "derivatives",
    signal?: AbortSignal,
  ): Promise<VerifiedObject> {
    validateByteCount(data.bytes);
    validateSha256(data.sha256);
    const key = `${kind}/${randomUUID()}`;
    const abortSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000);
    const body = createReadStream(file);
    try {
      const result = await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentLength: data.bytes,
          ContentType: data.mime,
          IfNoneMatch: "*",
          ChecksumSHA256: Buffer.from(data.sha256, "hex").toString("base64"),
        }),
        { abortSignal },
      );
      const fixed = {
        key,
        versionId: versionId(result.VersionId),
        bytes: data.bytes,
        sha256: data.sha256,
      };
      // The object server validates the explicit checksum. Verify the stored fixed version too.
      const head = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
          VersionId: fixed.versionId,
          ChecksumMode: "ENABLED",
        }),
        { abortSignal },
      );
      if (
        head.VersionId !== fixed.versionId ||
        head.ContentLength !== data.bytes ||
        head.ChecksumSHA256 !==
          Buffer.from(data.sha256, "hex").toString("base64")
      )
        throw new MediaFailure(
          "STORAGE_INTEGRITY_MISMATCH",
          "存储未确认文件完整性。",
        );
      return fixed;
    } finally {
      body.destroy();
    }
  }
  async access(
    source: ObjectVersion,
    fileName: string,
    mime: string,
    disposition: "inline" | "attachment",
  ) {
    objectKey(source.key);
    versionId(source.versionId);
    if (source.key.startsWith("staging/"))
      throw new Error("Staging is not a public media variant");
    const name = encodeURIComponent(safeFileName(fileName)).replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    const expiresAt = new Date(
      Date.now() + MEDIA_LIMITS.accessSeconds * 1000,
    ).toISOString();
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: source.key,
        VersionId: source.versionId,
        ResponseContentType: mime,
        ResponseContentDisposition: `${disposition}; filename="media"; filename*=UTF-8''${name}`,
        ResponseCacheControl: "private, no-store",
      }),
      { expiresIn: MEDIA_LIMITS.accessSeconds },
    );
    return { url, expiresAt };
  }
}
