import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, lstat, realpath, rm } from "node:fs/promises";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { FFMPEG_IMAGE, MEDIA_LIMITS, MediaFailure } from "./policy.js";
import {
  accountMediaWrite,
  currentMediaExecution,
  type OwnedMediaContainer,
} from "./execution.js";

type Execution = {
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
  outputFile?: string;
  /** Internal worker streams only. A caller owns both ends and their cancellation. */
  inputStream?: Readable;
  outputStream?: Writable;
  maxInputBytes?: number;
  maxBytes?: number;
  onCreated?: (containerName: string) => void;
};

function docker(args: string[], options: Execution = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn("docker", args, {
      stdio: [options.inputStream ? "pipe" : "ignore", "pipe", "pipe"],
    });
    const maxBytes = options.maxBytes ?? MEDIA_LIMITS.processOutputBytes;
    const output: Buffer[] = [];
    let bytes = 0,
      errorBytes = 0,
      failure: Error | undefined,
      created = false;
    const fail = (error: Error) => {
      failure ??= error;
      options.inputStream?.destroy(error);
      options.outputStream?.destroy(error);
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
        try {
          if (options.outputFile) accountMediaWrite(chunk.length);
          callback(null, chunk);
        } catch (error) {
          callback(error as Error);
        }
      },
    });
    const pending: Promise<void>[] = [];
    if (options.inputStream) {
      let inputBytes = 0;
      const inputLimiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          inputBytes += chunk.length;
          callback(
            inputBytes > options.maxInputBytes!
              ? new MediaFailure("MEDIA_INPUT_LIMIT", "媒体处理输入超过限额。")
              : null,
            chunk,
          );
        },
      });
      pending.push(
        pipeline(options.inputStream, inputLimiter, process.stdin!).catch(fail),
      );
    }
    if (options.outputFile) {
      const file = createWriteStream(options.outputFile, {
        flags: "wx",
        mode: 0o600,
      });
      file.once("open", () => {
        created = true;
      });
      pending.push(pipeline(process.stdout!, limiter, file).catch(fail));
    } else if (options.outputStream) {
      pending.push(
        pipeline(process.stdout!, limiter, options.outputStream).catch(fail),
      );
    } else {
      process.stdout!.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes)
          fail(
            new MediaFailure("MEDIA_OUTPUT_LIMIT", "媒体处理输出超过限额。"),
          );
        else output.push(chunk);
      });
    }
    // Decoder diagnostics are untrusted content and are never returned to the API or job payload.
    process.stderr!.on("data", (chunk: Buffer) => {
      errorBytes += chunk.length;
      if (errorBytes > 512 * 1024)
        fail(new MediaFailure("MEDIA_OUTPUT_LIMIT", "媒体诊断输出超过限额。"));
    });
    process.once("error", (error) => {
      failure ??= error;
    });
    process.once("close", async (code) => {
      // An encoder can exit before its upstream decoder does. Release that producer
      // before waiting for the input pipeline, including on cancellation and EPIPE.
      if (options.inputStream && !options.inputStream.readableEnded)
        options.inputStream.destroy(
          failure ??
            new MediaFailure(
              "MEDIA_INPUT_INCOMPLETE",
              "媒体编码未消费完整输入。",
            ),
        );
      await Promise.all(pending);
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
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
  if (options.outputFile && options.outputStream)
    throw new Error("Media output must have exactly one destination");
  if (
    options.inputStream &&
    (!Number.isSafeInteger(options.maxInputBytes) || options.maxInputBytes! < 1)
  )
    throw new Error("Stream input requires a positive safe integer byte limit");
  const owner = currentMediaExecution();
  if (owner)
    options = {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, owner.signal])
        : owner.signal,
    };
  options.signal?.throwIfAborted();
  let owned: OwnedMediaContainer | undefined;
  let name: string | undefined;
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
    owned = await owner?.reserveContainer();
    name = owned
      ? productionContainerName(owned.id)
      : `scenedesk-media-${randomUUID()}`;
    options.signal?.throwIfAborted();
    await docker(
      [
        "create",
        "--pull",
        "never",
        "--name",
        name,
        ...(owned
          ? [
              "--label",
              `scenedesk.production-resource=${owned.id}`,
              "--label",
              `scenedesk.production-host=${owned.hostId}`,
            ]
          : []),
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
        ...(options.inputStream ? ["--interactive"] : []),
        ...(input
          ? ["--mount", `type=bind,source=${input},target=/input,readonly`]
          : []),
        "--entrypoint",
        binary,
        FFMPEG_IMAGE,
        ...args,
      ],
      { timeoutMs: 15_000, signal: options.signal },
    );
    options.onCreated?.(name);
    options.signal?.throwIfAborted();
    try {
      return await docker(
        [
          "start",
          "--attach",
          ...(options.inputStream ? ["--interactive"] : []),
          name,
        ],
        options,
      );
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
    try {
      if (owned) {
        await removeProductionContainer(owned.id, owned.hostId);
        await owned.release();
      } else if (name) {
        await docker(["rm", "--force", name], { timeoutMs: 15_000 });
      }
    } catch {
      throw new MediaFailure(
        "MEDIA_SANDBOX_CLEANUP_FAILED",
        "媒体隔离任务未能清理，请检查 Worker。",
      );
    } finally {
      if (input) await chmod(input, 0o600);
    }
  }
}

function productionContainerName(id: string) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
  )
    throw new Error("Invalid production container identity");
  return `scenedesk-production-${id}`;
}
/** Absence is only established by a successful daemon listing; delete the inspected immutable ID. */
export async function removeProductionContainer(id: string, hostId: string) {
  const name = productionContainerName(id);
  productionContainerName(hostId);
  const found = (
    await docker(
      [
        "ps",
        "--all",
        "--no-trunc",
        "--filter",
        `name=^/${name}$`,
        "--format",
        "{{.ID}}",
      ],
      { timeoutMs: 10_000, maxBytes: 1024 },
    )
  ).trim();
  if (!found) return;
  if (!/^[a-f0-9]{64}$/.test(found))
    throw new Error("Container lookup is ambiguous");
  const labels = JSON.parse(
    await docker(["inspect", "--format", "{{json .Config.Labels}}", found], {
      timeoutMs: 10_000,
      maxBytes: 4096,
    }),
  ) as Record<string, string> | null;
  if (
    labels?.["scenedesk.production-resource"] !== id ||
    labels["scenedesk.production-host"] !== hostId
  )
    throw new Error("Container does not belong to this production resource");
  await docker(["rm", "--force", found], { timeoutMs: 15_000 });
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

/** Multi-architecture image manifests alone do not identify floating-point media output. */
export async function verifyProductionRuntime() {
  const runtime = await verifyMediaRuntime();
  const identity = (
    await docker(
      [
        "image",
        "inspect",
        "--format",
        "{{.Id}} {{.Os}} {{.Architecture}}",
        FFMPEG_IMAGE,
      ],
      { timeoutMs: 15_000, maxBytes: 1024 },
    )
  ).trim();
  const match = /^(sha256:[a-f0-9]{64}) linux (amd64|arm64)$/.exec(identity);
  if (!match)
    throw new MediaFailure(
      "MEDIA_BUILD_MISMATCH",
      "无法确认制作运行环境的镜像与处理器架构。",
    );
  if (
    process.env.DOCKER_DEFAULT_PLATFORM &&
    process.env.DOCKER_DEFAULT_PLATFORM !== `linux/${match[2]!}`
  )
    throw new MediaFailure(
      "MEDIA_BUILD_MISMATCH",
      "指定的制作架构与已确认的本地镜像不一致。",
    );
  return { ...runtime, imageId: match[1]!, platform: `linux/${match[2]!}` };
}
