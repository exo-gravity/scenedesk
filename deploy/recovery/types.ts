export const POSTGRES_IMAGE =
  "postgres:16.15-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685";
export const MINIO_IMAGE =
  "quay.io/minio/minio:RELEASE.2025-07-23T15-54-02Z@sha256:d249d1fb6966de4d8ad26c04754b545205ff15a62e4fd19ebd0f26fa5baacbc0";
export const LABEL = "io.scenedesk.recovery";
export type Configuration = {
  version: 1;
  runId: string;
  side: "source" | "target";
  sealKeyFile: string;
  database: {
    containerId: string;
    volumeName: string;
    database: string;
    schema: string;
    user: string;
  };
  storage: {
    containerId: string;
    volumeName: string;
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  writers: string[];
};
export type Role = {
  name: string;
  inherit: boolean;
  login: boolean;
  bypassRls: boolean;
  connectionLimit: number;
};
export type FixedObject = {
  key: string;
  versionId: string;
  bytes: number;
  sha256: string;
};
export type StorageVersion = {
  key: string;
  versionId: string;
  latest: boolean;
  lastModified: string;
} & (
  { kind: "object"; bytes: number; sha256: string } | { kind: "delete_marker" }
);
export type Snapshot = {
  tables: { schema: string; name: string; rows: number; digest: string }[];
  migrations: { name: string; checksum: string }[];
  roles: Role[];
  objects: FixedObject[];
  generation: { status: string; count: number }[];
};
export type Payload = {
  format: "scenedesk-isolated-cold-recovery/1";
  runId: string;
  database: string;
  schema: string;
  bucket: string;
  source: {
    databaseContainer: string;
    storageContainer: string;
    databaseVolume: string;
    storageVolume: string;
  };
  images: { postgres: typeof POSTGRES_IMAGE; minio: typeof MINIO_IMAGE };
  startedAt: string;
  writersStoppedAt: string;
  databaseStoppedAt: string;
  files: {
    name: "database.dump" | "storage.tar";
    bytes: number;
    sha256: string;
  }[];
  snapshot: Snapshot;
  storageVersions: StorageVersion[];
  generationExecution: "disabled";
};
export class RecoveryError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function requireRecovery(value: unknown, code: string): asserts value {
  if (!value) throw new RecoveryError(code);
}
export function identifier(value: string) {
  requireRecovery(
    typeof value === "string" && /^[a-z][a-z0-9_]{0,62}$/.test(value),
    "RECOVERY_IDENTIFIER_INVALID",
  );
  return `"${value}"`;
}
