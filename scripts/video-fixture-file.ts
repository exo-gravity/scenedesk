import { runMediaProcess } from "../packages/media/src/sandbox.js";
/** A local technical motion/tone source, never a model output or creative acceptance sample. */
export async function writeVideoFixture(
  file: string,
  withAudio: boolean,
  resolution = "256x144",
  seconds = 2,
) {
  if (!(seconds > 0 && seconds <= 30))
    throw new Error("Technical fixture duration must be within 30 seconds");
  if (
    !/^[1-9][0-9]*x[1-9][0-9]*$/.test(resolution) ||
    resolution.split("x").some((n) => Number(n) > 8192 || Number(n) % 2 !== 0)
  )
    throw new Error("Technical fixture requires bounded even dimensions");
  await runMediaProcess(
    undefined,
    "/ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=${resolution}:rate=24`,
      ...(withAudio
        ? ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"]
        : []),
      "-t",
      String(seconds),
      "-map",
      "0:v:0",
      ...(withAudio
        ? ["-map", "1:a:0", "-c:a", "aac", "-ar", "48000", "-ac", "1"]
        : ["-an"]),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-bf",
      "0",
      "-threads",
      "2",
      "-movflags",
      "+frag_keyframe+delay_moov+default_base_moof",
      "-f",
      "mp4",
      "pipe:1",
    ],
    { outputFile: file, maxBytes: 16 * 1024 * 1024 },
  );
}
