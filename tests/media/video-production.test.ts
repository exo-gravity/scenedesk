import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { watch } from "node:fs";
import { join } from "node:path";
import { runMediaProcess } from "../../packages/media/src/sandbox.js";
import {
  makeVideoProduction,
  VIDEO_PRODUCTION_RATES,
} from "../../packages/media/src/video-production.js";
import { readVideoTiming } from "../../packages/media/src/source-timing.js";
import { fileIntegrity, probeMedia } from "@drama/media";

test(
  "actual video production follows the source map without proxy quality loss",
  { timeout: 720_000 },
  async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), "scenedesk-production-test-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const create = (file: string, filter: string, extra: string[] = []) =>
      runMediaProcess(
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
          "color=black:size=64x48:rate=24:duration=0.5",
          "-vf",
          filter,
          "-c:v",
          "ffv1",
          "-level",
          "3",
          "-threads",
          "2",
          "-fps_mode",
          "passthrough",
          "-enc_time_base",
          "1:24",
          ...extra,
          "-f",
          "nut",
          "pipe:1",
        ],
        { outputFile: file, maxBytes: 4 * 1024 * 1024, signal: t.signal },
      );
    const raw = async (file: string, format: string, label: string) => {
      const outputFile = join(directory, label);
      await runMediaProcess(
        file,
        "/ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-threads",
          "2",
          "-i",
          "/input",
          "-map",
          "0:v:0",
          "-an",
          "-pix_fmt",
          format,
          "-fps_mode",
          "passthrough",
          "-f",
          "rawvideo",
          "pipe:1",
        ],
        { outputFile, maxBytes: 4 * 1024 * 1024, signal: t.signal },
      );
      return readFile(outputFile);
    };
    const source = join(directory, "vfr.nut");
    await create(
      source,
      "geq=lum='16+N*10':cb=128:cr=128,select='eq(n,0)+eq(n,2)+eq(n,3)+eq(n,8)+eq(n,11)',setpts=PTS+5/TB",
    );
    const original = await fileIntegrity(source);
    let ntscOriginal:
      Awaited<ReturnType<typeof makeVideoProduction>> | undefined;
    await t.test(
      "nonzero PTS, VFR long frames, exact joints, skipped frames and fractional tails",
      async () => {
        for (const [rate, expected] of [
          [
            { numerator: 24, denominator: 1 },
            [0, 0, 2, 3, 3, 3, 3, 3, 8, 8, 8, 11],
          ],
          [
            { numerator: 30000, denominator: 1001 },
            [0, 0, 0, 2, 3, 3, 3, 3, 3, 3, 8, 8, 8, 8],
          ],
        ] as const) {
          const result = await makeVideoProduction(
            source,
            rate,
            directory,
            t.signal,
          );
          if (rate.numerator === 30000) ntscOriginal = result;
          assert.equal(result.manifest.frameCount, expected.length);
          assert.equal(result.manifest.startPts, "245760");
          assert.equal(result.manifest.sourceSha256, original.sha256);
          assert.equal(result.manifest.verification.firstPts, "0");
          assert.equal(
            result.manifest.verification.allFramePixelsMatched,
            true,
          );
          const bytes = await raw(
            result.video.file,
            "yuv420p",
            `raw-${rate.numerator}`,
          );
          const size = (64 * 48 * 3) / 2;
          assert.equal(bytes.length, size * expected.length);
          for (const [index, n] of expected.entries()) {
            // The source signal encodes its original frame number in every luma pixel.
            assert.ok(
              bytes
                .subarray(index * size, index * size + 64 * 48)
                .every((v) => v === 16 + n * 10),
            );
          }
          const persisted = JSON.parse(
            await readFile(result.sourceMap.file, "utf8"),
          );
          assert.deepEqual(persisted.spans, result.manifest.spans);
          assert.ok(
            persisted.spans.every((span: { decodedSha256: string }) =>
              /^[a-f0-9]{64}$/.test(span.decodedSha256),
            ),
          );
          assert.deepEqual(await fileIntegrity(source), original);
        }
      },
    );
    await t.test(
      "all declared rates produce exact rational PTS and repeatable artifacts",
      async () => {
        for (const value of VIDEO_PRODUCTION_RATES.filter(
          (value) => value !== "24/1",
        )) {
          const [numerator, denominator] = value.split("/").map(Number);
          const result = await makeVideoProduction(
            source,
            { numerator: numerator!, denominator: denominator! },
            directory,
            t.signal,
          );
          const actual = await readVideoTiming(result.video.file, t.signal);
          assert.equal(
            result.manifest.frameCount,
            Math.floor(numerator! / (2 * denominator!)),
          );
          for (const [index, frame] of actual.frames.entries()) {
            assert.equal(
              BigInt(frame.pts) *
                BigInt(actual.timeBase.numerator) *
                BigInt(numerator!),
              BigInt(index) *
                BigInt(denominator!) *
                BigInt(actual.timeBase.denominator),
            );
          }
          if (ntscOriginal && value === "30000/1001") {
            assert.equal(result.video.sha256, ntscOriginal.video.sha256);
            assert.equal(
              result.sourceMap.sha256,
              ntscOriginal.sourceMap.sha256,
            );
          }
        }
      },
    );
    await t.test(
      "accepted H.264 with B-frame reordering retains every decoded pixel",
      async () => {
        const file = join(directory, "h264.mp4");
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
            "testsrc2=size=64x48:rate=24:duration=0.5",
            "-c:v",
            "libx264",
            "-threads",
            "2",
            "-bf",
            "3",
            "-crf",
            "18",
            "-movflags",
            "+frag_keyframe+delay_moov+default_base_moof",
            "-f",
            "mp4",
            "pipe:1",
          ],
          { outputFile: file, maxBytes: 4 * 1024 * 1024, signal: t.signal },
        );
        assert.equal(
          (await probeMedia(file, "video/mp4", t.signal)).kind,
          "video",
        );
        const pictureTypes = await runMediaProcess(
          file,
          "/ffprobe",
          [
            "-v",
            "error",
            "-show_entries",
            "frame=pict_type",
            "-of",
            "csv=p=0",
            "/input",
          ],
          { signal: t.signal },
        );
        assert.match(pictureTypes, /\bB\b/);
        const result = await makeVideoProduction(
          file,
          { numerator: 24, denominator: 1 },
          directory,
          t.signal,
        );
        assert.equal(result.manifest.frameCount, 12);
        assert.deepEqual(
          await raw(result.video.file, "yuv420p", "h264-copy.raw"),
          await raw(file, "yuv420p", "h264-source.raw"),
        );
      },
    );
    await t.test(
      "10-bit samples, HDR color tags and sample aspect ratio retain their original precision",
      async () => {
        const file = join(directory, "ten-bit.mp4");
        // NUT does not persist these color tags. The source must carry real VUI
        // metadata before its interpretation can be retained in the source map.
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
            "color=black:size=64x48:rate=24:duration=0.5",
            "-vf",
            "format=yuv420p10le,geq=lum='300+N*13':cb=513:cr=517,setparams=range=tv:colorspace=bt2020nc:color_primaries=bt2020:color_trc=smpte2084,setsar=4/3",
            "-c:v",
            "libx265",
            "-threads",
            "2",
            "-pix_fmt",
            "yuv420p10le",
            "-x265-params",
            "lossless=1:log-level=error:pools=2:frame-threads=1",
            "-color_primaries",
            "bt2020",
            "-color_trc",
            "smpte2084",
            "-colorspace",
            "bt2020nc",
            "-color_range",
            "tv",
            "-movflags",
            "+frag_keyframe+delay_moov+default_base_moof",
            "-f",
            "mp4",
            "pipe:1",
          ],
          { outputFile: file, maxBytes: 4 * 1024 * 1024, signal: t.signal },
        );
        const result = await makeVideoProduction(
          file,
          { numerator: 24, denominator: 1 },
          directory,
          t.signal,
        );
        assert.equal(result.manifest.pixelFormat, "yuv420p10le");
        assert.equal(result.manifest.sourceFormat.sampleAspectRatio, "4:3");
        assert.deepEqual(result.manifest.sourceFormat.color, {
          range: "tv",
          space: "bt2020nc",
          transfer: "smpte2084",
          primaries: "bt2020",
        });
        const bytes = await raw(
          result.video.file,
          "yuv420p10le",
          "ten-bit.raw",
        );
        const size = 64 * 48 * 3;
        assert.equal(bytes.length, size * 12);
        for (let frame = 0; frame < 12; frame++) {
          assert.equal(bytes.readUInt16LE(size * frame), 300 + frame * 13);
          assert.equal(bytes.readUInt16LE(size * frame + 64 * 48 * 2), 513);
          assert.equal(
            bytes.readUInt16LE(size * frame + (64 * 48 * 5) / 2),
            517,
          );
        }
      },
    );
    await t.test(
      "unaccepted profiles and cancelled work leave no partial production artifacts",
      async () => {
        const before = await readdir(directory);
        await assert.rejects(
          makeVideoProduction(
            source,
            { numerator: 60, denominator: 1 },
            directory,
          ),
          { code: "MEDIA_PROFILE_UNSUPPORTED" },
        );
        await assert.rejects(
          makeVideoProduction(
            source,
            { numerator: 24, denominator: 1 },
            directory,
            AbortSignal.abort(),
          ),
        );
        assert.deepEqual(await readdir(directory), before);
        const controller = new AbortController();
        let observed = false;
        const watcher = watch(directory, (_event, name) => {
          if (name?.startsWith("video-production-")) {
            observed = true;
            controller.abort();
          }
        });
        try {
          await assert.rejects(
            makeVideoProduction(
              source,
              { numerator: 24, denominator: 1 },
              directory,
              AbortSignal.any([controller.signal, t.signal]),
            ),
          );
          assert.equal(observed, true);
          assert.deepEqual(await readdir(directory), before);
        } finally {
          watcher.close();
        }
      },
    );
  },
);
