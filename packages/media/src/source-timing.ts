import { Writable } from "node:stream";
import { MEDIA_LIMITS, MediaFailure } from "./policy.js";
import { runMediaProcess } from "./sandbox.js";

export const PRODUCTION_LIMITS = Object.freeze({
  frames: 1_728_000,
  reportBytes: 256 * 1024 * 1024,
  artifactBytes: 8 * 1024 ** 3,
  rawBytes: 256 * 1024 ** 3,
});

export type ProductionRate = Readonly<{
  numerator: number;
  denominator: number;
}>;
export type VideoFrameTiming = Readonly<{ pts: string; durationPts?: string }>;
export type VideoTiming = Readonly<{
  streamIndex: number;
  timeBase: { numerator: number; denominator: number };
  width: number;
  height: number;
  pixelFormat: string;
  sampleAspectRatio: string;
  chromaLocation?: string;
  alphaMode?: string;
  color: { range: string; space: string; transfer: string; primaries: string };
  displayMatrix?: string;
  frames: readonly VideoFrameTiming[];
}>;
export type VideoSourceSpan = {
  sourceFrame: number;
  sourcePts: string;
  sourceEndPts: string;
  outputStartFrame: number;
  outputEndFrame: number;
  decodedSha256?: string;
};
export type VideoSourceMap = {
  version: "video-source-map-v1";
  timeBase: VideoTiming["timeBase"];
  startPts: string;
  endPts: string;
  endBasis: "decoded_last_frame_duration";
  lastFrameDurationPts: string;
  rate: ProductionRate;
  frameCount: number;
  spans: VideoSourceSpan[];
};

const timingFailure = () =>
  new MediaFailure(
    "MEDIA_TIMING_INVALID",
    "原片时间戳缺失、重复、回跳或末帧结束无法确认，请修正原片或外部转换。",
  );
function integer(value: string | undefined): bigint {
  if (!value || !/^-?(0|[1-9]\d{0,18})$/.test(value)) throw timingFailure();
  const result = BigInt(value);
  if (result <= -(1n << 63n) || result >= 1n << 63n) throw timingFailure();
  return result;
}
function positive(value: unknown, max: number) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > max
  )
    throw timingFailure();
  return value;
}
export function validateProductionRate(rate: ProductionRate) {
  positive(rate.numerator, 2_147_483_647);
  positive(rate.denominator, 2_147_483_647);
  let a = BigInt(rate.numerator),
    b = BigInt(rate.denominator);
  if (a > 240n * b) throw timingFailure();
  while (b) [a, b] = [b, a % b];
  if (a !== 1n)
    throw new MediaFailure(
      "MEDIA_PROFILE_INVALID",
      "制作帧率必须为约分后的整数比例。",
    );
}

/** Intervals are evaluated as integers in the original stream time base. */
export function mapVideoFrames(
  timing: VideoTiming,
  rate: ProductionRate,
): VideoSourceMap {
  validateProductionRate(rate);
  const { frames } = timing;
  if (!frames.length || frames.length > PRODUCTION_LIMITS.frames)
    throw timingFailure();
  const tbN = BigInt(positive(timing.timeBase.numerator, 2_147_483_647));
  const tbD = BigInt(positive(timing.timeBase.denominator, 2_147_483_647));
  const p = BigInt(rate.numerator),
    q = BigInt(rate.denominator);
  const start = integer(frames[0]!.pts);
  let previous: bigint | undefined;
  for (const frame of frames) {
    const pts = integer(frame.pts);
    if (previous !== undefined && pts <= previous) throw timingFailure();
    previous = pts;
  }
  const lastDuration = integer(frames.at(-1)!.durationPts);
  if (lastDuration <= 0n) throw timingFailure();
  const end = previous! + lastDuration;
  const duration = (end - start) * tbN;
  if (duration * 1_000_000n > BigInt(MEDIA_LIMITS.durationUs) * tbD)
    throw new MediaFailure(
      "MEDIA_DURATION_REJECTED",
      "制作源时长超过两小时限额。",
    );
  const count = (duration * p) / (tbD * q);
  if (count < 1n)
    throw new MediaFailure(
      "MEDIA_SOURCE_TOO_SHORT",
      "原片不足一个完整目标帧。",
    );
  if (count > BigInt(PRODUCTION_LIMITS.frames))
    throw new MediaFailure("MEDIA_RESOURCE_LIMIT", "制作副本帧数超过限额。");
  const boundary = (pts: bigint) => {
    const a = (pts - start) * tbN * p,
      b = tbD * q;
    return Number((a + b - 1n) / b < count ? (a + b - 1n) / b : count);
  };
  return {
    version: "video-source-map-v1",
    timeBase: { ...timing.timeBase },
    startPts: start.toString(),
    endPts: end.toString(),
    endBasis: "decoded_last_frame_duration",
    lastFrameDurationPts: lastDuration.toString(),
    rate: { ...rate },
    frameCount: Number(count),
    spans: frames.map((frame, index) => {
      const next =
        index + 1 < frames.length ? integer(frames[index + 1]!.pts) : end;
      return {
        sourceFrame: index,
        sourcePts: frame.pts,
        sourceEndPts: next.toString(),
        outputStartFrame: boundary(integer(frame.pts)),
        outputEndFrame: boundary(next),
      };
    }),
  };
}

/** Only numeric/enumerated fields are read; no media tags or diagnostics enter the map. */
export async function readVideoTiming(
  file: string,
  signal?: AbortSignal,
): Promise<VideoTiming> {
  const metadata = JSON.parse(
    await runMediaProcess(
      file,
      "/ffprobe",
      [
        "-v",
        "error",
        "-threads",
        "2",
        "-protocol_whitelist",
        "file,pipe",
        "-show_entries",
        "stream=index,codec_type,time_base,width,height,pix_fmt,sample_aspect_ratio,color_range,color_space,color_transfer,color_primaries,chroma_location:stream_disposition=attached_pic:stream_side_data=side_data_type,displaymatrix",
        "-of",
        "json",
        "/input",
      ],
      { signal },
    ),
  ) as { streams?: Array<Record<string, unknown>> };
  const streams = metadata.streams ?? [];
  const videos = streams.filter(
    (s) =>
      s.codec_type === "video" &&
      !(s.disposition as { attached_pic?: number } | undefined)?.attached_pic,
  );
  if (videos.length !== 1)
    throw new MediaFailure(
      "MEDIA_STREAMS_REJECTED",
      "制作副本要求恰好一个画面轨。",
    );
  const stream = videos[0]!;
  const parts = String(stream.time_base).split("/");
  if (parts.length !== 2 || parts.some((v) => !/^[1-9]\d{0,9}$/.test(v)))
    throw timingFailure();
  const width = positive(stream.width, MEDIA_LIMITS.dimension);
  const height = positive(stream.height, MEDIA_LIMITS.dimension);
  if (width * height > MEDIA_LIMITS.pixels)
    throw new MediaFailure("MEDIA_DIMENSIONS_REJECTED", "画面尺寸超过限额。");
  const index = stream.index;
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0)
    throw timingFailure();
  const token = (value: unknown, fallback: string) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[a-zA-Z0-9_:.-]{1,64}$/.test(value))
      throw timingFailure();
    return value;
  };
  const timing: VideoTiming = {
    streamIndex: index,
    width,
    height,
    pixelFormat: token(stream.pix_fmt, "unknown"),
    sampleAspectRatio: token(stream.sample_aspect_ratio, "0:1"),
    chromaLocation: token(stream.chroma_location, "unspecified"),
    timeBase: {
      numerator: positive(Number(parts[0]), 2_147_483_647),
      denominator: positive(Number(parts[1]), 2_147_483_647),
    },
    color: {
      range: token(stream.color_range, "unknown"),
      space: token(stream.color_space, "unknown"),
      transfer: token(stream.color_transfer, "unknown"),
      primaries: token(stream.color_primaries, "unknown"),
    },
    frames: [],
  };
  const sideData = stream.side_data_list as
    Array<{ side_data_type?: unknown; displaymatrix?: unknown }> | undefined;
  const matrix = sideData?.find(
    (s) => s.side_data_type === "Display Matrix",
  )?.displaymatrix;
  if (matrix !== undefined) {
    if (
      typeof matrix !== "string" ||
      matrix.length > 1024 ||
      !/^[\s\d:a-f-]+$/.test(matrix)
    )
      throw timingFailure();
    Object.assign(timing, { displayMatrix: matrix });
  }
  const frames = timing.frames as VideoFrameTiming[];
  let pending = "";
  const line = (value: string) => {
    if (
      /side_data_type=[^|]*(?:Mastering display|Content light|HDR|DOVI|Dolby Vision|ICC profile|Ambient viewing)/i.test(
        value,
      )
    )
      throw new MediaFailure(
        "MEDIA_HDR_METADATA_UNSUPPORTED",
        "此 HDR 附加元数据尚未通过制作验收，请先明确外部转换。",
      );
    if (!value.startsWith("frame|")) return;
    const fields = Object.fromEntries(
      value
        .split("|")
        .slice(1)
        .map((v) => {
          const i = v.indexOf("=");
          return [v.slice(0, i), v.slice(i + 1)];
        }),
    );
    const pts = integer(fields.pts).toString();
    const alpha = fields.alpha_mode ?? "unspecified";
    if (!/^(unspecified|straight|premultiplied)$/.test(alpha))
      throw timingFailure();
    if (timing.alphaMode === undefined)
      Object.assign(timing, { alphaMode: alpha });
    if (
      alpha !== timing.alphaMode ||
      (fields.chroma_location ?? "unspecified") !== timing.chromaLocation ||
      (fields.sample_aspect_ratio === "N/A"
        ? "0:1"
        : (fields.sample_aspect_ratio ?? "0:1")) !== timing.sampleAspectRatio
    )
      throw new MediaFailure(
        "MEDIA_FORMAT_CHANGE",
        "片中像素比例、色度位置或透明度解释发生变化，请先明确外部转换。",
      );
    if (frames.length >= PRODUCTION_LIMITS.frames)
      throw new MediaFailure("MEDIA_RESOURCE_LIMIT", "源视频帧数超过限额。");
    if (frames.length && BigInt(pts) <= BigInt(frames.at(-1)!.pts))
      throw timingFailure();
    if (
      Number(fields.width) !== width ||
      Number(fields.height) !== height ||
      fields.pix_fmt !== timing.pixelFormat
    )
      throw new MediaFailure(
        "MEDIA_FORMAT_CHANGE",
        "片中画面规格发生变化，请先外部转换为固定规格。",
      );
    if (fields.interlaced_frame !== "0")
      throw new MediaFailure(
        "MEDIA_INTERLACED_UNSUPPORTED",
        "隔行素材需要先明确去隔行转换。",
      );
    for (const [field, expected] of Object.entries({
      color_range: timing.color.range,
      color_space: timing.color.space,
      color_transfer: timing.color.transfer,
      color_primaries: timing.color.primaries,
    })) {
      if ((fields[field] ?? "unknown") !== expected)
        throw new MediaFailure(
          "MEDIA_COLOR_CHANGE",
          "片中色彩标记发生变化，请先明确外部转换。",
        );
    }
    frames.push({
      pts,
      ...(fields.duration && fields.duration !== "N/A"
        ? { durationPts: integer(fields.duration).toString() }
        : {}),
    });
  };
  const outputStream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        pending += chunk.toString("utf8");
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          line(pending.slice(0, end));
          pending = pending.slice(end + 1);
        }
        if (pending.length > 4096) throw timingFailure();
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    final(callback) {
      try {
        if (pending) line(pending);
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
  await runMediaProcess(
    file,
    "/ffprobe",
    [
      "-v",
      "error",
      "-threads",
      "2",
      "-protocol_whitelist",
      "file,pipe",
      "-err_detect",
      "explode",
      "-select_streams",
      String(index),
      "-show_entries",
      "frame=pts,duration,width,height,pix_fmt,interlaced_frame,sample_aspect_ratio,color_range,color_space,color_transfer,color_primaries,chroma_location,alpha_mode:frame_side_data=side_data_type",
      "-of",
      "compact",
      "/input",
    ],
    { signal, outputStream, maxBytes: PRODUCTION_LIMITS.reportBytes },
  );
  if (!frames.length) throw timingFailure();
  return timing;
}
