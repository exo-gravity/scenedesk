import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { TestContext } from "node:test";
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
} from "@aws-sdk/client-s3";
import {
  MediaStore,
  mediaStoragePolicy,
  type StoreConfiguration,
} from "@drama/media";

import { MINIO_TEST_IMAGE, MC_IMAGE } from "../../scripts/local-storage.js";
export { MINIO_TEST_IMAGE, MC_IMAGE };
const exec = promisify(execFile);

export async function storageFixture(t: TestContext) {
  let phase = "start";
  const trace = (value: string) => {
    phase = value;
    t.diagnostic("[DEBUG-asset-ci] " + value);
  };
  const beforeExit = () => {
    process.stderr.write(
      "[DEBUG-asset-ci] beforeExit phase=" +
        phase +
        " resources=" +
        process.getActiveResourcesInfo().join(",") +
        "\n",
    );
  };
  process.once("beforeExit", beforeExit);
  t.after(() => {
    process.removeListener("beforeExit", beforeExit);
  });
  trace("docker start");
  const name = `scenedesk-storage-test-${randomUUID()}`;
  const root = {
    accessKeyId: randomBytes(12).toString("hex"),
    secretAccessKey: randomBytes(24).toString("hex"),
  };
  const signer = {
    accessKeyId: randomBytes(12).toString("hex"),
    secretAccessKey: randomBytes(24).toString("hex"),
  };
  const worker = {
    accessKeyId: randomBytes(12).toString("hex"),
    secretAccessKey: randomBytes(24).toString("hex"),
  };
  const clients: { destroy?: () => void; close?: () => void }[] = [];
  t.after(async () => {
    for (const client of clients) {
      client.destroy?.();
      client.close?.();
    }
    await exec("docker", ["rm", "--force", name], { timeout: 15_000 });
  });
  await exec(
    "docker",
    [
      "run",
      "--detach",
      "--rm",
      "--name",
      name,
      "--publish",
      "127.0.0.1::9000",
      "--memory",
      "512m",
      "--pids-limit",
      "128",
      "--cpus",
      "2",
      "--tmpfs",
      "/data:rw,nosuid,nodev,size=536870912,mode=0700",
      "--env",
      "MINIO_ROOT_USER",
      "--env",
      "MINIO_ROOT_PASSWORD",
      MINIO_TEST_IMAGE,
      "server",
      "/data",
    ],
    {
      timeout: 60_000,
      env: {
        ...process.env,
        MINIO_ROOT_USER: root.accessKeyId,
        MINIO_ROOT_PASSWORD: root.secretAccessKey,
      },
    },
  );
  trace("docker started");
  const ports = JSON.parse(
    (
      await exec("docker", [
        "inspect",
        "--format",
        "{{json .NetworkSettings.Ports}}",
        name,
      ])
    ).stdout,
  );
  const endpoint = `http://127.0.0.1:${ports["9000/tcp"][0].HostPort}`;
  trace("readiness begin");
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
  if (!ready) throw new Error("Local storage fixture did not become ready");
  trace("readiness complete");
  const config: StoreConfiguration = {
    endpoint,
    region: "us-east-1",
    bucket: `media-${randomBytes(6).toString("hex")}`,
    credentials: root,
    local: true,
  };
  const admin = new S3Client({
    endpoint,
    forcePathStyle: true,
    region: config.region,
    credentials: root,
    maxAttempts: 1,
  });
  clients.push(admin);
  trace("bucket create");
  await admin.send(new CreateBucketCommand({ Bucket: config.bucket }));
  await admin.send(
    new PutBucketVersioningCommand({
      Bucket: config.bucket,
      VersioningConfiguration: { Status: "Enabled" },
    }),
  );
  trace("bucket versioning complete");
  const mc = (args: string[], input = "") =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        "docker",
        [
          "run",
          "--rm",
          "--interactive",
          "--network",
          `container:${name}`,
          "--env",
          "MC_HOST_fixture",
          MC_IMAGE,
          ...args,
        ],
        {
          env: {
            ...process.env,
            MC_HOST_fixture: `http://${root.accessKeyId}:${root.secretAccessKey}@127.0.0.1:9000`,
          },
          stdio: ["pipe", "ignore", "ignore"],
        },
      );
      const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
      child.once("error", () => {
        clearTimeout(timer);
        reject(new Error("Storage permission fixture failed to start"));
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve()
          : reject(new Error("Storage permission fixture failed"));
      });
      child.stdin.end(input);
    });
  for (const [role, credentials] of [
    ["api", signer],
    ["worker", worker],
  ] as const) {
    await mc([
      "admin",
      "user",
      "add",
      "fixture",
      credentials.accessKeyId,
      credentials.secretAccessKey,
    ]);
    await mc(
      ["admin", "policy", "create", "fixture", role, "/dev/stdin"],
      JSON.stringify(mediaStoragePolicy(config.bucket, role)),
    );
    await mc([
      "admin",
      "policy",
      "attach",
      "fixture",
      role,
      "--user",
      credentials.accessKeyId,
    ]);
  }
  trace("permission setup complete");
  const api = new MediaStore({ ...config, credentials: signer });
  const processing = new MediaStore({ ...config, credentials: worker });
  clients.push(api, processing);
  return { api, processing, admin, config };
}
