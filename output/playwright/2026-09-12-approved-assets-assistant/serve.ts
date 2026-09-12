/** Isolated visual fixture. Real API, PostgreSQL, upload/probe and fixed revisions; no model calls. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import type { TestContext } from "node:test";
import { createMediaProcessor } from "@drama/media";
import { createScheduler, runInternalWorker } from "@drama/queue";
import { buildApp } from "../../../apps/api/src/app.js";
import { imageGenerationFixture } from "../../../tests/support/image-generation.js";
import { storageFixture } from "../../../tests/support/storage.js";
const exec = promisify(execFile),
  origin = "http://127.0.0.1:4317";
const directory = resolve(".runtime/approved-assets-assistant-" + randomUUID());
await mkdir(directory, { mode: 0o700 });
const fixtureCleanup: (() => unknown)[] = [],
  ownCleanup: (() => unknown)[] = [];
const context = {
  after: (fn: () => unknown) => fixtureCleanup.push(fn),
} as unknown as TestContext;
const pgName = "scenedesk-assets-visual-" + randomUUID(),
  password = randomBytes(24).toString("hex");
let pgCreated = false,
  closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const failures = [];
  for (const fn of [...ownCleanup.reverse(), ...fixtureCleanup])
    try {
      await fn();
    } catch {
      failures.push("FIXTURE_RESOURCE_CLEANUP_FAILED");
    }
  if (pgCreated)
    try {
      await exec("docker", ["rm", "--force", "--volumes", pgName], {
        timeout: 30000,
      });
    } catch {
      failures.push("FIXTURE_DATABASE_CLEANUP_FAILED");
    }
  await writeFile(
    resolve(directory, "cleanup.json"),
    JSON.stringify({ closed: !failures.length, failures }),
    { mode: 0o600 },
  );
  if (failures.length) throw Error(failures.join(","));
}
async function start() {
  await exec(
    "docker",
    [
      "run",
      "--detach",
      "--name",
      pgName,
      "--publish",
      "127.0.0.1::5432",
      "--env",
      "POSTGRES_PASSWORD",
      "--env",
      "POSTGRES_DB=drama_assets_visual",
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
  process.env.DATABASE_URL = `postgres://postgres:${password}@127.0.0.1:${ports["5432/tcp"][0].HostPort}/drama_assets_visual`;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      await exec("docker", ["exec", pgName, "pg_isready", "-U", "postgres"]);
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert(ready);
  console.log("fixture: isolated PostgreSQL ready");
  const storage = await storageFixture(context, { storageCapacityMiB: 2048 });
  console.log("fixture: isolated storage ready");
  const f = await imageGenerationFixture(context, storage.api);
  console.log("fixture: isolated business schema ready");
  const scheduler = await createScheduler(f.runtime, {
    schema: f.queueSchema,
    onError: () => console.error("FIXTURE_QUEUE_ERROR"),
  });
  ownCleanup.push(() => scheduler.close());
  const processor = await createMediaProcessor({
    pool: f.mediaDb,
    schema: f.schema,
    store: storage.processing,
    schedule: f.mediaProducer.schedule,
  });
  const worker = await runInternalWorker(f.schedulerDb, processor, {
    schema: f.queueSchema,
    concurrency: 1,
    onError: () => console.error("FIXTURE_MEDIA_ERROR"),
  });
  ownCleanup.push(() => worker.close());
  const bytes = await readFile(
      "apps/web/public/demo/workspace-v2/key-reference.png",
    ),
    sha = createHash("sha256").update(bytes).digest("hex");
  const intent = await f.ok("POST", `${f.base}/uploads`, {
    scope: "project",
    projectId: f.project.id,
    fileName: "视觉验收-旧铜钥匙.png",
    mime: "image/png",
    bytes: bytes.length,
    sha256: sha,
  });
  const form = new FormData();
  for (const [key, value] of Object.entries(intent.formFields))
    form.append(key, String(value));
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)]),
    "视觉验收-旧铜钥匙.png",
  );
  assert.equal(
    (await fetch(intent.uploadUrl, { method: "POST", body: form })).status,
    204,
  );
  console.log(`fixture: presigned POST accepted ${bytes.length} bytes`);
  const completed = await f.request(
    "POST",
    `${f.base}/uploads/${intent.id}/complete`,
    { bytes: bytes.length, sha256: sha },
  );
  assert.equal(completed.statusCode, 202, completed.body);
  let media: any;
  const deadline = Date.now() + 180000;
  do {
    media = await f.ok("GET", `${f.base}/media/${completed.json().mediaId}`);
    if (
      media.status === "ready" &&
      media.derivatives.every((d: any) => d.status === "ready")
    )
      break;
    if (Date.now() > deadline) throw Error("FIXTURE_UPLOAD_TIMEOUT");
    await new Promise((r) => setTimeout(r, 500));
  } while (true);
  console.log("fixture: actual original and poster ready");
  const asset = await f.ok("POST", `${f.base}/assets`, {
    scope: "project",
    projectId: f.project.id,
    kind: "prop",
    name: "旧铜钥匙",
    description: "视觉验收示例 · 铜制道具",
    tags: ["钥匙", "铜制"],
  });
  const one = await f.ok(
    "POST",
    `${f.base}/assets/${asset.id}/revisions`,
    {
      definition: {
        description: "旧铜色，圆形匙环，保留左侧磨痕。",
        references: [
          { mediaId: media.id, purpose: "prop", note: "完整轮廓与表面磨痕" },
        ],
      },
    },
    asset.revision,
  );
  await f.ok(
    "POST",
    `${f.base}/assets/${asset.id}/revisions/${one.id}/confirm`,
    undefined,
    one.revision,
  );
  const root = await f.ok("GET", `${f.base}/assets/${asset.id}`);
  const two = await f.ok(
    "POST",
    `${f.base}/assets/${asset.id}/revisions`,
    {
      parentRevisionId: one.id,
      definition: {
        description: "增加匙环内侧的刻字说明，保留尺寸、铜色与磨痕。",
        references: [
          { mediaId: media.id, purpose: "prop", note: "完整轮廓与表面磨痕" },
        ],
      },
    },
    root.revision,
  );
  for (const [kind, name] of [
    ["character", "林夏"],
    ["location", "咖啡厅"],
    ["voice", "林夏 · 声音"],
    ["style", "午后自然光"],
  ])
    await f.ok("POST", `${f.base}/assets`, {
      scope: "project",
      projectId: f.project.id,
      kind,
      name,
    });
  const script = await f.ok(
    "POST",
    `${f.path}/scripts`,
    {
      text: "咖啡厅，午后。\n林夏坐在靠窗的位置。她伸手拿起桌上的旧铜钥匙，指尖接触匙环后轻轻收拢。\n她停了一会儿，抬头望向门口。",
    },
    await f.next(),
  );
  const scene = (await f.tree()).scenes.find(
    (item: { id: string }) => item.id === f.scene.id,
  );
  assert(scene);
  await f.ok(
    "PUT",
    `${f.path}/scenes/${scene.id}`,
    {
      episodeId: scene.episodeId,
      title: "咖啡厅",
      summary: "人物拿起旧钥匙，保持午后窗边的自然光。",
      position: scene.position,
      status: "active",
      state: scene.state,
    },
    scene.revision,
  );
  for (const [index, label] of [
    "相对而坐",
    "迟来的追问",
    "片刻犹豫",
    "拿起旧钥匙",
    "收进衣袋",
  ].entries()) {
    await f.ok(
      "POST",
      `${f.path}/shots`,
      {
        sceneId: f.scene.id,
        label: `SH-0${index + 2} · ${label}`,
        position: index + 1,
        status: "active",
        spec: { intent: label, references: [] },
      },
      await f.next(),
    );
  }
  for (const [index, title] of ["咖啡厅门外", "回到旧居"].entries()) {
    await f.ok(
      "POST",
      `${f.path}/scenes`,
      {
        episodeId: scene.episodeId,
        title,
        position: index + 1,
        summary: "视觉验收示例场次",
        state: {},
        status: "active",
      },
      await f.next(),
    );
  }
  const app = buildApp(f.runtime, {
    schema: f.schema,
    origin,
    secret: randomBytes(32).toString("base64url"),
    localIdentity: true,
    media: { store: storage.api, schedule: scheduler.schedule },
  });
  ownCleanup.push(() => app.close());
  const dist = resolve("apps/web/dist");
  app.get("/", async (_, reply) =>
    reply.type("text/html").send(await readFile(resolve(dist, "index.html"))),
  );
  app.get("/favicon.svg", async (_, reply) => reply.code(204).send());
  app.get<{ Params: { "*": string } }>("/assets/*", async (req, reply) => {
    const file = resolve(dist, "assets", req.params["*"]);
    if (!file.startsWith(resolve(dist, "assets") + "/"))
      return reply.code(404).send();
    return reply
      .type(
        (
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".woff2": "font/woff2",
          } as Record<string, string>
        )[extname(file)] ?? "application/octet-stream",
      )
      .send(await readFile(file));
  });
  app.get("/__layout_fixture/login", async (_, reply) =>
    reply
      .header(
        "set-cookie",
        `session=${f.owner.token}; Path=/; HttpOnly; SameSite=Lax`,
      )
      .header("cache-control", "no-store")
      .redirect(`/#/app/t/${f.tenant.id}/p/${f.project.id}/content`),
  );
  await app.listen({ host: "127.0.0.1", port: 4317 });
  await writeFile(
    resolve(directory, "session.json"),
    JSON.stringify({
      cookies: [
        {
          name: "session",
          value: f.owner.token,
          domain: "127.0.0.1",
          path: "/",
          httpOnly: true,
          secure: false,
        },
      ],
    }),
    { mode: 0o600 },
  );
  await writeFile(
    resolve(directory, "fixture.json"),
    JSON.stringify({
      origin,
      tenantId: f.tenant.id,
      projectId: f.project.id,
      sceneId: f.scene.id,
      assetId: asset.id,
      firstRevision: one.id,
      secondRevision: two.id,
      mediaId: media.id,
      scriptId: script.id,
      providerCalls: f.calls(),
    }),
    { mode: 0o600 },
  );
  console.log("fixture ready: " + directory);
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
  console.error("FIXTURE_START_FAILED " + directory);
  await close();
  process.exitCode = 1;
});
