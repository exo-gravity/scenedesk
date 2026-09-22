export type HttpOutcome =
  | { kind: "ok"; status: number; body: unknown }
  | { kind: "rejected"; status: number; body: unknown }
  | { kind: "unavailable"; status?: number; reason: "timeout" | "network" | "non_json" | "too_large" | "http_5xx" | "http_429" };

/** One bounded attempt. Never retries, never throws for transport problems. */
export async function jsonRequest(
  fetchImpl: typeof fetch,
  url: string,
  init: { method: "GET" | "POST" | "DELETE"; headers: Record<string, string>; body?: unknown; signal: AbortSignal; maxBodyBytes: number },
): Promise<HttpOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method,
      headers: { accept: "application/json", ...init.headers, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: init.signal,
      redirect: "error",
    });
  } catch (error) {
    return { kind: "unavailable", reason: init.signal.aborted || (error as Error)?.name === "TimeoutError" || (error as Error)?.name === "AbortError" ? "timeout" : "network" };
  }
  const status = response.status;
  if (status === 429) { response.body?.cancel().catch(() => undefined); return { kind: "unavailable", status, reason: "http_429" }; }
  if (status >= 500) { response.body?.cancel().catch(() => undefined); return { kind: "unavailable", status, reason: "http_5xx" }; }
  let text: string;
  try {
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader)
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > init.maxBodyBytes) { await reader.cancel(); return { kind: "unavailable", status, reason: "too_large" }; }
        chunks.push(chunk.value);
      }
    text = Buffer.concat(chunks).toString("utf8");
  } catch {
    return { kind: "unavailable", status, reason: init.signal.aborted ? "timeout" : "network" };
  }
  let body: unknown;
  try { body = text === "" ? {} : JSON.parse(text); } catch { return { kind: "unavailable", status, reason: "non_json" }; }
  if (status >= 200 && status < 300) return { kind: "ok", status, body };
  return { kind: "rejected", status, body };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function errorCode(body: unknown, fallback: string): string {
  const candidates: unknown[] = [];
  if (object(body)) {
    if (object(body.error)) candidates.push(body.error.type, body.error.code);
    candidates.push(body.code);
    if (object(body.base_resp)) candidates.push(body.base_resp.status_code);
  }
  for (const c of candidates) {
    if (typeof c === "number" && Number.isSafeInteger(c)) return String(c);
    if (typeof c === "string") { const clean = c.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80); if (clean) return clean; }
  }
  return fallback;
}
