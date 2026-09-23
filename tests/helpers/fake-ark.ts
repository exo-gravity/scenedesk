import { createServer, type IncomingMessage } from "node:http";

const read = (req: IncomingMessage) =>
  new Promise<any>((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s ? JSON.parse(s) : undefined));
  });

export async function fakeArk() {
  const calls: { method: string; url: string; body?: any }[] = [];
  let status: "queued" | "running" | "succeeded" | "failed" | "expired" = "queued";
  let imageMode: "ok" | "sensitive" | "500" = "ok";
  let taskMode: "ok" | "reject" = "ok";
  const server = createServer(async (req, res) => {
    const body = await read(req);
    calls.push({ method: req.method!, url: req.url!, body });
    const json = (code: number, value: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (req.url === "/result.mp4") return res.writeHead(200).end(Buffer.from("ark-mp4"));
    if (req.method === "POST" && req.url === "/api/v3/contents/generations/tasks") {
      // Ark's real 400 shape: a specific `code` beside a generic `type` (observed 2026-09-23).
      if (taskMode === "reject") return json(400, { error: { code: "InvalidParameter", message: "The parameter `content` specified in the request are not valid", type: "BadRequest" } });
      return json(200, { id: "cgt-1" });
    }
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
  return { origin, calls, setStatus: (s: typeof status) => (status = s), setImageMode: (m: typeof imageMode) => (imageMode = m), setTaskMode: (m: typeof taskMode) => (taskMode = m), close: () => new Promise<void>((r) => server.close(() => r())) };
}
