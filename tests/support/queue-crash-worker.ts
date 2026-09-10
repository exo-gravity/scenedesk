import { Pool } from "pg";
import { runInternalWorker } from "@drama/queue";
import { processProbe } from "./queue-work.js";
const scheduler = new Pool({
  connectionString: process.env.QUEUE_TEST_SCHEDULER_URL,
  max: 3,
});
const business = new Pool({
  connectionString: process.env.QUEUE_TEST_WORKER_URL,
  max: 1,
});
await runInternalWorker(
  scheduler,
  async (step) => {
    await processProbe(
      business,
      process.env.QUEUE_TEST_BUSINESS_SCHEMA!,
      step,
      async (at) => {
        if (at === process.env.QUEUE_TEST_CHECKPOINT) {
          process.send?.({ checkpoint: at });
          await new Promise<void>(() => {}); // Parent deliberately SIGKILLs the process here.
        }
      },
    );
  },
  {
    schema: process.env.QUEUE_TEST_SCHEMA!,
    concurrency: 1,
    onError: () => process.send?.({ error: "queue child failed" }),
  },
);
