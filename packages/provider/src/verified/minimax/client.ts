import { jsonRequest, type HttpOutcome } from "../http.js";
const SMALL = 4 * 1024 * 1024;
export type MinimaxClient = ReturnType<typeof createMinimaxClient>;
export function createMinimaxClient(options: { apiKey: string; baseUrl: string; fetch: typeof fetch }) {
  const base = options.baseUrl.replace(/\/$/, "");
  const headers = { authorization: `Bearer ${options.apiKey}` };
  return {
    createVideoTask: (body: unknown, signal: AbortSignal): Promise<HttpOutcome> =>
      jsonRequest(options.fetch, `${base}/v2/video_generation`, { method: "POST", headers, body, signal, maxBodyBytes: SMALL }),
    getVideoTask: (taskId: string, signal: AbortSignal): Promise<HttpOutcome> =>
      jsonRequest(options.fetch, `${base}/v2/query/video_generation/${encodeURIComponent(taskId)}`, { method: "GET", headers, signal, maxBodyBytes: SMALL }),
    cancelVideoTask: (taskId: string, signal: AbortSignal): Promise<HttpOutcome> =>
      jsonRequest(options.fetch, `${base}/v2/video_generation/${encodeURIComponent(taskId)}`, { method: "DELETE", headers, signal, maxBodyBytes: SMALL }),
  };
}
