import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import {
  defaultQueueSchema,
  internalQueue,
  verifyQueueRole,
} from "@drama/queue";
if (!process.env.RUNTIME_DATABASE_URL || !process.env.SCHEDULER_DATABASE_URL)
  throw new Error("Runtime and scheduler database identities are required");
const producer = new Pool({
    connectionString: process.env.RUNTIME_DATABASE_URL,
    max: 1,
  }),
  scheduler = new Pool({
    connectionString: process.env.SCHEDULER_DATABASE_URL,
    max: 2,
  });
const schema = process.env.QUEUE_SCHEMA ?? defaultQueueSchema;
const boss = new PgBoss({
  schema,
  db: { executeSql: (text, values) => scheduler.query(text, values) },
  migrate: false,
  supervise: false,
  schedule: false,
  reindex: false,
});
const errors: Error[] = [];
boss.on("error", (error) => errors.push(error));
try {
  for (const [pool, mode] of [
    [producer, "producer"],
    [scheduler, "scheduler"],
  ] as const) {
    const sql = await pool.connect();
    try {
      await verifyQueueRole(sql, schema, mode);
    } finally {
      sql.release();
    }
  }
  await boss.start();
  const queue = await boss.getQueue(internalQueue);
  if (!queue) throw new Error("Internal queue is not provisioned");
  const [stats] = await boss.getQueueStats(internalQueue, { force: true });
  if (!stats) throw new Error("Queue statistics are unavailable");
  if (errors.length) throw errors[0];
  console.log(
    JSON.stringify({
      queuePreflight: "pass",
      runtimeMigrations: false,
      producerMayConsume: false,
      pending: stats.queuedCount,
      active: stats.activeCount,
      failed: stats.failedCount,
      capturedAt: stats.capturedOn,
      processingEnabled: false,
      reason:
        "Media business handlers are connected in E03; QV-01 paid-provider gate remains open",
    }),
  );
} finally {
  await boss.stop();
  await producer.end();
  await scheduler.end();
}
