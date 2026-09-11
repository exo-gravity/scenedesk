import assert from "node:assert/strict";
import test from "node:test";
import { watch } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeAudioProduction } from "../../packages/media/src/audio-production.js";
import { readAudioTiming } from "../../packages/media/src/audio-timing.js";
import { readVideoTiming } from "../../packages/media/src/source-timing.js";
import { runMediaProcess } from "../../packages/media/src/sandbox.js";
import { fileIntegrity, probeMedia } from "@drama/media";
import { MediaFailure } from "../../packages/media/src/policy.js";

test(
  "accepted PCM WAV keeps signed source samples through the production API",
  { timeout: 180_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "scenedesk-audio-wave-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, "source.wav");
    const samples = [0, 16384, -8192];
    const bytes = Buffer.alloc(44 + 480 * 2);
    bytes.write("RIFF");
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(48000, 24);
    bytes.writeUInt32LE(96000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36);
    bytes.writeUInt32LE(960, 40);
    for (let i = 0; i < 480; i++)
      bytes.writeInt16LE(samples[i % 3]!, 44 + i * 2);
    await writeFile(file, bytes);
    assert.equal((await probeMedia(file, "audio/wav")).kind, "audio");
    const result = (await makeAudioProduction(
      file,
      directory,
      undefined,
      t.signal,
    ))!;
    assert.equal(result.manifest.outputSamples, 480);
    assert.equal(result.manifest.normalizationVersion, "normalization-v1");
    const actual = await readFile(result.audio.file);
    assert.equal(actual.length, 480 * 16);
    for (let i = 0; i < 480; i++) {
      assert.equal(actual.readDoubleLE(i * 16), samples[i % 3]! / 32768);
      assert.equal(actual.readDoubleLE(i * 16 + 8), samples[i % 3]! / 32768);
    }
  },
);

test(
  "actual audio production retains signal, decoded presentation intervals and fixed sample positions",
  { timeout: 720_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "scenedesk-audio-test-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const create = async (
      name: string,
      signal: string,
      filter: string,
      codec = "pcm_f64le",
      format = "nut",
      extra: string[] = [],
    ) => {
      const file = join(directory, name);
      await runMediaProcess(
        undefined,
        "/ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-filter_threads",
          "2",
          "-f",
          "lavfi",
          "-i",
          signal,
          "-af",
          filter,
          "-c:a",
          codec,
          "-threads",
          "2",
          ...extra,
          "-f",
          format,
          "pipe:1",
        ],
        { outputFile: file, maxBytes: 4 * 1024 * 1024, signal: t.signal },
      );
      return file;
    };
    const mono = await create(
      "mono.mka",
      "aevalsrc=0.25:s=48000:d=0.1",
      "asetnsamples=n=1024:p=0,asetpts=PTS+5/TB",
      "pcm_f64le",
      "matroska",
    );
    const original = await fileIntegrity(mono);
    await t.test(
      "millisecond PTS do not manufacture gaps; mono is duplicated exactly",
      async () => {
        const result = (await makeAudioProduction(
          mono,
          directory,
          undefined,
          t.signal,
        ))!;
        assert.deepEqual(
          result.manifest.frames.map((f) => f.pts),
          ["5000", "5021", "5043", "5064", "5085"],
        );
        assert.equal(result.manifest.outputSamples, 4800);
        assert.equal(result.manifest.segments.length, 1);
        assert.deepEqual(result.manifest.silence, []);
        const bytes = await readFile(result.audio.file);
        assert.equal(bytes.length, 4800 * 16);
        for (let i = 0; i < bytes.length; i += 8)
          assert.equal(bytes.readDoubleLE(i), 0.25);
        assert.ok(
          result.manifest.frames.every((f) =>
            /^[a-f0-9]{64}$/.test(f.decodedSha256),
          ),
        );
        const persisted = JSON.parse(
          await readFile(result.sourceMap.file, "utf8"),
        );
        assert.deepEqual(persisted.segments, result.manifest.segments);
        assert.equal(persisted.sourceSha256, original.sha256);
        assert.match(persisted.runtime.platform, /^linux\/(amd64|arm64)$/);
        assert.match(persisted.runtime.imageId, /^sha256:[a-f0-9]{64}$/);
        const repeated = (await makeAudioProduction(
          mono,
          directory,
          undefined,
          t.signal,
        ))!;
        assert.equal(repeated.audio.sha256, result.audio.sha256);
        assert.equal(repeated.sourceMap.sha256, result.sourceMap.sha256);
      },
    );
    await t.test(
      "actual video t0 preserves delayed embedded audio",
      async () => {
        const source = join(directory, "embedded.nut");
        await runMediaProcess(
          undefined,
          "/ffmpeg",
          [
            "-v",
            "error",
            "-nostdin",
            "-filter_threads",
            "2",
            "-filter_complex_threads",
            "2",
            "-f",
            "lavfi",
            "-i",
            "color=black:size=64x48:rate=24:duration=0.125",
            "-f",
            "lavfi",
            "-i",
            "aevalsrc=0.25:s=48000:d=0.1",
            "-vf",
            "setpts=PTS+5/TB",
            "-af",
            "asetpts=PTS+5.025/TB",
            "-c:v",
            "ffv1",
            "-threads",
            "2",
            "-fps_mode",
            "passthrough",
            "-c:a",
            "pcm_f64le",
            "-f",
            "nut",
            "pipe:1",
          ],
          { outputFile: source, maxBytes: 4 * 1024 * 1024, signal: t.signal },
        );
        const video = await readVideoTiming(source, t.signal);
        const result = (await makeAudioProduction(
          source,
          directory,
          { pts: video.frames[0]!.pts, timeBase: video.timeBase },
          t.signal,
        ))!;
        assert.equal(result.manifest.outputSamples, 6000);
        assert.deepEqual(result.manifest.silence, [
          { startSample: 0, endSample: 1200 },
        ]);
        const bytes = await readFile(result.audio.file);
        assert.ok(bytes.subarray(0, 1200 * 16).every((v) => v === 0));
        for (let i = 1200 * 16; i < bytes.length; i += 8)
          assert.equal(bytes.readDoubleLE(i), 0.25);
      },
    );
    await t.test(
      "internal gaps and fractional negative offsets are explicit, stereo channels stay distinct",
      async () => {
        const gap = await create(
          "gap.nut",
          "aevalsrc=0.25|-0.125:s=48000:d=0.1",
          "asetnsamples=n=1024:p=0,aselect=not(eq(n\\,2)),asetpts=PTS+5/TB",
        );
        const result = (await makeAudioProduction(
          gap,
          directory,
          {
            pts: "5000009",
            timeBase: { numerator: 1, denominator: 1_000_000 },
          },
          t.signal,
        ))!;
        assert.equal(result.manifest.outputSamples, 4800);
        assert.deepEqual(result.manifest.silence, [
          { startSample: 0, endSample: 1 },
          { startSample: 2048, endSample: 3072 },
        ]);
        assert.equal(result.manifest.segments[0]!.croppedLeadingSamples, 1);
        const bytes = await readFile(result.audio.file);
        for (let i = 0; i < 4800; i++) {
          const silent = i === 0 || (i >= 2048 && i < 3072);
          assert.equal(bytes.readDoubleLE(i * 16), silent ? 0 : 0.25);
          assert.equal(bytes.readDoubleLE(i * 16 + 8), silent ? 0 : -0.125);
        }
        const beforeZero = (await makeAudioProduction(
          gap,
          directory,
          { pts: "6", timeBase: { numerator: 1, denominator: 1 } },
          t.signal,
        ))!;
        assert.equal(beforeZero.audio.bytes, 0);
        assert.equal(beforeZero.manifest.outputSamples, 0);
      },
    );
    await t.test(
      "44.1 kHz resampling matches a known 997 Hz signal at the actual 48 kHz positions",
      async () => {
        const source = await create(
          "resample.nut",
          "aevalsrc=0.25*sin(2*PI*997*t):s=44100:d=0.1",
          "anull",
        );
        const result = (await makeAudioProduction(
          source,
          directory,
          undefined,
          t.signal,
        ))!;
        assert.equal(result.manifest.outputSamples, 4800);
        const bytes = await readFile(result.audio.file);
        assert.equal(bytes.length, 4800 * 16);
        let maxError = 0;
        for (let i = 100; i < 4700; i++) {
          const left = bytes.readDoubleLE(i * 16),
            right = bytes.readDoubleLE(i * 16 + 8);
          assert.equal(left, right);
          maxError = Math.max(
            maxError,
            Math.abs(left - 0.25 * Math.sin((2 * Math.PI * 997 * i) / 48000)),
          );
        }
        assert.ok(
          maxError < 0.0001,
          `maximum interior signal error: ${maxError}`,
        );
      },
    );
    await t.test(
      "AAC decoder tail beyond declared presentation is discarded; unknown leading delay is never guessed",
      async () => {
        const source = await create(
          "aac.mp4",
          "aevalsrc=0.25*sin(2*PI*997*t):s=44100:d=0.1",
          "anull",
          "aac",
          "mp4",
          ["-movflags", "frag_keyframe+empty_moov"],
        );
        const timing = (await readAudioTiming(source, t.signal))!;
        assert.equal(timing.frames.at(-1)!.samples, 1024);
        assert.equal(timing.frames.at(-1)!.durationPts, "314");
        const result = (await makeAudioProduction(
          source,
          directory,
          undefined,
          t.signal,
        ))!;
        assert.equal(result.manifest.decodedSamples, 6144);
        assert.equal(result.manifest.discardedTailSamples, 710);
        assert.equal(result.manifest.segments[0]!.sourceSamples, 5434);
        assert.equal(result.manifest.segments[0]!.croppedLeadingSamples, 0);
        assert.equal(result.manifest.outputSamples, 5915);
        assert.equal((await readFile(result.audio.file)).length, 5915 * 16);
      },
    );
    await t.test(
      "a one-sample source retains its presentation interval despite resampler filter latency",
      async () => {
        for (const rate of [8000, 44100, 48000, 192000]) {
          const source = await create(
            `one-${rate}.nut`,
            `aevalsrc=0.25:s=${rate}:d=0.01`,
            "atrim=end_sample=1",
          );
          const result = (await makeAudioProduction(
            source,
            directory,
            undefined,
            t.signal,
          ))!;
          const expected = { 8000: 6, 44100: 2, 48000: 1, 192000: 1 }[rate]!;
          assert.equal(result.manifest.decodedSamples, 1);
          assert.equal(result.manifest.outputSamples, expected);
          assert.equal(result.audio.bytes, expected * 16);
          const bytes = await readFile(result.audio.file);
          for (let i = 0; i < expected; i++) {
            assert.ok(Number.isFinite(bytes.readDoubleLE(i * 16)));
            assert.equal(
              bytes.readDoubleLE(i * 16),
              bytes.readDoubleLE(i * 16 + 8),
            );
          }
          if (rate === 48000) assert.equal(bytes.readDoubleLE(0), 0.25);
        }
      },
    );
    await t.test(
      "Opus decoder skip and discard metadata produce only effective samples",
      async () => {
        const source = await create(
          "opus.ogg",
          "aevalsrc=0.25*sin(2*PI*997*t):s=48000:d=0.1",
          "anull",
          "libopus",
          "ogg",
        );
        const result = (await makeAudioProduction(
          source,
          directory,
          undefined,
          t.signal,
        ))!;
        assert.equal(result.manifest.frames[0]!.pts, "0");
        assert.equal(result.manifest.frames[0]!.samples, 648);
        assert.equal(result.manifest.decodedSamples, 4800);
        assert.equal(result.manifest.discardedTailSamples, 0);
        assert.equal(result.manifest.outputSamples, 4800);
        assert.equal(result.audio.bytes, 4800 * 16);
      },
    );
    await t.test(
      "multichannel, non-finite samples and cancellation fail without partial production directories",
      async () => {
        const multichannel = await create(
          "four.nut",
          "aevalsrc=0.1|0.2|0.3|0.4:s=48000:d=0.01",
          "anull",
        );
        await assert.rejects(
          makeAudioProduction(multichannel, directory, undefined, t.signal),
          { code: "MEDIA_AUDIO_CHANNELS_UNSUPPORTED" },
        );
        const nan = await create(
          "nan.nut",
          "aevalsrc=nan:s=48000:d=0.01",
          "anull",
        );
        const before = (await readdir(directory))
          .filter((name) => name.startsWith("audio-production-"))
          .sort();
        await assert.rejects(
          makeAudioProduction(nan, directory, undefined, t.signal),
          { code: "MEDIA_AUDIO_SAMPLE_INVALID" },
        );
        const controller = new AbortController();
        const observer = watch(directory, (_event, name) => {
          if (name?.startsWith("audio-production-") && !before.includes(name))
            controller.abort();
        });
        try {
          await assert.rejects(
            makeAudioProduction(
              mono,
              directory,
              undefined,
              AbortSignal.any([controller.signal, t.signal]),
            ),
          );
          assert.equal(controller.signal.aborted, true);
        } finally {
          observer.close();
        }
        assert.deepEqual(
          (await readdir(directory))
            .filter((name) => name.startsWith("audio-production-"))
            .sort(),
          before,
        );
        assert.deepEqual(await fileIntegrity(mono), original);
      },
    );
    await t.test(
      "an undecodable midstream sample rate change is rejected rather than silently resampled",
      async () => {
        const a = await create(
          "rate-a.aac",
          "aevalsrc=0.25:s=44100:d=0.1",
          "anull",
          "aac",
          "adts",
        );
        const b = await create(
          "rate-b.aac",
          "aevalsrc=0.25:s=48000:d=0.1",
          "anull",
          "aac",
          "adts",
        );
        const mixed = join(directory, "changed.aac");
        await writeFile(
          mixed,
          Buffer.concat([await readFile(a), await readFile(b)]),
        );
        await assert.rejects(
          makeAudioProduction(mixed, directory, undefined, t.signal),
          (error: unknown) =>
            error instanceof MediaFailure &&
            [
              "MEDIA_AUDIO_TIMING_INVALID",
              "MEDIA_FORMAT_CHANGE",
              "MEDIA_DECODE_FAILED",
            ].includes(error.code),
        );
      },
    );
  },
);
