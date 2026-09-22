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
};

/**
 * The one-line summary shown on the compact specification button. Only chosen
 * values appear; a field the user has not set is simply absent, so the button
 * never reads like a form label ("尺寸 · — 秒").
 */
export function specificationSummary({
  kind,
  output,
  shotSourceCount = 0,
}: {
  kind: Kind;
  output: OutputOptions;
  shotSourceCount?: number;
}): string | null {
  const parts: string[] = [];
  if (kind !== "audio") {
    if (output.aspectRatio) parts.push(output.aspectRatio);
    if (output.resolution) parts.push(output.resolution);
  }
  if (kind !== "image" && output.durationSeconds !== undefined)
    parts.push(`${output.durationSeconds} 秒`);
  if (kind === "video" && output.withAudio === true) parts.push("有声");
  if (output.seed !== undefined) parts.push(`种子 ${output.seed}`);
  if (shotSourceCount > 0) parts.push(`${shotSourceCount} 镜头`);
  return parts.length ? parts.join(" · ") : null;
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
    const ratios = capability.allowedAspectRatios ?? [];
    if (output.aspectRatio && ratios.includes(output.aspectRatio))
      next.aspectRatio = output.aspectRatio;
    else if (ratios.length === 1) next.aspectRatio = ratios[0]!;
    const resolutions = capability.allowedResolutions ?? [];
    if (output.resolution && resolutions.includes(output.resolution))
      next.resolution = output.resolution;
    else if (resolutions.length === 1) next.resolution = resolutions[0]!;
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
