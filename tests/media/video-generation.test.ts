import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMediaProcessor, MediaFailure } from "@drama/media";
import type { StepEnvelope } from "@drama/queue";
import { writeVideoFixture } from "../../scripts/video-fixture-file.js";
import { imageGenerationFixture } from "../support/image-generation.js";
import { storageFixture } from "../support/storage.js";

test(
  "generated technical MP4 retains real timing/audio and independently verified poster/proxy",
  { timeout: 480_000 },
  async (t) => {
    const storage = await storageFixture(t),
      f = await imageGenerationFixture(t, storage.api, { purpose: "video" });
    const processor = await createMediaProcessor({
      pool: f.mediaDb,
      schema: f.schema,
      store: storage.processing,
      schedule: f.mediaProducer.schedule,
    });
    const run = (envelope: StepEnvelope) =>
      processor(envelope, {
        signal: t.signal,
        queueJobId: randomUUID(),
      });
    const directory = await mkdtemp(
      join(tmpdir(), "scenedesk-generated-video-test-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const sources = new Map<
      boolean,
      { bytes: Buffer; sha256: string; output: unknown }
    >();
    for (const withAudio of [false, true]) {
      const file = join(directory, withAudio ? "audio.mp4" : "silent.mp4");
      await writeVideoFixture(file, withAudio, "32x32");
      const bytes = await readFile(file),
        sha256 = createHash("sha256").update(bytes).digest("hex");
      const object = await storage.processing.publish(
        file,
        { bytes: bytes.length, sha256, mime: "video/mp4" },
        "originals",
      );
      sources.set(withAudio, {
        bytes,
        sha256,
        output: {
          videos: [
            {
              kind: "fixture_object",
              object: {
                key: object.key,
                versionId: object.versionId,
                bytes: object.bytes,
              },
              sha256,
              mime: "video/mp4",
            },
          ],
        },
      });
    }
    const submit = async (withAudio = false, sourceAudio = withAudio) => {
      f.setOutput(sources.get(sourceAudio)!.output);
      const p = await f.plan({ output: { ...f.input.output, withAudio } }),
        j = await f.execute(p.id);
      await f.worker.process(j.id);
      assert.equal((await f.job(j.id)).status, "archiving");
      return j;
    };
    const media = (id: string) => f.ok("GET", `${f.base}/media/${id}`);
    await t.test(
      "silent and audible originals are decoded, exact source bytes remain accessible, poster/proxy finish separately",
      async () => {
        for (const withAudio of [false, true]) {
          const j = await submit(withAudio);
          await run(await f.envelope(j.id));
          const m = await media(j.id);
          assert.equal(m.status, "ready");
          assert.equal(m.kind, "video");
          assert.equal(m.hasAudio, withAudio);
          assert.equal(m.width, 32);
          assert.equal(m.height, 32);
          assert.equal(m.fpsNum / m.fpsDen, 24);
          assert.equal(m.sha256, sources.get(withAudio)!.sha256);
          assert.equal((await f.job(j.id)).status, "succeeded");
          assert.equal(m.derivatives.length, 2);
          assert.ok(m.derivatives.every((d: any) => d.status === "queued"));
          t.diagnostic(
            `technical MP4 audio=${withAudio}: actual ${m.durationUs} microseconds at ${m.fpsNum}/${m.fpsDen} fps; no timing metadata rewritten`,
          );
          const original = await f.request(
            "POST",
            `${f.base}/media/${j.id}/access`,
            { variant: "original", disposition: "inline" },
          );
          assert.equal(original.statusCode, 200, original.body);
          assert.deepEqual(
            Buffer.from(await (await fetch(original.json().url)).arrayBuffer()),
            sources.get(withAudio)!.bytes,
          );
          for (const derivative of m.derivatives)
            await run({
              taskKind: "media_derivative",
              businessId: derivative.id,
              stepRevision: 1,
              epoch: 1,
            });
          const ready = await media(j.id);
          assert.ok(ready.derivatives.every((d: any) => d.status === "ready"));
          const proxy = await f.request(
            "POST",
            `${f.base}/media/${j.id}/access`,
            { variant: "proxy", disposition: "inline" },
          );
          assert.equal(proxy.statusCode, 200, proxy.body);
          assert.equal(
            (await fetch(proxy.json().url)).headers.get("content-type"),
            "video/mp4",
          );
          const poster = await f.request(
            "POST",
            `${f.base}/media/${j.id}/access`,
            { variant: "poster", disposition: "inline" },
          );
          assert.equal(poster.statusCode, 200, poster.body);
          assert.equal(
            (await fetch(poster.json().url)).headers.get("content-type"),
            "image/jpeg",
          );
        }
        assert.equal(f.calls(), 2);
      },
    );
    await t.test(
      "a clip a few frames longer than requested archives (real providers round to their own frame count); beyond one second is a final refusal",
      async () => {
        // Seedance returned 4.0417 s and 4.096 s for 4 s requests on 2026-09-23; migration 0120 widened
        // the database rule from one frame to one second, matching validateGeneratedOutput.
        const publishClip = async (name: string, seconds: number) => {
          const file = join(directory, name);
          await writeVideoFixture(file, false, "32x32", seconds);
          const bytes = await readFile(file),
            sha256 = createHash("sha256").update(bytes).digest("hex");
          const object = await storage.processing.publish(file, { bytes: bytes.length, sha256, mime: "video/mp4" }, "originals");
          return { videos: [{ kind: "fixture_object", object: { key: object.key, versionId: object.versionId, bytes: object.bytes }, sha256, mime: "video/mp4" }] };
        };
        f.setOutput(await publishClip("longer.mp4", 2.125));
        const accepted = await f.execute((await f.plan({ output: { ...f.input.output, withAudio: false } })).id);
        await f.worker.process(accepted.id);
        await run(await f.envelope(accepted.id));
        const m = await media(accepted.id);
        assert.equal(m.status, "ready", JSON.stringify(m.issue));
        assert.ok(m.durationUs > 2_000_000 && m.durationUs <= 2_200_000, String(m.durationUs));
        assert.equal((await f.job(accepted.id)).status, "succeeded");

        f.setOutput(await publishClip("too-long.mp4", 3.5));
        const refused = await f.execute((await f.plan({ output: { ...f.input.output, withAudio: false } })).id);
        await f.worker.process(refused.id);
        // A final refusal is recorded on the media row and does not propagate to the queue (no retry loop).
        await run(await f.envelope(refused.id));
        const m2 = await media(refused.id);
        assert.equal(m2.status, "rejected");
        assert.equal(m2.issue?.code, "VIDEO_OUTPUT_MISMATCH");
        assert.equal((await f.job(refused.id)).status, "archive_failed");
      },
    );
    await t.test(
      "declared audio mismatch rejects actual MP4 and never triggers a new generation",
      async () => {
        const j = await submit(true, false),
          before = f.calls();
        await run(await f.envelope(j.id));
        const m = await media(j.id);
        assert.equal(m.status, "rejected");
        assert.equal(m.issue.code, "VIDEO_OUTPUT_MISMATCH");
        assert.equal(m.issue.retryable, false);
        assert.equal((await f.job(j.id)).status, "archive_failed");
        assert.deepEqual((await f.job(j.id)).mediaIds, []);
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
      "archive retry preserves the original fixed file, while proxy failure does not revoke original success",
      async () => {
        const j = await submit(false),
          before = f.calls(),
          step = await f.envelope(j.id),
          download = storage.processing.download;
        storage.processing.download = async () => {
          throw new Error("Injected video archive outage");
        };
        try {
          for (let n = 0; n < 6; n++)
            await assert.rejects(run(step), /Injected video archive outage/);
        } finally {
          storage.processing.download = download;
        }
        assert.equal((await f.job(j.id)).status, "archive_failed");
        const r = await f.request(
          "POST",
          `${f.base}/generation-jobs/${j.id}/recover-archive`,
        );
        assert.equal(r.statusCode, 202, r.body);
        await run(step);
        assert.equal((await media(j.id)).status, "processing");
        await run(await f.envelope(j.id));
        const m = await media(j.id);
        assert.equal(m.status, "ready");
        assert.equal(m.sha256, sources.get(false)!.sha256);
        assert.equal(f.calls(), before);
        const proxy = m.derivatives.find((d: any) => d.kind === "proxy"),
          publish = storage.processing.publish;
        let failedProxyPublishes = 0;
        storage.processing.publish = async () => {
          failedProxyPublishes++;
          throw new MediaFailure(
            "MEDIA_RESOURCE_LIMIT",
            "Explicit proxy resource fixture",
          );
        };
        try {
          await run({
            taskKind: "media_derivative",
            businessId: proxy.id,
            stepRevision: 1,
            epoch: 1,
          });
        } finally {
          storage.processing.publish = publish;
        }
        assert.equal(failedProxyPublishes, 1);
        assert.equal((await f.job(j.id)).status, "succeeded");
        assert.equal(
          (await media(j.id)).derivatives.find((d: any) => d.kind === "proxy")
            .status,
          "failed",
        );
      },
    );
  },
);
