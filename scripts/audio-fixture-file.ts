import { writeFile } from "node:fs/promises";
/** Integer PCM sample count of a technical tone; no speech synthesis or voice cloning. */
export async function writeAudioFixture(file: string, durationSeconds = 2) {
  if (
    !Number.isSafeInteger(durationSeconds) ||
    durationSeconds < 1 ||
    durationSeconds > 10
  )
    throw new Error("Bounded integer technical fixture duration required");
  const rate = 48000,
    samples = rate * durationSeconds,
    dataBytes = samples * 2;
  const wave = Buffer.alloc(44 + dataBytes);
  wave.write("RIFF", 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(rate, 24);
  wave.writeUInt32LE(rate * 2, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(dataBytes, 40);
  for (let sample = 0; sample < samples; sample++)
    wave.writeInt16LE(
      Math.round(2400 * Math.sin((2 * Math.PI * 440 * sample) / rate)),
      44 + sample * 2,
    );
  await writeFile(file, wave, { flag: "wx", mode: 0o600 });
}
