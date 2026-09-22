import type { components } from "@drama/contracts";
type Schema<K extends keyof components["schemas"]> = components["schemas"][K];

export type Vendor = "minimax" | "volcengine";
export type ProfileMode = "frames_v1" | "reference_v1";
export type OutputTarget = { resolution: string; ratio: string };
export type Pricing =
  | { kind: "per_second"; revision: string; microsPerSecond: Record<string, number>; freeImages: number; extraImageMicros: number }
  | { kind: "per_token"; revision: string; microsPerMillion: Record<string, number> }
  | { kind: "per_image"; revision: string; microsPerImage: { standard: number; large?: number }; largeThresholdPixels?: number; freeInputImages?: number; extraInputImageMicros?: number };
export type ModelProfile = {
  id: string;
  vendor: Vendor;
  purpose: "video" | "image";
  providerModel: string;
  modes: readonly ProfileMode[];
  /** "<width>x<height>" → vendor tier. Empty until measured (H3). */
  outputs: Record<string, OutputTarget>;
  duration?: { min: number; max: number };
  audioOutput?: boolean;
  referenceImage: { maxCount: number; maxBytes: number; mimeTypes: readonly string[]; minSide: number; maxSide: number };
  pricing: Pricing;
  inflight: number | { personal: number; enterprise: number };
};
export type CapabilityDefinition = Omit<Schema<"Capability">, "id" | "connectionId" | "revision" | "enabled" | "createdAt" | "updatedAt">;

export class VerifiedProfileError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = "VerifiedProfileError"; }
}

const REFERENCE_PURPOSES = ["identity", "look", "style", "location", "prop", "composition"] as const;
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
const FOUR_MIB = 4 * 1024 * 1024;

const seedanceOutputs = (tiers: ("480p" | "720p" | "1080p")[]): Record<string, OutputTarget> => {
  const table: Record<string, Record<string, string>> = {
    "480p": { "16:9": "864x496", "9:16": "496x864", "1:1": "640x640", "4:3": "752x560", "3:4": "560x752", "21:9": "992x432" },
    "720p": { "16:9": "1280x720", "9:16": "720x1280", "1:1": "960x960", "4:3": "1112x834", "3:4": "834x1112", "21:9": "1470x630" },
    "1080p": { "16:9": "1920x1080", "9:16": "1080x1920", "1:1": "1440x1440", "4:3": "1664x1248", "3:4": "1248x1664", "21:9": "2206x946" },
  };
  const out: Record<string, OutputTarget> = {};
  for (const tier of tiers) for (const [ratio, size] of Object.entries(table[tier]!)) out[size] = { resolution: tier, ratio };
  return out;
};
const seedreamOutputs = (table: Record<string, Record<string, string>>): Record<string, OutputTarget> => {
  const out: Record<string, OutputTarget> = {};
  for (const [tier, ratios] of Object.entries(table)) for (const [ratio, size] of Object.entries(ratios)) out[size] = { resolution: tier, ratio };
  return out;
};
const seedreamPro = seedreamOutputs({
  "1K": { "1:1": "1024x1024", "16:9": "1424x800", "9:16": "800x1424", "4:3": "1152x864", "3:4": "864x1152", "3:2": "1248x832", "2:3": "832x1248", "21:9": "1568x672" },
  "1.5K": { "1:1": "1536x1536", "16:9": "2048x1152", "9:16": "1152x2048", "4:3": "1792x1344", "3:4": "1344x1792", "3:2": "1872x1248", "2:3": "1248x1872", "21:9": "2352x1008" },
  "2K": { "1:1": "2048x2048", "16:9": "2816x1584", "9:16": "1584x2816", "4:3": "2368x1776", "3:4": "1776x2368", "3:2": "2496x1664", "2:3": "1664x2496", "21:9": "3136x1344" },
});
const seedreamLite = seedreamOutputs({
  "2K": { "1:1": "2048x2048", "16:9": "2848x1600", "9:16": "1600x2848", "4:3": "2304x1728", "3:4": "1728x2304", "3:2": "2496x1664", "2:3": "1664x2496", "21:9": "3136x1344" },
});
const volcRef = { maxCount: 9, maxBytes: FOUR_MIB, mimeTypes: IMAGE_MIMES, minSide: 300, maxSide: 6000 };
const seedance = (id: string, providerModel: string, tiers: ("480p" | "720p" | "1080p")[], microsPerMillion: Record<string, number>, revision: string): ModelProfile => ({
  id, vendor: "volcengine", purpose: "video", providerModel, modes: ["frames_v1", "reference_v1"],
  outputs: seedanceOutputs(tiers), duration: { min: 4, max: 15 }, audioOutput: true, referenceImage: volcRef,
  pricing: { kind: "per_token", revision, microsPerMillion }, inflight: { personal: 3, enterprise: 8 },
});
export const PROFILES: readonly ModelProfile[] = [
  {
    id: "minimax/MiniMax-H3", vendor: "minimax", purpose: "video", providerModel: "MiniMax-H3",
    modes: ["frames_v1", "reference_v1"], outputs: {}, duration: { min: 4, max: 15 }, audioOutput: true,
    referenceImage: { maxCount: 9, maxBytes: FOUR_MIB, mimeTypes: IMAGE_MIMES, minSide: 256, maxSide: 5760 },
    pricing: { kind: "per_second", revision: "minimax-cn-2026-09-22", microsPerSecond: { "768P": 500000, "2K": 800000 }, freeImages: 5, extraImageMicros: 200000 },
    inflight: 8,
  },
  seedance("volcengine/doubao-seedance-2-0-260128", "doubao-seedance-2-0-260128", ["480p", "720p", "1080p"], { "480p": 46000000, "720p": 46000000, "1080p": 51000000 }, "ark-cn-2026-09-22"),
  seedance("volcengine/doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-fast-260128", ["480p", "720p"], { "480p": 37000000, "720p": 37000000 }, "ark-cn-2026-09-22"),
  seedance("volcengine/doubao-seedance-2-0-mini-260615", "doubao-seedance-2-0-mini-260615", ["480p", "720p"], { "480p": 23000000, "720p": 23000000 }, "ark-cn-2026-09-22"),
  {
    id: "volcengine/doubao-seedream-5-0-pro-260628", vendor: "volcengine", purpose: "image", providerModel: "doubao-seedream-5-0-pro-260628",
    modes: ["reference_v1"], outputs: seedreamPro, referenceImage: { ...volcRef, maxCount: 10, minSide: 15 },
    pricing: { kind: "per_image", revision: "ark-cn-2026-09-22", microsPerImage: { standard: 300000, large: 600000 }, largeThresholdPixels: 2610000, freeInputImages: 1, extraInputImageMicros: 20000 },
    inflight: 8,
  },
  {
    id: "volcengine/doubao-seedream-5-0-flash-260915", vendor: "volcengine", purpose: "image", providerModel: "doubao-seedream-5-0-flash-260915",
    modes: ["reference_v1"], outputs: seedreamPro, referenceImage: { ...volcRef, maxCount: 10, minSide: 15 },
    pricing: { kind: "per_image", revision: "ark-cn-2026-09-22", microsPerImage: { standard: 120000 } }, inflight: 8,
  },
  {
    id: "volcengine/doubao-seedream-5-0-260128", vendor: "volcengine", purpose: "image", providerModel: "doubao-seedream-5-0-260128",
    modes: ["reference_v1"], outputs: seedreamLite, referenceImage: { ...volcRef, maxCount: 14, minSide: 15 },
    pricing: { kind: "per_image", revision: "ark-cn-2026-09-22", microsPerImage: { standard: 220000 } }, inflight: 8,
  },
];
export function findProfile(id: string) { return PROFILES.find((p) => p.id === id); }
export function resolveOutput(profile: ModelProfile, resolution: string): OutputTarget {
  const target = profile.outputs[resolution];
  if (!target) throw new VerifiedProfileError("OUTPUT_NOT_IN_PROFILE");
  return target;
}
export function capabilityDefinition(profile: ModelProfile, mode: ProfileMode, options: { verifiedAt?: string }): CapabilityDefinition {
  if (!profile.modes.includes(mode)) throw new VerifiedProfileError("MODE_NOT_IN_PROFILE");
  const sizes = Object.keys(profile.outputs);
  if (sizes.length === 0) throw new VerifiedProfileError("OUTPUTS_UNMEASURED");
  const ref = profile.referenceImage;
  const rule = (purposes: string[], maxCount: number): Schema<"CapabilityInputRule"> => ({
    kind: "image", purposes, minCount: 0, maxCount, maxBytes: ref.maxBytes, mimeTypes: [...ref.mimeTypes],
    minWidth: ref.minSide, maxWidth: ref.maxSide, minHeight: ref.minSide, maxHeight: ref.maxSide,
  });
  const frames = mode === "frames_v1";
  return {
    purpose: profile.purpose,
    mode,
    modelVersion: profile.id,
    supportedPurposes: frames ? ["start_frame", "end_frame"] : [...REFERENCE_PURPOSES],
    inputRules: frames ? [rule(["start_frame"], 1), rule(["end_frame"], 1)] : [rule([...REFERENCE_PURPOSES], ref.maxCount)],
    allowedResolutions: sizes,
    allowedAspectRatios: [...new Set(sizes.map((s) => profile.outputs[s]!.ratio))],
    ...(profile.duration ? { minDurationSeconds: profile.duration.min, maxDurationSeconds: profile.duration.max } : {}),
    ...(profile.purpose === "video" ? { audioOutput: profile.audioOutput === true } : {}),
    maxReferences: frames ? 2 : ref.maxCount,
    cancelSupported: profile.purpose === "video",
    recoverySupported: false,
    executionMode: "verified_provider",
    ...(options.verifiedAt ? { verifiedAt: options.verifiedAt } : {}),
    notes: `pricingRevision=${profile.pricing.revision}; provider=${profile.vendor}/${profile.providerModel}`,
  };
}
const money = (micros: bigint): Schema<"Money"> => ({ currency: "CNY", amountMicros: micros.toString() });
export function estimateCost(profile: ModelProfile, resolved: Schema<"ResolvedInput">): Schema<"CostEstimate"> {
  const output = resolved.output ?? {};
  const references = resolved.references?.length ?? 0;
  const lines: Schema<"EstimateLine">[] = [];
  let base = 0n;
  const p = profile.pricing;
  if (p.kind === "per_second") {
    const tier = profile.outputs[output.resolution ?? ""]?.resolution ?? output.resolution ?? "";
    const unit = p.microsPerSecond[tier];
    if (unit === undefined || !output.durationSeconds) throw new VerifiedProfileError("ESTIMATE_INPUT_INVALID");
    const seconds = BigInt(output.durationSeconds);
    base += seconds * BigInt(unit);
    lines.push({ metric: `output_seconds@${tier}`, quantity: seconds.toString(), unit: "second", estimatedCost: money(seconds * BigInt(unit)) });
    const extra = Math.max(references - p.freeImages, 0);
    if (extra) { base += BigInt(extra * p.extraImageMicros); lines.push({ metric: "extra_reference_images", quantity: String(extra), unit: "image", estimatedCost: money(BigInt(extra * p.extraImageMicros)) }); }
  } else if (p.kind === "per_token") {
    const target = resolveOutput(profile, output.resolution ?? "");
    const [w, h] = (output.resolution ?? "").split("x").map(Number);
    if (!w || !h || !output.durationSeconds) throw new VerifiedProfileError("ESTIMATE_INPUT_INVALID");
    const tokens = Math.floor((output.durationSeconds * w * h * 24) / 1024);
    const unit = p.microsPerMillion[target.resolution];
    if (unit === undefined) throw new VerifiedProfileError("ESTIMATE_INPUT_INVALID");
    const amount = (BigInt(tokens) * BigInt(unit)) / 1000000n;
    base += amount;
    lines.push({ metric: `video_tokens@${target.resolution}`, quantity: String(tokens), unit: "token", estimatedCost: money(amount) });
  } else {
    const [w, h] = (output.resolution ?? "").split("x").map(Number);
    if (!w || !h) throw new VerifiedProfileError("ESTIMATE_INPUT_INVALID");
    resolveOutput(profile, output.resolution!);
    const large = p.largeThresholdPixels !== undefined && p.microsPerImage.large !== undefined && w * h > p.largeThresholdPixels;
    const unit = large ? p.microsPerImage.large! : p.microsPerImage.standard;
    base += BigInt(unit);
    lines.push({ metric: large ? "image@large" : "image@standard", quantity: "1", unit: "image", estimatedCost: money(BigInt(unit)) });
    const extra = Math.max(references - (p.freeInputImages ?? Infinity), 0);
    if (extra && p.extraInputImageMicros) { base += BigInt(extra * p.extraInputImageMicros); lines.push({ metric: "extra_input_images", quantity: String(extra), unit: "image", estimatedCost: money(BigInt(extra * p.extraInputImageMicros)) }); }
  }
  const hold = base / 5n;
  return { pricingRevision: p.revision, lines, baseCost: money(base), holdMargin: money(hold), totalReservation: money(base + hold),
    basisNote: `${profile.id}；按官方刊例价估算，预留 20% 余量；实际以供应商 usage 为准。` };
}
