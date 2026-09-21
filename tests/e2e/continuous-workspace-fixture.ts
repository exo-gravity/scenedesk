import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { test as base, expect } from "@playwright/test";
import type { MediaStore } from "@drama/media";
import {
  createAssistanceFixture,
  localAssistanceFixtureOutput,
} from "@drama/provider";
import { createAssistanceWorker } from "../../apps/api/src/modules/generation/worker.js";
import { imageGenerationFixture } from "../support/image-generation.js";
import { fixtureVideo } from "../support/selected-media.js";

/** Synthetic provider + actual checked-in video bytes. Archive acceptance is a restricted
 * SQL fixture, not a claim that the production media processor or a real provider ran. */
export async function startContinuousWorkspace(
  port = Number(process.env.SCENEDESK_E2E_PORT ?? 4461) + 4,
  host = "127.0.0.1",
) {
  if (process.env.PROVIDER_MODE !== "mock")
    throw Error("Explicit mock mode is required");
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !/^\/drama_e2e(?:_|$)/.test(url.pathname) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw Error("Use a dedicated local E2E database");
  if (!["127.0.0.1", "::1"].includes(host)) throw Error("Loopback only");
  const cleanup: (() => unknown | Promise<unknown>)[] = [];
  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "Continuous fixture cleanup failed");
  }
  const origin = `http://${host === "::1" ? "[::1]" : host}:${port}`;
  try {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4+0AAAAASUVORK5CYII=",
      "base64",
    );
    const blue = await fixtureVideo("blue"),
      orange = await fixtureVideo("orange");
    const files = new Map<string, { bytes: Buffer; mime: string }>();
    const grants = new Map<string, { bytes: Buffer; mime: string }>();
    const mediaServer = createServer((request, response) => {
      const file = grants.get(request.url ?? "");
      if (!file) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": file.mime,
        "Content-Length": file.bytes.length,
        "Cache-Control": "private, no-store",
        "Access-Control-Allow-Origin": "*",
      });
      response.end(file.bytes);
    });
    await new Promise<void>((resolve) =>
      mediaServer.listen(0, "127.0.0.1", resolve),
    );
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) => {
          mediaServer.closeAllConnections();
          mediaServer.close((error) => (error ? reject(error) : resolve()));
        }),
    );
    const storageOrigin = `http://127.0.0.1:${(mediaServer.address() as AddressInfo).port}`;
    const store = {
      async verify() {},
      async access(
        source: { key: string; bytes: number },
        _name: string,
        mime: string,
      ) {
        const file = files.get(source.key);
        assert.ok(file, "Synthetic bytes must exist");
        assert.equal(file.bytes.length, source.bytes);
        assert.equal(file.mime, mime);
        const token = `/${randomBytes(24).toString("base64url")}`;
        grants.set(token, file);
        return {
          url: `${storageOrigin}${token}`,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        };
      },
    } as unknown as MediaStore;
    const fixtureCleanup: (() => unknown | Promise<unknown>)[] = [];
    cleanup.push(async () => {
      const failures: unknown[] = [];
      for (const close of fixtureCleanup) {
        try { await close(); }
        catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, "Database fixture cleanup failed");
    });
    const f = await imageGenerationFixture(
      {
        after: (fn: () => unknown | Promise<unknown>) => {
          fixtureCleanup.push(fn);
        },
      } as TestContext,
      store,
      { origin },
    );
    cleanup.push(() => {
      f.app.server.closeAllConnections();
    });
    // Two visual capabilities share fixed connection snapshots but never call an external service.
    const videoCapabilityId = randomUUID(),
      videoVersionId = randomUUID();
    await f.admin.query(
      `INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
      [
        videoCapabilityId,
        f.tenant.id,
        f.input.connectionId,
        videoVersionId,
        {
          ...f.definition,
          purpose: "video",
          mode: "video_fixture_v1",
          modelVersion: "Local Video Demo",
          minDurationSeconds: 4,
          maxDurationSeconds: 4,
          audioOutput: false,
          allowedResolutions: ["96x160"],
          allowedAspectRatios: ["3:5"],
        },
      ],
    );
    let videoCalls = 0;
    const videoWorker = await createAssistanceWorker({
      pool: f.generationDb,
      schema: f.schema,
      adapters: [
        createAssistanceFixture(videoVersionId, async (submission) => {
          const bytes = videoCalls++ % 2 === 0 ? blue : orange,
            key = `originals/${randomUUID()}`;
          files.set(key, { bytes, mime: "video/mp4" });
          return {
            kind: "completed",
            correlation: submission.attemptId,
            output: {
              videos: [
                {
                  kind: "fixture_object",
                  object: {
                    key,
                    versionId: "synthetic-v1",
                    bytes: bytes.length,
                  },
                  sha256: createHash("sha256").update(bytes).digest("hex"),
                  mime: "video/mp4",
                },
              ],
            },
          };
        }),
      ],
      scheduleArchive: (sql, envelope) =>
        f.mediaProducer.schedule(sql, envelope),
    });
    async function completeVideo(id: string) {
      await videoWorker.process(id);
      const step = await f.envelope(id),
        token = randomUUID();
      const claim = (
        await f.mediaDb.query(
          `SELECT ${f.scope}.claim_generated_media($1,$2,$3,$4) AS claim`,
          [id, step.stepRevision, step.epoch, token],
        )
      ).rows[0].claim;
      assert.ok(claim);
      await f.mediaDb.query(
        `SELECT ${f.scope}.finish_generated_media($1,$2,$3,NULL)`,
        [
          id,
          token,
          {
            object: { ...claim.source.object, sha256: claim.source.sha256 },
            probe: {
              kind: "video",
              mime: "video/mp4",
              width: 96,
              height: 160,
              durationUs: 4000000,
              fpsNum: 24,
              fpsDen: 1,
              hasAudio: false,
            },
          },
        ],
      );
      assert.equal((await f.job(id)).status, "succeeded");
    }
    const assistance = {
      id: randomUUID(),
      connectionId: randomUUID(),
      versionId: randomUUID(),
    };
    await f.admin.query(
      `INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
      [
        assistance.id,
        f.tenant.id,
        assistance.connectionId,
        assistance.versionId,
        {
          purpose: "creative_assistance",
          mode: "fixture",
          modelVersion: "Local Demo",
          supportedPurposes: ["composition", "look"],
          maxReferences: 20,
        },
      ],
    );
    const assistantWorker = await createAssistanceWorker({
      pool: f.generationDb,
      schema: f.schema,
      adapters: [
        createAssistanceFixture(assistance.versionId, async (submission) => ({
          kind: "completed",
          correlation: submission.attemptId,
          output: {
            ...localAssistanceFixtureOutput(submission),
            prompt: "合成助手建议：雨夜窗边的人物，轻轻抬头。",
          },
        })),
      ],
    });
    const imageId = randomUUID(),
      uploadId = randomUUID(),
      imageKey = `originals/${imageId}`,
      imageSha = createHash("sha256").update(png).digest("hex");
    files.set(imageKey, { bytes: png, mime: "image/png" });
    await f.admin.query(
      `INSERT INTO ${f.scope}.upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch) VALUES($1,$2,$3,'project',$4,$5,$6,'synthetic-reference.png','image/png','合成参考图',$7,'accepted',now()+interval '15 minutes','synthetic-v1',1)`,
      [
        uploadId,
        f.tenant.id,
        f.project.id,
        `staging/${uploadId}`,
        png.length,
        imageSha,
        f.owner.userId,
      ],
    );
    await f.admin.query(
      `INSERT INTO ${f.scope}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio) VALUES($1,$2,$3,'project','image','ready','合成参考图','synthetic-reference.png',$4,$5,$6,'synthetic-v1',$7,$8,'image/png',1,1,false)`,
      [
        imageId,
        f.tenant.id,
        f.project.id,
        f.owner.userId,
        uploadId,
        imageKey,
        imageSha,
        png.length,
      ],
    );
    const ensured = await f.request("POST", `${f.path}/canvas`);
    assert.equal(ensured.statusCode, 200);
    let canvas = ensured.json().canvas;
    const referenceId = randomUUID(),
      draftId = randomUUID();
    canvas = await f.ok(
      "PUT",
      `${f.path}/canvases/${canvas.id}`,
      {
        schemaVersion: 1,
        document: {
          nodes: [
            {
              id: referenceId,
              kind: "image",
              title: "合成参考图",
              position: { x: 80, y: 80 },
              width: 280,
              content: { type: "media", mediaId: imageId },
            },
            {
              id: draftId,
              kind: "image",
              title: "待助手调整的草稿",
              position: { x: 480, y: 80 },
              width: 360,
              content: {
                type: "draft",
                prompt: "用户原来的提示",
                connectionId: f.input.connectionId,
                capabilityId: f.input.capabilityId,
                output: f.input.output,
              },
            },
          ],
          edges: [],
          groups: [],
        },
      },
      canvas.revision,
    );
    async function seedAdvice() {
      const current = await f.ok("GET", `${f.path}/canvases/${canvas.id}`);
      const plan = await f.ok("POST", `${f.base}/generation-plans`, {
        ...f.input,
        purpose: "creative_assistance",
        connectionId: assistance.connectionId,
        capabilityId: assistance.id,
        output: {},
        shotSources: [],
        canvasSources: [
          {
            canvasId: canvas.id,
            canvasRevision: current.revision,
            nodeId: draftId,
          },
        ],
        prompt: "改写这一个草稿",
        assistance: {
          kind: "prepare_prompt",
          targetCapabilityId: f.input.capabilityId,
          targetCapabilityRevision: 1,
        },
      });
      const job = await f.execute(plan.id);
      await assistantWorker.process(job.id);
      return f.ok(
        "GET",
        `${f.path}/assistance-artifacts/${(await f.job(job.id)).assistanceArtifactId}`,
      );
    }
    const apiOrigin = await f.app.listen({ host: "127.0.0.1", port: 0 });
    const web = await preview({
      configFile: false,
      root: fileURLToPath(new URL("../../apps/web", import.meta.url)),
      logLevel: "error",
      build: { outDir: "dist" },
      plugins: [
        {
          name: "synthetic-continuous-sign-in",
          configurePreviewServer(server) {
            server.middlewares.use((request, response, next) => {
              if (
                request.url !== "/__fixture/sign-in" ||
                request.method !== "GET"
              )
                return next();
              response.writeHead(303, {
                "Set-Cookie": `session=${f.owner.token}; Path=/; HttpOnly; SameSite=Lax`,
                Location: `/#/app/t/${f.tenant.id}/p/${f.project.id}/studio?node=${referenceId}`,
              });
              response.end();
            });
          },
        },
      ],
      preview: {
        host,
        port,
        strictPort: true,
        proxy: { "/v1": apiOrigin, "/health": apiOrigin, "/design": apiOrigin },
      },
    });
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) => {
          if ("closeAllConnections" in web.httpServer)
            web.httpServer.closeAllConnections();
          web.httpServer.close((error) => (error ? reject(error) : resolve()));
        }),
    );
    return {
      ...f,
      origin,
      canvas,
      referenceId,
      draftId,
      videoCapabilityId,
      seedAdvice,
      completeVideo,
      videoCalls: () => videoCalls,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
export const test = base.extend<{
  continuous: Awaited<ReturnType<typeof startContinuousWorkspace>>;
}>({
  continuous: [
    async ({ context }, use) => {
      const f = await startContinuousWorkspace();
      try {
        await context.addCookies([
          {
            name: "session",
            value: f.owner.token,
            url: f.origin,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        await use(f);
      } finally {
        await f.stop();
      }
    },
    { timeout: 120_000 },
  ],
});
export { expect };
