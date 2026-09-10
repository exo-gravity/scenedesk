// Used only after the editor explicitly reviews a newer server version.
// Local changes win overlaps; untouched fields and remote additions survive.
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function identity(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!object(value)) return undefined;
  for (const key of ["id", "characterAssetId", "propAssetId"])
    if (typeof value[key] === "string") return `${key}:${value[key]}`;
  if (typeof value.mediaId === "string")
    return JSON.stringify([
      value.mediaId,
      value.purpose,
      value.assetRevisionId,
      value.subjectAssetId,
    ]);
  return undefined;
}
export function reconcileContent<T>(base: T, local: T, remote: T): T {
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  if (object(local) && object(remote)) {
    const before: Record<string, unknown> = object(base) ? base : {};
    const result: Record<string, unknown> = Object.fromEntries(
      [...new Set([...Object.keys(local), ...Object.keys(remote)])].flatMap(
        (key) => {
          const value = reconcileContent(before[key], local[key], remote[key]);
          return value === undefined ? [] : [[key, value]];
        },
      ),
    );
    const lookKeys = ["lookId", "lookAssetRevisionId"];
    if (
      lookKeys.some((key) => key in before || key in local || key in remote)
    ) {
      const preferred = lookKeys.every((key) => same(local[key], before[key]))
        ? remote
        : local;
      for (const key of lookKeys)
        if (preferred[key] === undefined) delete result[key];
        else result[key] = preferred[key];
    }
    return result as T;
  }
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const arrays = [base, local, remote];
    if (
      arrays.every(
        (values) =>
          values.every((value) => identity(value) !== undefined) &&
          new Set(values.map(identity)).size === values.length,
      )
    ) {
      const [b, l, r] = arrays.map(
        (values) => new Map(values.map((value) => [identity(value)!, value])),
      );
      return [...new Set([...l!.keys(), ...r!.keys()])].flatMap((key) => {
        const value = reconcileContent(b!.get(key), l!.get(key), r!.get(key));
        return value === undefined ? [] : [value];
      }) as T;
    }
  }
  return local;
}
