/** Synthetic isolated E2E: actual API/PG/MinIO/upload processing; local technical text/video fixture executor only; zero paid/network provider calls. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import type { TestContext } from "node:test";
import { Pool } from "pg";
import { createMediaProcessor } from "@drama/media";
import {
  createScheduler,
  runInternalWorker,
  installQueue,
  grantQueueAccess,
} from "@drama/queue";
import {
  grantMediaWorkerAccess,
  grantGenerationWorkerAccess,
  sqlIdentifier,
} from "@drama/database";
import {
  createAssistanceFixture,
  localAssistanceFixtureOutput,
} from "@drama/provider";
import { createAssistanceWorker } from "../../../apps/api/src/modules/generation/worker.js";
import { buildApp } from "../../../apps/api/src/app.js";
import { businessFixture } from "../../../tests/support/business.js";
import { storageFixture } from "../../../tests/support/storage.js";

const exec = promisify(execFile);
const port = Number(process.env.CREATIVE_PORT ?? "4317");
assert(
  Number.isInteger(port) && port >= 1024 && port <= 65535,
  "CREATIVE_PORT must be a valid unprivileged port",
);
// localhost has a separate cookie host from the protected demo at 127.0.0.1.
const origin = `http://localhost:${port}`;
async function buildInput(pathKey: string, shaKey: string, fallback?: string) {
  const input = process.env[pathKey] ?? fallback;
  if (!input) return undefined;
  const sourceCommit = process.env[shaKey];
  assert(
    sourceCommit && /^[0-9a-f]{40}$/i.test(sourceCommit),
    `${shaKey} must be the full source commit of this prepared dist`,
  );
  const path = resolve(input);
  assert(
    (await stat(resolve(path, "index.html")).catch(() => undefined))?.isFile(),
    `${pathKey} must contain a prepared production index.html`,
  );
  return { path, sourceCommit };
}
const builds = {
  before: await buildInput("CREATIVE_BASELINE_DIST", "CREATIVE_BASELINE_SHA"),
  after: await buildInput(
    "CREATIVE_CURRENT_DIST",
    "CREATIVE_CURRENT_SHA",
    "apps/web/dist",
  ),
};
const phase =
  process.env.CREATIVE_PHASE ?? (builds.before ? "before" : "after");
assert(
  phase === "before" || phase === "after",
  "CREATIVE_PHASE must be before or after",
);
const initialBuild = builds[phase];
assert(
  initialBuild,
  "Selected build is not configured; baseline comparison requires its own dist and SHA",
);
const runId = randomUUID(),
  directory = resolve(`.runtime/creative-experience-${runId}`);
const evidence = resolve(
  "output/playwright/2026-09-14-canvas-workspace",
  runId,
);
await mkdir(directory, { mode: 0o700, recursive: true });
await mkdir(evidence, { recursive: true });
const distControl = resolve(directory, "dist.json");
await writeFile(distControl, JSON.stringify({ ...initialBuild, phase }), {
  mode: 0o600,
  flag: "wx",
});
await writeFile(
  resolve(directory, "build-inputs.json"),
  JSON.stringify(builds),
  { mode: 0o600, flag: "wx" },
);
// Explicit paths fail closed if missing. Only absent optional demo inputs use technical fallback.
async function mediaInput(key: string, preferred: string) {
  const path = resolve(process.env[key] ?? preferred);
  if ((await stat(path).catch(() => undefined))?.isFile())
    return {
      path,
      kind: process.env[key] ? "explicit_source" : "existing_approved_source",
    };
  assert(!process.env[key], `${key} does not name a readable source file`);
  return undefined;
}
function imageMime(path: string) {
  const mime = (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    } as Record<string, string>
  )[extname(path).toLowerCase()];
  assert(mime, "Fixture image source must be PNG, JPEG or WebP");
  return mime;
}
async function prepareSources() {
  const key = await mediaInput(
    "CREATIVE_KEY_SOURCE",
    "apps/web/public/demo/workspace-v2/key-reference.png",
  );
  const hand = await mediaInput(
    "CREATIVE_HAND_SOURCE",
    "apps/web/public/demo/workspace-v2/key-candidate-c.png",
  );
  assert(
    key && hand,
    "Repository key and hand images are required unless explicit source paths are supplied",
  );
  let character = await mediaInput(
    "CREATIVE_CHARACTER_SOURCE",
    ".runtime/complete-demo/media/old-key-sh02-a-poster.jpg",
  );
  let video = await mediaInput(
    "CREATIVE_VIDEO_SOURCE",
    ".runtime/complete-demo/media/old-key-sh04-a.mp4",
  );
  const ffmpeg = process.env.CREATIVE_FFMPEG ?? "ffmpeg";
  if (!character) {
    const path = resolve(directory, "technical-character-poster.jpg");
    // Exact approved Frame(index=1) crop; no synthetic character or model output.
    await exec(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-n",
        "-i",
        resolve("apps/web/public/demo/old-key-storyboard.png"),
        "-vf",
        "crop=351:679:400:2",
        "-frames:v",
        "1",
        "-threads",
        "1",
        path,
      ],
      { timeout: 30000 },
    );
    character = { path, kind: "repository_frame_crop" };
  }
  if (!video) {
    const path = resolve(directory, "technical-static-preview.mp4");
    await exec(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-n",
        "-loop",
        "1",
        "-framerate",
        "24",
        "-i",
        hand.path,
        "-t",
        "9",
        "-vf",
        "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-threads",
        "1",
        "-an",
        "-movflags",
        "+faststart",
        path,
      ],
      { timeout: 120000 },
    );
    video = { path, kind: "technical_static_video_no_model" };
  }
  const sources = { key, hand, character, video };
  await writeFile(
    resolve(directory, "media-inputs.json"),
    JSON.stringify(sources, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  return sources;
}
const fixtureCleanup: (() => unknown)[] = [],
  ownCleanup: (() => unknown)[] = [];
const context = {
  after: (fn: () => unknown) => fixtureCleanup.push(fn),
} as unknown as TestContext;
const pgName = `scenedesk-creative-e2e-${runId}`,
  password = randomBytes(24).toString("hex");
const requests: { method: string; path: string; status: number }[] = [];
const errors: string[] = [];
let pgCreated = false,
  closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const failures: string[] = [];
  for (const fn of [...ownCleanup.reverse(), ...fixtureCleanup.reverse()])
    try {
      await fn();
    } catch {
      failures.push("FIXTURE_RESOURCE_CLEANUP_FAILED");
    }
  if (pgCreated)
    try {
      const label = (
        await exec(
          "docker",
          [
            "inspect",
            "--format",
            '{{index .Config.Labels "io.scenedesk.e2e.run"}}',
            pgName,
          ],
          { timeout: 15000 },
        )
      ).stdout.trim();
      assert.equal(
        label,
        runId,
        "Refusing cleanup of a container outside this fixture run",
      );
      await exec("docker", ["rm", "--force", "--volumes", pgName], {
        timeout: 30000,
      });
    } catch {
      failures.push("FIXTURE_DATABASE_CLEANUP_FAILED");
    }
  await writeFile(
    resolve(evidence, "requests.json"),
    JSON.stringify(requests, null, 2),
    { flag: "wx" },
  );
  await writeFile(
    resolve(directory, "cleanup.json"),
    JSON.stringify({ closed: !failures.length, failures, errors }),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    JSON.stringify({ fixture: "closed", failures, errors, providerCalls: 0 }),
  );
  if (failures.length) throw Error(failures.join(","));
}
async function start() {
  const sources = await prepareSources();
  await exec(
    "docker",
    [
      "run",
      "--detach",
      "--name",
      pgName,
      "--label",
      `io.scenedesk.e2e.run=${runId}`,
      "--publish",
      "127.0.0.1::5432",
      "--env",
      "POSTGRES_PASSWORD",
      "--env",
      "POSTGRES_DB=drama_creative_e2e",
      "--tmpfs",
      "/var/lib/postgresql/data:rw,nosuid,nodev,size=536870912",
      "postgres:16.15-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685",
    ],
    { env: { ...process.env, POSTGRES_PASSWORD: password }, timeout: 60000 },
  );
  pgCreated = true;
  const ports = JSON.parse(
    (
      await exec("docker", [
        "inspect",
        "--format",
        "{{json .NetworkSettings.Ports}}",
        pgName,
      ])
    ).stdout,
  );
  process.env.DATABASE_URL = `postgres://postgres:${password}@127.0.0.1:${ports["5432/tcp"][0].HostPort}/drama_creative_e2e`;
  let ready = false;
  for (let i = 0; i < 40; i++)
    try {
      await exec("docker", ["exec", pgName, "pg_isready", "-U", "postgres"]);
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  assert(ready);
  console.log("fixture: own PostgreSQL ready");
  const storage = await storageFixture(context, { storageCapacityMiB: 2048 });
  const suffix = randomBytes(5).toString("hex"),
    queueSchema = `scenedesk_queue_${suffix}`;
  const assistanceRole = `canvas_assistance_${suffix}`;
  const mediaRole = `creative_media_${suffix}`,
    schedulerRole = `creative_sched_${suffix}`;
  const pools: Pool[] = [],
    roles: string[] = [];
  let scheduler: Awaited<ReturnType<typeof createScheduler>>;
  const f = await businessFixture(context, async (db) => {
    ownCleanup.push(async () => {
      for (const pool of pools) await pool.end();
      await db.admin.query(
        `DROP SCHEMA IF EXISTS ${sqlIdentifier(queueSchema)} CASCADE`,
      );
      for (const role of roles) {
        await db.admin.query(`DROP OWNED BY ${sqlIdentifier(role)}`);
        await db.admin.query(`DROP ROLE ${sqlIdentifier(role)}`);
      }
    });
    for (const role of [mediaRole, schedulerRole, assistanceRole]) {
      const secret = randomBytes(24).toString("hex");
      await db.admin.query(
        `CREATE ROLE ${sqlIdentifier(role)} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '${secret}'`,
      );
      roles.push(role);
      const url = new URL(process.env.DATABASE_URL!);
      url.username = role;
      url.password = secret;
      pools.push(new Pool({ connectionString: url.href, max: 3 }));
    }
    await installQueue(db.admin, queueSchema);
    const sql = await db.admin.connect();
    try {
      await grantMediaWorkerAccess(sql, db.schema, mediaRole, schedulerRole);
      await grantGenerationWorkerAccess(sql, db.schema, assistanceRole);
      for (const role of [db.apiRole, mediaRole, assistanceRole])
        await grantQueueAccess(sql, queueSchema, role, schedulerRole);
    } finally {
      sql.release();
    }
    scheduler = await createScheduler(db.runtime, {
      schema: queueSchema,
      onError: () => errors.push("QUEUE_ERROR"),
    });
    ownCleanup.push(() => scheduler.close());
    return { media: { store: storage.api, schedule: scheduler.schedule } };
  });
  const mediaProducer = await createScheduler(pools[0]!, {
    schema: queueSchema,
    onError: () => errors.push("MEDIA_QUEUE_ERROR"),
  });
  ownCleanup.push(() => mediaProducer.close());
  const processor = await createMediaProcessor({
    pool: pools[0]!,
    schema: f.schema,
    store: storage.processing,
    schedule: mediaProducer.schedule,
  });
  const worker = await runInternalWorker(pools[1]!, processor, {
    schema: queueSchema,
    concurrency: 1,
    onError: () => errors.push("MEDIA_WORKER_ERROR"),
  });
  ownCleanup.push(() => worker.close());
  const connectionId = randomUUID(),
    connectionVersionId = randomUUID();
  const assistantCapabilityId = randomUUID(),
    targetCapabilityId = randomUUID();
  for (const [id, purpose, mode] of [
    [assistantCapabilityId, "creative_assistance", "fixture"],
  ])
    await f.admin.query(
      `INSERT INTO "${f.schema}".generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
      [
        id,
        f.tenant.id,
        connectionId,
        connectionVersionId,
        {
          purpose,
          modelVersion: "隔离验收 · 本地技术样例",
          mode,
          supportedPurposes: [
            "composition",
            "identity",
            "look",
            "location",
            "action",
            "style",
            "voice",
            "start_frame",
            "end_frame",
            "prop",
          ],
          maxReferences: 20,
        },
      ],
    );
  let localAssistantCalls = 0,
    localVideoCalls = 0;
  let fixtureVideoOutput: unknown;
  const assistanceWorker = await createAssistanceWorker({
    pool: pools[2]!,
    schema: f.schema,
    scheduleArchive: scheduler!.schedule,
    adapters: [
      createAssistanceFixture(connectionVersionId, async (submission) => {
        if (submission.input.purpose === "creative_assistance")
          localAssistantCalls++;
        else if (submission.input.purpose === "video" && fixtureVideoOutput)
          localVideoCalls++;
        else
          throw Error(
            "Only explicitly configured local text/video fixtures may run",
          );
        return {
          kind: "completed",
          correlation: submission.attemptId,
          output:
            submission.input.purpose === "creative_assistance"
              ? localAssistanceFixtureOutput(submission)
              : fixtureVideoOutput,
        };
      }),
    ],
  });
  let draining = false;
  const drain = setInterval(async () => {
    if (draining || closing) return;
    draining = true;
    try {
      const jobs = await f.admin.query(
        `SELECT id FROM "${f.schema}".generation_jobs WHERE status='queued' ORDER BY created_at LIMIT 4`,
      );
      for (const { id } of jobs.rows) await assistanceWorker.process(id);
    } catch {
      errors.push("LOCAL_ASSISTANCE_DRAIN_FAILED");
    } finally {
      draining = false;
    }
  }, 500);
  ownCleanup.push(async () => {
    clearInterval(drain);
    while (draining) await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const base = `/v1/tenants/${f.tenant.id}`;
  const media: Record<string, any> = {};
  async function upload(key: string, file: string, name: string, mime: string) {
    const bytes = await readFile(file),
      sha256 = createHash("sha256").update(bytes).digest("hex");
    const intent = await f.ok("POST", `${base}/uploads`, {
      scope: "project",
      projectId: f.project.id,
      fileName: name,
      mime,
      bytes: bytes.length,
      sha256,
      displayName: name,
      tags: ["隔离E2E"],
    });
    const form = new FormData();
    for (const [key, value] of Object.entries(intent.formFields))
      form.append(key, String(value));
    form.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: mime }),
      name,
    );
    assert.equal(
      (
        await fetch(intent.uploadUrl, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(60000),
        })
      ).status,
      204,
    );
    const completion = await f.request(
      "POST",
      `${base}/uploads/${intent.id}/complete`,
      { bytes: bytes.length, sha256 },
    );
    assert.equal(completion.statusCode, 202, completion.body);
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      const current = await f.ok(
        "GET",
        `${base}/media/${completion.json().mediaId}`,
      );
      if (
        current.status === "ready" &&
        current.derivatives.length &&
        current.derivatives.every((d: any) => d.status === "ready")
      ) {
        assert.equal(current.sha256, sha256);
        assert.equal(current.bytes, bytes.length);
        media[key] = current;
        console.log(`fixture: ${key} actual original + derivatives ready`);
        return current;
      }
      if (
        ["rejected", "archived"].includes(current.status) ||
        (current.issue && !current.issue.retryable)
      ) {
        await writeFile(resolve(evidence, `media-${key}-failure.json`), JSON.stringify({
          status: current.status,
          issue: current.issue,
          derivatives: current.derivatives.map((d: any) => ({ kind: d.kind, status: d.status, issue: d.issue })),
        }, null, 2));
        throw Error(`FIXTURE_MEDIA_REJECTED ${key} ${current.issue?.code ?? "NO_ISSUE_CODE"}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw Error(`FIXTURE_MEDIA_TIMEOUT ${key}`);
  }
  await upload(
    "key",
    sources.key.path,
    `旧铜钥匙-真实参考${extname(sources.key.path)}`,
    imageMime(sources.key.path),
  );
  await upload(
    "hand",
    sources.hand.path,
    `手部-固定参考${extname(sources.hand.path)}`,
    imageMime(sources.hand.path),
  );
  await upload(
    "character",
    sources.character.path,
    `林夏-固定参考${extname(sources.character.path)}`,
    imageMime(sources.character.path),
  );
  await upload(
    "video",
    sources.video.path,
    sources.video.kind === "technical_static_video_no_model"
      ? "技术静帧播放验收-非模型.mp4"
      : "旧钥匙-预制画面演示-非模型.mp4",
    "video/mp4",
  );
  const videoBytes = await readFile(sources.video.path),
    videoSha256 = createHash("sha256").update(videoBytes).digest("hex");
  const fixtureObject = await storage.processing.publish(
    sources.video.path,
    { bytes: videoBytes.length, sha256: videoSha256, mime: "video/mp4" },
    "originals",
  );
  fixtureVideoOutput = {
    videos: [
      {
        kind: "fixture_object",
        object: {
          key: fixtureObject.key,
          versionId: fixtureObject.versionId,
          bytes: fixtureObject.bytes,
        },
        sha256: videoSha256,
        mime: "video/mp4",
      },
    ],
  };
  const fixtureResolution = `${media.video.width}x${media.video.height}`;
  const fixtureDurationSeconds = media.video.durationUs / 1000000;
  assert(
    Number.isInteger(fixtureDurationSeconds),
    "Technical fixture requires integer video duration",
  );
  await f.admin.query(
    `INSERT INTO "${f.schema}".generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
    [
      targetCapabilityId,
      f.tenant.id,
      connectionId,
      connectionVersionId,
      {
        purpose: "video",
        modelVersion: "隔离验收 · 预制静帧视频（非模型）",
        mode: "video_fixture_v1",
        supportedPurposes: [
          "composition",
          "identity",
          "look",
          "location",
          "action",
          "style",
          "start_frame",
          "end_frame",
          "prop",
        ],
        maxReferences: 20,
        inputRules: [{
          kind: "image",
          purposes: ["composition", "identity", "look", "location", "action", "style", "start_frame", "end_frame", "prop"],
          mimeTypes: ["image/png", "image/jpeg"],
          minCount: 0,
          maxCount: 20,
          maxBytes: 16 * 1024 * 1024,
        }],
        allowedResolutions: [fixtureResolution],
        allowedAspectRatios: ["9:16"],
        minDurationSeconds: fixtureDurationSeconds,
        maxDurationSeconds: fixtureDurationSeconds,
        audioOutput: false,
      },
    ],
  );
  const asset = await f.ok("POST", `${base}/assets`, {
    scope: "project",
    projectId: f.project.id,
    kind: "prop",
    name: "旧铜钥匙",
    description: "实际原图与固定历史验收",
    tags: ["钥匙", "道具"],
  });
  const one = await f.ok(
    "POST",
    `${base}/assets/${asset.id}/revisions`,
    {
      definition: {
        description: "旧铜色，圆形匙环，保留左侧磨痕。",
        references: [
          { mediaId: media.key.id, purpose: "prop", note: "独立道具原图" },
        ],
      },
    },
    asset.revision,
  );
  await f.ok(
    "POST",
    `${base}/assets/${asset.id}/revisions/${one.id}/confirm`,
    undefined,
    one.revision,
  );
  const assetRoot = await f.ok("GET", `${base}/assets/${asset.id}`);
  const two = await f.ok(
    "POST",
    `${base}/assets/${asset.id}/revisions`,
    {
      parentRevisionId: one.id,
      definition: {
        description: "增加匙环刻字说明，保留铜色与磨痕。",
        references: [
          { mediaId: media.key.id, purpose: "prop", note: "完整原图" },
          { mediaId: media.hand.id, purpose: "prop", note: "手部构图参考" },
        ],
      },
    },
    assetRoot.revision,
  );
  const character = await f.ok("POST", `${base}/assets`, {
    scope: "project",
    projectId: f.project.id,
    kind: "character",
    name: "林夏",
    description: "两个固定造型用于浏览测试",
    tags: ["角色"],
  });
  const lookIds = [randomUUID(), randomUUID()];
  const characterRevision = await f.ok(
    "POST",
    `${base}/assets/${character.id}/revisions`,
    {
      definition: {
        description: "灰色风衣，克制的神情。",
        references: [
          {
            mediaId: media.character.id,
            purpose: "identity",
            note: "人物固定参考",
          },
        ],
        looks: [
          {
            id: lookIds[0],
            revision: 1,
            label: "灰色风衣",
            references: [
              {
                mediaId: media.character.id,
                purpose: "look",
                note: "固定造型一",
              },
            ],
          },
          {
            id: lookIds[1],
            revision: 1,
            label: "手部与袖口",
            references: [
              { mediaId: media.hand.id, purpose: "look", note: "固定造型二" },
            ],
          },
        ],
      },
    },
    character.revision,
  );
  const noImage = await f.ok("POST", `${base}/assets`, {
    scope: "project",
    projectId: f.project.id,
    kind: "location",
    name: "没有参考图的场景",
    tags: ["无图"],
  });
  await f.ok("POST", `${base}/assets`, {
    scope: "project",
    projectId: f.project.id,
    kind: "style",
    name: "午后自然光",
    tags: ["风格"],
  });
  const archived = await f.ok("POST", `${base}/assets`, {
    scope: "project",
    projectId: f.project.id,
    kind: "prop",
    name: "已归档旧信封",
    tags: ["归档筛选"],
  });
  const archivedResponse = await f.request(
    "POST",
    `${base}/assets/${archived.id}/archive`,
    undefined,
    archived.revision,
  );
  assert.equal(archivedResponse.statusCode, 201, archivedResponse.body);
  const script = await f.ok(
    "POST",
    `${f.path}/scripts`,
    {
      text: "第 1 集 · 重逢\n\n咖啡厅，午后。\n林夏坐在靠窗的位置。周远把旧铜钥匙放在桌上。\n林夏伸出右手，拿起钥匙，认出匙环上的磨痕。\n她抬头望向门外，压住了涌起的情绪。",
    },
    await f.next(),
  );
  const episode = await f.ok(
    "POST",
    `${f.path}/episodes`,
    { title: "第 1 集 · 重逢", position: 0, status: "active" },
    await f.next(),
  );
  const scene = await f.ok(
    "POST",
    `${f.path}/scenes`,
    {
      episodeId: episode.id,
      title: "咖啡厅 · 日",
      position: 0,
      summary: "实际导入视频用于界面与固定输入验收；不代表新动作或模型质量。",
      state: {},
      defaultAssetRevisionIds: [one.id],
      status: "active",
    },
    await f.next(),
  );
  const emptyScene = await f.ok(
    "POST",
    `${f.path}/scenes`,
    {
      episodeId: episode.id,
      title: "未开始制作的场次",
      position: 1,
      summary: "空状态验收",
      state: {},
      status: "active",
    },
    await f.next(),
  );
  const shots: any[] = [],
    takes: any[] = [];
  for (const [i, intent] of [
    "相对而坐",
    "迟来的追问",
    "欲言又止",
    "拿起旧钥匙",
    "被唤起的记忆",
    "尚未建立候选",
  ].entries()) {
    const shot = await f.ok(
      "POST",
      `${f.path}/shots`,
      {
        sceneId: scene.id,
        label: `SH-${String(i + 1).padStart(2, "0")}`,
        position: i,
        status: "active",
        spec: {
          intent,
          references: [
            {
              mediaId: media.key.id,
              purpose: "prop",
              assetRevisionId: one.id,
              subjectAssetId: asset.id,
              note: "固定 v1 道具参考",
            },
          ],
        },
      },
      await f.next(),
    );
    shots.push(shot);
    if (i < 5) {
      const take = await f.ok("POST", `${f.path}/takes`, {
        shotId: shot.id,
        shotRevisionId: shot.specRevisionId,
        mediaId: media.video.id,
        range: { inUs: 0, outUs: media.video.durationUs },
        note: "预制静帧动画技术候选；无模型调用",
      });
      takes.push(take);
      await f.ok(
        "PUT",
        `${f.path}/shots/${shot.id}/selection`,
        { takeId: take.id, reason: "隔离夹具明确采用" },
        shot.revision,
      );
    }
  }
  const alternative = await f.ok("POST", `${f.path}/takes`, {
    shotId: shots[3].id,
    shotRevisionId: shots[3].specRevisionId,
    mediaId: media.video.id,
    range: { inUs: 1000000, outUs: 4000000 },
    note: "同一真实原视频的不同固定区间；未采用",
  });
  takes.push(alternative);
  const ensured = await f.request(
    "POST",
    `${f.path}/scenes/${scene.id}/canvas`,
  );
  assert.equal(ensured.statusCode, 200, ensured.body);
  const canvas = ensured.json().canvas;
  const draftId = randomUUID(),
    textId = randomUUID(),
    refId = randomUUID();
  const nodes: any[] = [
    {
      id: refId,
      kind: "image",
      title: "旧铜钥匙 · 固定 v1",
      position: { x: 30, y: 30 },
      width: 220,
      content: {
        type: "media",
        mediaId: media.key.id,
        assetRevisionId: one.id,
      },
    },
    {
      id: textId,
      kind: "text",
      title: "本次动作要求",
      position: { x: 300, y: 40 },
      width: 250,
      content: {
        type: "text",
        text: "保留光线、铜色与节奏。\n右手先接触匙环，再自然收拢。",
      },
    },
    {
      id: draftId,
      kind: "video",
      title: "动作优化 · 创作草稿",
      position: { x: 610, y: 30 },
      width: 280,
      content: {
        type: "draft",
        prompt: "手指与钥匙接触更自然，保留原节奏。",
        connectionId,
        capabilityId: targetCapabilityId,
        output: {
          durationSeconds: fixtureDurationSeconds,
          aspectRatio: "9:16",
          resolution: fixtureResolution,
          withAudio: false,
        },
      },
    },
    {
      id: randomUUID(),
      kind: "video",
      title: "固定视频 · 已采用区间",
      position: { x: 980, y: 30 },
      width: 250,
      content: { type: "media", mediaId: media.video.id },
    },
  ];
  const edges = [
    {
      id: randomUUID(),
      sourceNodeId: refId,
      targetNodeId: draftId,
      enabled: true,
      position: 0,
      purpose: "prop",
      subjectAssetId: asset.id,
    },
    {
      id: randomUUID(),
      sourceNodeId: textId,
      targetNodeId: draftId,
      enabled: true,
      position: 1,
      purpose: "prompt",
    },
  ];
  await f.ok(
    "PUT",
    `${f.path}/canvases/${canvas.id}`,
    { schemaVersion: 1, document: { nodes, edges, groups: [] } },
    canvas.revision,
  );
  const prefPath = `${f.path}/scenes/${scene.id}/workspace-preference`,
    pref = await f.ok("GET", prefPath);
  await f.ok(
    "PUT",
    prefPath,
    {
      mode: "storyboard",
      selectedShotId: shots[3].id,
      selectedNodeIds: [],
      viewport: { x: 36, y: 30, zoom: 0.8 },
      assetPanelOpen: false,
      assistantOpen: false,
    },
    pref.revision,
  );
  // A second synthetic canvas lets independent browser reviewers avoid shared CAS edits.
  const editorScene = await f.ok("POST", `${f.path}/scenes`, {
    episodeId: episode.id, title: "编辑器独立验收", position: 2,
    summary: "无镜头的独立画布交互验收", state: {}, status: "active",
  }, await f.next());
  const editorEnsure = await f.request("POST", `${f.path}/scenes/${editorScene.id}/canvas`);
  assert([200, 201].includes(editorEnsure.statusCode), editorEnsure.body);
  const editorCanvas = editorEnsure.json().canvas;
  const editorIds = new Map(nodes.map(node => [node.id, randomUUID()]));
  const editorNodes = nodes.map(node => ({...structuredClone(node), id: editorIds.get(node.id)}));
  const editorEdges = edges.map(edge => ({...edge, id: randomUUID(), sourceNodeId: editorIds.get(edge.sourceNodeId), targetNodeId: editorIds.get(edge.targetNodeId)}));
  await f.ok("PUT", `${f.path}/canvases/${editorCanvas.id}`, {schemaVersion: 1, document: {nodes: editorNodes, edges: editorEdges, groups: []}}, editorCanvas.revision);
  const fixture = {
    runId,
    apiSourceCommit: process.env.CREATIVE_API_SHA,
    origin,
    path: f.path,
    tenantId: f.tenant.id,
    projectId: f.project.id,
    sceneId: scene.id,
    emptySceneId: emptyScene.id,
    editor: {sceneId: editorScene.id, canvasId: editorCanvas.id, draftId: editorIds.get(draftId), textId: editorIds.get(textId), refId: editorIds.get(refId)},
    canvasId: canvas.id,
    draftId,
    textId,
    refId,
    shots,
    takes,
    assetId: asset.id,
    firstRevision: one.id,
    secondRevision: two.id,
    characterId: character.id,
    characterRevisionId: characterRevision.id,
    lookIds,
    noImageId: noImage.id,
    archivedId: archived.id,
    scriptId: script.id,
    media: Object.fromEntries(
      Object.entries(media).map(([k, v]) => [
        k,
        {
          id: v.id,
          displayName: v.displayName,
          sha256: v.sha256,
          bytes: v.bytes,
          durationUs: v.durationUs,
          width: v.width,
          height: v.height,
        },
      ]),
    ),
    mediaProvenance: Object.fromEntries(
      Object.entries(sources).map(([key, source]) => [key, source.kind]),
    ),
    providerCalls: 0,
    generationExecutorStarted: "local_text_and_prebuilt_video_fixture_only",
    assistantCapabilityId,
    targetCapabilityId,
  };
  const app = buildApp(f.runtime, {
    schema: f.schema,
    origin,
    secret: randomBytes(32).toString("base64url"),
    localIdentity: true,
    media: { store: storage.api, schedule: scheduler!.schedule },
  });
  ownCleanup.push(() => app.close());
  app.addHook("onResponse", async (req, reply) => {
    if (req.url.startsWith("/v1/"))
      requests.push({
        method: req.method,
        path: req.url.split("?")[0]!,
        status: reply.statusCode,
      });
  });
  app.get("/__layout_fixture/login", async (_, reply) =>
    reply
      .header(
        "set-cookie",
        `session=${f.owner.token}; Path=/; HttpOnly; SameSite=Lax`,
      )
      .header("cache-control", "no-store")
      .redirect(
        `/#/app/t/${f.tenant.id}/p/${f.project.id}/production?scene=${scene.id}&shot=${shots[3].id}&mode=storyboard`,
      ),
  );
  app.get("/__fixture/ids", async () => ({
    ...fixture,
    localAssistantCalls,
    localVideoCalls,
  }));
  app.get("/__fixture/requests", async () => ({ requests, localAssistantCalls, localVideoCalls, providerCalls: 0 }));
  app.get("/__fixture/build", async () => {
    const selected = JSON.parse(await readFile(distControl, "utf8"));
    const html = await readFile(resolve(selected.path, "index.html"), "utf8");
    return {
      phase: selected.phase,
      sourceCommit: selected.sourceCommit,
      indexSha256: createHash("sha256").update(html).digest("hex"),
      scripts: [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(
        (m) => m[1],
      ),
    };
  });
  app.get("/*", async (req, reply) => {
    if (req.url.startsWith("/v1/")) return reply.code(404).send();
    const selected = JSON.parse(await readFile(distControl, "utf8")),
      dist = resolve(selected.path);
    const pathname = decodeURIComponent(req.url.split("?")[0]!);
    let file = resolve(dist, "." + pathname);
    if (!file.startsWith(dist + "/") && file !== dist)
      return reply.code(404).send();
    if (!(await stat(file).catch(() => undefined))?.isFile())
      file = resolve(dist, "index.html");
    return reply
      .header("cache-control", "no-store")
      .type(
        (
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".woff2": "font/woff2",
            ".png": "image/png",
            ".mp4": "video/mp4",
          } as Record<string, string>
        )[extname(file)] ?? "application/octet-stream",
      )
      .send(await readFile(file));
  });
  await app.listen({ host: "127.0.0.1", port });
  await writeFile(
    resolve(evidence, "fixture.json"),
    JSON.stringify(fixture, null, 2),
    { flag: "wx" },
  );
  await writeFile(
    resolve(directory, "resources.json"),
    JSON.stringify({
      pgName,
      schema: f.schema,
      queueSchema,
      roles: [f.apiRole, f.authRole, f.authorizerRole, ...roles],
      distControl,
    }),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    `CREATIVE_FIXTURE_READY ${origin}/__layout_fixture/login ${directory}`,
  );
  for (const sig of ["SIGTERM", "SIGINT"] as const)
    process.on(
      sig,
      () =>
        void close().then(
          () => process.exit(0),
          () => process.exit(1),
        ),
    );
}
start().catch(async (error) => {
  await writeFile(
    resolve(directory, "failure.txt"),
    String(error?.stack ?? error),
    { mode: 0o600 },
  );
  console.error(`CREATIVE_FIXTURE_FAILED ${directory}`);
  await close();
  process.exitCode = 1;
});
