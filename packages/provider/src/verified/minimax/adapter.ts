import type { AssistanceAdapter, AssistanceProviderTask, AssistanceQueryReceipt, AssistanceSubmissionReceipt } from "../../assistance.js";
import { errorCode } from "../http.js";
import { archiveBytes, downloadBytes } from "../outputs.js";
import { prepareSubmission, rejectedFrom, type PreparedSubmission, type VerifiedDeps } from "../prepare.js";
import type { OutputTarget } from "../profiles.js";
import { createMinimaxClient } from "./client.js";

const VIDEO_MAX_BYTES = 128 * 1024 * 1024;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const numbers = (v: unknown) => object(v) ? Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === "number" && Number.isFinite(n))) as Record<string, number> : undefined;

export function createMinimaxAdapter(options: { connectionVersionId: string; apiKey: string; baseUrl: string; deps: VerifiedDeps; outputsOverride?: Record<string, OutputTarget> }): AssistanceAdapter {
  const client = createMinimaxClient({ apiKey: options.apiKey, baseUrl: options.baseUrl, fetch: options.deps.fetch });
  return {
    executionMode: "verified_provider",
    connectionVersionId: options.connectionVersionId,
    async submitOnce(submission, signal): Promise<AssistanceSubmissionReceipt> {
      const correlation = submission.attemptId;
      let prepared: PreparedSubmission;
      try { prepared = await prepareSubmission(submission, "minimax", options.deps, signal, options.outputsOverride); }
      catch (error) { const rejected = rejectedFrom(error, correlation); if (rejected) return rejected; throw error; }
      const body = {
        model: prepared.profile.providerModel,
        content: [
          { type: "text", text: prepared.legend ? `${prepared.prompt}\n${prepared.legend}` : prepared.prompt },
          ...prepared.images.map((image) => ({ type: "image_url", image_url: { url: image.dataUri }, role: image.role })),
        ],
        resolution: prepared.target.resolution,
        duration: prepared.durationSeconds,
        ratio: prepared.target.ratio,
        aigc_watermark: false,
      };
      const outcome = await client.createVideoTask(body, signal);
      if (outcome.kind === "ok" && object(outcome.body) && typeof outcome.body.task_id === "string" && outcome.body.task_id)
        return { kind: "accepted", correlation, providerJobId: outcome.body.task_id };
      if (outcome.kind === "rejected") return { kind: "rejected", correlation, code: `MINIMAX_${errorCode(outcome.body, `HTTP_${outcome.status}`)}` };
      if (outcome.kind === "unavailable" && outcome.reason === "http_429") return { kind: "rejected", correlation, code: "PROVIDER_RATE_LIMITED" };
      return { kind: "unknown", correlation };
    },
    async recoverSubmission() { return null; },
    async query(task: AssistanceProviderTask, signal): Promise<AssistanceQueryReceipt> {
      const correlation = task.attemptId, providerJobId = task.providerJobId;
      const unavailable = (code: string): AssistanceQueryReceipt => ({ kind: "unavailable", correlation, providerJobId, code });
      const outcome = await client.getVideoTask(providerJobId, signal);
      if (outcome.kind !== "ok" || !object(outcome.body))
        return unavailable(
          outcome.kind === "rejected"
            ? `MINIMAX_${errorCode(outcome.body, `HTTP_${outcome.status}`)}`
            : outcome.kind === "unavailable"
              ? `MINIMAX_${outcome.reason.toUpperCase()}`
              : "MINIMAX_INVALID_RESPONSE",
        );
      const view = object(outcome.body.task) ? outcome.body.task : outcome.body;
      switch (view.status) {
        case "queued": return { kind: "pending", correlation, providerJobId };
        case "running": return { kind: "running", correlation, providerJobId };
        case "cancelled": return { kind: "cancelled", correlation, providerJobId };
        case "failed": return { kind: "failed", correlation, providerJobId, code: `MINIMAX_${errorCode({ error: view.error }, "TASK_FAILED")}` };
        case "succeeded": {
          const url = object(view.content) && typeof view.content.url === "string" ? view.content.url : undefined;
          if (!url) return unavailable("MINIMAX_RESULT_URL_MISSING");
          try {
            const bytes = await downloadBytes(options.deps.fetch, url, VIDEO_MAX_BYTES, signal);
            const archived = await archiveBytes({ store: options.deps.store, tmpdir: options.deps.tmpdir, mime: "video/mp4", bytes, signal });
            const usage = numbers(view.usage);
            return { kind: "completed", correlation, providerJobId, output: { videos: [archived] }, ...(usage ? { usage } : {}) };
          } catch (error) {
            return unavailable(`ARCHIVE_${(error as { code?: string }).code ?? "FAILED"}`);
          }
        }
        default: return unavailable("MINIMAX_STATUS_UNKNOWN");
      }
    },
    async requestCancel(task, signal) {
      const correlation = task.attemptId, providerJobId = task.providerJobId;
      const outcome = await client.cancelVideoTask(providerJobId, signal);
      if (outcome.kind === "ok" && object(outcome.body) && outcome.body.action === "cancelled") return { kind: "cancelled", correlation, providerJobId };
      if (outcome.kind === "rejected" && outcome.status === 400) return { kind: "cancel_unsupported", correlation, providerJobId };
      return { kind: "cancel_unknown", correlation, providerJobId };
    },
  };
}
