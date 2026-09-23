import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { Pool } from "pg";
import {
  grantGenerationWorkerAccess,
  grantMediaWorkerAccess,
  sqlIdentifier,
} from "@drama/database";
import {
  createScheduler,
  grantQueueAccess,
  installQueue,
  type StepEnvelope,
} from "@drama/queue";
import {
  createAssistanceFixture,
  type AssistanceSubmissionReceipt,
  type AssistanceSubmission,
} from "@drama/provider";
import type { MediaStore } from "@drama/media";
import { businessFixture } from "./business.js";
import { createAssistanceWorker } from "../../apps/api/src/modules/generation/worker.js";

/** DB fixtures prove persistence, not file or AI quality. Media tests supply a real isolated store. */
export async function imageGenerationFixture(
  t: TestContext,
  store = { verify: async () => undefined } as unknown as MediaStore,
  options: {
    purpose?: "image" | "video" | "audio";
    origin?: string;
    generationExecutor?: boolean;
  } = {},
) {
  const kind = options.purpose ?? "image";
  const queueErrors: Error[] = [];
  t.after(() => assert.deepEqual(queueErrors, []));
  const suffix = randomBytes(5).toString("hex"),
    queueSchema = `scenedesk_queue_${suffix}`;
  const roles = [
      `image_gen_${suffix}`,
      `image_media_${suffix}`,
      `image_sched_${suffix}`,
    ],
    pools: Pool[] = [],
    stops: (() => Promise<void>)[] = [];
  t.after(async () => {
    for (const stop of stops.reverse()) await stop();
    for (const pool of pools) await pool.end();
    const admin = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await admin.query(
        `DROP SCHEMA IF EXISTS ${sqlIdentifier(queueSchema)} CASCADE`,
      );
      for (const role of roles) {
        await admin.query(`DROP OWNED BY ${sqlIdentifier(role)}`);
        await admin.query(`DROP ROLE ${sqlIdentifier(role)}`);
      }
    } finally {
      await admin.end();
    }
  });
  const f = await businessFixture(
    t,
    async (db) => {
      for (const role of roles) {
        const password = randomBytes(24).toString("hex");
        await db.admin.query(
          `CREATE ROLE ${sqlIdentifier(role)} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '${password}'`,
        );
        const url = new URL(process.env.DATABASE_URL!);
        url.username = role;
        url.password = password;
        pools.push(new Pool({ connectionString: url.href, max: 3 }));
      }
      await installQueue(db.admin, queueSchema);
      const sql = await db.admin.connect();
      try {
        await grantGenerationWorkerAccess(sql, db.schema, roles[0]!);
        await grantMediaWorkerAccess(sql, db.schema, roles[1]!, roles[2]!);
        for (const role of [db.apiRole, roles[0]!, roles[1]!])
          await grantQueueAccess(sql, queueSchema, role, roles[2]!);
      } finally {
        sql.release();
      }
      const producer = await createScheduler(db.runtime, {
        schema: queueSchema,
        onError: (error) => queueErrors.push(error),
      });
      stops.push(producer.close);
      return { media: { store, schedule: producer.schedule } };
    },
    {
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.generationExecutor === undefined
        ? {}
        : { generationExecutor: options.generationExecutor }),
    },
  );
  const [generationDb, mediaDb, schedulerDb] = pools as [Pool, Pool, Pool];
  const producer = await createScheduler(generationDb, {
    schema: queueSchema,
    onError: (error) => queueErrors.push(error),
  });
  stops.push(producer.close);
  const mediaProducer = await createScheduler(mediaDb, {
    schema: queueSchema,
    onError: (error) => queueErrors.push(error),
  });
  stops.push(mediaProducer.close);
  const base = `/v1/tenants/${f.tenant.id}`,
    scope = sqlIdentifier(f.schema);
  const episode = await f.ok(
    "POST",
    `${f.path}/episodes`,
    { title: "一", position: 0, status: "active" },
    await f.next(),
  );
  const scene = await f.ok(
    "POST",
    `${f.path}/scenes`,
    {
      episodeId: episode.id,
      title: "图像场次",
      summary: "明确选定的场次",
      position: 0,
      state: {},
      status: "active",
    },
    await f.next(),
  );
  const shot = await f.ok(
    "POST",
    `${f.path}/shots`,
    {
      sceneId: scene.id,
      label: "01",
      position: 0,
      status: "active",
      spec: { intent: "寻找钥匙", references: [] },
    },
    await f.next(),
  );
  const capabilityId = randomUUID(),
    connectionId = randomUUID(),
    connectionVersionId = randomUUID();
  const definition = {
    purpose: kind,
    mode: `${kind}_fixture_v1`,
    ...(kind !== "image"
      ? { minDurationSeconds: 2, maxDurationSeconds: 2, audioOutput: true }
      : {}),
    modelVersion: "显式文件 fixture，无真实模型",
    supportedPurposes: kind === "audio" ? ["voice"] : ["composition", "look"],
    maxReferences: 2,
    allowedResolutions: ["32x32"],
    allowedAspectRatios: ["1:1"],
    inputRules: [
      {
        kind: kind === "audio" ? "audio" : "image",
        purposes: kind === "audio" ? ["voice"] : ["composition", "look"],
        minCount: 0,
        maxCount: 2,
        mimeTypes: kind === "audio" ? ["audio/wav"] : ["image/png"],
        maxBytes: 1048576,
      },
    ],
  };
  await f.admin.query(
    `INSERT INTO ${scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
    [capabilityId, f.tenant.id, connectionId, connectionVersionId, definition],
  );
  // A synthetic model offering two input modes across three ratios and two
  // tiers. The panel's grouping, its mode pill and its tier list have nothing
  // else to exercise them: the fixture above is one mode at one size. Image
  // only, because only the image composer has a case for it, and never
  // submitted, so no provider is reached.
  const dualMode: { id: string; mode: string }[] = [];
  if (kind === "image") {
    const dualModeVersionId = randomUUID();
    for (const mode of ["frames_v1", "reference_v1"]) {
      const id = randomUUID();
      await f.admin.query(
        `INSERT INTO ${scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'verified_provider',true,2,100)`,
        [
          id,
          f.tenant.id,
          connectionId,
          dualModeVersionId,
          {
            ...definition,
            mode,
            modelVersion: "fixture/dual-mode",
            displayName: "双模式 fixture",
            allowedAspectRatios: ["16:9", "9:16", "21:9"],
            allowedResolutions: ["864x496", "1280x720", "720x1280", "1470x630"],
            outputs: [
              { resolution: "864x496", aspectRatio: "16:9", quality: "480p" },
              { resolution: "1280x720", aspectRatio: "16:9", quality: "720p" },
              { resolution: "720x1280", aspectRatio: "9:16", quality: "720p" },
              { resolution: "1470x630", aspectRatio: "21:9", quality: "720p" },
            ],
          },
        ],
      );
      dualMode.push({ id, mode });
    }
  }
  const input = {
    scope: "project",
    projectId: f.project.id,
    purpose: kind,
    connectionId,
    capabilityId,
    shotSources: [{ shotId: shot.id, shotRevisionId: shot.specRevisionId }],
    contextSources: [],
    additionalReferences: [],
    referenceOverrides: [],
    prompt: "固定的技术测试图像",
    promptPolicy: "replace",
    output:
      kind === "audio"
        ? { durationSeconds: 2 }
        : {
            resolution: "32x32",
            aspectRatio: "1:1",
            ...(kind === "video"
              ? { durationSeconds: 2, withAudio: false }
              : {}),
          },
  };
  let calls = 0,
    last: AssistanceSubmission | undefined,
    output: unknown = {
      [kind === "audio" ? "audios" : kind === "video" ? "videos" : "images"]: [
        {
          kind: "fixture_object",
          object: {
            key: `originals/${randomUUID()}`,
            versionId: "relational-fixture-only",
            bytes: 100,
          },
          sha256: "a".repeat(64),
          mime:
            kind === "audio"
              ? "audio/wav"
              : kind === "video"
                ? "video/mp4"
                : "image/png",
        },
      ],
    },
    unknown = false,
    queueFailure = false;
  const receipt = (
    submission: AssistanceSubmission,
  ): AssistanceSubmissionReceipt =>
    unknown
      ? { kind: "unknown", correlation: submission.attemptId }
      : { kind: "completed", correlation: submission.attemptId, output };
  const adapter = createAssistanceFixture(
    connectionVersionId,
    async (submission) => {
      calls++;
      last = submission;
      return receipt(submission);
    },
    async (submission) => (unknown ? null : receipt(submission)),
  );
  const worker = await createAssistanceWorker({
    pool: generationDb,
    schema: f.schema,
    adapters: [adapter],
    scheduleArchive: async (sql, envelope) => {
      if (queueFailure) throw new Error("Injected archive queue failure");
      await producer.schedule(sql, envelope);
    },
  });
  const plan = async (extra: Record<string, unknown> = {}) =>
    f.ok("POST", `${base}/generation-plans`, { ...input, ...extra });
  const execute = async (planId: string) => {
    const r = await f.request("POST", `${base}/generation-jobs`, { planId });
    assert.equal(r.statusCode, 202, r.body);
    return r.json();
  };
  const job = (id: string) => f.ok("GET", `${base}/generation-jobs/${id}`);
  const envelope = async (id: string) => {
    const r = await generationDb.query(
      `SELECT ${scope}.read_generation_archive_envelope($1) AS data`,
      [id],
    );
    return r.rows[0]?.data as StepEnvelope;
  };
  return {
    ...f,
    base,
    scope,
    scene,
    shot,
    input,
    dualMode,
    definition,
    roles,
    queueSchema,
    generationDb,
    mediaDb,
    schedulerDb,
    worker,
    mediaProducer,
    plan,
    execute,
    job,
    envelope,
    setOutput: (value: unknown) => {
      output = value;
    },
    setUnknown: (value: boolean) => {
      unknown = value;
    },
    setQueueFailure: (value: boolean) => {
      queueFailure = value;
    },
    calls: () => calls,
    last: () => last,
  };
}
