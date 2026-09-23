import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createMinimaxAdapter, type VerifiedDeps } from "@drama/provider";

const read = (req: IncomingMessage) => new Promise<any>((resolve) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => resolve(s ? JSON.parse(s) : undefined)); });
async function fakeMinimax() {
  const calls: { method: string; url: string; auth?: string | undefined; body?: any }[] = [];
  let mode: "ok" | "422" | "429" | "503" | "drop" = "ok";
  let status: "queued" | "running" | "succeeded" | "failed" = "queued";
  const server = createServer(async (req, res) => {
    const body = await read(req);
    calls.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
    const json = (code: number, value: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (req.url === "/result.mp4") return res.writeHead(200).end(Buffer.from("mp4-bytes"));
    if (req.method === "POST" && req.url === "/v2/video_generation") {
      if (mode === "422") return json(422, { type: "error", error: { type: "unprocessable_entity_error", message: "sensitive" }, request_id: "r" });
      if (mode === "429") return json(429, { type: "error", error: { type: "rate_limit_error" } });
      if (mode === "503") return json(503, { type: "error", error: { type: "server_error" } });
      if (mode === "drop") return req.socket.destroy();
      return json(200, { task_id: "mm-task-1" });
    }
    if (req.method === "GET" && req.url === "/v2/query/video_generation/mm-task-1")
      return json(200, { task: { id: "mm-task-1", status, ...(status === "succeeded" ? { content: { url: `${origin}/result.mp4` }, usage: { output_seconds: 5, input_seconds: 0, input_image_count: 1, total_seconds: 5 } } : {}), ...(status === "failed" ? { error: { code: 1026, message: "sensitive" } } : {}) } });
    if (req.method === "DELETE" && req.url === "/v2/video_generation/mm-task-1")
      return status === "queued" ? json(200, { task_id: "mm-task-1", action: "cancelled", status: "cancelled" }) : json(400, { error: { type: "bad_request_error", message: "not operable" } });
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { origin, calls, setMode: (m: typeof mode) => (mode = m), setStatus: (s: typeof status) => (status = s), close: () => new Promise<void>((r) => server.close(() => r())) };
}
async function deps(): Promise<VerifiedDeps & { published: any[] }> {
  const dir = await mkdtemp(join(tmpdir(), "verified-minimax-"));
  const png = Buffer.from("png-bytes");
  const published: any[] = [];
  return {
    published, fetch, tmpdir: dir,
    store: {
      async download(_s: unknown, file: string) { await writeFile(file, png); },
      async publish(_f: string, data: { bytes: number; sha256: string; mime: string }) { published.push(data); return { key: "originals/00000000-0000-4000-8000-000000000000", versionId: "v1", bytes: data.bytes, sha256: data.sha256 }; },
    },
    async resolveMedia() { return [{ id: "media-1", kind: "image", mime: "image/png", bytes: png.length, sha256: createHash("sha256").update(png).digest("hex"), width: 1280, height: 720, object: { key: "originals/in", versionId: "v0" } }]; },
  };
}
const submission = (overrides: Record<string, unknown> = {}) => ({
  attemptId: "attempt-1", jobId: "job-1", connectionVersionId: "cv-minimax", requestHash: "h", executionMode: "verified_provider" as const,
  input: { purpose: "video" } as any,
  resolvedInput: {
    prompt: "一个女孩推门", references: [{ reference: { mediaId: "media-1", purpose: "start_frame" }, sourceLevel: "shot" }],
    capabilitySnapshot: { modelVersion: "minimax/MiniMax-H3", mode: "frames_v1" }, output: { resolution: "1344x768", durationSeconds: 5, withAudio: true },
    ...overrides,
  } as any,
});

test("MiniMax submit sends one v2 request with bearer auth, data URI frame and returns accepted", async (t) => {
  const mm = await fakeMinimax(); t.after(mm.close);
  const d = await deps();
  const adapter = createMinimaxAdapter({ connectionVersionId: "cv-minimax", apiKey: "k", baseUrl: mm.origin, deps: d });
  const receipt = await adapter.submitOnce(submission(), AbortSignal.timeout(2000));
  assert.deepEqual(receipt, { kind: "accepted", correlation: "attempt-1", providerJobId: "mm-task-1" });
  assert.equal(mm.calls.length, 1);
  const call = mm.calls[0]!;
  assert.equal(call.auth, "Bearer k");
  assert.equal(call.body.model, "MiniMax-H3");
  assert.deepEqual([call.body.resolution, call.body.duration, call.body.ratio, call.body.aigc_watermark], ["768P", 5, "16:9", false]);
  assert.equal(call.body.content[0].type, "text");
  assert.equal(call.body.content[1].role, "first_frame");
  assert.ok(call.body.content[1].image_url.url.startsWith("data:image/png;base64,"));
});
test("MiniMax submit sends reference_v1 images with role reference_image and the measured 9:16 target (MV-02, 2026-09-23)", async (t) => {
  const mm = await fakeMinimax(); t.after(mm.close);
  const d = await deps();
  const png = Buffer.from("png-bytes");
  const media = (id: string) => ({ id, kind: "image", mime: "image/png", bytes: png.length, sha256: createHash("sha256").update(png).digest("hex"), width: 1280, height: 720, object: { key: `originals/${id}`, versionId: "v0" } });
  d.resolveMedia = async () => [media("media-1"), media("media-2")] as any;
  const adapter = createMinimaxAdapter({ connectionVersionId: "cv-minimax", apiKey: "k", baseUrl: mm.origin, deps: d });
  const receipt = await adapter.submitOnce(
    submission({
      references: [
        { reference: { mediaId: "media-1", purpose: "identity" }, sourceLevel: "shot" },
        { reference: { mediaId: "media-2", purpose: "look" }, sourceLevel: "shot" },
      ],
      capabilitySnapshot: { modelVersion: "minimax/MiniMax-H3", mode: "reference_v1" },
      output: { resolution: "768x1344", durationSeconds: 4, withAudio: true },
    }),
    AbortSignal.timeout(2000),
  );
  assert.deepEqual(receipt, { kind: "accepted", correlation: "attempt-1", providerJobId: "mm-task-1" });
  const call = mm.calls.find((c) => c.method === "POST")!;
  assert.equal(call.body.model, "MiniMax-H3");
  assert.equal(call.body.resolution, "768P");
  assert.equal(call.body.ratio, "9:16");
  assert.equal(call.body.duration, 4);
  assert.ok(call.body.content[0].text.startsWith("一个女孩推门"));
  assert.deepEqual(
    call.body.content.slice(1).map((c: any) => [c.type, c.role, c.image_url.url.slice(0, 22)]),
    [["image_url", "reference_image", "data:image/png;base64,"], ["image_url", "reference_image", "data:image/png;base64,"]],
  );
});
test("MiniMax submit maps 422 to rejected with vendor code, 429 to PROVIDER_RATE_LIMITED, 503 and dropped socket to unknown", async (t) => {
  const mm = await fakeMinimax(); t.after(mm.close);
  const adapter = createMinimaxAdapter({ connectionVersionId: "cv-minimax", apiKey: "k", baseUrl: mm.origin, deps: await deps() });
  mm.setMode("422");
  assert.deepEqual(await adapter.submitOnce(submission(), AbortSignal.timeout(2000)), { kind: "rejected", correlation: "attempt-1", code: "MINIMAX_unprocessable_entity_error" });
  mm.setMode("429");
  assert.deepEqual(await adapter.submitOnce(submission(), AbortSignal.timeout(2000)), { kind: "rejected", correlation: "attempt-1", code: "PROVIDER_RATE_LIMITED" });
  mm.setMode("503");
  assert.deepEqual(await adapter.submitOnce(submission(), AbortSignal.timeout(2000)), { kind: "unknown", correlation: "attempt-1" });
  mm.setMode("drop");
  assert.deepEqual(await adapter.submitOnce(submission(), AbortSignal.timeout(2000)), { kind: "unknown", correlation: "attempt-1" });
  assert.equal(mm.calls.filter((c) => c.method === "POST").length, 4);
});
test("MiniMax submit rejects locally without a request when the profile or output is not configured", async (t) => {
  const mm = await fakeMinimax(); t.after(mm.close);
  const adapter = createMinimaxAdapter({ connectionVersionId: "cv-minimax", apiKey: "k", baseUrl: mm.origin, deps: await deps() });
  // 1366x768 is the size the documentation suggested before MV-01 measured 1344x768; it is not in the profile.
  const receipt = await adapter.submitOnce(submission({ output: { resolution: "1366x768", durationSeconds: 5, withAudio: true } }), AbortSignal.timeout(2000));
  assert.deepEqual(receipt, { kind: "rejected", correlation: "attempt-1", code: "OUTPUT_NOT_IN_PROFILE" });
  const wrongVendor = await adapter.submitOnce(submission({ capabilitySnapshot: { modelVersion: "volcengine/doubao-seedance-2-0-260128", mode: "frames_v1" } }), AbortSignal.timeout(2000));
  assert.equal((wrongVendor as any).code, "VENDOR_MISMATCH");
  assert.equal(mm.calls.length, 0);
});
test("MiniMax query maps statuses, downloads and archives on success, cancels only queued", async (t) => {
  const mm = await fakeMinimax(); t.after(mm.close);
  const d = await deps();
  const adapter = createMinimaxAdapter({ connectionVersionId: "cv-minimax", apiKey: "k", baseUrl: mm.origin, deps: d });
  const task = { ...submission(), providerJobId: "mm-task-1" };
  assert.equal((await adapter.query!(task, AbortSignal.timeout(2000))).kind, "pending");
  mm.setStatus("running");
  assert.equal((await adapter.query!(task, AbortSignal.timeout(2000))).kind, "running");
  mm.setStatus("succeeded");
  const done = await adapter.query!(task, AbortSignal.timeout(2000));
  assert.equal(done.kind, "completed");
  assert.deepEqual((done as any).output, { videos: [{ kind: "fixture_object", object: { key: "originals/00000000-0000-4000-8000-000000000000", versionId: "v1", bytes: 9 }, sha256: createHash("sha256").update("mp4-bytes").digest("hex"), mime: "video/mp4" }] });
  assert.deepEqual((done as any).usage, { output_seconds: 5, input_seconds: 0, input_image_count: 1, total_seconds: 5 });
  assert.equal(d.published[0]!.mime, "video/mp4");
  mm.setStatus("failed");
  assert.deepEqual(await adapter.query!(task, AbortSignal.timeout(2000)), { kind: "failed", correlation: "attempt-1", providerJobId: "mm-task-1", code: "MINIMAX_1026" });
  mm.setStatus("queued");
  assert.equal((await adapter.requestCancel!(task, AbortSignal.timeout(2000))).kind, "cancelled");
  mm.setStatus("running");
  assert.equal((await adapter.requestCancel!(task, AbortSignal.timeout(2000))).kind, "cancel_unsupported");
  assert.equal(await adapter.recoverSubmission(submission(), AbortSignal.timeout(2000)), null);
});
