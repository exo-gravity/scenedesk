/** SceneDesk-owned isolated browser fixture; never a production entry point. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import type { TestContext } from "node:test";
import { createMediaProcessor } from "@drama/media";
import { createScheduler, runInternalWorker } from "@drama/queue";
import { buildApp } from "../../../apps/api/src/app.js";
import { imageGenerationFixture } from "../../../tests/support/image-generation.js";
import { storageFixture } from "../../../tests/support/storage.js";

const directory = resolve(process.argv[2] ?? ".runtime/canvas-sources-fixture");
assert(directory.includes("/.runtime/"));
await mkdir(directory, { recursive: true, mode: 0o700 });
const fixtureCleanup: (() => unknown)[] = [],
  ownCleanup: (() => unknown)[] = [];
const context = {
  after: (fn: () => unknown) => fixtureCleanup.push(fn),
} as unknown as TestContext;
let closing = false,
  timer: NodeJS.Timeout | undefined,
  active: Promise<void> | undefined;
const errors: string[] = [];
async function release() {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  await active;
  const failures: unknown[] = [];
  for (const run of [...ownCleanup.reverse(), ...fixtureCleanup]) {
    try {
      await run();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "Fixture cleanup failed");
}
// Deterministic tiny fixture pixels, not generated artwork or provider quality evidence.
function png(rgb: [number, number, number]) {
  const crc32 = (bytes: Buffer) => {
    let n = 0xffffffff;
    for (const byte of bytes) {
      n ^= byte;
      for (let bit = 0; bit < 8; bit++)
        n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
    }
    return (n ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Buffer) => {
    const name = Buffer.from(type),
      result = Buffer.alloc(body.length + 12);
    result.writeUInt32BE(body.length);
    name.copy(result, 4);
    body.copy(result, 8);
    result.writeUInt32BE(crc32(Buffer.concat([name, body])), body.length + 8);
    return result;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(32);
  ihdr.writeUInt32BE(32, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(32 * (1 + 32 * 3));
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) raw.set(rgb, y * 97 + 1 + x * 3);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
async function start() {
  console.log("fixture: preparing isolated storage");
  const storage = await storageFixture(context);
  console.log("fixture: applying isolated database and queue");
  const f = await imageGenerationFixture(context, storage.api);
  const queueErrors: string[] = [];
  const scheduler = await createScheduler(f.runtime, {
    schema: f.queueSchema,
    onError: () => queueErrors.push("API_QUEUE_FAILED"),
  });
  ownCleanup.push(() => scheduler.close());
  const processor = await createMediaProcessor({
    pool: f.mediaDb,
    schema: f.schema,
    store: storage.processing,
    schedule: f.mediaProducer.schedule,
  });
  const mediaWorker = await runInternalWorker(f.schedulerDb, processor, {
    schema: f.queueSchema,
    concurrency: 2,
    onError: () => queueErrors.push("MEDIA_STEP_FAILED"),
  });
  ownCleanup.push(() => mediaWorker.close());
  async function until<T>(
    read: () => Promise<T>,
    ready: (v: T) => boolean,
    label: string,
  ) {
    const deadline = Date.now() + 180000;
    for (;;) {
      const result = await read();
      if (ready(result)) return result;
      if (Date.now() > deadline) throw new Error(`Fixture timed out: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  async function importImage(name: string, bytes: Buffer) {
    console.log(`fixture: importing ${name}`);
    const intent = await f.ok("POST", `${f.base}/uploads`, {
      scope: "project",
      projectId: f.project.id,
      fileName: name,
      mime: "image/png",
      bytes: bytes.length,
      sha256: hash(bytes),
    });
    const form = new FormData();
    for (const [key, value] of Object.entries(intent.formFields))
      form.append(key, String(value));
    form.append("file", new Blob([new Uint8Array(bytes)]), name);
    assert.equal(
      (await fetch(intent.uploadUrl, { method: "POST", body: form })).status,
      204,
    );
    const completed = await f.request(
      "POST",
      `${f.base}/uploads/${intent.id}/complete`,
      { bytes: bytes.length, sha256: hash(bytes) },
    );
    assert.equal(completed.statusCode, 202, completed.body);
    const media = completed.json();
    return until(
      () => f.ok("GET", `${f.base}/media/${media.mediaId}`),
      (value) =>
        value.status === "ready" &&
        value.derivatives.every(
          (d: { status: string }) => d.status === "ready",
        ),
      "reference import",
    );
  }
  const referenceA = await importImage(
    "旧镜头蓝色参考.png",
    png([40, 85, 145]),
  );
  const referenceB = await importImage(
    "跨场镜头红色参考.png",
    png([145, 55, 45]),
  );
  const selectedA = await f.ok(
    "PUT",
    `${f.path}/shots/${f.shot.id}`,
    {
      sceneId: f.scene.id,
      label: "A-门口",
      position: 0,
      status: "active",
      spec: {
        intent: "旧要求：先看门口再看钥匙",
        entryState: { spatialNotes: "旧起点：门边" },
        exitState: { spatialNotes: "旧终点：桌前" },
        references: [
          {
            mediaId: referenceA.id,
            purpose: "composition",
            note: "A固定蓝色构图",
          },
        ],
      },
    },
    f.shot.revision,
  );
  let currentA = await f.ok(
    "PUT",
    `${f.path}/shots/${selectedA.id}`,
    {
      sceneId: f.scene.id,
      label: "A-门口",
      position: 0,
      status: "active",
      spec: {
        ...selectedA.spec,
        intent: "新要求：不可自动带入本次历史版本",
        entryState: { spatialNotes: "新起点" },
      },
    },
    selectedA.revision,
  );
  const sceneB = await f.ok(
    "POST",
    `${f.path}/scenes`,
    {
      episodeId: f.scene.episodeId,
      title: "同项目另一场",
      position: 1,
      summary: "固定跨场来源",
      state: {},
      status: "active",
    },
    await f.next(),
  );
  const selectedB = await f.ok(
    "POST",
    `${f.path}/shots`,
    {
      sceneId: sceneB.id,
      label: "B-窗边",
      position: 0,
      status: "active",
      spec: {
        intent: "B要求：保持窗边反应",
        entryState: { spatialNotes: "窗边" },
        exitState: { spatialNotes: "窗边未动" },
        references: [
          { mediaId: referenceB.id, purpose: "look", note: "B固定红色造型" },
        ],
      },
    },
    await f.next(),
  );
  const script = await f.ok(
    "POST",
    `${f.path}/scripts`,
    { text: "她推门进入房间，先看门口，再看向桌上的钥匙。窗边的人没有移动。" },
    await f.next(),
  );
  const ensured = await f.request(
    "POST",
    `${f.path}/scenes/${f.scene.id}/canvas`,
  );
  assert.equal(ensured.statusCode, 200, ensured.body);
  const canvas = ensured.json().canvas;
  const nodeId = randomUUID(),
    alternateNodeId = randomUUID(),
    textA = randomUUID(),
    textB = randomUUID(),
    disabledText = randomUUID();
  const draft = (id: string, title: string, x: number) => ({
    id,
    kind: "image",
    title,
    position: { x, y: 240 },
    width: 320,
    content: {
      type: "draft",
      prompt: "手工提示：保留用户选定镜头和来源顺序。",
      connectionId: f.input.connectionId,
      capabilityId: f.input.capabilityId,
      output: { resolution: "32x32", aspectRatio: "1:1" },
    },
  });
  const savedCanvas = await f.ok(
    "PUT",
    `${f.path}/canvases/${canvas.id}`,
    {
      schemaVersion: 1,
      document: {
        nodes: [
          {
            id: textA,
            kind: "text",
            title: "后发给模型",
            position: { x: 40, y: 40 },
            width: 240,
            content: { type: "text", text: "第二段画布文字：再看钥匙。" },
          },
          {
            id: textB,
            kind: "text",
            title: "先发给模型",
            position: { x: 340, y: 40 },
            width: 240,
            content: { type: "text", text: "第一段画布文字：先看门口。" },
          },
          {
            id: disabledText,
            kind: "text",
            title: "停用来源",
            position: { x: 640, y: 40 },
            width: 240,
            content: { type: "text", text: "停用文字不可进入固定输入。" },
          },
          draft(nodeId, "多镜头创作", 100),
          draft(alternateNodeId, "独立空来源草稿", 560),
        ],
        edges: [
          {
            id: randomUUID(),
            sourceNodeId: textA,
            targetNodeId: nodeId,
            enabled: true,
            position: 1,
            purpose: "prompt",
          },
          {
            id: randomUUID(),
            sourceNodeId: textB,
            targetNodeId: nodeId,
            enabled: true,
            position: 0,
            purpose: "prompt",
          },
          {
            id: randomUUID(),
            sourceNodeId: disabledText,
            targetNodeId: nodeId,
            enabled: false,
            position: 2,
            purpose: "prompt",
          },
        ],
        groups: [],
      },
    },
    canvas.revision,
  );
  console.log("fixture: fixed sources and canvas saved");
  const sourceFile = resolve(directory, "provider-output.png"),
    outputBytes = png([45, 120, 85]);
  await writeFile(sourceFile, outputBytes, { mode: 0o600 });
  const source = await storage.processing.publish(
    sourceFile,
    { bytes: outputBytes.length, sha256: hash(outputBytes), mime: "image/png" },
    "originals",
  );
  f.setOutput({
    images: [
      {
        kind: "fixture_object",
        object: {
          key: source.key,
          versionId: source.versionId,
          bytes: source.bytes,
        },
        sha256: hash(outputBytes),
        mime: "image/png",
      },
    ],
  });
  const origin = "http://127.0.0.1:4319",
    secret = randomBytes(32).toString("base64url");
  const app = buildApp(f.runtime, {
    schema: f.schema,
    origin,
    secret,
    localIdentity: true,
    media: { store: storage.api, schedule: scheduler.schedule },
  });
  ownCleanup.push(() => app.close());
  const dist = fileURLToPath(
    new URL("../../../apps/web/dist/", import.meta.url),
  );
  app.get("/", async (_, reply) =>
    reply.type("text/html").send(await readFile(resolve(dist, "index.html"))),
  );
  app.get("/favicon.svg", async (_, reply) => reply.code(204).send());
  app.get<{ Params: { "*": string } }>("/assets/*", async (request, reply) => {
    const root = resolve(dist, "assets"),
      file = resolve(root, request.params["*"]);
    if (!file.startsWith(root + "/")) return reply.code(404).send();
    const mime: Record<string, string> = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
    };
    return reply
      .type(mime[extname(file)] ?? "application/octet-stream")
      .send(await readFile(file));
  });
  let paused = true;
  const identity = {
    origin,
    tenantId: f.tenant.id,
    projectId: f.project.id,
    sceneId: f.scene.id,
    otherSceneId: sceneB.id,
    canvasId: savedCanvas.id,
    nodeId,
    alternateNodeId,
    scriptRevisionId: script.id,
    selectedA: {
      shotId: selectedA.id,
      shotRevisionId: selectedA.specRevisionId,
      number: 2,
    },
    selectedB: {
      shotId: selectedB.id,
      shotRevisionId: selectedB.specRevisionId,
      number: 1,
    },
    initialCurrentA: currentA.specRevisionId,
    referenceA: referenceA.id,
    referenceB: referenceB.id,
    capabilityId: f.input.capabilityId,
    expectedOutputSha256: hash(outputBytes),
    executionMode: "test_fixture",
    paidProvidersEnabled: false,
  };
  app.get("/__fixture/state", async () => ({
    paused,
    calls: f.calls(),
    last: f.last()
      ? {
          jobId: f.last()!.jobId,
          attemptId: f.last()!.attemptId,
          input: f.last()!.input,
          resolvedInput: f.last()!.resolvedInput,
        }
      : undefined,
    errors,
    queueErrors,
  }));
  app.post<{ Body: { action: string } }>(
    "/__fixture/control",
    async (request) => {
      if (request.body.action === "resume") paused = false;
      else if (request.body.action === "pause") paused = true;
      else if (request.body.action === "advance-shot-a") {
        currentA = await f.ok(
          "PUT",
          `${f.path}/shots/${currentA.id}`,
          {
            sceneId: f.scene.id,
            label: "A-门口",
            position: 0,
            status: "active",
            spec: { ...currentA.spec, intent: "再更新：已选旧版本仍应保留" },
          },
          currentA.revision,
        );
        return {
          shotId: currentA.id,
          currentRevisionId: currentA.specRevisionId,
        };
      } else throw Error("Unknown fixture control");
      return { paused };
    },
  );
  await app.listen({ host: "127.0.0.1", port: 4319 });
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
    JSON.stringify(identity, null, 2) + "\n",
    { mode: 0o600 },
  );
  function scan() {
    if (closing) return;
    active = (
      paused ? Promise.resolve() : f.worker.scan().then(() => undefined)
    )
      .catch(() => {
        errors.push("GENERATION_STEP_FAILED");
      })
      .finally(() => {
        if (!closing) timer = setTimeout(scan, 500);
      });
  }
  scan();
  const close = async () => {
    const summary = {
      ...identity,
      calls: f.calls(),
      errors,
      queueErrors,
      cleanup: "completed",
    };
    await release();
    await writeFile(
      resolve(directory, "cleanup.json"),
      JSON.stringify(summary, null, 2) + "\n",
      { mode: 0o600 },
    );
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => void close());
  console.log(JSON.stringify({ status: "ready", ...identity }));
}
try {
  await start();
} catch (error) {
  await release();
  throw error;
}
