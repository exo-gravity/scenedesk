import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMediaProcessor, MediaFailure } from "@drama/media";
import type { StepEnvelope } from "@drama/queue";
import { writeAudioFixture } from "../../scripts/audio-fixture-file.js";
import { imageGenerationFixture } from "../support/image-generation.js";
import { storageFixture } from "../support/storage.js";

test(
  "generated PCM audio archives original bytes and independently recovers its preview",
  { timeout: 420000 },
  async (t) => {
    const storage = await storageFixture(t),
      f = await imageGenerationFixture(t, storage.api, { purpose: "audio" });
    const processor = await createMediaProcessor({
      pool: f.mediaDb,
      schema: f.schema,
      store: storage.processing,
      schedule: f.mediaProducer.schedule,
    });
    const run = (step: StepEnvelope) =>
      processor(step, { signal: t.signal, queueJobId: randomUUID() });
    const dir = await mkdtemp(join(tmpdir(), "scenedesk-generated-audio-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const sources = new Map<
      number,
      { bytes: Buffer; sha256: string; output: unknown }
    >();
    for (const duration of [2, 3]) {
      const file = join(dir, `${duration}.wav`);
      await writeAudioFixture(file, duration);
      const bytes = await readFile(file),
        sha256 = createHash("sha256").update(bytes).digest("hex");
      const object = await storage.processing.publish(
        file,
        { bytes: bytes.length, sha256, mime: "audio/wav" },
        "originals",
      );
      sources.set(duration, {
        bytes,
        sha256,
        output: {
          audios: [
            {
              kind: "fixture_object",
              object: {
                key: object.key,
                versionId: object.versionId,
                bytes: object.bytes,
              },
              sha256,
              mime: "audio/wav",
            },
          ],
        },
      });
    }
    const submit = async (duration = 2) => {
      f.setOutput(sources.get(duration)!.output);
      const j = await f.execute((await f.plan()).id);
      await f.worker.process(j.id);
      assert.equal((await f.job(j.id)).status, "archiving");
      return j;
    };
    const media = (id: string) => f.ok("GET", `${f.base}/media/${id}`);
    await t.test(
      "original audio is verified and readable before its only proxy completes",
      async () => {
        const j = await submit();
        await run(await f.envelope(j.id));
        const m = await media(j.id);
        assert.equal(m.status, "ready");
        assert.equal(m.kind, "audio");
        assert.equal(m.durationUs, 2000000);
        assert.equal(m.hasAudio, true);
        assert.equal(m.width, undefined);
        assert.equal(m.sha256, sources.get(2)!.sha256);
        assert.deepEqual(
          m.derivatives.map((d: any) => d.kind),
          ["proxy"],
        );
        assert.equal((await f.job(j.id)).status, "succeeded");
        const original = await f.request(
          "POST",
          `${f.base}/media/${j.id}/access`,
          { variant: "original", disposition: "inline" },
        );
        assert.equal(original.statusCode, 200, original.body);
        assert.deepEqual(
          Buffer.from(await (await fetch(original.json().url)).arrayBuffer()),
          sources.get(2)!.bytes,
        );
        await run({
          taskKind: "media_derivative",
          businessId: m.derivatives[0].id,
          stepRevision: 1,
          epoch: 1,
        });
        assert.equal((await media(j.id)).derivatives[0].status, "ready");
        const proxy = await f.request(
          "POST",
          `${f.base}/media/${j.id}/access`,
          { variant: "proxy", disposition: "inline" },
        );
        assert.equal(proxy.statusCode, 200, proxy.body);
        assert.equal(
          (await fetch(proxy.json().url)).headers.get("content-type"),
          "audio/mp4",
        );
        assert.equal(f.calls(), 1);
      },
    );
    await t.test(
      "a real three-second output cannot masquerade as the fixed two-second request",
      async () => {
        const j = await submit(3),
          before = f.calls();
        await run(await f.envelope(j.id));
        const m = await media(j.id);
        assert.equal(m.status, "rejected");
        assert.equal(m.issue.code, "AUDIO_OUTPUT_MISMATCH");
        assert.equal((await f.job(j.id)).status, "archive_failed");
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
      },
    );
    await t.test(
      "archive retries keep the same source; a failed proxy preserves ready original and job success",
      async () => {
        const j = await submit(),
          before = f.calls(),
          step = await f.envelope(j.id),
          download = storage.processing.download;
        storage.processing.download = async () => {
          throw new Error("Injected audio archive outage");
        };
        try {
          for (let i = 0; i < 6; i++)
            await assert.rejects(run(step), /Injected audio archive outage/);
        } finally {
          storage.processing.download = download;
        }
        assert.equal((await f.job(j.id)).status, "archive_failed");
        assert.equal(
          (
            await f.request(
              "POST",
              `${f.base}/generation-jobs/${j.id}/recover-archive`,
            )
          ).statusCode,
          202,
        );
        await run(step);
        assert.equal((await media(j.id)).status, "processing");
        await run(await f.envelope(j.id));
        const m = await media(j.id);
        assert.equal(m.status, "ready");
        assert.equal(m.sha256, sources.get(2)!.sha256);
        assert.equal(f.calls(), before);
        const publish = storage.processing.publish;
        let failedPublishes = 0;
        storage.processing.publish = async () => {
          failedPublishes++;
          throw new MediaFailure(
            "MEDIA_RESOURCE_LIMIT",
            "Explicit audio proxy resource fixture",
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
        assert.equal(failedPublishes, 1);
        assert.equal((await media(j.id)).derivatives[0].status, "failed");
        assert.equal((await f.job(j.id)).status, "succeeded");
      },
    );
  },
);
