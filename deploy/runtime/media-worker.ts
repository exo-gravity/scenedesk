import { createServer } from "node:http";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { createMediaProcessor, repairMediaWork } from "@drama/media";
import { createScheduler, runInternalWorker } from "@drama/queue";
import {
  configuration,
  workerConfiguration,
  diagnostic,
  mediaStore,
  pool,
  fail,
} from "./config.js";
import { supportsMediaTask, verifyMediaQueue } from "./queue-boundary.js";

let stage = "configuration",
  healthy = false,
  stopping = false;
const cleanup: Array<() => Promise<unknown>> = [];
async function close() {
  if (stopping) return;
  stopping = true;
  healthy = false;
  for (const run of cleanup.reverse()) await run().catch(() => {});
}
try {
  const config = workerConfiguration(await configuration());
  if (
    !process.env.TMPDIR?.startsWith("/") ||
    process.env.TMPDIR.includes(",") ||
    !process.env.DOCKER_HOST
  )
    fail("DECODER_HOST_AND_SHARED_TMPDIR_REQUIRED");
  stage = "temporary_directory";
  await access(process.env.TMPDIR!, constants.W_OK);
  const database = pool(config.databaseUrl),
    scheduler = pool(config.schedulerDatabaseUrl);
  cleanup.push(
    () => database.end(),
    () => scheduler.end(),
  );
  stage = "creative_media_queue_boundary";
  await verifyMediaQueue(scheduler);
  stage = "queue_producer_role";
  const producer = await createScheduler(database, {
    onError: () => diagnostic(undefined, "worker_queue"),
  });
  cleanup.push(() => producer.close());
  const store = mediaStore(config.media);
  cleanup.push(async () => store.close());
  stage = "media_role_storage_and_decoder";
  const processor = await createMediaProcessor({
    pool: database,
    store,
    schedule: producer.schedule,
  });
  if (process.argv.includes("--check")) {
    console.log(
      JSON.stringify({
        status: "ok",
        scope: "creative_media_worker_dependencies",
        generationExecutor: "unavailable",
        productionEnabled: false,
        paidProvidersEnabled: false,
      }),
    );
    await close();
  } else {
    stage = "start_worker";
    let consumerStarted = false;
    let fatalQueueError = false;
    const stopForQueueFailure = (error: Error) => {
      fatalQueueError = true;
      healthy = false;
      diagnostic(error, "media_queue_stop");
      if (consumerStarted)
        setTimeout(() => {
          void close().then(() => {
            process.exitCode = 1;
          });
        }, 0);
    };
    const worker = await runInternalWorker(
      scheduler,
      async (step, context) => {
        // Recognized deferred kinds fail here; malformed/new kinds fail in the wrapper.
        // Both reach onError and stop this consumer instead of exhausting retries.
        if (!supportsMediaTask(step.taskKind))
          fail("QUEUE_EXCLUSIVITY_VIOLATED");
        await processor(step, context);
      },
      { concurrency: 1, onError: stopForQueueFailure },
    );
    cleanup.push(() => worker.close());
    consumerStarted = true;
    if (fatalQueueError) fail("QUEUE_STARTUP_FAILED");
    let repair: Promise<unknown> | undefined;
    const repairOnce = () => {
      if (repair || stopping) return;
      repair = verifyMediaQueue(scheduler)
        .then(() =>
          repairMediaWork({
            pool: scheduler,
            schedule: producer.schedule,
            includeProduction: false,
          }),
        )
        .then(() => {
          healthy = true;
        })
        .catch((error) => {
          healthy = false;
          diagnostic(error, "media_repair");
          void close().then(() => {
            process.exitCode = 1;
          });
        })
        .finally(() => {
          repair = undefined;
        });
    };
    const timer = setInterval(repairOnce, 60000);
    cleanup.push(async () => {
      clearInterval(timer);
    });
    repairOnce();
    await repair;
    if (stopping) fail("INITIAL_REPAIR_FAILED");
    const server = createServer((request, reply) => {
      if (request.url !== "/health/ready") {
        reply.writeHead(404).end();
        return;
      }
      void Promise.all([
        database.query("SELECT 1"),
        scheduler.query("SELECT 1"),
        store.verify(),
      ])
        .then(() => {
          reply.writeHead(healthy && !stopping ? 200 : 503, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          reply.end(
            JSON.stringify({
              status: healthy && !stopping ? "ok" : "unavailable",
              scope: "creative_media_worker",
              generationExecutor: "unavailable",
              productionEnabled: false,
              paidProvidersEnabled: false,
            }),
          );
        })
        .catch(() => {
          reply.writeHead(503).end('{"status":"unavailable"}');
        });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(4313, "0.0.0.0", resolve);
    });
    cleanup.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    console.log(
      JSON.stringify({
        status: "listening",
        service: "creative_media_worker",
        generationExecutor: "unavailable",
        productionEnabled: false,
        paidProvidersEnabled: false,
      }),
    );
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        void close();
      });
  }
} catch (error) {
  diagnostic(error, stage);
  await close();
  process.exitCode = 1;
}
