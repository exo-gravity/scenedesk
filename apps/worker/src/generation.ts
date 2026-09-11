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
  process.env.APP_SECRET
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
    output: {
      shots: [
        {
          label: "测试建议 01",
          intent: `显式测试 fixture：根据选区准备镜头。${submission.resolvedInput.sourceExcerpt?.quote ?? ""}`,
        },
      ],
    },
  }),
);
const worker = await createAssistanceWorker({
  pool,
  schema: process.env.DATABASE_SCHEMA ?? "drama",
  adapters: [adapter],
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
  }),
);
scan();
