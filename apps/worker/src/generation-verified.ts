import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Pool } from "pg";
import { MediaStore, type StoreConfiguration } from "@drama/media";
import { parseGenerationVendors } from "@drama/provider";
import { createVerifiedGenerationRuntime } from "./verified-runtime.js";

// Local entry: same JSON shape as production, but plain local Postgres and MinIO are allowed.
if (
  process.env.APP_ENV !== "local" ||
  process.env.PROVIDER_MODE !== "verified" ||
  !process.env.GENERATION_CONFIG_FILE
)
  throw new Error(
    "Set APP_ENV=local PROVIDER_MODE=verified GENERATION_CONFIG_FILE=<generation.json>",
  );
if (process.env.DATABASE_URL || process.env.APP_SECRET)
  throw new Error(
    "Generation worker must not load migration or identity credentials",
  );
const raw = JSON.parse(await readFile(process.env.GENERATION_CONFIG_FILE, "utf8"));
const pool = new Pool({
  connectionString: raw.databaseUrl,
  max: 3,
  connectionTimeoutMillis: 3000,
});
const storeConfig: StoreConfiguration = {
  ...(raw.media.endpoint ? { endpoint: raw.media.endpoint } : {}),
  region: raw.media.region,
  bucket: raw.media.bucket,
  credentials: {
    accessKeyId: raw.media.accessKeyId,
    secretAccessKey: raw.media.secretAccessKey,
  },
  local: true,
};
const store = new MediaStore(storeConfig);
await store.verify();
const runtime = await createVerifiedGenerationRuntime({
  pool,
  schema: process.env.DATABASE_SCHEMA ?? "drama",
  ...(process.env.QUEUE_SCHEMA ? { queueSchema: process.env.QUEUE_SCHEMA } : {}),
  store,
  tmpdir: process.env.TMPDIR ?? tmpdir(),
  config: parseGenerationVendors({
    vendors: raw.vendors,
    connections: raw.connections,
  }),
  onError: (stage) =>
    console.error(`generation ${stage} failed; durable state remains`),
});
runtime.start(2500);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void runtime.close().then(() => pool.end());
  });
console.log(
  JSON.stringify({
    generationWorker: "ready",
    executionMode: "verified_provider",
    paidProvidersEnabled: true,
    vendors: Object.keys(raw.vendors),
  }),
);
