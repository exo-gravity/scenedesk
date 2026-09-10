export class Problem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export function requireThat(
  condition: unknown,
  status: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new Problem(status, code, message);
}
export function versionMatches(actual: number, expected?: number) {
  requireThat(
    expected !== undefined && actual === expected,
    412,
    "VERSION_CONFLICT",
    "内容已更新，请读取最新版本后重试。",
  );
}
