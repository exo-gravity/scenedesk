import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runInternalWorker, PRODUCTION_JOB_SECONDS } from "@drama/queue";
import {
  createMediaProcessor,
  createProductionProcessor,
  repairMediaWork,
  requestMediaProduction,
  readNormalizationMedia,
  normalizationMediaFromVerifiedMaps,
} from "@drama/media";
import {
  editingCanonical,
  normalizeSavedCut,
  type WorkDocument,
} from "@drama/domain";
import { runMediaProcess } from "../../packages/media/src/sandbox.js";
import { storageFixture } from "../support/storage.js";
import { productionJobsFixture } from "../support/production-jobs.js";

test(
  "accepted original media is produced by the real queue dispatcher and fixed artifacts survive restart",
  { timeout: 720_000 },
  async (t) => {
    const storage = await storageFixture(t),
      f = await productionJobsFixture(t, storage.api);
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), "scenedesk-production-worker-")),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const root = join(directory, "worker"),
      file = join(directory, "signal.mp4");
    await runMediaProcess(
      undefined,
      "/ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-threads",
        "2",
        "-filter_threads",
        "2",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=32x32:rate=24:duration=0.5",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=997:sample_rate=48000:duration=0.5",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "frag_keyframe+empty_moov",
        "-f",
        "mp4",
        "pipe:1",
      ],
      { outputFile: file, signal: t.signal },
    );
    const data = await readFile(file),
      sha256 = createHash("sha256").update(data).digest("hex");
    let producer:
      Awaited<ReturnType<typeof createProductionProcessor>> | undefined;
    let queue: Awaited<ReturnType<typeof runInternalWorker>> | undefined;
    const errors: Error[] = [];
    try {
      producer = await createProductionProcessor({
        pool: f.worker,
        schema: f.schema,
        originals: storage.processing,
        artifacts: storage.production,
        workDirectory: root,
        writeLimitBytes: 16 * 1024 ** 2,
      });
      const old = await createMediaProcessor({
        pool: f.worker,
        schema: f.schema,
        store: storage.processing,
        schedule: f.schedule,
      });
      queue = await runInternalWorker(
        f.scheduler,
        (step, context) =>
          step.taskKind === "media_production"
            ? producer!.process(step, context)
            : old(step, context),
        {
          schema: f.queueSchema,
          concurrency: 1,
          onError: (error) => errors.push(error),
        },
      );
      const waitFor = async <T>(
        read: () => Promise<T>,
        done: (value: T) => boolean,
      ) => {
        const until = Date.now() + 150_000;
        while (Date.now() < until) {
          const value = await read();
          if (done(value)) return value;
          await delay(100, undefined, { signal: t.signal });
        }
        throw new Error(
          "Production business result did not reach its expected state",
        );
      };
      const path = `/v1/tenants/${f.tenant.id}`;
      const upload = await f.requestHttp("POST", `${path}/uploads`, {
        scope: "project",
        projectId: f.project.id,
        fileName: "signal.mp4",
        mime: "video/mp4",
        bytes: data.length,
        sha256,
      });
      assert.equal(upload.statusCode, 201, upload.body);
      const intent = upload.json(),
        form = new FormData();
      for (const [key, value] of Object.entries(intent.formFields))
        form.append(key, String(value));
      form.append("file", new Blob([new Uint8Array(data)]), "signal.mp4");
      assert.equal(
        (
          await fetch(intent.uploadUrl, {
            method: "POST",
            body: form,
            signal: t.signal,
          })
        ).status,
        204,
      );
      const completed = await f.requestHttp(
        "POST",
        `${path}/uploads/${intent.id}/complete`,
        { bytes: data.length, sha256 },
      );
      assert.equal(completed.statusCode, 202, completed.body);
      const mediaId = completed.json().mediaId;
      await waitFor(
        async () =>
          (await f.requestHttp("GET", `${path}/media/${mediaId}`)).json(),
        (value) => value.status === "ready",
      );
      const fixedProfile = producer.profile("video", "24/1");
      const copy = await f.request(mediaId, fixedProfile);
      const rootState = () =>
        f.transaction(
          async (sql) =>
            (
              await sql.query(
                `SELECT status,issue FROM ${f.schema}.media_production_copies WHERE id=$1`,
                [copy.id],
              )
            ).rows[0],
        );
      const state = await waitFor(
        rootState,
        (value) => value.status !== "processing",
      );
      assert.equal(
        state.status,
        "ready",
        state.issue ?? "Expected actual production ready",
      );
      const context = await f.jobs.read(copy.id);
      assert.deepEqual(context.artifacts.map((a) => a.kind).sort(), [
        "audio",
        "audio_map",
        "video",
        "video_map",
      ]);
      for (const artifact of context.artifacts) {
        assert.equal(artifact.phase, "verified");
        assert.ok(artifact.storage_version_id);
        const output = join(directory, artifact.kind);
        await storage.production.download(
          artifact,
          artifact.storage_version_id!,
          output,
          t.signal,
        );
        if (artifact.kind.endsWith("_map")) {
          const map = JSON.parse(await readFile(output, "utf8"));
          assert.equal(map.sourceSha256, sha256);
          assert.equal(map.runtime.imageId, fixedProfile.imageId);
          if (artifact.kind === "video_map")
            assert.ok(map.verification.allFramePixelsMatched);
          else assert.ok(map.verification.allOutputSamplesFinite);
        }
      }
      // Normalize the document read back from the real work-draft API, using
      // only the durable copy's fixed, fully verified source maps.
      const cut = await f.ok("POST", `${f.path}/cuts`, {
        name: "真实制作归一验收",
      });
      const workPath = `${f.path}/cuts/${cut.id}/work-draft`;
      const work = await f.ok("GET", workPath);
      const document = work.document as WorkDocument;
      const videoClipId = randomUUID();
      document.timeline.tracks = [
        {
          id: randomUUID(),
          kind: "video",
          muted: false,
          items: [
            {
              id: videoClipId,
              kind: "video",
              mediaId,
              range: { inUs: 1000, outUs: 490000 },
              timelineStartUs: 0,
              gainDb: 0,
              muted: false,
              fit: "contain",
              streamSelection: "default",
            },
          ],
        },
      ];
      const saved = await f.ok(
        "PUT",
        workPath,
        { baseCutRevision: cut.revision, document },
        0,
      );
      assert.equal(saved.revision, 1);
      const snapshot = await f.ok("GET", workPath);
      assert.equal(
        snapshot.documentHash,
        createHash("sha256")
          .update(editingCanonical(snapshot.document))
          .digest("hex"),
      );
      const fact = await readNormalizationMedia({
        context,
        source: { mediaId, sha256 },
        store: storage.production,
        workDirectory: directory,
        signal: t.signal,
      });
      assert.equal(fact.video!.frameCount, 12);
      assert.deepEqual(fact.duration, { numerator: "1", denominator: "2" });
      const normalized = normalizeSavedCut({
        cutId: cut.id,
        document: snapshot.document,
        media: new Map([[mediaId, fact]]),
        changeId: () => randomUUID(),
      });
      assert.equal(normalized.lengthFrames, 10);
      assert.equal(normalized.normalizedItems[0]!.sourceInFrame, 1);
      assert.equal(normalized.normalizedItems[0]!.sourceOutFrame, 11);
      assert.equal(normalized.normalizedItems[0]!.timelineEndSample, 20000);
      assert.equal(normalized.normalizedItems[0]!.productionCopyId, copy.id);
      assert.ok(normalized.changes.some((c) => c.kind === "frame_snap"));
      const videoMap = JSON.parse(
        await readFile(join(directory, "video_map"), "utf8"),
      );
      const audioMap = JSON.parse(
        await readFile(join(directory, "audio_map"), "utf8"),
      );
      for (const altered of [
        { ...videoMap, frameCount: 13 },
        { ...videoMap, sourceSha256: "0".repeat(64) },
        {
          ...videoMap,
          runtime: { ...videoMap.runtime, platform: "unverified" },
        },
      ]) {
        assert.throws(
          () =>
            normalizationMediaFromVerifiedMaps(
              context,
              { mediaId, sha256 },
              { video: altered, audio: audioMap },
            ),
          (error: unknown) =>
            (error as { code?: string }).code ===
            "NORMALIZATION_SOURCE_MISMATCH",
        );
      }
      assert.throws(
        () =>
          normalizationMediaFromVerifiedMaps(
            context,
            { mediaId, sha256 },
            {
              video: videoMap,
              audio: { ...audioMap, zero: { ...audioMap.zero, pts: "1" } },
            },
          ),
        (error: unknown) =>
          (error as { code?: string }).code === "NORMALIZATION_SOURCE_MISMATCH",
      );
      // The arithmetic result has not been confirmed by a save command.
      assert.equal(
        (await f.ok("GET", `${f.path}/cuts/${cut.id}`)).normalizationId,
        undefined,
      );
      const hints = await f.admin.query(
        `SELECT expire_seconds FROM ${f.queueSchema}.job WHERE data->>'businessId'=$1`,
        [copy.id],
      );
      assert.equal(hints.rows[0].expire_seconds, PRODUCTION_JOB_SECONDS);
      assert.equal((await f.request(mediaId, fixedProfile)).id, copy.id);
      // A real standalone WAV exceeds a small per-job budget; explicit recovery can finish it.
      await producer.close();
      producer = await createProductionProcessor({
        pool: f.worker,
        schema: f.schema,
        originals: storage.processing,
        artifacts: storage.production,
        workDirectory: root,
        writeLimitBytes: 1024 ** 2,
      });
      const wav = Buffer.alloc(44 + 48000 * 2);
      wav.write("RIFF");
      wav.writeUInt32LE(wav.length - 8, 4);
      wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(48000, 24);
      wav.writeUInt32LE(96000, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write("data", 36);
      wav.writeUInt32LE(wav.length - 44, 40);
      for (let i = 0; i < 48000; i++)
        wav.writeInt16LE(
          Math.round(12000 * Math.sin((2 * Math.PI * 997 * i) / 48000)),
          44 + i * 2,
        );
      const audioSha = createHash("sha256").update(wav).digest("hex");
      const audioUpload = await f.requestHttp("POST", `${path}/uploads`, {
        scope: "project",
        projectId: f.project.id,
        fileName: "signal.wav",
        mime: "audio/wav",
        bytes: wav.length,
        sha256: audioSha,
      });
      assert.equal(audioUpload.statusCode, 201, audioUpload.body);
      const audioIntent = audioUpload.json(),
        audioForm = new FormData();
      for (const [key, value] of Object.entries(audioIntent.formFields))
        audioForm.append(key, String(value));
      audioForm.append("file", new Blob([new Uint8Array(wav)]), "signal.wav");
      assert.equal(
        (
          await fetch(audioIntent.uploadUrl, {
            method: "POST",
            body: audioForm,
            signal: t.signal,
          })
        ).status,
        204,
      );
      const audioComplete = await f.requestHttp(
        "POST",
        `${path}/uploads/${audioIntent.id}/complete`,
        { bytes: wav.length, sha256: audioSha },
      );
      assert.equal(audioComplete.statusCode, 202, audioComplete.body);
      const audioId = audioComplete.json().mediaId;
      await waitFor(
        async () =>
          (await f.requestHttp("GET", `${path}/media/${audioId}`)).json(),
        (value) => value.status === "ready",
      );
      const audioProfile = producer.profile("audio"),
        audioCopy = await f.request(audioId, audioProfile);
      const audioState = () =>
        f.transaction(
          async (sql) =>
            (
              await sql.query(
                `SELECT status,issue FROM ${f.schema}.media_production_copies WHERE id=$1`,
                [audioCopy.id],
              )
            ).rows[0],
        );
      assert.deepEqual(
        await waitFor(audioState, (value) => value.status !== "processing"),
        { status: "failed", issue: "MEDIA_WORKSPACE_LIMIT" },
      );
      await producer.close();
      producer = await createProductionProcessor({
        pool: f.worker,
        schema: f.schema,
        originals: storage.processing,
        artifacts: storage.production,
        workDirectory: root,
        writeLimitBytes: 16 * 1024 ** 2,
      });
      const recovered = await f.transaction((sql) =>
        requestMediaProduction(sql, {
          schema: f.schema,
          projectId: f.project.id,
          sourceMediaId: audioId,
          profile: audioProfile,
          recoverCopyId: audioCopy.id,
          schedule: f.schedule,
        }),
      );
      assert.equal(recovered.step_revision, 2);
      assert.equal(
        (await waitFor(audioState, (value) => value.status !== "processing"))
          .status,
        "ready",
      );
      const audioContext = await f.jobs.read(audioCopy.id);
      assert.deepEqual(
        audioContext.artifacts.map((artifact) => artifact.kind),
        ["audio", "audio_map"],
      );
      assert.equal(audioContext.artifacts[0]!.bytes, 48000 * 16);
      const audioFact = await readNormalizationMedia({
        context: audioContext,
        source: { mediaId: audioId, sha256: audioSha },
        store: storage.production,
        workDirectory: directory,
        signal: t.signal,
      });
      assert.deepEqual(audioFact.duration, {
        numerator: "1",
        denominator: "1",
      });
      assert.equal(audioFact.audio!.sampleCount, 48000);
      await queue.close();
      queue = undefined;
      await producer.close();
      producer = undefined;
      assert.deepEqual(await readdir(join(root, "jobs")), []);
      const resources = await f.admin.query(
        `SELECT r.* FROM ${f.schema}.media_production_resources r JOIN ${f.schema}.media_production_attempts a ON a.id=r.attempt_id WHERE a.copy_id=$1`,
        [copy.id],
      );
      assert.ok(resources.rows.some((row) => row.kind === "container"));
      assert.ok(resources.rows.every((row) => row.released));
      producer = await createProductionProcessor({
        pool: f.worker,
        schema: f.schema,
        originals: storage.processing,
        artifacts: storage.production,
        workDirectory: root,
        writeLimitBytes: 16 * 1024 ** 2,
      });
      await producer.process(
        {
          taskKind: "media_production",
          businessId: copy.id,
          stepRevision: copy.step_revision,
          epoch: copy.epoch,
        },
        { signal: t.signal, queueJobId: randomUUID() },
      );
      assert.deepEqual(
        (await f.jobs.read(copy.id)).artifacts.map((a) => a.storage_version_id),
        context.artifacts.map((a) => a.storage_version_id),
      );
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int AS n FROM ${f.schema}.media_production_attempts WHERE copy_id=$1`,
            [copy.id],
          )
        ).rows[0].n,
        1,
      );
      await assert.rejects(
        createProductionProcessor({
          pool: f.worker,
          schema: f.schema,
          originals: storage.processing,
          artifacts: storage.production,
          workDirectory: root,
        }),
        /Another production worker/,
      );
      // Lost scheduling hint: the restricted scanner reconstructs the new production step.
      const another = await f.transaction((sql) =>
        requestMediaProduction(sql, {
          schema: f.schema,
          projectId: f.project.id,
          sourceMediaId: mediaId,
          profile: producer!.profile("video", "25/1"),
          schedule: async () => {},
        }),
      );
      await repairMediaWork({
        pool: f.scheduler,
        schema: f.schema,
        schedule: f.schedule,
        includeProduction: true,
      });
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int AS n FROM ${f.queueSchema}.job WHERE data->>'businessId'=$1`,
            [another.id],
          )
        ).rows[0].n,
        1,
      );
      assert.deepEqual(errors, []);
    } finally {
      producer?.stop();
      await queue?.close();
      await producer?.close();
    }
  },
);
