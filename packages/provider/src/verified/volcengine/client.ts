import { jsonRequest, type HttpOutcome } from "../http.js";
const SMALL = 4 * 1024 * 1024, IMAGE = 64 * 1024 * 1024;
export function createVolcengineClient(options: { apiKey: string; baseUrl: string; fetch: typeof fetch }) {
  const base = options.baseUrl.replace(/\/$/, "");
  const headers = { authorization: `Bearer ${options.apiKey}` };
  return {
    createContentTask: (body: unknown, signal: AbortSignal): Promise<HttpOutcome> =>
      jsonRequest(options.fetch, `${base}/contents/generations/tasks`, { method: "POST", headers, body, signal, maxBodyBytes: SMALL }),
    getContentTask: (id: string, signal: AbortSignal): Promise<HttpOutcome> =>
      jsonRequest(options.fetch, `${base}/contents/generations/tasks/${encodeURIComponent(id)}`, { method: "GET", headers, signal, maxBodyBytes: SMALL }),
    deleteContentTask: (id: string, signal: AbortSignal): Promise<HttpOutcome> =>
      jsonRequest(options.fetch, `${base}/contents/generations/tasks/${encodeURIComponent(id)}`, { method: "DELETE", headers, signal, maxBodyBytes: SMALL }),
    generateImages: (body: unknown, signal: AbortSignal): Promise<HttpOutcome> =>
      jsonRequest(options.fetch, `${base}/images/generations`, { method: "POST", headers, body, signal, maxBodyBytes: IMAGE }),
  };
}
