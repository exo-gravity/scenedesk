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
  const left = Array.from(a, (c) => c.codePointAt(0)!),
    right = Array.from(b, (c) => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++)
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  return left.length - right.length;
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
