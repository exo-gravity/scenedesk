import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { accountMediaWrite } from "./execution.js";
import { FFMPEG_IMAGE, MediaFailure } from "./policy.js";
import { fileIntegrity } from "./probe.js";
import { runMediaProcess, verifyProductionRuntime } from "./sandbox.js";
import {
  PRODUCTION_LIMITS,
  PRODUCTION_NORMALIZATION_VERSION,
} from "./source-timing.js";
import {
  mapAudioFrames,
  readAudioTiming,
  type AudioSegment,
  type AudioZero,
} from "./audio-timing.js";

export const AUDIO_PRODUCTION_PROFILE = "stereo-f64le-swr-v1";
export const AUDIO_RESAMPLER =
  "aresample=48000:resampler=swr:osf=dbl:tsf=dblp:filter_size=32:phase_shift=10:exact_rational=1:linear_interp=1:cutoff=0.97:filter_type=kaiser:kaiser_beta=9:dither_method=none:async=0";
// Fixed filter context, outside the source presentation interval. It is never emitted as content.
export const AUDIO_FILTER_MIN_TAIL_SAMPLES = 256;
const mismatch = () =>
  new MediaFailure(
    "MEDIA_AUDIO_COPY_MISMATCH",
    "音频制作副本的实际样本与固定映射不一致。",
  );
async function digest(file: string, signal?: AbortSignal) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file, { signal })) {
    bytes += chunk.length;
    if (bytes > PRODUCTION_LIMITS.artifactBytes)
      throw new MediaFailure(
        "MEDIA_OUTPUT_LIMIT",
        "音频制作副本超过存储限额。",
      );
    hash.update(chunk);
  }
  return { file, bytes, sha256: hash.digest("hex") };
}
function finite(bytes: Buffer) {
  if (bytes.length % 8) throw mismatch();
  for (let i = 0; i < bytes.length; i += 8)
    if (!Number.isFinite(bytes.readDoubleLE(i)))
      throw new MediaFailure(
        "MEDIA_AUDIO_SAMPLE_INVALID",
        "音频包含非有限样本，请修正原片。",
      );
}

async function* pcmChunks(
  file: string,
  start: number,
  end: number,
  signal?: AbortSignal,
) {
  let pending = Buffer.alloc(0);
  for await (const chunk of createReadStream(file, {
    start,
    end,
    signal,
    highWaterMark: 64 * 1024,
  })) {
    const bytes = pending.length
      ? Buffer.concat([pending, chunk])
      : (chunk as Buffer);
    const complete = bytes.length - (bytes.length % 16);
    if (complete) yield bytes.subarray(0, complete);
    pending = Buffer.from(bytes.subarray(complete));
  }
  if (pending.length) throw mismatch();
}

/** Raw PCM has no guessed timestamps. Its immutable map owns all sample positions. */
export async function makeAudioProduction(
  sourceFile: string,
  workDirectory: string,
  zero?: AudioZero,
  signal?: AbortSignal,
) {
  const runtime = await verifyProductionRuntime();
  const original = await fileIntegrity(sourceFile);
  const source = await readAudioTiming(sourceFile, signal);
  if (!source) return undefined;
  const mono = source.channels === 1;
  const mapping = mapAudioFrames(source, zero);
  const nativeBytes = mapping.decodedSamples * source.channels * 8;
  const outputBytes = mapping.outputSamples * 16;
  if (Math.max(nativeBytes, outputBytes) > PRODUCTION_LIMITS.artifactBytes)
    throw new MediaFailure(
      "MEDIA_RESOURCE_LIMIT",
      "音频制作所需临时文件超过限额，请缩小素材区间或外部转换。",
    );
  const directory = await mkdtemp(join(workDirectory, "audio-production-"));
  try {
    const native = join(directory, "decoded.f64le");
    await runMediaProcess(
      sourceFile,
      "/ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-threads",
        "2",
        "-filter_threads",
        "2",
        "-cpuflags",
        "0",
        "-bitexact",
        "-protocol_whitelist",
        "file,pipe",
        "-err_detect",
        "explode",
        "-xerror",
        "-copyts",
        "-reinit_filter",
        "0",
        "-i",
        "/input",
        "-map",
        `0:${source.streamIndex}`,
        "-vn",
        "-sn",
        "-dn",
        "-ar",
        String(source.sampleRate),
        "-ac",
        String(source.channels),
        "-c:a",
        "pcm_f64le",
        "-f",
        "f64le",
        "pipe:1",
      ],
      { signal, outputFile: native, maxBytes: nativeBytes },
    );
    if ((await stat(native)).size !== nativeBytes) throw mismatch();
    const frames: Array<{
      pts: string;
      durationPts?: string;
      samples: number;
      decodedSha256: string;
    }> = [];
    const input = await open(native, "r");
    try {
      let offset = 0;
      for (const frame of source.frames) {
        signal?.throwIfAborted();
        const size = frame.samples * source.channels * 8,
          bytes = Buffer.allocUnsafe(size);
        let read = 0;
        while (read < size) {
          const result = await input.read(
            bytes,
            read,
            size - read,
            offset + read,
          );
          if (!result.bytesRead) throw mismatch();
          read += result.bytesRead;
        }
        finite(bytes);
        frames.push({
          ...frame,
          decodedSha256: createHash("sha256").update(bytes).digest("hex"),
        });
        offset += size;
      }
    } finally {
      await input.close();
    }
    const segments: Array<
      AudioSegment & {
        resampledSha256: string;
        resampledWithContextSamples: number;
        filterTailSamples: number;
        file: string;
      }
    > = [];
    for (const [i, segment] of mapping.segments.entries()) {
      signal?.throwIfAborted();
      const file = join(directory, `segment-${i}.f64le`);
      const size = segment.sourceSamples * source.channels * 8;
      const start = segment.decodedStartSample * source.channels * 8;
      const r = BigInt(source.sampleRate);
      let a = r,
        b = 48000n;
      while (b) [a, b] = [b, a % b];
      const period = r / a;
      const count = BigInt(segment.sourceSamples);
      // A full conversion period avoids the resampler's fractional flush endpoint.
      const extended =
        ((count + BigInt(AUDIO_FILTER_MIN_TAIL_SAMPLES) + period - 1n) /
          period) *
        period;
      const filterTailSamples = Number(extended - count);
      const withContext = Number((extended * 48000n) / r);
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
          "-cpuflags",
          "0",
          "-bitexact",
          "-protocol_whitelist",
          "file,pipe",
          "-xerror",
          "-f",
          "f64le",
          "-ar",
          String(source.sampleRate),
          "-ac",
          String(source.channels),
          "-i",
          "pipe:0",
          "-af",
          `apad=pad_len=${filterTailSamples},${AUDIO_RESAMPLER}` +
            (source.channels === 1 ? ",pan=stereo|c0=c0|c1=c0" : ""),
          "-c:a",
          "pcm_f64le",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-f",
          "f64le",
          "pipe:1",
        ],
        {
          signal,
          inputStream: createReadStream(native, {
            start,
            end: start + size - 1,
            signal,
          }),
          maxInputBytes: size,
          outputFile: file,
          maxBytes: (withContext + 1) * 16,
        },
      );
      const artifact = await digest(file, signal);
      if (artifact.bytes !== withContext * 16)
        throw new MediaFailure(
          "MEDIA_AUDIO_RESAMPLE_MISMATCH",
          "固定重采样器的实际尾部不满足样本映射；不能补齐或裁掉未声明样本。",
        );
      segments.push({
        ...segment,
        resampledSha256: artifact.sha256,
        resampledWithContextSamples: withContext,
        filterTailSamples,
        file,
      });
    }
    const expectedHash = createHash("sha256");
    let emittedBytes = 0;
    async function* assemble() {
      let position = 0;
      const silence = Buffer.alloc(64 * 1024);
      for (const segment of segments) {
        if (segment.outputStartSample === segment.outputEndSample) continue;
        let gapBytes = (segment.outputStartSample - position) * 16;
        while (gapBytes > 0) {
          signal?.throwIfAborted();
          const bytes = silence.subarray(0, Math.min(gapBytes, silence.length));
          expectedHash.update(bytes);
          emittedBytes += bytes.length;
          accountMediaWrite(bytes.length);
          yield bytes;
          gapBytes -= bytes.length;
        }
        for await (const bytes of pcmChunks(
          segment.file,
          segment.croppedLeadingSamples * 16,
          segment.resampledSamples * 16 - 1,
          signal,
        )) {
          finite(bytes);
          if (mono)
            for (let j = 0; j < bytes.length; j += 16)
              if (
                !bytes.subarray(j, j + 8).equals(bytes.subarray(j + 8, j + 16))
              )
                throw mismatch();
          expectedHash.update(bytes);
          emittedBytes += bytes.length;
          accountMediaWrite(bytes.length);
          yield bytes;
        }
        position = segment.outputEndSample;
      }
    }
    const file = join(directory, "audio.f64le");
    await pipeline(
      Readable.from(assemble()),
      createWriteStream(file, { flags: "wx", mode: 0o600 }),
      { signal },
    );
    const audio = await digest(file, signal);
    if (
      audio.bytes !== outputBytes ||
      emittedBytes !== outputBytes ||
      audio.sha256 !== expectedHash.digest("hex")
    )
      throw mismatch();
    const unchanged = await fileIntegrity(sourceFile);
    if (
      unchanged.sha256 !== original.sha256 ||
      unchanged.bytes !== original.bytes
    )
      throw new MediaFailure(
        "MEDIA_SOURCE_CHANGED",
        "处理期间原始媒体发生变化。",
      );
    const manifest = {
      ...mapping,
      profile: AUDIO_PRODUCTION_PROFILE,
      resampler: AUDIO_RESAMPLER,
      ffmpegImage: FFMPEG_IMAGE,
      runtime,
      cpuFlags: "0",
      filterContext: {
        minimumTailZeroSamples: AUDIO_FILTER_MIN_TAIL_SAMPLES,
        alignment: "total input samples are a multiple of R/gcd(R,48000)",
        unit: "source_sample",
        retainedOutput:
          "only sample instants within the source presentation interval",
      },
      normalizationVersion: PRODUCTION_NORMALIZATION_VERSION,
      sourceSha256: original.sha256,
      sourceBytes: original.bytes,
      sourceFormat: { ...source, frames: undefined },
      frames,
      segments: segments.map(({ file: _file, ...segment }) => segment),
      outputFormat: {
        encoding: "pcm_f64le",
        sampleRate: 48000,
        channels: 2,
        channelLayout: "stereo",
        bytesPerSampleFrame: 16,
      },
      boundaryRule:
        "resample-each-continuous-run-ceil-length;crop-pre-zero-with-ceil;place-survivor-with-round-half-up-v1",
      verification: {
        decodedBytes: nativeBytes,
        outputBytes: audio.bytes,
        actualSamples: audio.bytes / 16,
        allOutputSamplesFinite: true,
        monoDuplicatedExactly: source.channels === 1,
        assembledSha256: audio.sha256,
      },
    };
    const sourceMapFile = join(directory, "source-map.json");
    const json = JSON.stringify(manifest);
    if (Buffer.byteLength(json) > PRODUCTION_LIMITS.reportBytes)
      throw new MediaFailure("MEDIA_OUTPUT_LIMIT", "音频源映射超过限额。");
    accountMediaWrite(Buffer.byteLength(json));
    await writeFile(sourceMapFile, json, { flag: "wx", mode: 0o600 });
    const sourceMap = await digest(sourceMapFile, signal);
    await rm(native);
    for (const segment of segments) await rm(segment.file);
    return { audio, sourceMap, manifest };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
