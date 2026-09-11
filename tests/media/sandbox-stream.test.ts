import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PassThrough, Readable, Writable } from "node:stream";
import { runMediaProcess } from "../../packages/media/src/sandbox.js";

const exec = promisify(execFile);
const args = [
  "-v",
  "error",
  "-nostdin",
  "-threads",
  "2",
  "-f",
  "u8",
  "-ar",
  "8000",
  "-ac",
  "1",
  "-i",
  "pipe:0",
  "-c:a",
  "pcm_u8",
  "-f",
  "u8",
  "pipe:1",
];
test(
  "sandbox stream input and output stay bounded and clean up on every termination",
  { timeout: 240_000 },
  async (t) => {
    const names: string[] = [];
    t.after(async () => {
      const listing = await exec(
        "docker",
        [
          "ps",
          "-a",
          "--filter",
          "name=scenedesk-media-",
          "--format",
          "{{.Names}}",
        ],
        { timeout: 15_000 },
      );
      const remaining = listing.stdout
        .trim()
        .split("\n")
        .filter((name) => names.includes(name));
      if (remaining.length)
        await exec("docker", ["rm", "--force", ...remaining], {
          timeout: 15_000,
        });
      assert.deepEqual(
        remaining,
        [],
        "Completed stream work must remove its containers",
      );
    });
    const onCreated = (name: string) => {
      names.push(name);
    };
    await t.test(
      "binary samples survive stdin, stdout and backpressure",
      async () => {
        const source = Buffer.from(
          Array.from({ length: 32768 }, (_, i) => i % 256),
        );
        const output: Buffer[] = [];
        await runMediaProcess(undefined, "/ffmpeg", args, {
          inputStream: Readable.from([source], { objectMode: false }),
          maxInputBytes: source.length,
          outputStream: new Writable({
            highWaterMark: 1024,
            write(chunk: Buffer, _encoding, done) {
              output.push(Buffer.from(chunk));
              setTimeout(done, 2);
            },
          }),
          maxBytes: source.length,
          onCreated,
        });
        assert.deepEqual(Buffer.concat(output), source);
      },
    );
    await t.test(
      "an over-limit producer cannot keep an encoder alive",
      async () => {
        await assert.rejects(
          runMediaProcess(undefined, "/ffmpeg", args, {
            inputStream: Readable.from([Buffer.alloc(32)]),
            maxInputBytes: 16,
            onCreated,
          }),
          { code: "MEDIA_INPUT_LIMIT" },
        );
      },
    );
    await t.test(
      "timeout releases an input that never reaches EOF",
      async () => {
        const input = new PassThrough();
        await assert.rejects(
          runMediaProcess(undefined, "/ffmpeg", args, {
            inputStream: input,
            maxInputBytes: 32768,
            timeoutMs: 300,
            onCreated,
          }),
          { code: "MEDIA_TIMEOUT" },
        );
        assert.equal(input.destroyed, true);
      },
    );
    await t.test(
      "a stalled output cannot prevent cancellation after the decoder exits",
      async () => {
        const controller = new AbortController();
        let written!: () => void,
          name = "";
        const firstWrite = new Promise<void>((resolve) => {
          written = resolve;
        });
        const output = new Writable({
          write() {
            written();
          },
        });
        const running = runMediaProcess(undefined, "/ffmpeg", args, {
          inputStream: Readable.from([Buffer.alloc(32768)]),
          maxInputBytes: 32768,
          outputStream: output,
          timeoutMs: 180_000,
          signal: controller.signal,
          onCreated(value) {
            name = value;
            onCreated(value);
          },
        });
        void running.catch(written);
        const checks = await Promise.allSettled([
          assert.rejects(running, { code: "MEDIA_CANCELLED" }),
          (async () => {
            try {
              await firstWrite;
              // Prove cancellation works while only the host sink remains unfinished.
              const stopped = await exec("docker", ["wait", name], {
                timeout: 30_000,
              });
              assert.equal(stopped.stdout.trim(), "0");
            } finally {
              controller.abort();
            }
          })(),
        ]);
        for (const check of checks)
          if (check.status === "rejected") throw check.reason;
        assert.equal(output.destroyed, true);
      },
    );
    await t.test(
      "input exceptions and output limits remove the container",
      async () => {
        const error = new Error("producer stopped");
        const inputStream = Readable.from(
          (async function* () {
            yield Buffer.alloc(16);
            throw error;
          })(),
        );
        await assert.rejects(
          runMediaProcess(undefined, "/ffmpeg", args, {
            inputStream,
            maxInputBytes: 32,
            onCreated,
          }),
          error,
        );
        await assert.rejects(
          runMediaProcess(undefined, "/ffmpeg", args, {
            inputStream: Readable.from([Buffer.alloc(32768)]),
            maxInputBytes: 32768,
            maxBytes: 16,
            onCreated,
          }),
          { code: "MEDIA_OUTPUT_LIMIT" },
        );
      },
    );
  },
);
