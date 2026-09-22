import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { jsonRequest, errorCode } from "@drama/provider";

async function serve(handler: Parameters<typeof createServer>[1]) {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
const init = (signal = AbortSignal.timeout(2000)) => ({ method: "POST" as const, headers: { authorization: "Bearer x" }, body: { a: 1 }, signal, maxBodyBytes: 1024 });

test("2xx JSON is ok, 4xx is rejected, 429 and 5xx are unavailable", async (t) => {
  const s = await serve((req, res) => {
    const status = Number(new URL(req.url!, "http://x").searchParams.get("s"));
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ status }));
  });
  t.after(s.close);
  assert.equal((await jsonRequest(fetch, `${s.origin}/?s=200`, init())).kind, "ok");
  assert.equal((await jsonRequest(fetch, `${s.origin}/?s=422`, init())).kind, "rejected");
  const r429 = await jsonRequest(fetch, `${s.origin}/?s=429`, init());
  assert.deepEqual([r429.kind, (r429 as any).reason], ["unavailable", "http_429"]);
  const r503 = await jsonRequest(fetch, `${s.origin}/?s=503`, init());
  assert.deepEqual([r503.kind, (r503 as any).reason], ["unavailable", "http_5xx"]);
});
test("oversized, non-JSON and timed-out responses are unavailable and never throw", async (t) => {
  const s = await serve((req, res) => {
    const mode = new URL(req.url!, "http://x").searchParams.get("m");
    if (mode === "big") res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ pad: "x".repeat(5000) }));
    else if (mode === "html") res.writeHead(200, { "content-type": "text/html" }).end("<html>");
    else setTimeout(() => res.writeHead(200).end("{}"), 1500);
  });
  t.after(s.close);
  assert.equal(((await jsonRequest(fetch, `${s.origin}/?m=big`, init())) as any).reason, "too_large");
  assert.equal(((await jsonRequest(fetch, `${s.origin}/?m=html`, init())) as any).reason, "non_json");
  assert.equal(((await jsonRequest(fetch, `${s.origin}/?m=slow`, init(AbortSignal.timeout(200)))) as any).reason, "timeout");
});
test("connection refused is a network unavailable outcome", async () => {
  const r = await jsonRequest(fetch, "http://127.0.0.1:9/", init());
  assert.deepEqual([r.kind, (r as any).reason], ["unavailable", "network"]);
});
test("errorCode extracts vendor codes and sanitizes", () => {
  assert.equal(errorCode({ error: { type: "insufficient_balance_error" } }, "X"), "insufficient_balance_error");
  assert.equal(errorCode({ code: "ModelNotOpen" }, "X"), "ModelNotOpen");
  assert.equal(errorCode({ base_resp: { status_code: 1026 } }, "X"), "1026");
  assert.equal(errorCode({ error: { code: "bad code!! <script>" } }, "X"), "badcodescript");
  assert.equal(errorCode("nope", "FALLBACK"), "FALLBACK");
});
test("rejecting cancel() on 5xx responses never escapes", async () => {
  const mockFetch = async () => ({
    status: 503,
    body: {
      cancel: async () => { throw new Error("cancel failed"); },
    },
  }) as unknown as Response;
  const r = await jsonRequest(mockFetch, "http://x/", { method: "GET" as const, headers: {}, signal: AbortSignal.timeout(2000), maxBodyBytes: 1024 });
  assert.deepEqual([r.kind, (r as any).reason], ["unavailable", "http_5xx"]);
});
