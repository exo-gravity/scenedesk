import { Pool } from "pg";
import { createScheduler, runInternalWorker } from "@drama/queue";
import {
  createMediaProcessor,
  mediaStoreFromEnvironment,
  repairMediaWork,
} from "@drama/media";

if (
  process.env.APP_ENV !== "local" ||
  (process.env.PROVIDER_MODE && process.env.PROVIDER_MODE !== "mock")
)
  throw new Error(
    "This local worker supports imported media and mock mode only",
  );
if (
  process.env.DATABASE_URL ||
  process.env.RUNTIME_DATABASE_URL ||
  process.env.AUTH_DATABASE_URL ||
  process.env.APP_SECRET
)
  throw new Error(
    "Media worker must not load migration, API or identity secrets",
  );
if (
  !process.env.MEDIA_WORKER_DATABASE_URL ||
  !process.env.SCHEDULER_DATABASE_URL
)
  throw new Error(
    "Separate media worker and scheduler database identities are required",
  );
const store = mediaStoreFromEnvironment(process.env);
if (!store) throw new Error("Media worker storage credentials are required");
const business = new Pool({
  connectionString: process.env.MEDIA_WORKER_DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 3000,
});
const scheduler = new Pool({
  connectionString: process.env.SCHEDULER_DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 3000,
});
const queueOptions = {
  schema: process.env.QUEUE_SCHEMA ?? "scenedesk_queue",
  onError: () =>
    console.error(
      "Media worker step or queue operation failed; persisted issue records remain available",
    ),
};
let producer: Awaited<ReturnType<typeof createScheduler>> | undefined;
let worker: Awaited<ReturnType<typeof runInternalWorker>> | undefined;
let timer: NodeJS.Timeout | undefined;
let repair: Promise<void> | undefined;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  await worker?.close();
  await repair;
  await producer?.close();
  store!.close();
  await business.end();
  await scheduler.end();
}
function scan() {
  if (closing) return;
  repair = repairMediaWork({
    pool: scheduler,
    schema: process.env.DATABASE_SCHEMA ?? "drama",
    schedule: producer!.schedule,
  })
    .then(() => undefined)
    .catch(() => {
      console.error("Media repair scan failed; retrying on the next interval");
    })
    .finally(() => {
      if (!closing) timer = setTimeout(scan, 60_000);
    });
}
try {
  producer = await createScheduler(business, queueOptions);
  const processor = await createMediaProcessor({
    pool: business,
    schema: process.env.DATABASE_SCHEMA ?? "drama",
    store,
    schedule: producer.schedule,
  });
  worker = await runInternalWorker(scheduler, processor, {
    ...queueOptions,
    concurrency: 2,
  });
  scan();
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void close();
    });
  console.log(
    JSON.stringify({
      mediaWorker: "ready",
      concurrency: 2,
      repairIntervalSeconds: 60,
      paidProvidersEnabled: false,
    }),
  );
} catch {
  await close();
  throw new Error(
    "Media worker preflight failed; verify runtime roles, storage versioning and pinned decoder image",
  );
}
