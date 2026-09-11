import { readFile, stat } from "node:fs/promises";
import { createScheduler } from "@drama/queue";
import { imageOutput } from "../../api/src/modules/generation/image-output.js";
import { Pool } from "pg";
import { createAssistanceFixture } from "@drama/provider";
import { createAssistanceWorker } from "../../api/src/modules/generation/worker.js";

// This explicit fixture runner exercises the real durable pipeline without making model calls.
// A verified provider transport and spending authorization are a separate release prerequisite.
if (
  process.env.APP_ENV !== "local" ||
  process.env.GENERATION_ADAPTER !== "test_fixture"
)
  throw new Error("Only the explicit local assistance fixture is configured");
if (
  process.env.DATABASE_URL ||
  process.env.RUNTIME_DATABASE_URL ||
  process.env.AUTH_DATABASE_URL ||
  process.env.APP_SECRET ||
  process.env.SCHEDULER_DATABASE_URL ||
  process.env.MEDIA_WORKER_DATABASE_URL ||
  process.env.MEDIA_SECRET_ACCESS_KEY
)
  throw new Error(
    "Generation worker must not load migration, API or identity credentials",
  );
if (
  !process.env.GENERATION_WORKER_DATABASE_URL ||
  !process.env.GENERATION_CONNECTION_VERSION_ID
)
  throw new Error(
    "Provision the isolated generation worker and fixed connection identity first",
  );
const pool = new Pool({
  connectionString: process.env.GENERATION_WORKER_DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 3000,
});
const adapter = createAssistanceFixture(
  process.env.GENERATION_CONNECTION_VERSION_ID,
  async (submission) => ({
    kind: "completed",
    correlation: submission.attemptId,
    output:
      submission.input.purpose === "creative_assistance"
        ? {
            prompt: `显式测试 fixture：${submission.resolvedInput.prompt}`,
            referenceSuggestions: submission.resolvedInput.references.map(
              (item) => item.reference,
            ),
            retain: ["保留明确选定的镜头与参考版本"],
            change: ["由制作人员核对后再应用到创作输入"],
            notes: "无真实模型调用。此建议仅验证固定输入、耐久执行与人工修订。",
          }
        : {
            shots: [
              {
                label: "测试建议 01",
                intent: `显式测试 fixture：根据选区准备镜头。${submission.resolvedInput.sourceExcerpt?.quote ?? ""}`,
              },
            ],
          },
  }),
);
let imageAdapter: ReturnType<typeof createAssistanceFixture> | undefined;
let archiveScheduler: Awaited<ReturnType<typeof createScheduler>> | undefined;
if (process.env.GENERATION_IMAGE_FIXTURE_FILE) {
  const info = await stat(process.env.GENERATION_IMAGE_FIXTURE_FILE);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 65536)
    throw new Error("Image fixture manifest must be a private bounded file");
  const manifest = JSON.parse(
    await readFile(process.env.GENERATION_IMAGE_FIXTURE_FILE, "utf8"),
  );
  if (
    manifest.version !== 1 ||
    manifest.executionMode !== "test_fixture" ||
    !/^[0-9a-f-]{36}$/.test(manifest.connectionVersionId) ||
    !/^[0-9a-f-]{36}$/.test(manifest.capabilityId)
  )
    throw new Error("Explicit fixed image fixture identity is required");
  const output = imageOutput(manifest.output);
  imageAdapter = createAssistanceFixture(
    manifest.connectionVersionId,
    async (submission) =>
      submission.input.purpose === "image" &&
      submission.input.capabilityId === manifest.capabilityId
        ? { kind: "completed", correlation: submission.attemptId, output }
        : {
            kind: "rejected",
            correlation: submission.attemptId,
            code: "IMAGE_FIXTURE_IDENTITY_MISMATCH",
          },
  );
  archiveScheduler = await createScheduler(pool, {
    ...(process.env.QUEUE_SCHEMA ? { schema: process.env.QUEUE_SCHEMA } : {}),
    onError: () =>
      console.error(
        "Generation archive queue operation failed; durable receipt remains available",
      ),
  });
}
const worker = await createAssistanceWorker({
  pool,
  schema: process.env.DATABASE_SCHEMA ?? "drama",
  adapters: imageAdapter ? [adapter, imageAdapter] : [adapter],
  ...(archiveScheduler ? { scheduleArchive: archiveScheduler.schedule } : {}),
});
let closing = false,
  timer: NodeJS.Timeout | undefined,
  active: Promise<void> | undefined;
function scan() {
  if (closing) return;
  active = worker
    .scan()
    .then(() => undefined)
    .catch(() => {
      console.error(
        "Assistance worker step failed; durable attempts remain available for recovery",
      );
    })
    .finally(() => {
      if (!closing) timer = setTimeout(scan, 2500);
    });
}
async function close() {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  await active;
  await archiveScheduler?.close();
  await pool.end();
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void close();
  });
console.log(
  JSON.stringify({
    generationWorker: "ready",
    executionMode: "test_fixture",
    paidProvidersEnabled: false,
    imageFixtureEnabled: !!imageAdapter,
  }),
);
scan();
