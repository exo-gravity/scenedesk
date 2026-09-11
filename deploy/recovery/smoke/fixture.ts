import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve, join } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { S3Client, CreateBucketCommand, PutBucketVersioningCommand, ListBucketsCommand } from "@aws-sdk/client-s3";

const exec = promisify(execFile);
export const PG_IMAGE = "postgres:16.15-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685";
export const STORAGE_IMAGE = "quay.io/minio/minio:RELEASE.2025-07-23T15-54-02Z@sha256:d249d1fb6966de4d8ad26c04754b545205ff15a62e4fd19ebd0f26fa5baacbc0";
export type Side = "source" | "target";
export type RecoveryConfig = {
  version: 1; runId: string; side: Side; sealKeyFile: string;
  database: { containerId: string; volumeName: string; database: string; schema: string; user: "postgres" };
  storage: { containerId: string; volumeName: string; endpoint: string; region: "us-east-1"; bucket: string; accessKeyId: string; secretAccessKey: string };
  writers: string[];
};

// Full command output is deliberately never placed in the public test report.
export async function docker(args: string[], environment: Record<string, string> = {}) {
  try {
    return (await exec("docker", args, { timeout: 90_000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: process.env.PATH, ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}), ...environment },
    })).stdout.trim();
  } catch { throw Error(`RECOVERY_FIXTURE_DOCKER_${args[0]?.toUpperCase()}_FAILED`); }
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((yes, no) => server.close(error => error ? no(error) : yes()));
  return address.port;
}
export async function privateJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
}
export async function recoveryFixture() {
  const root = resolve(".runtime");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, "recovery-verification-"));
  await chmod(directory, 0o700);
  const runId = randomUUID(), resources: string[] = [], volumes: string[] = [], clients: S3Client[] = [];
  const password = randomBytes(24).toString("hex"), accessKeyId = randomBytes(12).toString("hex"), secretAccessKey = randomBytes(24).toString("hex");
  const sealKeyFile = join(directory, "seal-key.json");
  await privateJson(sealKeyFile, { version: 1, key: randomBytes(32).toString("base64url") });
  const labels = (side: Side) => ["--label", `io.scenedesk.recovery.run=${runId}`, "--label", `io.scenedesk.recovery.side=${side}`, "--label", "io.scenedesk.recovery.synthetic=true"];
  const create = async (side: Side) => {
    const suffix = randomBytes(6).toString("hex"), prefix = `scenedesk-recovery-${side}-${suffix}`;
    const databaseVolume = `${prefix}-database`, storageVolume = `${prefix}-storage`;
    for (const volume of [databaseVolume, storageVolume]) {
      await docker(["volume", "create", ...labels(side), volume]); volumes.push(volume);
    }
    const pgPort = await freePort(), storagePort = await freePort();
    const databaseId = await docker(["create", "--name", `${prefix}-database`, ...labels(side), "--publish", `127.0.0.1:${pgPort}:5432`, "--memory", "512m", "--pids-limit", "128", "--cpus", "2", "--mount", `type=volume,source=${databaseVolume},target=/var/lib/postgresql/data`, "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB=drama_recovery", PG_IMAGE], { POSTGRES_PASSWORD: password });
    resources.push(databaseId);
    const storageId = await docker(["create", "--name", `${prefix}-storage`, ...labels(side), "--publish", `127.0.0.1:${storagePort}:9000`, "--memory", "512m", "--pids-limit", "128", "--cpus", "2", "--mount", `type=volume,source=${storageVolume},target=/data`, "--env", "MINIO_ROOT_USER", "--env", "MINIO_ROOT_PASSWORD", STORAGE_IMAGE, "server", "/data"], { MINIO_ROOT_USER: accessKeyId, MINIO_ROOT_PASSWORD: secretAccessKey });
    resources.push(storageId);
    await docker(["start", databaseId]);
    const url = `postgres://postgres:${password}@127.0.0.1:${pgPort}/drama_recovery`;
    await readyDatabase(url);
    const config: RecoveryConfig = { version: 1, runId, side, sealKeyFile,
      database: { containerId: databaseId, volumeName: databaseVolume, database: "drama_recovery", schema: "drama", user: "postgres" },
      storage: { containerId: storageId, volumeName: storageVolume, endpoint: `http://127.0.0.1:${storagePort}`, region: "us-east-1", bucket: "recovery-media", accessKeyId, secretAccessKey }, writers: [],
    };
    const client = new S3Client({ endpoint: config.storage.endpoint, region: "us-east-1", credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true, maxAttempts: 1 });
    clients.push(client);
    if (side === "source") {
      await docker(["start", storageId]);
      await readyStorage(client);
      await client.send(new CreateBucketCommand({ Bucket: config.storage.bucket }));
      await client.send(new PutBucketVersioningCommand({ Bucket: config.storage.bucket, VersioningConfiguration: { Status: "Enabled" } }));
      // Harmless declared-writer sentinel; never an API, queue consumer or model runner.
      const sentinel = await docker(["create", "--name", `${prefix}-writer-sentinel`, ...labels(side), "--network", "none", "--read-only", "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,nodev", "--entrypoint", "/bin/sleep", PG_IMAGE, "3600"]);
      resources.push(sentinel); config.writers.push(sentinel);
      await docker(["start", sentinel]);
    }
    return { config, url, client };
  };
  return { directory, runId, create,
    async close() {
      for (const client of clients) client.destroy();
      const failed: string[] = [];
      for (const resource of resources.reverse()) await docker(["rm", "--force", "--volumes", resource]).catch(() => failed.push("container"));
      for (const volume of volumes.reverse()) await docker(["volume", "rm", volume]).catch(() => failed.push("volume"));
      assert.deepEqual(failed, [], "Only explicitly recorded recovery fixture resources are cleaned up");
    },
  };
}
export async function readyDatabase(url: string) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 1000 });
    try { await pool.query("SELECT 1"); return; } catch { await delay(250); } finally { await pool.end(); }
  }
  throw Error("RECOVERY_FIXTURE_DATABASE_NOT_READY");
}
export async function readyStorage(client: S3Client) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { await client.send(new ListBucketsCommand({}), { abortSignal: AbortSignal.timeout(1000) }); return; } catch { await delay(250); }
  }
  throw Error("RECOVERY_FIXTURE_STORAGE_NOT_READY");
}
