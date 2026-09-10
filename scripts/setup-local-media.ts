import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Pool } from "pg";
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
} from "@aws-sdk/client-s3";
import { grantMediaWorkerAccess, sqlIdentifier } from "@drama/database";
import { grantQueueAccess, defaultQueueSchema } from "@drama/queue";
import {
  mediaStoragePolicy,
  MediaStore,
  verifyMediaRuntime,
} from "@drama/media";
import { MINIO_TEST_IMAGE, MC_IMAGE } from "./local-storage.js";

if (
  process.env.APP_ENV !== "local" ||
  !process.env.DATABASE_URL ||
  !process.env.RUNTIME_DATABASE_URL ||
  !process.env.SCHEDULER_DATABASE_URL
)
  throw new Error(
    "Load local .env, .env.business and .env.queue; run upgrade:business first",
  );
const adminUrl = new URL(process.env.DATABASE_URL),
  apiUrl = new URL(process.env.RUNTIME_DATABASE_URL),
  schedulerUrl = new URL(process.env.SCHEDULER_DATABASE_URL);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(adminUrl.hostname) ||
  !adminUrl.pathname.startsWith("/drama_") ||
  [apiUrl, schedulerUrl].some(
    (url) => url.host !== adminUrl.host || url.pathname !== adminUrl.pathname,
  )
)
  throw new Error("Media setup requires the same loopback drama_* database");
const origin = process.env.APP_ORIGIN ?? "http://127.0.0.1:4311";
if (origin !== "http://127.0.0.1:4311")
  throw new Error("Local media setup is scoped to the default local UI origin");
const exec = promisify(execFile);
const manifestPath = new URL("../.runtime/media-local.json", import.meta.url);
type Credentials = { accessKeyId: string; secretAccessKey: string };
type Manifest = {
  version: 1;
  container: string;
  volume: string;
  bucket: string;
  workerRole: string;
  workerPassword: string;
  root: Credentials;
  api: Credentials;
  worker: Credentials;
};
const credentials = (): Credentials => ({
  accessKeyId: randomBytes(12).toString("hex"),
  secretAccessKey: randomBytes(24).toString("hex"),
});
await mkdir(new URL("../.runtime/", import.meta.url), {
  recursive: true,
  mode: 0o700,
});
let manifest: Manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT")
    throw new Error(
      "Local media manifest is unreadable; retain it for recovery",
    );
  const suffix = randomBytes(6).toString("hex");
  manifest = {
    version: 1,
    container: `scenedesk-local-media-${suffix}`,
    volume: `scenedesk-local-media-${suffix}`,
    bucket: `scenedesk-media-${suffix}`,
    workerRole: `scenedesk_media_${suffix}`,
    workerPassword: randomBytes(32).toString("hex"),
    root: credentials(),
    api: credentials(),
    worker: credentials(),
  };
  await writeFile(manifestPath, JSON.stringify(manifest), {
    mode: 0o600,
    flag: "wx",
  });
}
if (
  manifest.version !== 1 ||
  !/^scenedesk-local-media-[a-f0-9]{12}$/.test(manifest.container) ||
  manifest.container !== manifest.volume ||
  !/^scenedesk_media_[a-f0-9]{12}$/.test(manifest.workerRole) ||
  !/^scenedesk-media-[a-f0-9]{12}$/.test(manifest.bucket) ||
  !/^[a-f0-9]{64}$/.test(manifest.workerPassword) ||
  [manifest.root, manifest.api, manifest.worker].some(
    (value) =>
      !value ||
      !/^[a-f0-9]{24}$/.test(value.accessKeyId) ||
      !/^[a-f0-9]{48}$/.test(value.secretAccessKey),
  )
)
  throw new Error(
    "Invalid local media manifest; existing configuration was retained",
  );
await chmod(manifestPath, 0o600);
const endpoint = "http://127.0.0.1:55440",
  region = "us-east-1";
async function docker(args: string[], env?: NodeJS.ProcessEnv) {
  try {
    return (
      await exec("docker", args, { timeout: 60_000, env: env ?? process.env })
    ).stdout;
  } catch {
    throw new Error(
      "Local media container operation failed; configuration was retained for rerun",
    );
  }
}
let existing:
  | {
      Config: { Image: string; Labels: Record<string, string> };
      State: { Running: boolean };
    }
  | undefined;
try {
  existing = JSON.parse(
    (await exec("docker", ["inspect", manifest.container], { timeout: 10_000 }))
      .stdout,
  )[0];
} catch {}
if (existing) {
  if (
    existing.Config.Image !== MINIO_TEST_IMAGE ||
    existing.Config.Labels["scenedesk.local-media"] !== manifest.bucket
  )
    throw new Error(
      "Existing media container identity does not match local configuration",
    );
  if (!existing.State.Running) await docker(["start", manifest.container]);
} else {
  await docker(
    [
      "run",
      "--detach",
      "--pull",
      "never",
      "--name",
      manifest.container,
      "--label",
      `scenedesk.local-media=${manifest.bucket}`,
      "--publish",
      "127.0.0.1:55440:9000",
      "--memory",
      "1g",
      "--pids-limit",
      "128",
      "--cpus",
      "2",
      "--volume",
      `${manifest.volume}:/data`,
      "--env",
      "MINIO_ROOT_USER",
      "--env",
      "MINIO_ROOT_PASSWORD",
      "--env",
      "MINIO_API_CORS_ALLOW_ORIGIN",
      "--env",
      "MINIO_BROWSER=off",
      MINIO_TEST_IMAGE,
      "server",
      "/data",
    ],
    {
      ...process.env,
      MINIO_ROOT_USER: manifest.root.accessKeyId,
      MINIO_ROOT_PASSWORD: manifest.root.secretAccessKey,
      MINIO_API_CORS_ALLOW_ORIGIN: origin,
    },
  );
}
let ready = false;
for (let i = 0; i < 60; i++) {
  try {
    ready = (
      await fetch(`${endpoint}/minio/health/ready`, {
        signal: AbortSignal.timeout(1000),
      })
    ).ok;
  } catch {}
  if (ready) break;
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) throw new Error("Local media storage did not become ready");
const storageAdmin = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: manifest.root,
  maxAttempts: 1,
});
const database = new Pool({ connectionString: adminUrl.href, max: 2 });
const workerUrl = new URL(adminUrl);
workerUrl.username = manifest.workerRole;
workerUrl.password = manifest.workerPassword;
async function mc(args: string[], input = "") {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "run",
        "--rm",
        "--pull",
        "never",
        "--interactive",
        "--network",
        `container:${manifest.container}`,
        "--env",
        "MC_HOST_local",
        MC_IMAGE,
        ...args,
      ],
      {
        env: {
          ...process.env,
          MC_HOST_local: `http://${manifest.root.accessKeyId}:${manifest.root.secretAccessKey}@127.0.0.1:9000`,
        },
        stdio: ["pipe", "ignore", "ignore"],
      },
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Local storage permission setup could not start"));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(new Error("Local storage permission setup failed"));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
async function privateConfig(name: string, contents: string) {
  const file = new URL(`../${name}`, import.meta.url);
  try {
    await writeFile(file, contents, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(file, "utf8")) !== contents)
      throw new Error(`Existing ${name} differs; it was not overwritten`);
  }
  await chmod(file, 0o600);
}
try {
  try {
    await storageAdmin.send(new HeadBucketCommand({ Bucket: manifest.bucket }));
  } catch (error) {
    if (
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode !== 404
    )
      throw new Error("Local media bucket could not be inspected");
    await storageAdmin.send(
      new CreateBucketCommand({ Bucket: manifest.bucket }),
    );
  }
  await storageAdmin.send(
    new PutBucketVersioningCommand({
      Bucket: manifest.bucket,
      VersioningConfiguration: { Status: "Enabled" },
    }),
  );
  for (const role of ["api", "worker"] as const) {
    const identity = manifest[role],
      policyName = `scenedesk-${role}`;
    await mc([
      "admin",
      "user",
      "add",
      "local",
      identity.accessKeyId,
      identity.secretAccessKey,
    ]);
    await mc(
      ["admin", "policy", "create", "local", policyName, "/dev/stdin"],
      JSON.stringify(mediaStoragePolicy(manifest.bucket, role)),
    );
    await mc([
      "admin",
      "policy",
      "attach",
      "local",
      policyName,
      "--user",
      identity.accessKeyId,
    ]);
  }
  const sql = await database.connect();
  try {
    await sql.query("BEGIN");
    if (
      !(
        await sql.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [
          manifest.workerRole,
        ])
      ).rowCount
    )
      await sql.query(
        `CREATE ROLE ${sqlIdentifier(manifest.workerRole)} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '${manifest.workerPassword}'`,
      );
    await grantMediaWorkerAccess(
      sql,
      "drama",
      manifest.workerRole,
      decodeURIComponent(schedulerUrl.username),
    );
    await grantQueueAccess(
      sql,
      process.env.QUEUE_SCHEMA ?? defaultQueueSchema,
      manifest.workerRole,
      decodeURIComponent(schedulerUrl.username),
    );
    await sql.query("COMMIT");
  } catch {
    await sql.query("ROLLBACK");
    throw new Error(
      "Local media database grants failed; run upgrade:business and retain the manifest for rerun",
    );
  } finally {
    sql.release();
  }
  const shared = `APP_ENV=local\nMEDIA_ENDPOINT=${endpoint}\nMEDIA_REGION=${region}\nMEDIA_BUCKET=${manifest.bucket}\nQUEUE_SCHEMA=${process.env.QUEUE_SCHEMA ?? defaultQueueSchema}\n`;
  const storageConfig = (value: Credentials) =>
    `MEDIA_ACCESS_KEY_ID=${value.accessKeyId}\nMEDIA_SECRET_ACCESS_KEY=${value.secretAccessKey}\n`;
  await privateConfig(".env.media-api", shared + storageConfig(manifest.api));
  await privateConfig(
    ".env.media-worker",
    shared +
      storageConfig(manifest.worker) +
      `MEDIA_WORKER_DATABASE_URL=${workerUrl.href}\n`,
  );
  for (const identity of [manifest.api, manifest.worker]) {
    const store = new MediaStore({
      endpoint,
      region,
      bucket: manifest.bucket,
      credentials: identity,
      local: true,
    });
    try {
      await store.verify();
    } finally {
      store.close();
    }
  }
  await verifyMediaRuntime();
  console.log(
    JSON.stringify({
      localMediaSetup: "pass",
      endpoint,
      versioningEnabled: true,
      independentRuntimeIdentities: true,
      configurationReused: !!existing,
      productionStorage: false,
    }),
  );
} finally {
  storageAdmin.destroy();
  await database.end();
}
