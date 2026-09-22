import type { AssistanceAdapter, AssistanceProviderTask, AssistanceQueryReceipt, AssistanceSubmissionReceipt } from "../../assistance.js";
import { errorCode } from "../http.js";
import { archiveBytes, downloadBytes } from "../outputs.js";
import { prepareSubmission, rejectedFrom, type PreparedSubmission, type VerifiedDeps } from "../prepare.js";
import { createVolcengineClient } from "./client.js";

const VIDEO_MAX_BYTES = 128 * 1024 * 1024;
const EXPIRES_AFTER_SECONDS = 6 * 60 * 60;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const numbers = (v: unknown) => object(v) ? Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === "number" && Number.isFinite(n))) as Record<string, number> : undefined;
const withLegend = (prepared: PreparedSubmission) => prepared.legend ? `${prepared.prompt}\n${prepared.legend}` : prepared.prompt;

export function createVolcengineAdapter(options: { connectionVersionId: string; apiKey: string; baseUrl: string; deps: VerifiedDeps }): AssistanceAdapter {
  const client = createVolcengineClient({ apiKey: options.apiKey, baseUrl: options.baseUrl, fetch: options.deps.fetch });
  const rejectedCode = (outcome: { status: number; body: unknown }) => `ARK_${errorCode(outcome.body, `HTTP_${outcome.status}`)}`;
  async function submitVideo(prepared: PreparedSubmission, correlation: string, signal: AbortSignal): Promise<AssistanceSubmissionReceipt> {
    const body = {
      model: prepared.profile.providerModel,
      content: [
        { type: "text", text: withLegend(prepared) },
        ...prepared.images.map((image) => ({ type: "image_url", image_url: { url: image.dataUri }, role: image.role })),
      ],
      resolution: prepared.target.resolution,
      ratio: prepared.target.ratio,
      duration: prepared.durationSeconds,
      generate_audio: prepared.withAudio,
      watermark: false,
      execution_expires_after: EXPIRES_AFTER_SECONDS,
    };
    const outcome = await client.createContentTask(body, signal);
    if (outcome.kind === "ok" && object(outcome.body) && typeof outcome.body.id === "string" && outcome.body.id) return { kind: "accepted", correlation, providerJobId: outcome.body.id };
    if (outcome.kind === "rejected") return { kind: "rejected", correlation, code: rejectedCode(outcome) };
    if (outcome.kind === "unavailable" && outcome.reason === "http_429") return { kind: "rejected", correlation, code: "PROVIDER_RATE_LIMITED" };
    return { kind: "unknown", correlation };
  }
  async function submitImage(prepared: PreparedSubmission, correlation: string, signal: AbortSignal): Promise<AssistanceSubmissionReceipt> {
    const body = {
      model: prepared.profile.providerModel,
      prompt: withLegend(prepared),
      ...(prepared.images.length ? { image: prepared.images.map((i) => i.dataUri) } : {}),
      size: prepared.size,
      response_format: "b64_json",
      output_format: "jpeg",
      watermark: false,
      ...(prepared.profile.sequentialImages === true ? { sequential_image_generation: "disabled" } : {}),
    };
    const outcome = await client.generateImages(body, signal);
    if (outcome.kind === "rejected") return { kind: "rejected", correlation, code: rejectedCode(outcome) };
    if (outcome.kind === "unavailable") return outcome.reason === "http_429" ? { kind: "rejected", correlation, code: "PROVIDER_RATE_LIMITED" } : { kind: "unknown", correlation };
    const first = object(outcome.body) && Array.isArray(outcome.body.data) ? outcome.body.data[0] : undefined;
    if (object(outcome.body) && object(outcome.body.error) && !first) return { kind: "rejected", correlation, code: rejectedCode({ status: 200, body: outcome.body }) };
    if (!object(first) || typeof first.b64_json !== "string") return { kind: "unknown", correlation };
    const mime = first.output_format === "png" ? "image/png" : "image/jpeg";
    let archived;
    try {
      archived = await archiveBytes({ store: options.deps.store, tmpdir: options.deps.tmpdir, mime, bytes: Buffer.from(first.b64_json, "base64"), signal });
    } catch (error) {
      return { kind: "rejected", correlation, code: `ARCHIVE_${(error as { code?: string }).code ?? "FAILED"}` };
    }
    const usage = numbers(object(outcome.body) ? outcome.body.usage : undefined);
    return { kind: "completed", correlation, output: { images: [archived] }, ...(usage ? { usage } : {}) };
  }
  return {
    executionMode: "verified_provider",
    connectionVersionId: options.connectionVersionId,
    async submitOnce(submission, signal) {
      const correlation = submission.attemptId;
      let prepared: PreparedSubmission;
      try { prepared = await prepareSubmission(submission, "volcengine", options.deps, signal); }
      catch (error) { const rejected = rejectedFrom(error, correlation); if (rejected) return rejected; throw error; }
      return prepared.profile.purpose === "image" ? submitImage(prepared, correlation, signal) : submitVideo(prepared, correlation, signal);
    },
    async recoverSubmission() { return null; },
    async query(task: AssistanceProviderTask, signal): Promise<AssistanceQueryReceipt> {
      const correlation = task.attemptId, providerJobId = task.providerJobId;
      const unavailable = (code: string): AssistanceQueryReceipt => ({ kind: "unavailable", correlation, providerJobId, code });
      const outcome = await client.getContentTask(providerJobId, signal);
      if (outcome.kind !== "ok" || !object(outcome.body))
        return unavailable(
          outcome.kind === "rejected"
            ? rejectedCode(outcome)
            : outcome.kind === "unavailable"
              ? `ARK_${outcome.reason.toUpperCase()}`
              : "ARK_INVALID_RESPONSE",
        );
      const view = outcome.body;
      switch (view.status) {
        case "queued": return { kind: "pending", correlation, providerJobId };
        case "running": return { kind: "running", correlation, providerJobId };
        case "cancelled": return { kind: "cancelled", correlation, providerJobId };
        case "expired": return { kind: "failed", correlation, providerJobId, code: "ARK_EXPIRED" };
        case "failed": return { kind: "failed", correlation, providerJobId, code: `ARK_${errorCode({ error: view.error }, "TASK_FAILED")}` };
        case "succeeded": {
          const url = object(view.content) && typeof view.content.video_url === "string" ? view.content.video_url : undefined;
          if (!url) return unavailable("ARK_RESULT_URL_MISSING");
          try {
            const bytes = await downloadBytes(options.deps.fetch, url, VIDEO_MAX_BYTES, signal);
            const archived = await archiveBytes({ store: options.deps.store, tmpdir: options.deps.tmpdir, mime: "video/mp4", bytes, signal });
            const usage = numbers(view.usage);
            return { kind: "completed", correlation, providerJobId, output: { videos: [archived] }, ...(usage ? { usage } : {}) };
          } catch (error) {
            return unavailable(`ARCHIVE_${(error as { code?: string }).code ?? "FAILED"}`);
          }
        }
        default: return unavailable("ARK_STATUS_UNKNOWN");
      }
    },
    async requestCancel(task, signal) {
      const correlation = task.attemptId, providerJobId = task.providerJobId;
      const outcome = await client.deleteContentTask(providerJobId, signal);
      if (outcome.kind === "ok") return { kind: "cancelled", correlation, providerJobId };
      if (outcome.kind === "rejected" && outcome.status === 400) return { kind: "cancel_unsupported", correlation, providerJobId };
      return { kind: "cancel_unknown", correlation, providerJobId };
    },
  };
}
