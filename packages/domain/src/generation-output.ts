/** Nominal vendor ratios come from fixed output pairs; legacy capabilities use exact geometry. */
export function supportsVisualOutput(
  capability: {
    allowedResolutions?: readonly string[];
    allowedAspectRatios?: readonly string[];
    outputs?: readonly { resolution: string; aspectRatio: string }[];
  },
  resolution: string,
  aspectRatio?: string,
): boolean {
  const size = /^(\d+)x(\d+)$/.exec(resolution)?.slice(1).map(Number);
  if (
    !capability.allowedResolutions?.includes(resolution) ||
    !size?.every((n) => Number.isSafeInteger(n) && n > 0)
  )
    return false;
  const ratio = aspectRatio
    ? /^(\d+):(\d+)$/.exec(aspectRatio)?.slice(1).map(Number)
    : undefined;
  if (
    aspectRatio &&
    (!capability.allowedAspectRatios?.includes(aspectRatio) ||
      !ratio?.every((n) => Number.isSafeInteger(n) && n > 0))
  )
    return false;
  if (capability.outputs?.length)
    return capability.outputs.some(
      (output) =>
        output.resolution === resolution &&
        (!aspectRatio || output.aspectRatio === aspectRatio),
    );
  return (
    !ratio ||
    BigInt(size[0]!) * BigInt(ratio[1]!) ===
      BigInt(size[1]!) * BigInt(ratio[0]!)
  );
}
