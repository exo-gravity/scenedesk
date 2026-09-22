import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createMinimaxClient, createVolcengineClient, downloadBytes, errorCode, parseGenerationVendors } from "@drama/provider";

// PAID. Creates exactly one vendor task and records the evidence MV-01/04/05/06 need.
const { values } = parseArgs({ options: { config: { type: "string" }, vendor: { type: "string" }, kind: { type: "string" }, out: { type: "string" }, prompt: { type: "string", default: "一只橘猫在窗台上晒太阳，午后柔光。" } } });
if (!values.config || !values.vendor || !values.kind || !values.out) throw new Error("Usage: --config generation.json --vendor minimax|volcengine --kind image|video --out <dir>");
const raw = JSON.parse(await readFile(values.config, "utf8"));
const vendors = parseGenerationVendors({ vendors: raw.vendors, connections: raw.connections }).vendors;
const record: Record<string, unknown> = { startedAt: new Date().toISOString(), vendor: values.vendor, kind: values.kind, observations: [] as unknown[] };
await mkdir(values.out, { recursive: true, mode: 0o700 });
const save = () => writeFile(join(values.out!, "record.json"), JSON.stringify(record, null, 2), { mode: 0o600 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const observe = (o: unknown) => { (record.observations as unknown[]).push({ at: new Date().toISOString(), ...(o as object) }); return save(); };
async function finish(bytes: Buffer, mime: string) {
  await writeFile(join(values.out!, mime === "video/mp4" ? "result.mp4" : "result.jpg"), bytes, { mode: 0o600 });
  record.result = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), mime };
  record.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ status: "done", out: values.out, bytes: bytes.length }));
}
if (values.vendor === "volcengine") {
  const v = vendors.volcengine!, client = createVolcengineClient({ ...v, fetch });
  if (values.kind === "image") {
    const body = { model: "doubao-seedream-5-0-flash-260915", prompt: values.prompt, size: "1024x1024", response_format: "b64_json", output_format: "jpeg", watermark: false };
    record.request = { ...body, digest: digest(body) };
    const r = await client.generateImages(body, AbortSignal.timeout(120000));
    await observe({ outcome: r.kind, status: (r as any).status, body: r.kind === "ok" ? { ...(r.body as any), data: "<omitted>" } : r });
    if (r.kind !== "ok") throw new Error(`image request ${r.kind}`);
    const first = (r.body as any).data[0];
    record.output = { size: first.size, output_format: first.output_format, usage: (r.body as any).usage };
    await finish(Buffer.from(first.b64_json, "base64"), "image/jpeg");
  } else {
    const body = { model: "doubao-seedance-2-0-mini-260615", content: [{ type: "text", text: values.prompt }], resolution: "720p", ratio: "16:9", duration: 5, generate_audio: true, watermark: false, execution_expires_after: 3600 };
    record.request = { ...body, digest: digest(body) };
    const created = await client.createContentTask(body, AbortSignal.timeout(120000));
    await observe({ phase: "create", outcome: created.kind, status: (created as any).status, body: (created as any).body });
    if (created.kind !== "ok") throw new Error(`create ${created.kind}`);
    const id = (created.body as any).id as string;
    let poll = 0, unavailableCount = 0;
    for (;;) {
      await sleep(10000);
      const q = await client.getContentTask(id, AbortSignal.timeout(30000));
      poll++;
      if (poll > 90) throw new Error("task did not finish within 90 polls");
      if (q.kind === "rejected") throw new Error(`query rejected: ${(q as any).status} ${errorCode((q as any).body, `HTTP_${(q as any).status}`)}`);
      if (q.kind !== "ok") {
        unavailableCount++;
        console.log(JSON.stringify({ poll, outcome: q.kind, status: undefined }));
        if (unavailableCount >= 6) throw new Error("query unavailable 6 times in a row");
        continue;
      }
      unavailableCount = 0;
      const task = q.body as any;
      const taskObserved = { ...task, content: task.content?.video_url ? "<omitted>" : task.content };
      await observe({ phase: "query", outcome: q.kind, status: (q as any).status, task: taskObserved });
      console.log(JSON.stringify({ poll, outcome: q.kind, status: task.status }));
      if (task.status === "succeeded") { record.output = { duration: task.duration, resolution: task.resolution, ratio: task.ratio, usage: task.usage }; await finish(await downloadBytes(fetch, task.content.video_url, 128 * 1024 * 1024, AbortSignal.timeout(120000)), "video/mp4"); break; }
      if (["failed", "expired", "cancelled"].includes(task.status)) throw new Error(`task ${task.status}: ${JSON.stringify(task.error)}`);
    }
  }
} else {
  const v = vendors.minimax!, client = createMinimaxClient({ ...v, fetch });
  if (values.kind !== "video") throw new Error("MiniMax smoke supports video only");
  const body = { model: "MiniMax-H3", content: [{ type: "text", text: values.prompt }], resolution: "768P", duration: 5, ratio: "16:9", aigc_watermark: false };
  record.request = { ...body, digest: digest(body) };
  const created = await client.createVideoTask(body, AbortSignal.timeout(120000));
  await observe({ phase: "create", outcome: created.kind, status: (created as any).status, body: (created as any).body });
  if (created.kind !== "ok") throw new Error(`create ${created.kind}`);
  const id = (created.body as any).task_id as string;
  let poll = 0, unavailableCount = 0;
  for (;;) {
    await sleep(10000);
    const q = await client.getVideoTask(id, AbortSignal.timeout(30000));
    poll++;
    if (poll > 90) throw new Error("task did not finish within 90 polls");
    if (q.kind === "rejected") throw new Error(`query rejected: ${(q as any).status} ${errorCode((q as any).body, `HTTP_${(q as any).status}`)}`);
    const task = q.kind === "ok" ? ((q.body as any).task ?? q.body) : undefined;
    if (!task) {
      unavailableCount++;
      console.log(JSON.stringify({ poll, outcome: q.kind, status: undefined }));
      if (unavailableCount >= 6) throw new Error("query unavailable 6 times in a row");
      continue;
    }
    unavailableCount = 0;
    const taskObserved = { ...task, content: task.content?.url ? "<omitted>" : task.content };
    await observe({ phase: "query", outcome: q.kind, status: (q as any).status, task: taskObserved });
    console.log(JSON.stringify({ poll, outcome: q.kind, status: task.status }));
    if (task.status === "succeeded") { record.output = { duration: task.duration, resolution: task.resolution, usage: task.usage }; await finish(await downloadBytes(fetch, task.content.url, 128 * 1024 * 1024, AbortSignal.timeout(120000)), "video/mp4"); break; }
    if (["failed", "cancelled"].includes(task.status)) throw new Error(`task ${task.status}: ${JSON.stringify(task.error)}`);
  }
}
