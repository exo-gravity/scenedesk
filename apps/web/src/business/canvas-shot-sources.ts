import type { components } from "@drama/contracts";
export type ShotSource = components["schemas"]["ShotSource"];

/** A selection is ordered and contains one explicitly chosen revision per shot. */
export function fixedShotSources(
  sources: readonly ShotSource[] = [],
): ShotSource[] {
  if (!Array.isArray(sources) || sources.length > 100)
    throw Error("最多选择 100 个镜头来源，请保留原选择并核对。");
  const seen = new Set<string>();
  return sources.map((source) => {
    if (!source || !source.shotId || !source.shotRevisionId)
      throw Error("镜头来源缺少固定版本，请重新核对。");
    if (seen.has(source.shotId))
      throw Error("同一个镜头只能选择一个固定版本。");
    seen.add(source.shotId);
    return { shotId: source.shotId, shotRevisionId: source.shotRevisionId };
  });
}

/** Replacing a revision preserves the existing position; adding appends it. */
export function selectShotSource(
  sources: readonly ShotSource[],
  selected: ShotSource,
) {
  const position = sources.findIndex(
    (source) => source.shotId === selected.shotId,
  );
  return fixedShotSources(
    position < 0
      ? [...sources, selected]
      : sources.map((source, index) =>
          index === position ? selected : source,
        ),
  );
}

export function moveShotSource(
  sources: readonly ShotSource[],
  index: number,
  offset: -1 | 1,
) {
  const next = fixedShotSources(sources),
    target = index + offset;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length)
    return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
