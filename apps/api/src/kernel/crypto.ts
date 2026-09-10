import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const token = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error("Non-JSON value");
  return result;
}
export class Secrets {
  private readonly key: Buffer;
  constructor(key: string) {
    this.key = Buffer.from(key, "base64url");
    if (this.key.length !== 32)
      throw new Error(
        "Application secret must contain 32 random bytes (base64url)",
      );
  }
  csrf(session: string) {
    return createHmac("sha256", this.key)
      .update(`csrf:v1:${session}`)
      .digest("base64url");
  }
  equal(a: string, b: string) {
    const left = Buffer.from(a),
      right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
  seal(value: unknown, context: string): string {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), body]
      .map((b) => b.toString("base64url"))
      .join(".");
  }
  open<T>(value: string, context: string): T {
    const parts = value.split(".");
    if (parts.length !== 3) throw new Error("Invalid encrypted value");
    const [iv, tag, body] = parts.map((p) => Buffer.from(p, "base64url")) as [
      Buffer,
      Buffer,
      Buffer,
    ];
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"),
    ) as T;
  }
}
