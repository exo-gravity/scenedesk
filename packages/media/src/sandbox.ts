import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, lstat, realpath, rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { FFMPEG_IMAGE, MEDIA_LIMITS, MediaFailure } from "./policy.js";

type Execution = {
  signal?: AbortSignal;
  timeoutMs?: number;
  outputFile?: string;
  maxBytes?: number;
  onCreated?: (containerName: string) => void;
};

function docker(args: string[], options: Execution = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const maxBytes = options.maxBytes ?? MEDIA_LIMITS.processOutputBytes;
    const output: Buffer[] = [];
    let bytes = 0,
      errorBytes = 0,
      failure: Error | undefined,
      created = false;
    const fail = (error: Error) => {
      failure ??= error;
      process.kill("SIGKILL");
    };
    const abort = () =>
      fail(new MediaFailure("MEDIA_CANCELLED", "媒体处理已取消。"));
    const timer = setTimeout(
      () => fail(new MediaFailure("MEDIA_TIMEOUT", "媒体处理超过时限。")),
      options.timeoutMs ?? MEDIA_LIMITS.processMilliseconds,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes)
          return callback(
            new MediaFailure("MEDIA_OUTPUT_LIMIT", "媒体处理输出超过限额。"),
          );
        callback(null, chunk);
      },
    });
    let finished: Promise<void> = Promise.resolve();
    if (options.outputFile) {
      const file = createWriteStream(options.outputFile, {
        flags: "wx",
        mode: 0o600,
      });
      file.once("open", () => {
        created = true;
      });
      finished = pipeline(process.stdout, limiter, file).catch(
        (error: Error) => {
          fail(error);
        },
      );
    } else {
      process.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes)
          fail(
            new MediaFailure("MEDIA_OUTPUT_LIMIT", "媒体处理输出超过限额。"),
          );
        else output.push(chunk);
      });
    }
    // Decoder diagnostics are untrusted content and are never returned to the API or job payload.
    process.stderr.on("data", (chunk: Buffer) => {
      errorBytes += chunk.length;
      if (errorBytes > 512 * 1024)
        fail(new MediaFailure("MEDIA_OUTPUT_LIMIT", "媒体诊断输出超过限额。"));
    });
    process.once("error", (error) => {
      failure ??= error;
    });
    process.once("close", async (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      await finished;
      if (failure || code !== 0) {
        if (created && options.outputFile)
          await rm(options.outputFile, { force: true });
        reject(
          failure ??
            new MediaFailure(
              "MEDIA_SANDBOX_UNAVAILABLE",
              "媒体隔离环境暂不可用，请检查 Worker。",
            ),
        );
      } else resolve(Buffer.concat(output).toString("utf8"));
    });
  });
}

/** No writable host mount, network, credentials, Docker socket or user-supplied command. */
export async function runMediaProcess(
  file: string | undefined,
  binary: "/ffprobe" | "/ffmpeg",
  args: string[],
  options: Execution = {},
) {
  options.signal?.throwIfAborted();
  const name = `scenedesk-media-${randomUUID()}`;
  let input: string | undefined;
  if (file) {
    if (!(await lstat(file)).isFile())
      throw new Error("Media input must be a regular worker file");
    input = await realpath(file);
    if (input.includes(","))
      throw new Error(
        "Worker temporary path contains an invalid mount separator",
      );
    // The parent directory remains 0700. Only this single file is visible to the container.
    await chmod(input, 0o444);
  }
  try {
    await docker(
      [
        "create",
        "--pull",
        "never",
        "--name",
        name,
        "--network",
        "none",
        "--read-only",
        "--user",
        "65532:65532",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "64",
        "--cpus",
        "2",
        "--memory",
        String(MEDIA_LIMITS.processMemoryBytes),
        "--memory-swap",
        String(MEDIA_LIMITS.processMemoryBytes),
        "--ipc",
        "none",
        "--ulimit",
        "nofile=64:64",
        "--ulimit",
        "core=0:0",
        "--ulimit",
        `fsize=${MEDIA_LIMITS.bytes}:${MEDIA_LIMITS.bytes}`,
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,nodev,size=16777216,mode=1777",
        "--log-driver",
        "none",
        ...(input
          ? ["--mount", `type=bind,source=${input},target=/input,readonly`]
          : []),
        "--entrypoint",
        binary,
        FFMPEG_IMAGE,
        ...args,
      ],
      { timeoutMs: 15_000 },
    );
    options.onCreated?.(name);
    options.signal?.throwIfAborted();
    try {
      return await docker(["start", "--attach", name], options);
    } catch (error) {
      if (
        error instanceof MediaFailure &&
        error.code === "MEDIA_SANDBOX_UNAVAILABLE"
      ) {
        const state = JSON.parse(
          await docker(["inspect", "--format", "{{json .State}}", name], {
            timeoutMs: 15_000,
          }),
        ) as {
          OOMKilled: boolean;
          Status: string;
          ExitCode: number;
          Error: string;
        };
        if (state.OOMKilled)
          throw new MediaFailure(
            "MEDIA_RESOURCE_LIMIT",
            "媒体处理超出内存限额，请缩小文件或外部转换。",
          );
        if (state.Status === "exited" && state.ExitCode !== 0 && !state.Error)
          throw new MediaFailure(
            "MEDIA_DECODE_FAILED",
            "文件无法完整解析或解码，请检查原文件。",
          );
      }
      throw error;
    }
  } finally {
    // Killing an attached Docker CLI does not kill its container. Always remove the named job.
    await docker(["rm", "--force", name], { timeoutMs: 15_000 }).catch(() => {
      throw new MediaFailure(
        "MEDIA_SANDBOX_CLEANUP_FAILED",
        "媒体隔离任务未能清理，请检查 Worker。",
      );
    });
    if (input) await chmod(input, 0o600);
  }
}

export async function verifyMediaRuntime() {
  const output = await runMediaProcess(undefined, "/ffprobe", ["-version"]);
  if (!/^ffprobe version 9\.0\.1\b/.test(output))
    throw new MediaFailure(
      "MEDIA_BUILD_MISMATCH",
      "媒体构建版本与已验收版本不符。",
    );
  return { image: FFMPEG_IMAGE, ffmpegVersion: "9.0.1" };
}
