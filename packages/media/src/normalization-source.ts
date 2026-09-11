import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { editingCanonical, type NormalizationMedia } from "@drama/domain";
import type { ProductionContext } from "./production-jobs.js";
import type { ProductionStore } from "./production-storage.js";
import { FFMPEG_IMAGE, MediaFailure } from "./policy.js";
import {
  mapVideoFrames,
  PRODUCTION_NORMALIZATION_VERSION,
  type VideoTiming,
} from "./source-timing.js";
import { mapAudioFrames, type AudioTiming } from "./audio-timing.js";
import { VIDEO_PRODUCTION_PROFILE } from "./video-production.js";
import {
  AUDIO_PRODUCTION_PROFILE,
  AUDIO_RESAMPLER,
} from "./audio-production.js";

const mismatch = () =>
  new MediaFailure(
    "NORMALIZATION_SOURCE_MISMATCH",
    "固定制作映射与来源、构建或工件不一致，不能生成可执行编排。",
  );
function check(value: unknown): asserts value {
  if (!value) throw mismatch();
}
type ObjectValue = Record<string, any>;
function object(value: unknown): ObjectValue {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as ObjectValue;
}
function equal(actual: unknown, expected: unknown) {
  check(editingCanonical(actual) === editingCanonical(expected));
}
const sha = (value: unknown) =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
function fraction(n: bigint, d: bigint) {
  check(n > 0n && d > 0n);
  let a = n,
    b = d;
  while (b) [a, b] = [b, a % b];
  return { numerator: String(n / a), denominator: String(d / a) };
}

/** The caller has already downloaded these exact map versions and verified all
 * bytes against the durable artifact journal. This second check binds their
 * contents to the selected copy and re-evaluates the declared timing recipe. */
export function normalizationMediaFromVerifiedMaps(
  context: ProductionContext,
  source: { mediaId: string; sha256: string },
  maps: { video?: unknown; audio?: unknown },
): NormalizationMedia {
  try {
    const { copy } = context;
    check(
      copy.status === "ready" &&
        copy.source_sha256 === source.sha256 &&
        context.source.sha256 === source.sha256,
    );
    check(
      copy.profile.normalizationVersion === PRODUCTION_NORMALIZATION_VERSION,
    );
    const artifact = (kind: "video" | "video_map" | "audio" | "audio_map") => {
      const found = context.artifacts.filter((a) => a.kind === kind);
      check(found.length === 1);
      const a = found[0]!;
      check(
        a.copy_id === copy.id &&
          a.step_revision === copy.step_revision &&
          a.phase === "verified" &&
          !a.retired &&
          a.storage_version_id &&
          a.storage_version_id !== "null",
      );
      return a;
    };
    const common = (value: unknown) => {
      const map = object(value);
      check(
        map.sourceSha256 === source.sha256 &&
          map.sourceBytes === context.source.bytes &&
          map.ffmpegImage === FFMPEG_IMAGE &&
          map.normalizationVersion === copy.profile.normalizationVersion,
      );
      const runtime = object(map.runtime);
      check(
        runtime.imageId === copy.profile.imageId &&
          runtime.platform === copy.profile.platform,
      );
      return map;
    };
    let duration: NormalizationMedia["duration"] | undefined,
      video: NormalizationMedia["video"],
      audio: NormalizationMedia["audio"];
    let videoZero:
      | { pts: string; timeBase: { numerator: number; denominator: number } }
      | undefined;
    if (copy.kind === "video") {
      const map = common(maps.video),
        content = artifact("video"),
        mapArtifact = artifact("video_map");
      check(
        map.profile === VIDEO_PRODUCTION_PROFILE &&
          map.profile === copy.profile.videoProfile,
      );
      check(Array.isArray(map.spans));
      const sourceFormat = object(map.sourceFormat);
      const expected = mapVideoFrames(
        {
          streamIndex: sourceFormat.streamIndex,
          timeBase: sourceFormat.timeBase,
          width: sourceFormat.width,
          height: sourceFormat.height,
          pixelFormat: sourceFormat.pixelFormat,
          sampleAspectRatio: sourceFormat.sampleAspectRatio,
          color: sourceFormat.color,
          frames: map.spans.map((v: ObjectValue, index: number) => {
            check(v.sourceFrame === index && sha(v.decodedSha256));
            return {
              pts: v.sourcePts,
              ...(index === map.spans.length - 1
                ? { durationPts: map.lastFrameDurationPts }
                : {}),
            };
          }),
        } as VideoTiming,
        { numerator: map.rate?.numerator, denominator: map.rate?.denominator },
      );
      check(
        `${expected.rate.numerator}/${expected.rate.denominator}` ===
          copy.profile.rate,
      );
      for (const field of [
        "version",
        "timeBase",
        "startPts",
        "endPts",
        "endBasis",
        "lastFrameDurationPts",
        "rate",
        "frameCount",
      ] as const)
        equal(map[field], expected[field]);
      for (const [i, span] of expected.spans.entries())
        for (const [field, value] of Object.entries(span))
          equal(map.spans[i][field], value);
      const verified = object(map.verification);
      check(
        verified.allFramePixelsMatched === true &&
          verified.frameCount === expected.frameCount &&
          verified.videoSha256 === content.sha256,
      );
      const start = BigInt(expected.startPts),
        end = BigInt(expected.endPts),
        n = BigInt(expected.timeBase.numerator),
        d = BigInt(expected.timeBase.denominator),
        p = BigInt(expected.rate.numerator),
        q = BigInt(expected.rate.denominator);
      duration = fraction((end - start) * n, d);
      const converted =
        expected.spans.length !== expected.frameCount ||
        expected.spans.some(
          (span, index) =>
            span.outputStartFrame !== index ||
            span.outputEndFrame !== index + 1 ||
            (BigInt(span.sourcePts) - start) * n * p !== BigInt(index) * q * d,
        ) ||
        (end - start) * n * p !== BigInt(expected.frameCount) * q * d;
      video = {
        sourceMapId: mapArtifact.id,
        frameCount: expected.frameCount,
        fpsNum: expected.rate.numerator,
        fpsDen: expected.rate.denominator,
        ...(converted
          ? {
              conversion: {
                before: `${expected.spans.length} source presentation intervals; duration=${duration.numerator}/${duration.denominator}s`,
                after: `${expected.frameCount} frames at ${p}/${q}; map=${mapArtifact.id}`,
              },
            }
          : {}),
      };
      videoZero = { pts: expected.startPts, timeBase: expected.timeBase };
    } else check(maps.video === undefined);
    if (copy.has_audio) {
      const map = common(maps.audio),
        content = artifact("audio"),
        mapArtifact = artifact("audio_map");
      check(
        map.profile === AUDIO_PRODUCTION_PROFILE &&
          map.profile === copy.profile.audioProfile &&
          map.resampler === AUDIO_RESAMPLER &&
          map.cpuFlags === "0",
      );
      check(
        Array.isArray(map.frames) &&
          map.frames.every((f: ObjectValue) => sha(f.decodedSha256)),
      );
      const sourceFormat = object(map.sourceFormat);
      const expected = mapAudioFrames(
        {
          streamIndex: sourceFormat.streamIndex,
          timeBase: sourceFormat.timeBase,
          sampleRate: sourceFormat.sampleRate,
          channels: sourceFormat.channels,
          sampleFormat: sourceFormat.sampleFormat,
          channelLayout: sourceFormat.channelLayout,
          frames: map.frames,
        } as AudioTiming,
        videoZero,
      );
      for (const field of [
        "version",
        "sourceTimeBase",
        "sourceSampleRate",
        "zero",
        "clockRule",
        "decodedSamples",
        "discardedTailSamples",
        "outputSampleRate",
        "outputSamples",
        "silence",
      ] as const)
        equal(map[field], expected[field]);
      check(
        Array.isArray(map.segments) &&
          map.segments.length === expected.segments.length,
      );
      for (const [i, segment] of expected.segments.entries())
        for (const [field, value] of Object.entries(segment))
          equal(map.segments[i][field], value);
      const format = object(map.outputFormat),
        verified = object(map.verification);
      check(
        format.encoding === "pcm_f64le" &&
          format.sampleRate === 48000 &&
          format.channels === 2 &&
          format.bytesPerSampleFrame === 16,
      );
      check(
        verified.allOutputSamplesFinite === true &&
          verified.actualSamples === expected.outputSamples &&
          verified.outputBytes === content.bytes &&
          content.bytes === expected.outputSamples * 16 &&
          verified.assembledSha256 === content.sha256,
      );
      audio = {
        sourceMapId: mapArtifact.id,
        sampleCount: expected.outputSamples,
      };
      if (!duration) {
        const last = expected.segments.at(-1)!;
        const n = BigInt(expected.sourceTimeBase.numerator),
          d = BigInt(expected.sourceTimeBase.denominator),
          r = BigInt(expected.sourceSampleRate);
        // The source ends at the final continuous run's effective source sample,
        // before output sample-grid rounding and resampler context/tail removal.
        duration = fraction(
          (BigInt(last.pts) - BigInt(expected.zero.pts)) * n * r +
            BigInt(last.sourceSamples) * d,
          d * r,
        );
      }
    } else check(maps.audio === undefined && copy.kind === "video");
    check(
      duration &&
        context.artifacts.length ===
          (copy.kind === "video" ? 2 : 0) + (copy.has_audio ? 2 : 0),
    );
    return {
      mediaId: source.mediaId,
      sourceSha256: source.sha256,
      productionCopyId: copy.id,
      kind: copy.kind,
      duration,
      ...(video ? { video } : {}),
      ...(audio ? { audio } : {}),
    };
  } catch (error) {
    if (
      error instanceof MediaFailure &&
      error.code === "NORMALIZATION_SOURCE_MISMATCH"
    )
      throw error;
    throw mismatch();
  }
}

/** No database lock is held here. The worker supplies its owned job directory;
 * originals and browser proxies are never accepted as a normalization map. */
export async function readNormalizationMedia(options: {
  context: ProductionContext;
  source: { mediaId: string; sha256: string };
  store: ProductionStore;
  workDirectory: string;
  signal?: AbortSignal;
}) {
  const directory = await mkdtemp(
    join(options.workDirectory, "normalization-map-"),
  );
  try {
    const maps: { video?: unknown; audio?: unknown } = {};
    for (const kind of ["video_map", "audio_map"] as const) {
      const artifact = options.context.artifacts.find((a) => a.kind === kind);
      if (!artifact) continue;
      check(
        artifact.phase === "verified" &&
          artifact.storage_version_id &&
          !artifact.retired,
      );
      const file = join(directory, kind);
      await options.store.download(
        artifact,
        artifact.storage_version_id,
        file,
        options.signal,
      );
      options.signal?.throwIfAborted();
      const json = await readFile(file, "utf8");
      try {
        maps[kind === "video_map" ? "video" : "audio"] = JSON.parse(json);
      } catch {
        throw mismatch();
      }
    }
    return normalizationMediaFromVerifiedMaps(
      options.context,
      options.source,
      maps,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
