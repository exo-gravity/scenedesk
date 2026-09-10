import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { TestContext } from "node:test";
import {
  S3Client,
  CreateBucketCommand,
  PutBucketVersioningCommand,
} from "@aws-sdk/client-s3";
import { MediaStore, type StoreConfiguration } from "@drama/media";

// Frozen, loopback-only compatibility fixture, not a production storage recommendation.
export const MINIO_TEST_IMAGE =
  "minio/minio@sha256:d249d1fb6966de4d8ad26c04754b545205ff15a62e4fd19ebd0f26fa5baacbc0";
export const MC_IMAGE =
  "minio/mc@sha256:fb8f773eac8ef9d6da0486d5dec2f42f219358bcb8de579d1623d518c9ebd4cc";
const exec = promisify(execFile);

export async function storageFixture(t: TestContext) {
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
  await admin.send(new CreateBucketCommand({ Bucket: config.bucket }));
  await admin.send(
    new PutBucketVersioningCommand({
      Bucket: config.bucket,
      VersioningConfiguration: { Status: "Enabled" },
    }),
  );
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
  const bucket = `arn:aws:s3:::${config.bucket}`;
  for (const [role, credentials, statements] of [
    [
      "signer",
      signer,
      [
        {
          Effect: "Allow",
          Action: ["s3:GetBucketVersioning"],
          Resource: [bucket],
        },
        {
          Effect: "Allow",
          Action: ["s3:PutObject"],
          Resource: [`${bucket}/staging/*`],
        },
        {
          Effect: "Allow",
          Action: ["s3:GetObjectVersion"],
          Resource: [`${bucket}/originals/*`, `${bucket}/derivatives/*`],
        },
      ],
    ],
    [
      "worker",
      worker,
      [
        {
          Effect: "Allow",
          Action: ["s3:GetBucketVersioning"],
          Resource: [bucket],
        },
        {
          Effect: "Allow",
          Action: ["s3:GetObject"],
          Resource: [`${bucket}/staging/*`],
        },
        {
          Effect: "Allow",
          Action: ["s3:GetObjectVersion"],
          Resource: [
            `${bucket}/staging/*`,
            `${bucket}/originals/*`,
            `${bucket}/derivatives/*`,
          ],
        },
        {
          Effect: "Allow",
          Action: ["s3:PutObject"],
          Resource: [`${bucket}/originals/*`, `${bucket}/derivatives/*`],
        },
      ],
    ],
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
      JSON.stringify({ Version: "2012-10-17", Statement: statements }),
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
  const api = new MediaStore({ ...config, credentials: signer });
  const processing = new MediaStore({ ...config, credentials: worker });
  clients.push(api, processing);
  return { api, processing, admin, config };
}
