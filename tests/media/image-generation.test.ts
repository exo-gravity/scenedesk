import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMediaProcessor, MediaFailure } from "@drama/media";
import type { StepEnvelope } from "@drama/queue";
import { runMediaProcess } from "../../packages/media/src/sandbox.js";
import { imageGenerationFixture } from "../support/image-generation.js";
import { storageFixture } from "../support/storage.js";

test(
  "image fixture archives real isolated bytes through strict probe and preview processing",
  { timeout: 240_000 },
  async (t) => {
    const storage = await storageFixture(t),
      f = await imageGenerationFixture(t, storage.api);
    const processor = await createMediaProcessor({
      pool: f.mediaDb,
      schema: f.schema,
      store: storage.processing,
      schedule: f.mediaProducer.schedule,
    });
    const run = (envelope: StepEnvelope) =>
      processor(envelope, {
        signal: new AbortController().signal,
        queueJobId: randomUUID(),
      });
    const directory = await mkdtemp(
      join(tmpdir(), "scenedesk-generated-fixture-test-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, "image");
    await runMediaProcess(
      undefined,
      "/ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=32x32",
        "-frames:v",
        "1",
        "-threads",
        "2",
        "-c:v",
        "png",
        "-f",
        "image2pipe",
        "pipe:1",
      ],
      { outputFile: file, maxBytes: 1048576 },
    );
    const bytes = await readFile(file),
      sha256 = createHash("sha256").update(bytes).digest("hex");
    const source = await storage.processing.publish(
      file,
      { bytes: bytes.length, sha256, mime: "image/png" },
      "originals",
    );
    const output = {
      images: [
        {
          kind: "fixture_object",
          object: {
            key: source.key,
            versionId: source.versionId,
            bytes: source.bytes,
          },
          sha256,
          mime: "image/png",
        },
      ],
    };
    f.setOutput(output);
    const submit = async () => {
      const p = await f.plan(),
        j = await f.execute(p.id);
      await f.worker.process(j.id);
      assert.equal((await f.job(j.id)).status, "archiving");
      return j;
    };
    const media = (id: string) => f.ok("GET", `${f.base}/media/${id}`);
    await t.test(
      "original and poster become separately ready and fixed access returns exact bytes",
      async () => {
        const j = await submit();
        assert.deepEqual((await f.job(j.id)).mediaIds, []);
        await run(await f.envelope(j.id));
        const result = await media(j.id);
        assert.equal(result.status, "ready");
        assert.equal(result.width, 32);
        assert.equal(result.height, 32);
        assert.equal(result.sha256, sha256);
        assert.equal(result.bytes, bytes.length);
        assert.equal(result.derivatives[0].status, "queued");
        assert.deepEqual((await f.job(j.id)).mediaIds, [j.id]);
        const access = await f.request(
          "POST",
          `${f.base}/media/${j.id}/access`,
          { variant: "original", disposition: "inline" },
        );
        assert.equal(access.statusCode, 200, access.body);
        assert.deepEqual(
          Buffer.from(await (await fetch(access.json().url)).arrayBuffer()),
          bytes,
        );
        await run({
          taskKind: "media_derivative",
          businessId: result.derivatives[0].id,
          stepRevision: 1,
          epoch: 1,
        });
        const preview = await media(j.id);
        assert.equal(preview.derivatives[0].status, "ready");
        const grant = await f.request(
          "POST",
          `${f.base}/media/${j.id}/access`,
          { variant: "poster", disposition: "inline" },
        );
        assert.equal(grant.statusCode, 200, grant.body);
        assert.equal(
          (await fetch(grant.json().url)).headers.get("content-type"),
          "image/jpeg",
        );
        assert.equal(f.calls(), 1);
        await f.worker.process(j.id);
        assert.equal(f.calls(), 1);
      },
    );
    await t.test(
      "finite download failures recover the same object and never call the model again",
      async () => {
        const j = await submit(),
          step = await f.envelope(j.id),
          before = f.calls(),
          download = storage.processing.download;
        storage.processing.download = async () => {
          throw new Error("Injected generated original interruption");
        };
        try {
          for (let n = 0; n < 6; n++)
            await assert.rejects(
              run(step),
              /Injected generated original interruption/,
            );
        } finally {
          storage.processing.download = download;
        }
        assert.equal((await f.job(j.id)).status, "archive_failed");
        assert.deepEqual((await f.job(j.id)).mediaIds, []);
        const recovery = await f.request(
          "POST",
          `${f.base}/generation-jobs/${j.id}/recover-archive`,
        );
        assert.equal(recovery.statusCode, 202, recovery.body);
        await run(step);
        assert.equal((await media(j.id)).status, "processing");
        await run(await f.envelope(j.id));
        assert.equal((await f.job(j.id)).status, "succeeded");
        assert.equal((await media(j.id)).sha256, sha256);
        assert.equal(f.calls(), before);
      },
    );
    await t.test(
      "wrong bytes cannot become usable Media or be retried as generation",
      async () => {
        const broken = join(directory, "broken"),
          invalid = Buffer.from("not a PNG despite the provider declaration");
        await writeFile(broken, invalid);
        const hash = createHash("sha256").update(invalid).digest("hex");
        const bad = await storage.processing.publish(
          broken,
          { bytes: invalid.length, sha256: hash, mime: "image/png" },
          "originals",
        );
        f.setOutput({
          images: [
            {
              kind: "fixture_object",
              object: {
                key: bad.key,
                versionId: bad.versionId,
                bytes: bad.bytes,
              },
              sha256: hash,
              mime: "image/png",
            },
          ],
        });
        const j = await submit(),
          before = f.calls();
        await run(await f.envelope(j.id));
        assert.equal((await f.job(j.id)).status, "archive_failed");
        assert.deepEqual((await f.job(j.id)).mediaIds, []);
        const rejected = await media(j.id);
        assert.equal(rejected.status, "rejected");
        assert.equal(rejected.issue.retryable, false);
        assert.equal(
          (
            await f.request("POST", `${f.base}/media/${j.id}/access`, {
              variant: "original",
              disposition: "inline",
            })
          ).statusCode,
          409,
        );
        assert.equal(
          (
            await f.request(
              "POST",
              `${f.base}/generation-jobs/${j.id}/recover-archive`,
            )
          ).statusCode,
          409,
        );
        await f.worker.process(j.id);
        assert.equal(f.calls(), before);
        f.setOutput(output);
      },
    );
    await t.test(
      "poster failure preserves verified original and job success",
      async () => {
        const j = await submit();
        await run(await f.envelope(j.id));
        const m = await media(j.id),
          publish = storage.processing.publish;
        storage.processing.publish = async () => {
          throw new MediaFailure(
            "MEDIA_RESOURCE_LIMIT",
            "Explicit preview failure fixture",
          );
        };
        try {
          await run({
            taskKind: "media_derivative",
            businessId: m.derivatives[0].id,
            stepRevision: 1,
            epoch: 1,
          });
        } finally {
          storage.processing.publish = publish;
        }
        const after = await media(j.id);
        assert.equal(after.status, "ready");
        assert.equal(after.derivatives[0].status, "failed");
        assert.equal((await f.job(j.id)).status, "succeeded");
        assert.equal(after.sha256, sha256);
      },
    );
  },
);
