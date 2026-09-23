import type { components } from "@drama/contracts";

type OutputOptions = Partial<components["schemas"]["OutputOptions"]>;
type Kind = "image" | "video" | "audio";
/** The parts of a capability record that constrain output options. */
export type SpecificationCapability = {
  allowedAspectRatios?: string[] | undefined;
  allowedResolutions?: string[] | undefined;
  minDurationSeconds?: number | undefined;
  maxDurationSeconds?: number | undefined;
  audioOutput?: boolean | undefined;
  outputs?: { resolution: string; aspectRatio: string; quality: string }[] | undefined;
};

/**
 * The one-line summary shown on the compact specification button. Only chosen
 * values appear; a field the user has not set is simply absent, so the button
 * never reads like a form label ("尺寸 · — 秒").
 */
export function specificationSummary({
  kind,
  output,
  capability,
  shotSourceCount = 0,
}: {
  kind: Kind;
  output: OutputOptions;
  capability?: SpecificationCapability | undefined;
  shotSourceCount?: number;
}): string | null {
  const parts: string[] = [];
  if (kind !== "audio") {
    if (output.aspectRatio) parts.push(output.aspectRatio);
    const quality = qualityOf(capability, output.resolution);
    if (quality) parts.push(quality);
  }
  if (kind !== "image" && output.durationSeconds !== undefined)
    parts.push(`${output.durationSeconds}s`);
  if (kind === "video" && output.withAudio === true) parts.push("有声");
  if (output.seed !== undefined) parts.push(`种子 ${output.seed}`);
  if (shotSourceCount > 0) parts.push(`${shotSourceCount} 镜头`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The ratios the panel offers. A vendor allows more — photographic ratios and
 * cinemascope among them — and the API still accepts every one of them; this
 * is the product's choice of what to put on screen, not a limit on the model.
 */
export const PANEL_ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;

/**
 * The ratio tiles for this model. A model that allows none of the three keeps
 * its own list: a panel with no selectable ratio could never be submitted.
 */
export function aspectRatioOptions(
  capability: SpecificationCapability | undefined,
): string[] {
  const allowed = capability?.allowedAspectRatios ?? [];
  const offered = PANEL_ASPECT_RATIOS.filter((ratio) => allowed.includes(ratio));
  return offered.length ? [...offered] : [...allowed];
}

/**
 * The quality tiers available at this ratio, each with the pixel size it
 * resolves to. Without an output table the flat resolution list stands in and
 * each size labels itself, which is what a record provisioned before the table
 * existed can offer.
 */
export function qualityOptions(
  capability: SpecificationCapability | undefined,
  aspectRatio: string | undefined,
): { quality: string; resolution: string }[] {
  if (!capability) return [];
  const outputs = capability.outputs;
  // Without the table nothing ties a size to a ratio, so the flat list stands
  // on its own — including before a ratio is chosen. A draft saved when the
  // ratio was still optional would otherwise lose the size it already has.
  if (!outputs?.length)
    return (capability.allowedResolutions ?? []).map((resolution) => ({
      quality: resolution,
      resolution,
    }));
  if (!aspectRatio) return [];
  return outputs
    .filter((output) => output.aspectRatio === aspectRatio)
    .map(({ quality, resolution }) => ({ quality, resolution }));
}

/** The one pixel size this ratio and tier name. */
export function resolutionFor(
  capability: SpecificationCapability | undefined,
  aspectRatio: string | undefined,
  quality: string | undefined,
): string | undefined {
  return qualityOptions(capability, aspectRatio).find((o) => o.quality === quality)
    ?.resolution;
}

/** The tier a pixel size belongs to; the size itself when nothing names it. */
export function qualityOf(
  capability: SpecificationCapability | undefined,
  resolution: string | undefined,
): string | undefined {
  if (!resolution) return undefined;
  const outputs = capability?.outputs;
  if (!outputs?.length) return resolution;
  return outputs.find((o) => o.resolution === resolution)?.quality ?? resolution;
}

/** How duration can be chosen for this model: a range, one fixed value, or not at all. */
export function durationControl(
  kind: Kind,
  capability: SpecificationCapability | undefined,
): { min: number; max: number } | { fixed: number } | null {
  if (kind === "image" || !capability) return null;
  const { minDurationSeconds: min, maxDurationSeconds: max } = capability;
  if (min === undefined || max === undefined) return null;
  return min === max ? { fixed: min } : { min, max };
}

/**
 * Output options after switching to `capability`. Everything the new model still
 * accepts survives; what it rejects is dropped rather than silently altered; a
 * choice the model leaves no room for (one resolution, one duration) is filled
 * in. The seed never depends on a model. Without a model only the seed remains.
 */
export function reconcileOutputForCapability({
  kind,
  output,
  capability,
}: {
  kind: Kind;
  output: OutputOptions;
  capability: SpecificationCapability | undefined;
}): OutputOptions {
  const next: OutputOptions = {};
  if (output.seed !== undefined) next.seed = output.seed;
  if (!capability) return next;
  if (kind !== "audio") {
    const ratios = aspectRatioOptions(capability);
    if (output.aspectRatio && ratios.includes(output.aspectRatio))
      next.aspectRatio = output.aspectRatio;
    else if (ratios.length === 1) next.aspectRatio = ratios[0]!;
    const qualities = qualityOptions(capability, next.aspectRatio);
    // The size in hand survives only where it belongs to the ratio that stuck.
    const kept = qualities.find((o) => o.resolution === output.resolution);
    if (kept) next.resolution = kept.resolution;
    else if (qualities.length === 1) next.resolution = qualities[0]!.resolution;
  }
  if (kind !== "image") {
    const duration = durationControl(kind, capability);
    if (duration && "fixed" in duration) next.durationSeconds = duration.fixed;
    else if (
      output.durationSeconds !== undefined &&
      (!duration ||
        (output.durationSeconds >= duration.min &&
          output.durationSeconds <= duration.max))
    )
      next.durationSeconds = output.durationSeconds;
  }
  if (kind === "video" && capability.audioOutput === true && output.withAudio)
    next.withAudio = true;
  return next;
}
