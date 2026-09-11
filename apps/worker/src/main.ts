import { Pool } from "pg";
import { createScheduler, runInternalWorker } from "@drama/queue";
import {
  createMediaProcessor,
  mediaStoreFromEnvironment,
  repairMediaWork,
  createProductionProcessor,
  productionStoreFromEnvironment,
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
const artifacts = productionStoreFromEnvironment(process.env);
if (!artifacts || !process.env.PRODUCTION_WORK_DIRECTORY)
  throw new Error(
    "Production bucket and private work directory are required; rerun setup:media",
  );
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
let production:
  Awaited<ReturnType<typeof createProductionProcessor>> | undefined;
let timer: NodeJS.Timeout | undefined;
let repair: Promise<void> | undefined;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  production?.stop();
  await worker?.close();
  await repair;
  await production?.close();
  await producer?.close();
  store!.close();
  artifacts!.close();
  await business.end();
  await scheduler.end();
}
function scan() {
  if (closing) return;
  repair = repairMediaWork({
    pool: scheduler,
    schema: process.env.DATABASE_SCHEMA ?? "drama",
    schedule: producer!.schedule,
    includeProduction: true,
  })
    .then(() => production!.cleanup())
    .then((result) => {
      if (result.failed)
        console.error(
          "Some owned production resources await the next cleanup scan",
        );
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
  production = await createProductionProcessor({
    pool: business,
    schema: process.env.DATABASE_SCHEMA ?? "drama",
    originals: store,
    artifacts,
    workDirectory: process.env.PRODUCTION_WORK_DIRECTORY,
  });
  worker = await runInternalWorker(
    scheduler,
    (step, context) =>
      step.taskKind === "media_production"
        ? production!.process(step, context)
        : processor(step, context),
    {
      ...queueOptions,
      concurrency: 2,
    },
  );
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
      productionEnabled: true,
    }),
  );
} catch {
  await close();
  throw new Error(
    "Media worker preflight failed; verify runtime roles, storage versioning and pinned decoder image",
  );
}
