export type FrameRate = Readonly<{ numerator: bigint; denominator: bigint }>;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
function validRate(rate: FrameRate) {
  if (rate.numerator <= 0n || rate.denominator <= 0n)
    throw new RangeError("Frame rate must be positive");
}
function microseconds(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("Time must be non-negative safe integer microseconds");
  return BigInt(value);
}
// This is the exact arithmetic kernel, not the complete media normalization pipeline.
export function inwardFrameRange(inUs: number, outUs: number, rate: FrameRate) {
  validRate(rate);
  const input = microseconds(inUs),
    output = microseconds(outUs);
  if (output <= input) throw new RangeError("Empty or reversed source range");
  const scale = 1_000_000n * rate.denominator;
  const start = ceilDiv(input * rate.numerator, scale);
  const end = (output * rate.numerator) / scale;
  if (end <= start)
    throw new RangeError("Source range is shorter than one full output frame");
  return { start, end, length: end - start };
}
export function frameToSample(
  frame: bigint,
  rate: FrameRate,
  sampleRate = 48_000n,
): bigint {
  validRate(rate);
  if (frame < 0n || sampleRate <= 0n)
    throw new RangeError("Invalid frame or sample rate");
  const a = frame * rate.denominator * sampleRate;
  return (2n * a + rate.numerator) / (2n * rate.numerator);
}
