import { createServer } from "node:http";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import {
  configuration,
  generationConfiguration,
  diagnostic,
  mediaStore,
  pool,
  fail,
} from "./config.js";
import { createVerifiedGenerationRuntime } from "../../apps/worker/src/verified-runtime.js";

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
  if (process.env.PROVIDER_MODE !== "verified")
    fail("PROVIDER_MODE_VERIFIED_REQUIRED");
  const config = generationConfiguration(await configuration());
  if (!process.env.TMPDIR?.startsWith("/")) fail("PRIVATE_TMPDIR_REQUIRED");
  stage = "temporary_directory";
  await access(process.env.TMPDIR!, constants.W_OK);
  const database = pool(config.databaseUrl);
  cleanup.push(() => database.end());
  const store = mediaStore(config.media);
  cleanup.push(async () => store.close());
  stage = "storage_versioning";
  await store.verify();
  stage = "generation_role";
  const login = await database.query<{ generation_worker_login: boolean }>(
    "SELECT drama.generation_worker_login()",
  );
  if (login.rows[0]?.generation_worker_login !== true)
    fail("GENERATION_ROLE_REQUIRED");
  stage = "capability_connections";
  const known = await database.query(
    "SELECT drama.list_verified_connection_versions()::text AS id",
  );
  const ids = new Set(known.rows.map((r) => r.id));
  if (!config.vendors.connections.some((c) => ids.has(c.connectionVersionId)))
    fail("GENERATION_CONNECTIONS_NOT_PROVISIONED");
  if (process.argv.includes("--check")) {
    console.log(
      JSON.stringify({
        status: "ok",
        scope: "generation_executor_dependencies",
        vendors: Object.keys(config.vendors.vendors),
        paidProvidersEnabled: true,
      }),
    );
    await close();
  } else {
    stage = "start_runtime";
    let consecutiveScanFailures = 0;
    const runtime = await createVerifiedGenerationRuntime({
      pool: database,
      schema: "drama",
      config: config.vendors,
      store,
      tmpdir: process.env.TMPDIR!,
      onError: (step) => diagnostic(undefined, `generation_${step}`),
      onScan: (outcome) => {
        if (outcome === "failed") {
          consecutiveScanFailures += 1;
          if (consecutiveScanFailures >= 3) healthy = false;
        } else {
          consecutiveScanFailures = 0;
          if (!stopping) healthy = true;
        }
      },
    });
    cleanup.push(() => runtime.close());
    runtime.start(2500);
    healthy = true;
    const server = createServer((request, reply) => {
      if (request.url !== "/health/ready") {
        reply.writeHead(404).end();
        return;
      }
      void Promise.all([database.query("SELECT 1"), store.verify()])
        .then(() => {
          reply.writeHead(healthy && !stopping ? 200 : 503, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          reply.end(
            JSON.stringify({
              status: healthy && !stopping ? "ok" : "unavailable",
              scope: "generation_executor",
              paidProvidersEnabled: true,
            }),
          );
        })
        .catch(() => {
          reply.writeHead(503).end('{"status":"unavailable"}');
        });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(4314, "0.0.0.0", resolve);
    });
    cleanup.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    console.log(
      JSON.stringify({
        status: "listening",
        service: "generation_executor",
        paidProvidersEnabled: true,
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
