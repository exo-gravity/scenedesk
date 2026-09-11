/** Versioned editing JSON encoding. Do not substitute the older command hash. */
export const EDITING_HASH_VERSION = "editing-json-v1" as const;

function scalarString(value: string) {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff)
      throw new TypeError("Editing JSON requires Unicode scalar strings");
  }
  return JSON.stringify(value);
}
function compareCodePoints(a: string, b: string): number {
  // Advance through UTF-16 by scalar width without allocating two arrays for
  // every sort comparison. codePointAt also preserves Array.from's treatment
  // of lone surrogates; scalarString rejects those during encoding as before.
  let left = 0,
    right = 0;
  while (left < a.length && right < b.length) {
    const leftPoint = a.codePointAt(left)!,
      rightPoint = b.codePointAt(right)!;
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
    left += leftPoint > 0xffff ? 2 : 1;
    right += rightPoint > 0xffff ? 2 : 1;
  }
  return left < a.length ? 1 : right < b.length ? -1 : 0;
}

/** The result is browser/server portable; SHA-256 is applied to its UTF-8 bytes. */
export function editingCanonical(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown, depth: number): string {
    if (depth > 128) throw new TypeError("Editing JSON is too deeply nested");
    if (item === null) return "null";
    if (typeof item === "string") return scalarString(item);
    if (typeof item === "boolean") return String(item);
    if (typeof item === "number" && Number.isFinite(item))
      return JSON.stringify(item); // ECMAScript number representation, including -0 -> 0.
    if (typeof item !== "object") throw new TypeError("Expected JSON value");
    if (ancestors.has(item)) throw new TypeError("Editing JSON is cyclic");
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        const entries = [];
        for (let i = 0; i < item.length; i++) {
          if (!Object.hasOwn(item, i)) throw new TypeError("Sparse JSON array");
          entries.push(encode(item[i], depth + 1));
        }
        return `[${entries.join(",")}]`;
      }
      if (
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      )
        throw new TypeError("Expected plain JSON object");
      if (Object.getOwnPropertySymbols(item).length)
        throw new TypeError("JSON does not have symbol keys");
      // Build directly: JSON.stringify(object) would reorder integer-like keys.
      return `{${Object.keys(item)
        .sort(compareCodePoints)
        .map(
          (key) =>
            `${scalarString(key)}:${encode((item as Record<string, unknown>)[key], depth + 1)}`,
        )
        .join(",")}}`;
    } finally {
      ancestors.delete(item);
    }
  }
  return encode(value, 0);
}
