import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createVolcengineAdapter, type VerifiedDeps } from "@drama/provider";

const read = (req: IncomingMessage) => new Promise<any>((resolve) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => resolve(s ? JSON.parse(s) : undefined)); });
async function fakeArk() {
  const calls: { method: string; url: string; body?: any }[] = [];
  let status: "queued" | "running" | "succeeded" | "failed" | "expired" = "queued";
  let imageMode: "ok" | "sensitive" | "500" = "ok";
  const server = createServer(async (req, res) => {
    const body = await read(req);
    calls.push({ method: req.method!, url: req.url!, body });
    const json = (code: number, value: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (req.url === "/result.mp4") return res.writeHead(200).end(Buffer.from("ark-mp4"));
    if (req.method === "POST" && req.url === "/api/v3/contents/generations/tasks") return json(200, { id: "cgt-1" });
    if (req.method === "GET" && req.url === "/api/v3/contents/generations/tasks/cgt-1")
      return json(200, { id: "cgt-1", model: "doubao-seedance-2-0-mini-260615", status, ...(status === "succeeded" ? { content: { video_url: `${origin}/result.mp4` }, usage: { completion_tokens: 108000, total_tokens: 108000 }, duration: 5 } : {}), ...(status === "failed" ? { error: { code: "OutputVideoSensitiveContentDetected", message: "x" } } : {}) });
    if (req.method === "DELETE" && req.url === "/api/v3/contents/generations/tasks/cgt-1") return status === "queued" ? json(200, {}) : json(400, { code: "InvalidParameter", message: "only queued" });
    if (req.method === "POST" && req.url === "/api/v3/images/generations") {
      if (imageMode === "sensitive") return json(400, { error: { code: "InputImageSensitiveContentDetected", message: "x" } });
      if (imageMode === "500") return json(500, { error: { code: "InternalServiceError" } });
      return json(200, { model: "doubao-seedream-5-0-flash-260915", created: 1, data: [{ b64_json: Buffer.from("jpeg-bytes").toString("base64"), size: "2048x2048", output_format: "jpeg" }], usage: { generated_images: 1, output_tokens: 16384, total_tokens: 16384 } });
    }
    json(404, { code: "NotFound" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { origin, calls, setStatus: (s: typeof status) => (status = s), setImageMode: (m: typeof imageMode) => (imageMode = m), close: () => new Promise<void>((r) => server.close(() => r())) };
}
async function deps(): Promise<VerifiedDeps & { published: any[] }> {
  const dir = await mkdtemp(join(tmpdir(), "verified-ark-"));
  const png = Buffer.from("png-bytes");
  const published: any[] = [];
  return {
    published, fetch, tmpdir: dir,
    store: {
      async download(_s: unknown, file: string) { await writeFile(file, png); },
      async publish(_f: string, data: { bytes: number; sha256: string; mime: string }) { published.push(data); return { key: "originals/00000000-0000-4000-8000-000000000000", versionId: "v1", bytes: data.bytes, sha256: data.sha256 }; },
    },
    async resolveMedia() { return [{ id: "media-1", kind: "image", mime: "image/png", bytes: png.length, sha256: createHash("sha256").update(png).digest("hex"), width: 1024, height: 1024, object: { key: "originals/in", versionId: "v0" } }]; },
  };
}
const videoSubmission = () => ({
  attemptId: "attempt-1", jobId: "job-1", connectionVersionId: "cv-ark", requestHash: "h", executionMode: "verified_provider" as const,
  input: { purpose: "video" } as any,
  resolvedInput: { prompt: "她推门进来", references: [{ reference: { mediaId: "media-1", purpose: "identity" }, sourceLevel: "shot" }],
    capabilitySnapshot: { modelVersion: "volcengine/doubao-seedance-2-0-mini-260615", mode: "reference_v1" }, output: { resolution: "720x1280", durationSeconds: 5, withAudio: true } } as any,
});
const imageSubmission = () => ({
  attemptId: "attempt-2", jobId: "job-2", connectionVersionId: "cv-ark", requestHash: "h", executionMode: "verified_provider" as const,
  input: { purpose: "image" } as any,
  resolvedInput: { prompt: "海报", references: [], capabilitySnapshot: { modelVersion: "volcengine/doubao-seedream-5-0-flash-260915", mode: "reference_v1" }, output: { resolution: "2048x2048" } } as any,
});

test("Seedance submit: reference image, legend appended, mono audio on, watermark off, 6h expiry", async (t) => {
  const ark = await fakeArk(); t.after(ark.close);
  const adapter = createVolcengineAdapter({ connectionVersionId: "cv-ark", apiKey: "k", baseUrl: `${ark.origin}/api/v3`, deps: await deps() });
  assert.deepEqual(await adapter.submitOnce(videoSubmission(), AbortSignal.timeout(2000)), { kind: "accepted", correlation: "attempt-1", providerJobId: "cgt-1" });
  const body = ark.calls[0]!.body;
  assert.deepEqual([body.model, body.resolution, body.ratio, body.duration, body.generate_audio, body.watermark, body.execution_expires_after],
    ["doubao-seedance-2-0-mini-260615", "720p", "9:16", 5, true, false, 21600]);
  assert.equal(body.content[0].text, "她推门进来\n参考素材：图片1为角色形象参考。");
  assert.equal(body.content[1].role, "reference_image");
});
test("Seedance query: expired is failed, succeeded archives the download with token usage", async (t) => {
  const ark = await fakeArk(); t.after(ark.close);
  const d = await deps();
  const adapter = createVolcengineAdapter({ connectionVersionId: "cv-ark", apiKey: "k", baseUrl: `${ark.origin}/api/v3`, deps: d });
  const task = { ...videoSubmission(), providerJobId: "cgt-1" };
  ark.setStatus("expired");
  assert.deepEqual(await adapter.query!(task, AbortSignal.timeout(2000)), { kind: "failed", correlation: "attempt-1", providerJobId: "cgt-1", code: "ARK_EXPIRED" });
  ark.setStatus("failed");
  assert.equal((await adapter.query!(task, AbortSignal.timeout(2000)) as any).code, "ARK_OutputVideoSensitiveContentDetected");
  ark.setStatus("succeeded");
  const done = await adapter.query!(task, AbortSignal.timeout(2000));
  assert.equal(done.kind, "completed");
  assert.deepEqual((done as any).usage, { completion_tokens: 108000, total_tokens: 108000 });
  assert.equal(d.published[0]!.mime, "video/mp4");
  ark.setStatus("queued");
  assert.equal((await adapter.requestCancel!(task, AbortSignal.timeout(2000))).kind, "cancelled");
});
test("Seedream submit: synchronous b64 result is archived and completed; vendor 400 rejected; 500 unknown", async (t) => {
  const ark = await fakeArk(); t.after(ark.close);
  const d = await deps();
  const adapter = createVolcengineAdapter({ connectionVersionId: "cv-ark", apiKey: "k", baseUrl: `${ark.origin}/api/v3`, deps: d });
  const receipt = await adapter.submitOnce(imageSubmission(), AbortSignal.timeout(2000));
  assert.equal(receipt.kind, "completed");
  assert.deepEqual((receipt as any).output.images[0].mime, "image/jpeg");
  assert.deepEqual((receipt as any).usage, { generated_images: 1, output_tokens: 16384, total_tokens: 16384 });
  const body = ark.calls[0]!.body;
  assert.deepEqual([body.model, body.size, body.response_format, body.watermark, body.sequential_image_generation, body.prompt], ["doubao-seedream-5-0-flash-260915", "2048x2048", "b64_json", false, "disabled", "海报"]);
  ark.setImageMode("sensitive");
  assert.deepEqual(await adapter.submitOnce(imageSubmission(), AbortSignal.timeout(2000)), { kind: "rejected", correlation: "attempt-2", code: "ARK_InputImageSensitiveContentDetected" });
  ark.setImageMode("500");
  assert.deepEqual(await adapter.submitOnce(imageSubmission(), AbortSignal.timeout(2000)), { kind: "unknown", correlation: "attempt-2" });
});
