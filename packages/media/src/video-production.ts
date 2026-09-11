import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { FFMPEG_IMAGE, MediaFailure } from "./policy.js";
import { fileIntegrity } from "./probe.js";
import { runMediaProcess, verifyMediaRuntime } from "./sandbox.js";
import {
  PRODUCTION_LIMITS,
  mapVideoFrames,
  readVideoTiming,
  validateProductionRate,
  type ProductionRate,
  type VideoTiming,
} from "./source-timing.js";

export const VIDEO_PRODUCTION_PROFILE = "native-ffv1-nut-v1";
export const VIDEO_PRODUCTION_RATES = [
  "24/1",
  "25/1",
  "30/1",
  "24000/1001",
  "30000/1001",
] as const;

/** Native precision is retained. The listed repackings do not change color samples. */
function rawLayout(timing: VideoTiming) {
  const aliases: Record<string, string> = {
    nv12: "yuv420p",
    nv21: "yuv420p",
    p010le: "yuv420p10le",
    p012le: "yuv420p12le",
    p016le: "yuv420p16le",
    yuvj420p: "yuv420p",
    yuvj422p: "yuv422p",
    yuvj444p: "yuv444p",
    yuvj440p: "yuv440p",
    yuvj411p: "yuv411p",
    rgb24: "bgr0",
    bgr24: "bgr0",
    gbrp: "bgr0",
    rgba: "bgra",
    argb: "bgra",
    abgr: "bgra",
    gbrap: "bgra",
  };
  const pixelFormat = aliases[timing.pixelFormat] ?? timing.pixelFormat;
  const { width: w, height: h } = timing;
  let bytes: number | undefined;
  const packed: Record<string, number> = {
    bgr0: 4,
    bgra: 4,
    rgb48le: 6,
    rgba64le: 8,
    gray: 1,
    ya8: 2,
  };
  if (packed[pixelFormat]) bytes = w * h * packed[pixelFormat];
  const yuv =
    /^(yuv|yuva)(420|422|444|440|411|410)p(?:(9|10|12|14|16)le)?$/.exec(
      pixelFormat,
    );
  if (yuv) {
    const shifts: Record<string, [number, number]> = {
      "420": [2, 2],
      "422": [2, 1],
      "444": [1, 1],
      "440": [1, 2],
      "411": [4, 1],
      "410": [4, 4],
    };
    const [x, y] = shifts[yuv[2]!]!;
    bytes =
      (w * h * (yuv[1] === "yuva" ? 2 : 1) +
        2 * Math.ceil(w / x) * Math.ceil(h / y)) *
      (yuv[3] ? 2 : 1);
  }
  const planar = /^(gbrp|gbrap|gray)(9|10|12|14|16)le$/.exec(pixelFormat);
  if (planar)
    bytes =
      w * h * 2 * (planar[1] === "gbrp" ? 3 : planar[1] === "gbrap" ? 4 : 1);
  if (!bytes)
    throw new MediaFailure(
      "MEDIA_PIXEL_FORMAT_UNSUPPORTED",
      "此像素格式尚未通过无损制作验收，请先显式外部转换。",
    );
  return { pixelFormat, frameBytes: bytes };
}

const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
async function integrity(file: string) {
  let bytes = 0;
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    if (bytes > PRODUCTION_LIMITS.artifactBytes)
      throw new MediaFailure("MEDIA_OUTPUT_LIMIT", "制作副本超过存储限额。");
    digest.update(chunk);
  }
  return { file, bytes, sha256: digest.digest("hex") };
}
async function* rawFrames(input: Readable, size: number) {
  let frame = Buffer.allocUnsafe(size),
    offset = 0;
  for await (const chunk of input) {
    const bytes = chunk as Buffer;
    let position = 0;
    while (position < bytes.length) {
      const count = Math.min(size - offset, bytes.length - position);
      bytes.copy(frame, offset, position, position + count);
      offset += count;
      position += count;
      if (offset === size) {
        yield frame;
        // Downstream owns yielded buffers; never overwrite one still in a pipe.
        frame = Buffer.allocUnsafe(size);
        offset = 0;
      }
    }
  }
  if (offset)
    throw new MediaFailure(
      "MEDIA_FRAME_INCOMPLETE",
      "解码输出含不完整画面帧。",
    );
}
function decodeArgs(timing: VideoTiming, pixelFormat: string) {
  return [
    "-v",
    "error",
    "-nostdin",
    "-threads",
    "2",
    "-filter_threads",
    "2",
    "-protocol_whitelist",
    "file,pipe",
    "-err_detect",
    "explode",
    "-xerror",
    "-copyts",
    "-noautorotate",
    "-i",
    "/input",
    "-map",
    `0:${timing.streamIndex}`,
    "-an",
    "-sn",
    "-dn",
    "-vf",
    `${timing.pixelFormat.startsWith("yuvj") ? "scale=in_range=full:out_range=full," : ""}format=pix_fmts=${pixelFormat}`,
    "-c:v",
    "rawvideo",
    "-threads",
    "2",
    "-fps_mode",
    "passthrough",
    "-enc_time_base",
    "demux",
    "-f",
    "rawvideo",
    "pipe:1",
  ];
}

/** Creates worker-local artifacts; persistence and tenant ownership belong to the durable caller. */
export async function makeVideoProduction(
  sourceFile: string,
  rate: ProductionRate,
  workDirectory: string,
  signal?: AbortSignal,
) {
  validateProductionRate(rate);
  if (
    !(VIDEO_PRODUCTION_RATES as readonly string[]).includes(
      `${rate.numerator}/${rate.denominator}`,
    )
  )
    throw new MediaFailure(
      "MEDIA_PROFILE_UNSUPPORTED",
      "此目标帧率尚未通过制作 profile 验收。",
    );
  await verifyMediaRuntime();
  const original = await fileIntegrity(sourceFile);
  const source = await readVideoTiming(sourceFile, signal);
  const mapping = mapVideoFrames(source, rate);
  const layout = rawLayout(source);
  const rawSourceBytes = layout.frameBytes * source.frames.length;
  const rawOutputBytes = layout.frameBytes * mapping.frameCount;
  if (Math.max(rawSourceBytes, rawOutputBytes) > PRODUCTION_LIMITS.rawBytes)
    throw new MediaFailure(
      "MEDIA_RESOURCE_LIMIT",
      "制作所需解码数据超过限额，请缩小素材区间或外部转换。",
    );
  const directory = await mkdtemp(join(workDirectory, "video-production-"));
  try {
    const file = join(directory, "video.nut");
    const controller = new AbortController();
    const combined = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    const decoded = new PassThrough({ highWaterMark: 64 * 1024 });
    decoded.on("error", () => {});
    const selected = Readable.from(
      (async function* () {
        let index = 0;
        for await (const frame of rawFrames(decoded, layout.frameBytes)) {
          const span = mapping.spans[index++];
          if (!span)
            throw new MediaFailure(
              "MEDIA_FRAME_COUNT_MISMATCH",
              "解码帧数与源映射不一致。",
            );
          span.decodedSha256 = hash(frame);
          for (let k = span.outputStartFrame; k < span.outputEndFrame; k++)
            yield frame;
        }
        if (index !== source.frames.length)
          throw new MediaFailure(
            "MEDIA_FRAME_COUNT_MISMATCH",
            "解码帧数与源映射不一致。",
          );
      })(),
      { objectMode: false, highWaterMark: 64 * 1024 },
    );
    selected.on("error", () => {});
    let failure: unknown;
    const finish = async (promise: Promise<unknown>) => {
      try {
        await promise;
      } catch (error) {
        failure ??= error;
        controller.abort();
        decoded.destroy(error as Error);
        selected.destroy(error as Error);
      }
    };
    const colorArgs = Object.entries({
      color_range: source.pixelFormat.startsWith("yuvj")
        ? "pc"
        : source.color.range,
      colorspace: source.color.space,
      color_trc: source.color.transfer,
      color_primaries: source.color.primaries,
      chroma_sample_location: source.chromaLocation ?? "unspecified",
    }).flatMap(([key, value]) =>
      value === "unknown" || value === "unspecified" ? [] : [`-${key}`, value],
    );
    const sar = /^[1-9]\d*:[1-9]\d*$/.test(source.sampleAspectRatio)
      ? source.sampleAspectRatio.replace(":", "/")
      : "1/1";
    await Promise.all([
      finish(
        runMediaProcess(
          sourceFile,
          "/ffmpeg",
          decodeArgs(source, layout.pixelFormat),
          {
            signal: combined,
            outputStream: decoded,
            maxBytes: rawSourceBytes,
          },
        ),
      ),
      finish(
        runMediaProcess(
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
            "-xerror",
            "-bitexact",
            "-protocol_whitelist",
            "file,pipe",
            "-f",
            "rawvideo",
            "-pixel_format",
            layout.pixelFormat,
            "-video_size",
            `${source.width}x${source.height}`,
            "-framerate",
            `${rate.numerator}/${rate.denominator}`,
            "-i",
            "pipe:0",
            "-map",
            "0:v:0",
            "-vf",
            `setsar=ratio=${sar}:max=2147483647`,
            "-c:v",
            "ffv1",
            "-level",
            "3",
            "-coder",
            "1",
            "-context",
            "1",
            "-slicecrc",
            "1",
            "-threads",
            "2",
            "-pix_fmt",
            `+${layout.pixelFormat}`,
            ...colorArgs,
            "-fps_mode",
            "passthrough",
            "-enc_time_base",
            `${rate.denominator}:${rate.numerator}`,
            "-fflags",
            "+bitexact",
            "-flags:v",
            "+bitexact",
            "-f",
            "nut",
            "pipe:1",
          ],
          {
            signal: combined,
            inputStream: selected,
            maxInputBytes: rawOutputBytes,
            outputFile: file,
            maxBytes: PRODUCTION_LIMITS.artifactBytes,
          },
        ),
      ),
    ]);
    if (failure) throw failure;

    const actual = await readVideoTiming(file, signal);
    if (
      actual.frames.length !== mapping.frameCount ||
      actual.width !== source.width ||
      actual.height !== source.height ||
      actual.pixelFormat !== layout.pixelFormat
    )
      throw new MediaFailure(
        "MEDIA_COPY_MISMATCH",
        "制作副本帧数或画面规格与映射不一致。",
      );
    const actualMap = mapVideoFrames(actual, rate);
    if (sar !== "1/1" && actual.sampleAspectRatio !== source.sampleAspectRatio)
      throw new MediaFailure(
        "MEDIA_COPY_MISMATCH",
        "制作副本像素比例与原片不一致。",
      );
    if (
      actualMap.frameCount !== mapping.frameCount ||
      BigInt(actualMap.endPts) *
        BigInt(actual.timeBase.numerator) *
        BigInt(rate.numerator) !==
        BigInt(mapping.frameCount) *
          BigInt(rate.denominator) *
          BigInt(actual.timeBase.denominator)
    )
      throw new MediaFailure("MEDIA_COPY_MISMATCH", "制作副本末帧边界不匹配。");
    for (const [index, frame] of actual.frames.entries()) {
      if (
        BigInt(frame.pts) *
          BigInt(actual.timeBase.numerator) *
          BigInt(rate.numerator) !==
        BigInt(index) *
          BigInt(rate.denominator) *
          BigInt(actual.timeBase.denominator)
      )
        throw new MediaFailure(
          "MEDIA_COPY_MISMATCH",
          "制作副本时间戳与固定帧率不一致。",
        );
    }
    const verification = new PassThrough({ highWaterMark: 64 * 1024 });
    verification.on("error", () => {});
    const verifyController = new AbortController();
    const verifySignal = signal
      ? AbortSignal.any([signal, verifyController.signal])
      : verifyController.signal;
    let verifyFailure: unknown;
    const verifyFinish = async (promise: Promise<unknown>) => {
      try {
        await promise;
      } catch (error) {
        verifyFailure ??= error;
        verifyController.abort();
        verification.destroy(error as Error);
      }
    };
    await Promise.all([
      verifyFinish(
        runMediaProcess(
          file,
          "/ffmpeg",
          decodeArgs(actual, layout.pixelFormat),
          {
            signal: verifySignal,
            outputStream: verification,
            maxBytes: rawOutputBytes,
          },
        ),
      ),
      verifyFinish(
        (async () => {
          let index = 0,
            spanIndex = 0;
          for await (const frame of rawFrames(
            verification,
            layout.frameBytes,
          )) {
            while (
              mapping.spans[spanIndex] &&
              mapping.spans[spanIndex]!.outputEndFrame <= index
            )
              spanIndex++;
            const span = mapping.spans[spanIndex];
            if (
              !span ||
              index < span.outputStartFrame ||
              hash(frame) !== span.decodedSha256
            )
              throw new MediaFailure(
                "MEDIA_COPY_MISMATCH",
                "制作副本画面内容与原帧映射不一致。",
              );
            index++;
          }
          if (index !== mapping.frameCount)
            throw new MediaFailure(
              "MEDIA_COPY_MISMATCH",
              "制作副本未完整解码。",
            );
        })(),
      ),
    ]);
    if (verifyFailure) throw verifyFailure;
    const after = await fileIntegrity(sourceFile);
    if (original.sha256 !== after.sha256 || original.bytes !== after.bytes)
      throw new MediaFailure(
        "MEDIA_SOURCE_CHANGED",
        "原片在制作过程中发生变化。",
      );
    const video = await integrity(file);
    const manifest = {
      profile: VIDEO_PRODUCTION_PROFILE,
      ffmpegImage: FFMPEG_IMAGE,
      normalizationVersion: "normalization-v1",
      sourceSha256: original.sha256,
      sourceBytes: original.bytes,
      sourceFormat: { ...source, frames: undefined },
      pixelFormat: layout.pixelFormat,
      productionFormat: {
        sampleAspectRatio: actual.sampleAspectRatio,
        color: actual.color,
      },
      ...mapping,
      verification: {
        videoSha256: video.sha256,
        frameCount: actual.frames.length,
        timeBase: actual.timeBase,
        firstPts: actual.frames[0]!.pts,
        lastPts: actual.frames.at(-1)!.pts,
        allFramePixelsMatched: true,
      },
    };
    const mapFile = join(directory, "source-map.json");
    await writeFile(mapFile, JSON.stringify(manifest) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    return { video, sourceMap: await integrity(mapFile), manifest };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
