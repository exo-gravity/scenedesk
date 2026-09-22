import type { Pool, PoolClient } from "pg";
import { createScheduler } from "@drama/queue";
import { sqlIdentifier } from "@drama/database";
import type { MediaStore } from "@drama/media";
import { createVerifiedAdapters, type GenerationVendors, type ResolvedMedia } from "@drama/provider";
import { createAssistanceWorker } from "../../api/src/modules/generation/worker.js";

export async function createVerifiedGenerationRuntime(options: {
  pool: Pool; schema: string; queueSchema?: string; config: GenerationVendors; store: MediaStore; tmpdir: string;
  fetch?: typeof fetch; onError?: (stage: string) => void; onScan?: (outcome: "ok" | "failed") => void;
}) {
  const scope = sqlIdentifier(options.schema);
  const resolveMedia = async (jobId: string): Promise<ResolvedMedia[]> =>
    (await options.pool.query(`SELECT ${scope}.read_generation_media_sources($1) AS sources`, [jobId])).rows[0]?.sources ?? [];
  const scheduler = await createScheduler(options.pool, {
    ...(options.queueSchema ? { schema: options.queueSchema } : {}),
    onError: () => options.onError?.("archive_queue"),
  });
  const adapters = createVerifiedAdapters(options.config, { store: options.store, resolveMedia, fetch: options.fetch ?? fetch, tmpdir: options.tmpdir });
  const worker = await createAssistanceWorker({ pool: options.pool, schema: options.schema, adapters, scheduleArchive: (sql: PoolClient, envelope) => scheduler.schedule(sql, envelope) });
  let timer: NodeJS.Timeout | undefined, active: Promise<void> | undefined, closing = false;
  const scanOnce = () => worker.scan().then(() => undefined);
  function tick(intervalMs: number) {
    if (closing) return;
    active = scanOnce()
      .then(() => { options.onScan?.("ok"); })
      .catch(() => { options.onError?.("scan"); options.onScan?.("failed"); })
      .finally(() => { if (!closing) timer = setTimeout(() => tick(intervalMs), intervalMs); });
  }
  return {
    scanOnce,
    start(intervalMs = 2500) { tick(intervalMs); },
    async close() { if (closing) return; closing = true; clearTimeout(timer); await active; await scheduler.close(); },
  };
}
