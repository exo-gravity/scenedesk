/** Decimal seconds at the source boundary. Never multiply a float into a stored timestamp. */
export function parseSourceSeconds(value: string): number | undefined {
  if (value.trim().length > 17) return undefined;
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(value.trim());
  if (!match) return undefined;
  const us =
    BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
  return us <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(us) : undefined;
}
export function sourceSeconds(us: number): string {
  const value = BigInt(us);
  return `${value / 1_000_000n}.${String(value % 1_000_000n).padStart(6, "0")}`.replace(
    /\.?0+$/,
    "",
  );
}
