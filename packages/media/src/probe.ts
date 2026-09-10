import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import {
  ALLOWED_UPLOAD_MIMES,
  MEDIA_LIMITS,
  MediaFailure,
  validateByteCount,
  type ProbeResult,
} from "./policy.js";
import { runMediaProcess } from "./sandbox.js";

const decodeInput = [
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
  "-i",
  "/input",
];
type Stream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  time_base?: string;
  start_pts?: number | string;
  sample_rate?: string;
  channels?: number;
  nb_read_frames?: string;
  nb_read_packets?: string;
  disposition?: { attached_pic?: number };
};
type Probe = {
  streams?: Stream[];
  format?: { format_name?: string; duration?: string };
};
const failure = (code: string, message: string): never => {
  throw new MediaFailure(code, message);
};

function rational(value: string | undefined): [number, number] | undefined {
  if (!value || !/^[1-9][0-9]*\/[1-9][0-9]*$/.test(value)) return;
  const [a, b] = value.split("/").map(Number) as [number, number];
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return;
  return [a, b];
}
function microseconds(value: string | undefined) {
  if (!value || !/^\d+(\.\d+)?$/.test(value)) return;
  const [seconds = "0", fraction = ""] = value.split(".");
  const us =
    BigInt(seconds) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  if (us < 1n || us > BigInt(MEDIA_LIMITS.durationUs)) return;
  return Number(us);
}
async function signature(file: string) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      return "png";
    if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])))
      return "jpeg";
    if (bytes.toString("ascii", 0, 4) === "RIFF") {
      if (bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
      if (bytes.toString("ascii", 8, 12) === "WAVE") return "wav";
    }
    if (bytes.toString("ascii", 4, 8) === "ftyp")
      return bytes.toString("ascii", 8, 12) === "qt  " ? "mov" : "mp4";
    if (
      bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) &&
      bytes.includes(Buffer.from("webm"))
    )
      return "webm";
    if (bytes.toString("ascii", 0, 4) === "fLaC") return "flac";
    if (bytes.toString("ascii", 0, 4) === "OggS") return "ogg";
    if (
      bytes.toString("ascii", 0, 3) === "ID3" ||
      (bytes[0] === 255 && ((bytes[1] ?? 0) & 224) === 224)
    )
      return "mp3";
    return "unknown";
  } finally {
    await handle.close();
  }
}

export async function fileIntegrity(file: string) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    if (bytes > MEDIA_LIMITS.bytes)
      failure("FILE_SIZE_REJECTED", "文件超过 256 MiB。");
    hash.update(chunk);
  }
  validateByteCount(bytes);
  return { bytes, sha256: hash.digest("hex") };
}

/** Stream metadata plus full strict decode. Exact per-frame production maps belong to Editing. */
export async function probeMedia(
  file: string,
  mimeHint: string,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  if (!(ALLOWED_UPLOAD_MIMES as readonly string[]).includes(mimeHint))
    failure("FILE_TYPE_REJECTED", "当前不支持此文件类型。");
  const size = (await stat(file)).size;
  validateByteCount(size);
  if (["text/plain", "application/x-subrip"].includes(mimeHint)) {
    if (size > 2 * 1024 * 1024)
      failure("DOCUMENT_SIZE_REJECTED", "文本或字幕文件不能超过 2 MiB。");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(
        await readFile(file),
      );
    } catch {
      return failure(
        "DOCUMENT_ENCODING_REJECTED",
        "请使用 UTF-8 编码的文本文件。",
      );
    }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))
      failure("DOCUMENT_CONTENT_REJECTED", "文本包含无效控制字符。");
    if (
      mimeHint === "application/x-subrip" &&
      !/^\s*\d+\r?\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\r?\n\S/m.test(
        text,
      )
    )
      failure("SUBTITLE_FORMAT_REJECTED", "未找到有效 SRT 字幕条目。");
    return { kind: "document", mime: mimeHint, hasAudio: false };
  }
  const magic = await signature(file);
  const hinted: Record<string, string[]> = {
    png: ["image/png"],
    jpeg: ["image/jpeg"],
    webp: ["image/webp"],
    wav: ["audio/wav", "audio/x-wav"],
    mp4: ["video/mp4", "audio/mp4"],
    mov: ["video/quicktime"],
    webm: ["video/webm"],
    flac: ["audio/flac"],
    ogg: ["audio/ogg"],
    mp3: ["audio/mpeg"],
  };
  if (!hinted[magic]?.includes(mimeHint))
    failure(
      "FILE_SIGNATURE_MISMATCH",
      "文件签名与声明类型不一致，或格式尚不支持。",
    );
  let probe: Probe;
  try {
    probe = JSON.parse(
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
          "-count_packets",
          "-show_entries",
          "format=format_name,duration:stream=codec_type,codec_name,width,height,avg_frame_rate,time_base,start_pts,sample_rate,channels,nb_read_packets:stream_disposition=attached_pic",
          "-of",
          "json",
          "/input",
        ],
        { ...(signal ? { signal } : {}) },
      ),
    );
  } catch (error) {
    if (error instanceof MediaFailure) throw error;
    return failure("MEDIA_PROBE_FAILED", "无法读取文件媒体信息。");
  }
  const streams = probe.streams ?? [];
  const videos = streams.filter(
    (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
  );
  const audios = streams.filter((s) => s.codec_type === "audio");
  if (
    videos.length > 1 ||
    audios.length > 1 ||
    streams.some(
      (s) => !["video", "audio", "data"].includes(s.codec_type ?? ""),
    )
  )
    failure(
      "MEDIA_TRACKS_REJECTED",
      "首期导入支持一个画面轨和一个混合音轨，请先整理多轨文件。",
    );
  const image = ["png", "jpeg", "webp"].includes(magic);
  const video = videos[0],
    audio = audios[0];
  if (
    (!video && !audio) ||
    (image && (!video || audio)) ||
    (mimeHint.startsWith("audio/") && video) ||
    (mimeHint.startsWith("video/") && !video)
  )
    failure("MEDIA_TRACKS_REJECTED", "文件轨道与声明媒体类型不一致。");
  if (magic === "mp3" && !probe.format?.format_name?.split(",").includes("mp3"))
    failure("FILE_SIGNATURE_MISMATCH", "音频格式与声明不一致。");
  if (
    video &&
    (!Number.isInteger(video.width) ||
      !Number.isInteger(video.height) ||
      video.width! < 1 ||
      video.height! < 1)
  )
    failure("MEDIA_DECODE_FAILED", "无法从文件解出有效画面尺寸。");
  if (
    video &&
    (video.width! > MEDIA_LIMITS.dimension ||
      video.height! > MEDIA_LIMITS.dimension ||
      video.width! * video.height! > MEDIA_LIMITS.pixels)
  )
    failure("MEDIA_DIMENSIONS_REJECTED", "画面尺寸超出当前处理范围。");
  if (
    audio &&
    (!/^\d+$/.test(audio.sample_rate ?? "") ||
      Number(audio.sample_rate) < 8000 ||
      Number(audio.sample_rate) > 192000 ||
      !Number.isInteger(audio.channels) ||
      audio.channels! < 1 ||
      audio.channels! > 8)
  )
    failure("MEDIA_AUDIO_REJECTED", "音频采样率或声道数超出当前处理范围。");
  const durationUs = image ? undefined : microseconds(probe.format?.duration);
  if (!image && !durationUs)
    failure("MEDIA_DURATION_REJECTED", "媒体时长无效或超过两小时。");
  const fps = video && !image ? rational(video.avg_frame_rate) : undefined;
  if (video && !image && (!fps || fps[0] / fps[1] > 240))
    failure(
      "MEDIA_FRAMERATE_REJECTED",
      "无法确认有效帧率，或帧率超过 240 fps。",
    );
  if (
    [video, audio].some(
      (stream) => stream && !/^[1-9][0-9]*$/.test(stream.nb_read_packets ?? ""),
    )
  )
    failure("MEDIA_DECODE_FAILED", "媒体轨道没有可解码的数据包。");
  const decoded = await runMediaProcess(
    file,
    "/ffmpeg",
    [
      ...decodeInput,
      "-map",
      "0:v?",
      "-map",
      "0:a?",
      "-progress",
      "pipe:1",
      "-f",
      "null",
      "-",
    ],
    { ...(signal ? { signal } : {}) },
  );
  if (
    (video && !/^frame=\s*[1-9][0-9]*$/m.test(decoded)) ||
    (!video && !/^out_time_us=[1-9][0-9]*$/m.test(decoded))
  )
    failure("MEDIA_DECODE_FAILED", "未能解码出有效画面或声音。");
  if (image) {
    const frames = JSON.parse(
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
          "-count_frames",
          "-show_entries",
          "stream=nb_read_frames",
          "-of",
          "json",
          "/input",
        ],
        { ...(signal ? { signal } : {}) },
      ),
    ) as Probe;
    if (frames.streams?.[0]?.nb_read_frames !== "1")
      failure("ANIMATED_IMAGE_REJECTED", "当前图片导入仅支持静态图片。");
  }
  const timeBase = rational((video ?? audio)?.time_base);
  const startPts = (video ?? audio)?.start_pts;
  // ffprobe JSON numbers beyond the safe integer range are not accepted as timing evidence.
  if (
    startPts !== undefined &&
    !(typeof startPts === "number" && Number.isSafeInteger(startPts))
  )
    failure("MEDIA_TIMING_REJECTED", "媒体起始时间戳无法精确表示。");
  return {
    kind: image ? "image" : video ? "video" : "audio",
    mime: magic === "wav" ? "audio/wav" : mimeHint,
    hasAudio: !!audio,
    ...(durationUs === undefined ? {} : { durationUs }),
    ...(video ? { width: video.width!, height: video.height! } : {}),
    ...(fps ? { fpsNum: fps[0], fpsDen: fps[1] } : {}),
    ...(!image
      ? {
          timing: {
            frameRateMode: "unknown" as const,
            ...(timeBase
              ? { timeBaseNum: timeBase[0], timeBaseDen: timeBase[1] }
              : {}),
            ...(startPts === undefined ? {} : { startPts: String(startPts) }),
            ...(audio
              ? {
                  audioSampleRate: Number(audio.sample_rate),
                  audioChannels: audio.channels!,
                }
              : {}),
          },
        }
      : {}),
  };
}

export async function makeDerivative(
  file: string,
  source: ProbeResult,
  kind: "poster" | "proxy",
  outputFile: string,
  signal?: AbortSignal,
) {
  if (
    source.kind === "document" ||
    (kind === "poster" && source.kind === "audio")
  )
    failure("DERIVATIVE_NOT_SUPPORTED", "此媒体不支持所选预览类型。");
  if (source.kind === "image" && kind === "proxy")
    failure("DERIVATIVE_NOT_SUPPORTED", "静态图片使用海报预览。");
  const resize =
    "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2";
  const args =
    kind === "poster"
      ? [
          "-map",
          "0:v:0",
          "-frames:v",
          "1",
          "-vf",
          resize,
          "-c:v",
          "mjpeg",
          "-q:v",
          "3",
          "-f",
          "image2pipe",
          "pipe:1",
        ]
      : [
          ...(source.kind === "video"
            ? [
                "-map",
                "0:v:0",
                "-vf",
                `${resize},format=yuv420p`,
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "25",
                "-bf",
                "0",
                "-fps_mode",
                "passthrough",
                "-threads",
                "2",
              ]
            : []),
          ...(source.hasAudio
            ? [
                "-map",
                "0:a:0",
                "-c:a",
                "aac",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-b:a",
                "128k",
              ]
            : []),
          "-map_metadata",
          "-1",
          "-movflags",
          "+frag_keyframe+delay_moov+default_base_moof",
          "-f",
          "mp4",
          "pipe:1",
        ];
  await runMediaProcess(file, "/ffmpeg", [...decodeInput, ...args], {
    outputFile,
    maxBytes: kind === "poster" ? 8 * 1024 * 1024 : MEDIA_LIMITS.bytes,
    ...(signal ? { signal } : {}),
  });
  const mime =
    kind === "poster"
      ? "image/jpeg"
      : source.kind === "video"
        ? "video/mp4"
        : "audio/mp4";
  return {
    ...(await fileIntegrity(outputFile)),
    ...(await probeMedia(outputFile, mime, signal)),
    profileRevision: 1,
  };
}
