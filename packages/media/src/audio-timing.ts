import { Writable } from "node:stream";
import { MEDIA_LIMITS, MediaFailure } from "./policy.js";
import { runMediaProcess } from "./sandbox.js";
import { PRODUCTION_LIMITS } from "./source-timing.js";

export type AudioZero = Readonly<{
  pts: string;
  timeBase: { numerator: number; denominator: number };
}>;
export type AudioFrameTiming = Readonly<{
  pts: string;
  durationPts?: string;
  samples: number;
}>;
export type AudioTiming = Readonly<{
  streamIndex: number;
  timeBase: AudioZero["timeBase"];
  sampleRate: number;
  channels: 1 | 2;
  sampleFormat: string;
  channelLayout: string;
  frames: readonly AudioFrameTiming[];
}>;
export type AudioSegment = {
  firstFrame: number;
  endFrame: number;
  pts: string;
  decodedStartSample: number;
  sourceSamples: number;
  resampledSamples: number;
  croppedLeadingSamples: number;
  outputStartSample: number;
  outputEndSample: number;
  /** Half-open feasible clock phase interval, in units of 1/(2*sampleRate*timeBase.denominator) seconds. */
  clockPhase: { lower: string; upper: string };
};
export const AUDIO_SAMPLE_RATE = 48_000;
export const AUDIO_MAX_SEGMENTS = 128;

function invalid() {
  return new MediaFailure(
    "MEDIA_AUDIO_TIMING_INVALID",
    "音频有效区间或时间戳无法解释，请修正原片或外部转换。",
  );
}
function integer(value: string | undefined) {
  if (!value || !/^-?(0|[1-9]\d{0,18})$/.test(value)) throw invalid();
  const n = BigInt(value);
  if (n <= -(1n << 63n) || n >= 1n << 63n) throw invalid();
  return n;
}
function positive(value: unknown, max: number) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > max
  )
    throw invalid();
  return value;
}
function timeBase(value: AudioZero["timeBase"]) {
  return {
    n: BigInt(positive(value.numerator, 2_147_483_647)),
    d: BigInt(positive(value.denominator, 2_147_483_647)),
  };
}
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
const round = (n: bigint, d: bigint) => (2n * n + d) / (2n * d);

/** Quantization never accumulates: every frame must share one feasible clock phase. */
export function mapAudioFrames(timing: AudioTiming, zero?: AudioZero) {
  const { n, d } = timeBase(timing.timeBase);
  const r = BigInt(positive(timing.sampleRate, 192_000));
  if (r < 8_000n || ![1, 2].includes(timing.channels)) throw invalid();
  if (!timing.frames.length || timing.frames.length > PRODUCTION_LIMITS.frames)
    throw invalid();
  const origin = zero ?? {
    pts: timing.frames[0]!.pts,
    timeBase: { ...timing.timeBase },
  };
  const z = timeBase(origin.timeBase),
    zp = integer(origin.pts);
  const segments: AudioSegment[] = [];
  let decodedSamples = 0,
    discardedTailSamples = 0,
    previous: bigint | undefined;
  let start = 0n,
    count = 0n,
    lower = -r * n,
    upper = r * n;
  // Cell width is one source tick. Fine/sample-exact clocks do not receive a tolerance.
  const coarse = n * r > d;
  for (const [i, frame] of timing.frames.entries()) {
    const pts = integer(frame.pts);
    if (previous !== undefined && pts <= previous) throw invalid();
    previous = pts;
    const samples = positive(frame.samples, 1_048_576);
    let effective = samples;
    if (frame.durationPts !== undefined) {
      const duration = integer(frame.durationPts);
      if (duration < 0n) throw invalid();
      // Only an exact, explicitly shorter FINAL presentation interval can discard decoder padding.
      if (!coarse && duration > 0n) {
        const durationSamples = duration * n * r;
        if (durationSamples % d !== 0n) throw invalid();
        if (durationSamples / d > BigInt(samples)) {
          // Some fragmented MP4 tracks stretch a packet's declared duration across
          // a timestamp gap. Only decoded samples contain sound; a following PTS
          // must independently bound the gap. Never stretch samples or invent a tail.
          const next = timing.frames[i + 1];
          if (!next || integer(next.pts) < pts + duration) throw invalid();
        }
        if (durationSamples / d < BigInt(samples)) {
          if (i !== timing.frames.length - 1) throw invalid();
          effective = Number(durationSamples / d);
          discardedTailSamples = samples - effective;
        }
      }
    }
    let continuous = segments.length > 0;
    if (continuous) {
      const delta = (pts - start) * n * r - count * d;
      if (coarse) {
        const nextLower = 2n * delta - r * n,
          nextUpper = 2n * delta + r * n;
        const intersectionLower = lower > nextLower ? lower : nextLower;
        const intersectionUpper = upper < nextUpper ? upper : nextUpper;
        if (intersectionLower < intersectionUpper) {
          lower = intersectionLower;
          upper = intersectionUpper;
        } else {
          // A discontinuity smaller than a whole tick cannot be distinguished from clock phase.
          if (delta < r * n) throw invalid();
          continuous = false;
        }
      } else if (delta !== 0n) {
        if (delta < 0n) throw invalid();
        continuous = false;
      }
    }
    if (!continuous) {
      if (segments.length >= AUDIO_MAX_SEGMENTS)
        throw new MediaFailure(
          "MEDIA_RESOURCE_LIMIT",
          "音频间隙段数超过制作限额。",
        );
      start = pts;
      count = 0n;
      lower = -r * n;
      upper = r * n;
      segments.push({
        firstFrame: i,
        endFrame: i,
        pts: frame.pts,
        decodedStartSample: decodedSamples,
        sourceSamples: 0,
        resampledSamples: 0,
        croppedLeadingSamples: 0,
        outputStartSample: 0,
        outputEndSample: 0,
        clockPhase: { lower: "0", upper: "0" },
      });
    }
    count += BigInt(effective);
    decodedSamples += samples;
    const segment = segments.at(-1)!;
    segment.endFrame = i + 1;
    segment.sourceSamples = Number(count);
    segment.clockPhase = coarse
      ? { lower: lower.toString(), upper: upper.toString() }
      : { lower: "0", upper: "0" };
  }
  const silence: Array<{ startSample: number; endSample: number }> = [];
  let outputSamples = 0;
  const s = BigInt(AUDIO_SAMPLE_RATE);
  for (const segment of segments) {
    const offsetNumerator = (integer(segment.pts) * n * z.d - zp * z.n * d) * s;
    const offsetDenominator = d * z.d;
    const size = ceil(BigInt(segment.sourceSamples) * s, r);
    const crop =
      offsetNumerator < 0n ? ceil(-offsetNumerator, offsetDenominator) : 0n;
    const retainedCrop = crop < size ? crop : size;
    const remaining = size - retainedCrop;
    const position = remaining
      ? round(
          offsetNumerator + retainedCrop * offsetDenominator,
          offsetDenominator,
        )
      : 0n;
    const end = position + remaining;
    if (
      end * 1_000_000n > BigInt(MEDIA_LIMITS.durationUs) * s ||
      BigInt(decodedSamples) * 1_000_000n > BigInt(MEDIA_LIMITS.durationUs) * r
    )
      throw new MediaFailure(
        "MEDIA_DURATION_REJECTED",
        "音频制作源或相对零点的末端超过两小时。",
      );
    segment.resampledSamples = Number(size);
    segment.croppedLeadingSamples = Number(retainedCrop);
    segment.outputStartSample = Number(position);
    segment.outputEndSample = Number(end);
    if (!remaining) continue;
    if (position < BigInt(outputSamples)) throw invalid();
    if (position > BigInt(outputSamples))
      silence.push({ startSample: outputSamples, endSample: Number(position) });
    outputSamples = Number(end);
  }
  return {
    version: "audio-source-map-v1" as const,
    sourceTimeBase: { ...timing.timeBase },
    sourceSampleRate: timing.sampleRate,
    zero: { pts: origin.pts, timeBase: { ...origin.timeBase } },
    clockRule: "shared-nearest-tick-phase-v1" as const,
    decodedSamples,
    discardedTailSamples,
    outputSampleRate: AUDIO_SAMPLE_RATE,
    outputSamples,
    segments,
    silence,
  };
}

/** FFprobe has already applied decoder skip metadata; nb_samples describes the bytes we decode. */
export async function readAudioTiming(
  file: string,
  signal?: AbortSignal,
): Promise<AudioTiming | undefined> {
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
        "stream=index,codec_type,time_base,sample_rate,sample_fmt,channels,channel_layout",
        "-of",
        "json",
        "/input",
      ],
      { signal },
    ),
  ) as { streams?: Array<Record<string, unknown>> };
  const streams = (metadata.streams ?? []).filter(
    (s) => s.codec_type === "audio",
  );
  if (!streams.length) return undefined;
  if (streams.length !== 1)
    throw new MediaFailure(
      "MEDIA_STREAMS_REJECTED",
      "制作副本要求最多一个混合音轨。",
    );
  const stream = streams[0]!;
  if (stream.channels !== 1 && stream.channels !== 2)
    throw new MediaFailure(
      "MEDIA_AUDIO_CHANNELS_UNSUPPORTED",
      "首版制作仅接受单声道或双声道，请明确外部转换多声道素材。",
    );
  const parts = String(stream.time_base).split("/");
  if (parts.length !== 2 || parts.some((v) => !/^[1-9]\d{0,9}$/.test(v)))
    throw invalid();
  const rate = positive(Number(stream.sample_rate), 192_000);
  if (
    rate < 8_000 ||
    typeof stream.index !== "number" ||
    !Number.isSafeInteger(stream.index) ||
    stream.index < 0
  )
    throw invalid();
  const sampleFormat = String(stream.sample_fmt),
    layout = String(stream.channel_layout ?? "unknown");
  if (
    !/^(u8|s16|s32|s64|flt|dbl)p?$/.test(sampleFormat) ||
    !["unknown", stream.channels === 1 ? "mono" : "stereo"].includes(layout)
  )
    throw new MediaFailure(
      "MEDIA_AUDIO_FORMAT_UNSUPPORTED",
      "音频样本格式或声道含义尚未通过制作验收。",
    );
  const frames: AudioFrameTiming[] = [];
  let pending = "";
  function line(value: string) {
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
    if (
      fields.sample_fmt !== sampleFormat ||
      Number(fields.channels) !== stream.channels ||
      (fields.channel_layout ?? "unknown") !== layout
    )
      throw new MediaFailure(
        "MEDIA_FORMAT_CHANGE",
        "片中音频规格发生变化，请先外部转换。",
      );
    if (frames.length >= PRODUCTION_LIMITS.frames)
      throw new MediaFailure("MEDIA_RESOURCE_LIMIT", "音频解码帧数超过限额。");
    frames.push({
      pts: integer(fields.pts).toString(),
      samples: positive(Number(fields.nb_samples), 1_048_576),
      ...(fields.duration !== undefined && fields.duration !== "N/A"
        ? { durationPts: integer(fields.duration).toString() }
        : {}),
    });
  }
  const outputStream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        pending += chunk.toString("utf8");
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          line(pending.slice(0, end));
          pending = pending.slice(end + 1);
        }
        if (pending.length > 4096) throw invalid();
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
      String(stream.index),
      "-show_entries",
      "frame=pts,duration,nb_samples,sample_fmt,channels,channel_layout",
      "-of",
      "compact",
      "/input",
    ],
    { signal, outputStream, maxBytes: PRODUCTION_LIMITS.reportBytes },
  );
  const timing: AudioTiming = {
    streamIndex: stream.index,
    timeBase: { numerator: Number(parts[0]), denominator: Number(parts[1]) },
    sampleRate: rate,
    channels: stream.channels,
    sampleFormat,
    channelLayout: layout,
    frames,
  };
  mapAudioFrames(timing);
  return timing;
}
