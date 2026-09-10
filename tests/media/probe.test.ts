import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import {
  FFMPEG_IMAGE,
  MEDIA_LIMITS,
  fileIntegrity,
  probeMedia,
  makeDerivative,
} from "@drama/media";
import { runMediaProcess } from "../../packages/media/src/sandbox.js";

const exec = promisify(execFile);
test(
  "bounded media decode and independent previews",
  { timeout: 180_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "scenedesk-media-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const image = join(directory, "image"),
      video = join(directory, "video"),
      audio = join(directory, "audio");
    const create = (args: string[], outputFile: string) =>
      runMediaProcess(
        undefined,
        "/ffmpeg",
        ["-v", "error", "-nostdin", ...args],
        { outputFile, maxBytes: 4 * 1024 * 1024 },
      );
    await create(
      [
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=96x64",
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
      image,
    );
    await create(
      [
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=320x180:r=24:d=1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=1",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-preset",
        "ultrafast",
        "-bf",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+frag_keyframe+delay_moov+default_base_moof",
        "-f",
        "mp4",
        "pipe:1",
      ],
      video,
    );
    // A seekable WAV header records the real data size; piping WAV leaves an unknown-size header.
    const wave = Buffer.alloc(44 + 48000 * 2);
    wave.write("RIFF", 0);
    wave.writeUInt32LE(wave.length - 8, 4);
    wave.write("WAVEfmt ", 8);
    wave.writeUInt32LE(16, 16);
    wave.writeUInt16LE(1, 20);
    wave.writeUInt16LE(1, 22);
    wave.writeUInt32LE(48000, 24);
    wave.writeUInt32LE(96000, 28);
    wave.writeUInt16LE(2, 32);
    wave.writeUInt16LE(16, 34);
    wave.write("data", 36);
    wave.writeUInt32LE(96000, 40);
    for (let sample = 0; sample < 48000; sample++)
      wave.writeInt16LE(
        Math.round(12000 * Math.sin((2 * Math.PI * 880 * sample) / 48000)),
        44 + sample * 2,
      );
    await writeFile(audio, wave);
    await t.test(
      "pinned build and full decode report actual image, video and audio metadata",
      async () => {
        assert.match(
          await runMediaProcess(undefined, "/ffprobe", ["-version"]),
          /^ffprobe version 9\.0\.1\b/,
        );
        const still = await probeMedia(image, "image/png");
        assert.equal(still.kind, "image");
        assert.equal(still.width, 96);
        assert.equal(still.height, 64);
        assert.equal(still.hasAudio, false);
        assert.equal(still.durationUs, undefined);
        const movie = await probeMedia(video, "video/mp4");
        assert.equal(movie.kind, "video");
        assert.equal(movie.width, 320);
        assert.equal(movie.height, 180);
        assert.equal(movie.fpsNum, 24);
        assert.equal(movie.fpsDen, 1);
        assert.equal(movie.hasAudio, true);
        assert.ok(
          movie.durationUs! >= 1_000_000 && movie.durationUs! < 1_100_000,
        );
        assert.equal(movie.timing?.audioSampleRate, 48000);
        assert.equal(movie.timing?.frameRateMode, "unknown");
        const sound = await probeMedia(audio, "audio/wav");
        assert.equal(sound.kind, "audio");
        assert.equal(sound.durationUs, 1_000_000);
        assert.equal(sound.hasAudio, true);
        assert.equal(sound.width, undefined);
      },
    );
    await t.test(
      "poster and proxy are decoded independently while original bytes remain fixed",
      async () => {
        const before = await fileIntegrity(video);
        const movie = await probeMedia(video, "video/mp4");
        const poster = await makeDerivative(
          video,
          movie,
          "poster",
          join(directory, "poster"),
        );
        const proxy = await makeDerivative(
          video,
          movie,
          "proxy",
          join(directory, "proxy"),
        );
        assert.equal(poster.kind, "image");
        assert.equal(poster.mime, "image/jpeg");
        assert.equal(poster.profileRevision, 1);
        assert.equal(proxy.kind, "video");
        assert.equal(proxy.mime, "video/mp4");
        assert.equal(proxy.hasAudio, true);
        assert.ok(Math.abs(proxy.durationUs! - movie.durationUs!) < 42_000);
        assert.equal(proxy.timing?.startPts, "0");
        assert.notEqual(proxy.sha256, before.sha256);
        assert.deepEqual(await fileIntegrity(video), before);
        const soundProxy = await makeDerivative(
          audio,
          await probeMedia(audio, "audio/wav"),
          "proxy",
          join(directory, "sound-proxy"),
        );
        assert.equal(soundProxy.kind, "audio");
        assert.equal(soundProxy.mime, "audio/mp4");
        await assert.rejects(
          makeDerivative(
            audio,
            await probeMedia(audio, "audio/wav"),
            "poster",
            join(directory, "no-poster"),
          ),
          { code: "DERIVATIVE_NOT_SUPPORTED" },
        );
        assert.equal((await probeMedia(audio, "audio/wav")).kind, "audio");
      },
    );
    await t.test(
      "type spoofing, damaged files and oversized dimensions cannot become ready",
      async () => {
        await assert.rejects(probeMedia(image, "video/mp4"), {
          code: "FILE_SIGNATURE_MISMATCH",
        });
        const bad = join(directory, "damaged");
        const original = await readFile(image);
        await writeFile(bad, original.subarray(0, 40));
        await assert.rejects(probeMedia(bad, "image/png"), {
          code: "MEDIA_DECODE_FAILED",
        });
        const large = join(directory, "wide");
        await create(
          [
            "-f",
            "lavfi",
            "-i",
            "color=s=9000x2",
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
          large,
        );
        await assert.rejects(probeMedia(large, "image/png"), {
          code: "MEDIA_DIMENSIONS_REJECTED",
        });
      },
    );
    await t.test(
      "documents require bounded UTF-8 and remain separate from rendered media",
      async () => {
        const text = join(directory, "script");
        await writeFile(text, "女主：钥匙在哪里？\n");
        assert.equal((await probeMedia(text, "text/plain")).kind, "document");
        await writeFile(text, Buffer.from([0xff, 0xfe]));
        await assert.rejects(probeMedia(text, "text/plain"), {
          code: "DOCUMENT_ENCODING_REJECTED",
        });
        await writeFile(text, "abc\0def");
        await assert.rejects(probeMedia(text, "text/plain"), {
          code: "DOCUMENT_CONTENT_REJECTED",
        });
        await writeFile(
          text,
          "1\n00:00:00,000 --> 00:00:01,000\n钥匙在哪里？\n",
        );
        assert.equal(
          (await probeMedia(text, "application/x-subrip")).kind,
          "document",
        );
        await assert.rejects(
          makeDerivative(
            text,
            await probeMedia(text, "text/plain"),
            "proxy",
            join(directory, "no-document-proxy"),
          ),
          { code: "DERIVATIVE_NOT_SUPPORTED" },
        );
      },
    );
    await t.test(
      "untrusted playlist cannot cause a network request",
      async () => {
        let requests = 0;
        const server = createServer((_request, response) => {
          requests++;
          response.end("private");
        });
        await new Promise<void>((resolve) =>
          server.listen(0, "0.0.0.0", resolve),
        );
        try {
          const address = server.address();
          assert.ok(address && typeof address === "object");
          const playlist = join(directory, "remote-playlist");
          await writeFile(
            playlist,
            `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://host.docker.internal:${address.port}/secret\n#EXT-X-ENDLIST\n`,
          );
          await assert.rejects(probeMedia(playlist, "video/mp4"), {
            code: "FILE_SIGNATURE_MISMATCH",
          });
          await assert.rejects(
            runMediaProcess(playlist, "/ffprobe", [
              "-v",
              "error",
              "-protocol_whitelist",
              "file,pipe",
              "-i",
              "/input",
            ]),
            { code: "MEDIA_DECODE_FAILED" },
          );
          assert.equal(requests, 0);
        } finally {
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
      },
    );
    await t.test(
      "timeout kills the container with enforced resource limits and no writable host paths",
      async () => {
        const controller = new AbortController();
        let containerName = "";
        let created!: () => void;
        const ready = new Promise<void>((resolve) => {
          created = resolve;
        });
        const running = runMediaProcess(
          image,
          "/ffmpeg",
          [
            "-v",
            "error",
            "-nostdin",
            "-re",
            "-f",
            "lavfi",
            "-i",
            "color=s=32x32:r=1",
            "-f",
            "null",
            "-",
          ],
          {
            signal: controller.signal,
            timeoutMs: 5000,
            onCreated: (name) => {
              containerName = name;
              created();
            },
          },
        );
        // Attach rejection handling immediately; inspect the live, bounded job before cancellation.
        const outcome = running.then(
          () => undefined,
          (error: unknown) => error,
        );
        // Creation has its own bounded deadline. Wait for that actual event,
        // not an unrelated three-second polling budget on a busy Docker host.
        await Promise.race([
          ready,
          outcome.then((error) => {
            throw error ?? new Error("Media process ended before inspection");
          }),
        ]);
        const info = JSON.parse(
          (await exec("docker", ["inspect", containerName])).stdout,
        )[0];
        assert.equal(info.Config.Image, FFMPEG_IMAGE);
        assert.equal(info.Config.User, "65532:65532");
        assert.equal(info.HostConfig.NetworkMode, "none");
        assert.equal(info.HostConfig.ReadonlyRootfs, true);
        assert.equal(info.HostConfig.Memory, MEDIA_LIMITS.processMemoryBytes);
        assert.equal(
          info.HostConfig.MemorySwap,
          MEDIA_LIMITS.processMemoryBytes,
        );
        assert.equal(info.HostConfig.NanoCpus, 2e9);
        assert.equal(info.HostConfig.PidsLimit, 64);
        assert.deepEqual(info.HostConfig.CapDrop, ["ALL"]);
        assert.ok(info.HostConfig.SecurityOpt.includes("no-new-privileges"));
        assert.ok(
          info.Mounts.every(
            (mount: { RW: boolean; Destination: string }) =>
              !mount.RW && mount.Destination === "/input",
          ),
        );
        controller.abort();
        assert.equal(
          ((await outcome) as { code: string }).code,
          "MEDIA_CANCELLED",
        );
        assert.equal(
          (
            await exec("docker", [
              "ps",
              "--all",
              "--filter",
              `name=${containerName}`,
              "--format",
              "{{.ID}}",
            ])
          ).stdout.trim(),
          "",
        );
        let timedContainer = "";
        await assert.rejects(
          runMediaProcess(
            undefined,
            "/ffmpeg",
            [
              "-v",
              "error",
              "-nostdin",
              "-re",
              "-f",
              "lavfi",
              "-i",
              "color=s=32x32:r=1",
              "-f",
              "null",
              "-",
            ],
            {
              timeoutMs: 500,
              onCreated: (name) => {
                timedContainer = name;
              },
            },
          ),
          { code: "MEDIA_TIMEOUT" },
        );
        assert.equal(
          (
            await exec("docker", [
              "ps",
              "--all",
              "--filter",
              `name=${timedContainer}`,
              "--format",
              "{{.ID}}",
            ])
          ).stdout.trim(),
          "",
        );
      },
    );
    await t.test(
      "output cap aborts decoding and removes incomplete worker output",
      async () => {
        const output = join(directory, "too-large");
        await assert.rejects(
          runMediaProcess(
            video,
            "/ffmpeg",
            [
              "-v",
              "error",
              "-nostdin",
              "-i",
              "/input",
              "-map",
              "0:v:0",
              "-f",
              "rawvideo",
              "pipe:1",
            ],
            { outputFile: output, maxBytes: 10 },
          ),
          { code: "MEDIA_OUTPUT_LIMIT" },
        );
        await assert.rejects(readFile(output), { code: "ENOENT" });
        assert.equal((await probeMedia(video, "video/mp4")).kind, "video");
      },
    );
  },
);
