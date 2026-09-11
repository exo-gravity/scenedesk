import { buildApp } from "../../apps/api/src/app.js";
import { discoverIssuer } from "../../apps/api/src/modules/identity/oidc.js";
import { createScheduler } from "@drama/queue";
import {
  apiConfiguration,
  configuration,
  diagnostic,
  mediaStore,
  pool,
} from "./config.js";

let stage = "configuration",
  closing = false;
const cleanup: Array<() => Promise<unknown>> = [];
async function close() {
  if (closing) return;
  closing = true;
  for (const run of cleanup.reverse()) await run().catch(() => {});
}
try {
  const config = apiConfiguration(await configuration());
  const database = pool(config.databaseUrl),
    auth = pool(config.authDatabaseUrl, 2);
  cleanup.push(
    () => database.end(),
    () => auth.end(),
  );
  stage = "oidc_discovery";
  const issuer = await discoverIssuer(config.oidc);
  stage = "private_storage";
  const store = mediaStore(config.media);
  cleanup.push(async () => store.close());
  await store.verify();
  stage = "queue_producer_role";
  const queue = await createScheduler(database, {
    onError: () => diagnostic(undefined, "api_queue"),
  });
  cleanup.push(() => queue.close());
  stage = "business_database_roles";
  const app = buildApp(database, {
    origin: config.origin,
    secret: config.secret,
    localIdentity: false,
    auth: { pool: auth, config: issuer },
    media: { store, schedule: queue.schedule },
  });
  cleanup.push(() => app.close());
  await app.ready();
  if (process.argv.includes("--check")) {
    console.log(
      JSON.stringify({
        status: "ok",
        scope: "api_dependencies",
        productionReady: false,
        completeMvp: false,
        paidProvidersEnabled: false,
      }),
    );
    await close();
  } else {
    stage = "listen";
    await app.listen({ host: "0.0.0.0", port: 4310 });
    console.log(
      JSON.stringify({
        status: "listening",
        service: "api",
        port: 4310,
        identity: "configured_oidc",
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
