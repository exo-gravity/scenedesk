import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { sqlIdentifier } from "@drama/database";
import { grantQueueAccess, defaultQueueSchema } from "@drama/queue";
import { mediaStoreFromEnvironment } from "@drama/media";
import { writeVideoFixture } from "./video-fixture-file.js";

// Explicit local technical fixture. Publishes a new immutable identity; never upgrades target profiles.
if (process.env.APP_ENV !== "local" || !process.env.DATABASE_URL)
  throw new Error(
    "Explicit local provisioning and media processing credentials are required",
  );
const [tenantId] = process.argv.slice(2);
if (!tenantId || !/^[0-9a-f-]{36}$/.test(tenantId))
  throw new Error("Usage: extend-local-video-fixture.ts <tenant UUID>");
const dburl = new URL(process.env.DATABASE_URL);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(dburl.hostname) ||
  !dburl.pathname.startsWith("/drama_")
)
  throw new Error(
    "Video fixture provisioning requires the local drama_* database",
  );
const store = mediaStoreFromEnvironment(process.env);
if (!store)
  throw new Error("Load the isolated local media worker configuration");
await store.verify();
const admin = new Pool({ connectionString: process.env.DATABASE_URL }),
  sql = await admin.connect(),
  scope = sqlIdentifier(process.env.DATABASE_SCHEMA ?? "drama");
const directory = await mkdtemp(
  join(tmpdir(), "scenedesk-local-video-fixture-"),
);
const manifestFile = new URL("../.runtime/video-fixture.json", import.meta.url);
let wrote = false;
try {
  await sql.query("BEGIN");
  const tenant = await sql.query(
    `SELECT id FROM ${scope}.tenants WHERE id=$1 AND status='active' FOR UPDATE`,
    [tenantId],
  );
  const generation = (
    await sql.query(
      `SELECT worker_role FROM ${scope}.generation_runtime_identity WHERE singleton`,
    )
  ).rows[0];
  const media = (
    await sql.query(
      `SELECT worker_role,scheduler_role FROM ${scope}.media_processing_state WHERE singleton`,
    )
  ).rows[0];
  if (
    !tenant.rowCount ||
    !generation?.worker_role ||
    !media?.worker_role ||
    !media?.scheduler_role
  )
    throw new Error(
      "Active local tenant and isolated generation/media/queue workers must already exist",
    );
  if (
    (
      await sql.query(
        `SELECT 1 FROM ${scope}.generation_capabilities WHERE tenant_id=$1 AND definition->>'mode'='video_fixture_v1'`,
        [tenantId],
      )
    ).rowCount
  )
    throw new Error(
      "Video fixture already exists; recover the existing private manifest instead of publishing a duplicate",
    );
  const outputs: Record<string, unknown> = {};
  for (const withAudio of [false, true]) {
    const target = join(directory, withAudio ? "audio.mp4" : "silent.mp4");
    await writeVideoFixture(target, withAudio);
    const bytes = await readFile(target),
      sha256 = createHash("sha256").update(bytes).digest("hex");
    const source = await store.publish(
      target,
      { bytes: bytes.length, sha256, mime: "video/mp4" },
      "originals",
    );
    outputs[withAudio ? "audio" : "silent"] = {
      videos: [
        {
          kind: "fixture_object",
          object: {
            key: source.key,
            versionId: source.versionId,
            bytes: source.bytes,
          },
          sha256,
          mime: "video/mp4",
        },
      ],
    };
  }
  const capabilityId = randomUUID(),
    connectionId = randomUUID(),
    connectionVersionId = randomUUID();
  await sql.query(
    `INSERT INTO ${scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
    [
      capabilityId,
      tenantId,
      connectionId,
      connectionVersionId,
      {
        purpose: "video",
        mode: "video_fixture_v1",
        modelVersion: "本地视频归档测试（无真实模型）",
        supportedPurposes: [
          "composition",
          "look",
          "style",
          "identity",
          "location",
          "prop",
        ],
        maxReferences: 4,
        allowedResolutions: ["256x144"],
        minDurationSeconds: 2,
        maxDurationSeconds: 2,
        audioOutput: true,
        allowedAspectRatios: ["16:9"],
        inputRules: [
          {
            kind: "image",
            purposes: [
              "composition",
              "look",
              "style",
              "identity",
              "location",
              "prop",
            ],
            minCount: 0,
            maxCount: 4,
            mimeTypes: ["image/png", "image/jpeg", "image/webp"],
            maxBytes: 16777216,
            maxWidth: 8192,
            maxHeight: 8192,
          },
        ],
        notes:
          "固定两秒技术测试图与可选测试音，仅验证提交、视频归档、预览与人工放置；不解释提示、不代表真实 AI 效果。",
      },
    ],
  );
  await grantQueueAccess(
    sql,
    process.env.QUEUE_SCHEMA ?? defaultQueueSchema,
    generation.worker_role,
    media.scheduler_role,
  );
  await mkdir(new URL("../.runtime/", import.meta.url), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(
    manifestFile,
    JSON.stringify(
      {
        version: 1,
        executionMode: "test_fixture",
        tenantId,
        capabilityId,
        connectionVersionId,
        outputs,
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  wrote = true;
  await sql.query("COMMIT");
  console.log(
    JSON.stringify({
      configured: "test_fixture",
      capabilityId,
      connectionId,
      connectionVersionId,
      paidProvidersEnabled: false,
      configurationFile: ".runtime/video-fixture.json",
    }),
  );
} catch (error) {
  await sql.query("ROLLBACK");
  if (wrote)
    throw new Error(
      "Video fixture provisioning uncertain; private manifest retained for explicit recovery",
    );
  throw error;
} finally {
  await rm(directory, { recursive: true, force: true });
  sql.release();
  await admin.end();
  store.close();
}
