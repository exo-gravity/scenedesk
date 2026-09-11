import { Pool } from "pg";
import {
  ProductionJobs,
  ProductionStore,
  type StoreConfiguration,
} from "@drama/media";

// Only generated worker credentials are passed to this isolated test process.
process.once("message", async (input: unknown) => {
  const value = input as {
    schema: string;
    copyId: string;
    attemptId: string;
    artifactId: string;
    file: string;
    storage: StoreConfiguration;
  };
  const pool = new Pool({
    connectionString: process.env.MEDIA_WORKER_DATABASE_URL,
    max: 2,
  });
  const jobs = new ProductionJobs(pool, value.schema),
    storage = new ProductionStore(value.storage);
  let timer: NodeJS.Timeout | undefined;
  try {
    await jobs.verify();
    const journal = jobs.journal(
      value.copyId,
      value.attemptId,
      value.artifactId,
    );
    timer = setInterval(() => {
      void jobs
        .heartbeat(value.copyId, value.attemptId)
        .catch(() => process.exit(2));
    }, 15_000);
    await storage.publish(value.file, {
      ...journal,
      verified: async () => {
        process.send?.({ checkpoint: "stored-before-journal" });
        await new Promise<void>(() => {});
      },
    });
  } catch {
    process.send?.({ failed: true });
    process.exitCode = 1;
  } finally {
    clearInterval(timer);
    storage.close();
    await pool.end();
    process.disconnect?.();
  }
});
