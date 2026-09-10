import type { Pool, PoolClient } from "pg";
import { PgBoss } from "pg-boss";
import { internalQueue, queueSchema } from "./config.js";
import { verifyQueueRole } from "./provision.js";
export {
  installQueue,
  grantQueueAccess,
  verifyQueueRole,
} from "./provision.js";
export {
  defaultQueueSchema,
  internalQueue,
  queueVersion,
  queueSchemaVersion,
} from "./config.js";

/** A scheduling hint only. The handler resolves tenant and authority from its business root. */
export type StepEnvelope = {
  taskKind: "media_probe";
  businessId: string;
  stepRevision: number;
  epoch: string;
};
export function parseEnvelope(input: unknown): StepEnvelope {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid internal step envelope");
  const value = input as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (
    Object.keys(value).sort().join(",") !==
      "businessId,epoch,stepRevision,taskKind" ||
    value.taskKind !== "media_probe" ||
    typeof value.businessId !== "string" ||
    !uuid.test(value.businessId) ||
    typeof value.epoch !== "string" ||
    !uuid.test(value.epoch) ||
    !Number.isSafeInteger(value.stepRevision) ||
    Number(value.stepRevision) < 1
  )
    throw new Error("Invalid internal step envelope");
  return {
    taskKind: "media_probe",
    businessId: value.businessId,
    epoch: value.epoch,
    stepRevision: Number(value.stepRevision),
  };
}

type Options = { schema?: string; onError: (error: Error) => void };
async function start(
  pool: Pool,
  options: Options,
  mode: "producer" | "scheduler",
) {
  const schema = queueSchema(options.schema),
    client = await pool.connect();
  try {
    await verifyQueueRole(client, schema, mode);
  } finally {
    client.release();
  }
  const boss = new PgBoss({
    db: { executeSql: (text, values) => pool.query(text, values) },
    schema,
    migrate: false,
    schedule: false,
    supervise: mode === "scheduler",
    reindex: false,
    useListenNotify: false,
    persistWarnings: false,
    persistQueueStats: false,
  });
  boss.on("error", options.onError);
  boss.on("warning", (warning) =>
    options.onError(new Error(`Queue warning: ${warning.message}`)),
  );
  try {
    await boss.start();
    if (!(await boss.getQueue(internalQueue)))
      throw new Error("Provision internal queue before startup");
    return boss;
  } catch (error) {
    await boss.stop();
    throw error;
  }
}

export async function createScheduler(pool: Pool, options: Options) {
  const boss = await start(pool, options, "producer");
  return {
    /** Caller must own an open business transaction on this exact PoolClient. */
    async schedule(sql: PoolClient, envelope: StepEnvelope, startAfter?: Date) {
      const data = parseEnvelope(envelope);
      if (startAfter && !Number.isFinite(startAfter.getTime()))
        throw new Error("Invalid step date");
      return boss.send(internalQueue, data, {
        db: { executeSql: (text, values) => sql.query(text, values) },
        singletonKey: `${data.businessId}:${data.stepRevision}:${data.epoch}`,
        ...(startAfter ? { startAfter } : {}),
      });
    },
    close: () => boss.stop(),
  };
}

export type StepHandler = (
  envelope: StepEnvelope,
  context: { signal: AbortSignal; queueJobId: string },
) => Promise<void>;
export async function runInternalWorker(
  pool: Pool,
  handler: StepHandler,
  options: Options & { concurrency?: number },
) {
  const concurrency = options.concurrency ?? 2;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error("Internal worker concurrency must be 1–8");
  const boss = await start(pool, options, "scheduler");
  try {
    await boss.work<unknown>(
      internalQueue,
      {
        batchSize: 1,
        localConcurrency: concurrency,
        pollingIntervalSeconds: 1,
      },
      async ([job]) => {
        if (!job) return;
        try {
          const data = parseEnvelope(job.data);
          await handler(data, { signal: job.signal, queueJobId: job.id });
        } catch (error) {
          options.onError(
            error instanceof Error ? error : new Error("Internal step failed"),
          );
          // Full errors may contain private media URLs. Keep queue output generic.
          throw new Error("Internal step failed; consult worker diagnostics");
        }
      },
    );
    return { close: () => boss.stop({ graceful: true, timeout: 10000 }) };
  } catch (error) {
    await boss.stop();
    throw error;
  }
}
