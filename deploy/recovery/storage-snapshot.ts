import { createHash } from "node:crypto";
import {
  GetBucketVersioningCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  requireRecovery,
  type Configuration,
  type FixedObject,
  type StorageVersion,
} from "./types.js";

/** Read every version, including unreferenced originals and delete markers. Never PUT/copy. */
export async function storageSnapshot(
  config: Configuration,
  references: FixedObject[],
): Promise<StorageVersion[]> {
  const client = new S3Client({
    endpoint: config.storage.endpoint,
    region: config.storage.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.storage.accessKeyId,
      secretAccessKey: config.storage.secretAccessKey,
    },
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 5000, requestTimeout: 60_000 },
  });
  try {
    const versioning = await client.send(
      new GetBucketVersioningCommand({ Bucket: config.storage.bucket }),
      { abortSignal: AbortSignal.timeout(60_000) },
    );
    requireRecovery(
      versioning.Status === "Enabled",
      "RECOVERY_STORAGE_VERSIONING_REQUIRED",
    );
    const versions: StorageVersion[] = [];
    let keyMarker: string | undefined,
      versionMarker: string | undefined,
      total = 0;
    do {
      const page = await client.send(
        new ListObjectVersionsCommand({
          Bucket: config.storage.bucket,
          KeyMarker: keyMarker,
          VersionIdMarker: versionMarker,
          MaxKeys: 1000,
        }),
        { abortSignal: AbortSignal.timeout(60_000) },
      );
      requireRecovery(
        versions.length +
          (page.Versions?.length ?? 0) +
          (page.DeleteMarkers?.length ?? 0) <=
          1000,
        "RECOVERY_SYNTHETIC_OBJECT_LIMIT",
      );
      for (const value of [
        ...(page.Versions ?? []),
        ...(page.DeleteMarkers ?? []),
      ])
        requireRecovery(
          value.Key &&
            value.VersionId &&
            value.VersionId !== "null" &&
            value.LastModified &&
            typeof value.IsLatest === "boolean",
          "RECOVERY_STORAGE_VERSION_INVALID",
        );
      for (const value of page.Versions ?? []) {
        const bytes = value.Size!;
        requireRecovery(
          Number.isSafeInteger(bytes) &&
            bytes >= 0 &&
            bytes <= 16 * 1024 * 1024,
          "RECOVERY_SYNTHETIC_SIZE_LIMIT",
        );
        total += bytes;
        requireRecovery(
          total <= 256 * 1024 * 1024,
          "RECOVERY_SYNTHETIC_SIZE_LIMIT",
        );
        const signal = AbortSignal.timeout(60_000);
        const content = await client.send(
          new GetObjectCommand({
            Bucket: config.storage.bucket,
            Key: value.Key!,
            VersionId: value.VersionId!,
          }),
          { abortSignal: signal },
        );
        requireRecovery(
          content.Body &&
            Symbol.asyncIterator in content.Body &&
            content.VersionId === value.VersionId &&
            content.ContentLength === bytes,
          "RECOVERY_STORAGE_VERSION_MISMATCH",
        );
        const hash = createHash("sha256");
        let observed = 0;
        for await (const chunk of content.Body as AsyncIterable<Uint8Array>) {
          signal.throwIfAborted();
          observed += chunk.byteLength;
          requireRecovery(observed <= bytes, "RECOVERY_STORAGE_BYTES_MISMATCH");
          hash.update(chunk);
        }
        requireRecovery(observed === bytes, "RECOVERY_STORAGE_BYTES_MISMATCH");
        versions.push({
          key: value.Key!,
          versionId: value.VersionId!,
          kind: "object",
          latest: value.IsLatest!,
          lastModified: value.LastModified!.toISOString(),
          bytes,
          sha256: hash.digest("hex"),
        });
      }
      for (const value of page.DeleteMarkers ?? [])
        versions.push({
          key: value.Key!,
          versionId: value.VersionId!,
          kind: "delete_marker",
          latest: value.IsLatest!,
          lastModified: value.LastModified!.toISOString(),
        });
      if (!page.IsTruncated) break;
      requireRecovery(
        page.NextKeyMarker &&
          (page.NextKeyMarker !== keyMarker ||
            page.NextVersionIdMarker !== versionMarker),
        "RECOVERY_STORAGE_PAGE_INVALID",
      );
      keyMarker = page.NextKeyMarker;
      versionMarker = page.NextVersionIdMarker;
    } while (true);
    versions.sort((a, b) =>
      a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : a.versionId < b.versionId
            ? -1
            : a.versionId > b.versionId
              ? 1
              : 0,
    );
    requireRecovery(
      new Set(
        versions.map((item) => JSON.stringify([item.key, item.versionId])),
      ).size === versions.length,
      "RECOVERY_STORAGE_VERSION_DUPLICATED",
    );
    for (const fixed of references) {
      const version = versions.find(
        (value) =>
          value.key === fixed.key && value.versionId === fixed.versionId,
      );
      requireRecovery(
        version?.kind === "object" &&
          version.bytes === fixed.bytes &&
          version.sha256 === fixed.sha256,
        "RECOVERY_FIXED_OBJECT_MISMATCH",
      );
    }
    return versions;
  } finally {
    client.destroy();
  }
}
