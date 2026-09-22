import {
  imageOutput,
  videoOutput,
  audioOutput,
  type ImageOutput,
  type VideoOutput,
  type AudioOutput,
} from "./image-output.js";
import { parseEnvelope, type StepEnvelope } from "@drama/queue";
import type { PoolClient } from "pg";
import { assistanceBody } from "./artifacts.js";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { sqlIdentifier, verifyRuntimeRole } from "@drama/database";
import { validateContract } from "@drama/contracts/validation";
import type {
  AssistanceAdapter,
  AssistanceProviderTask,
  AssistanceReceipt,
  AssistanceSubmission,
} from "@drama/provider";
import type { Schema } from "../content/model.js";

type Saved = AssistanceSubmission & {
  status: Schema<"GenerationJob">["status"];
  providerJobId?: string;
  observationFailures?: number;
  evidence: { id: string; body: AssistanceReceipt }[];
};
type Observation = Saved & {
  action: "query" | "recover" | "cancel";
  leaseToken: string;
};
/** Decode a constrained model result. It cannot inject IDs, references, target changes or actions. */
export function analysisOperations(
  output: unknown,
  submission: AssistanceSubmission,
): Schema<"ProposalOperation">[] {
  if (
    !output ||
    typeof output !== "object" ||
    Array.isArray(output) ||
    Object.keys(output).join(",") !== "shots"
  )
    throw new Error("INVALID_ASSISTANCE_OUTPUT");
  const shots = (output as { shots: unknown }).shots;
  if (!Array.isArray(shots) || shots.length < 1 || shots.length > 100)
    throw new Error("INVALID_ASSISTANCE_OUTPUT");
  const target = submission.input.proposalTarget,
    excerpt = submission.resolvedInput.sourceExcerpt;
  if (target?.mode !== "append_to_scene" || !excerpt)
    throw new Error("INVALID_ASSISTANCE_INPUT");
  const text = (value: unknown, max: number, required = false) => {
    if (
      typeof value !== "string" ||
      Array.from(value).length > max ||
      (required && !value.trim()) ||
      /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        value,
      )
    )
      throw new Error("INVALID_ASSISTANCE_OUTPUT");
    return value;
  };
  return shots.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("INVALID_ASSISTANCE_OUTPUT");
    const shot = raw as Record<string, unknown>;
    if (
      Object.keys(shot).some(
        (k) =>
          ![
            "label",
            "intent",
            "action",
            "camera",
            "dialogue",
            "plannedDurationUs",
          ].includes(k),
      )
    )
      throw new Error("INVALID_ASSISTANCE_OUTPUT");
    const spec: Schema<"ShotSpec"> = {
      intent: text(shot.intent, 20000, true),
      references: [],
    };
    if (shot.action !== undefined) spec.action = text(shot.action, 20000);
    if (shot.camera !== undefined) spec.camera = text(shot.camera, 20000);
    if (shot.plannedDurationUs !== undefined) {
      if (
        !Number.isSafeInteger(shot.plannedDurationUs) ||
        Number(shot.plannedDurationUs) < 0
      )
        throw new Error("INVALID_ASSISTANCE_OUTPUT");
      spec.plannedDurationUs = Number(shot.plannedDurationUs);
    }
    if (shot.dialogue !== undefined) {
      if (!Array.isArray(shot.dialogue) || shot.dialogue.length > 100)
        throw new Error("INVALID_ASSISTANCE_OUTPUT");
      spec.dialogue = shot.dialogue.map((line) => ({
        id: randomUUID(),
        text: text(line, 20000),
      }));
    }
    const op: Schema<"ProposalOperation"> = {
      opId: randomUUID(),
      temporaryId: randomUUID(),
      action: "create",
      kind: "shot",
      summary: spec.intent,
      proposed: {
        sceneId: target.sceneId,
        label: text(shot.label, 160, true),
        position: index,
        status: "active",
        spec,
      },
      sourceExcerpts: [excerpt],
    };
    if (!validateContract("ProposalOperation", op).valid)
      throw new Error("INVALID_ASSISTANCE_OUTPUT");
    return op;
  });
}
/** One durable poll step. Lost processes never return a dispatching attempt to queued. */
export async function createAssistanceWorker(options: {
  pool: Pool;
  schema?: string;
  adapters: AssistanceAdapter[];
  scheduleArchive?: (
    sql: PoolClient,
    envelope: StepEnvelope,
  ) => Promise<unknown>;
}) {
  const schema = options.schema ?? "drama",
    scope = sqlIdentifier(schema),
    adapters = new Map(options.adapters.map((a) => [a.connectionVersionId, a]));
  if (adapters.size !== options.adapters.length)
    throw new Error("Duplicate connection adapter");
  const check = await options.pool.connect();
  try {
    await verifyRuntimeRole(check, schema);
    const r = await check.query(
      `SELECT ${scope}.generation_worker_login() AS ok`,
    );
    if (!r.rows[0]?.ok)
      throw new Error("Generation worker role is not configured");
  } finally {
    check.release();
  }
  const query = (sql: string, values: unknown[] = []) =>
    options.pool.query(sql, values);
  async function save(attemptId: string, receipt: AssistanceReceipt) {
    await query(`SELECT ${scope}.record_generation_evidence($1,$2,$3)`, [
      attemptId,
      randomUUID(),
      receipt,
    ]);
  }
  async function finish(jobId: string) {
    const state = (
      await query(`SELECT ${scope}.read_generation_evidence($1) AS state`, [
        jobId,
      ])
    ).rows[0]?.state as Saved | null;
    if (!state) return;
    if (["succeeded", "failed", "cancelled"].includes(state.status)) return;
    // Every observation is evidence. Only a completed receipt contains creative output;
    // accepted/running/cancellation acknowledgements must never be decoded as results.
    // SQL projects evidence monotonically and detects conflicting terminal receipts.
    for (const selected of state.evidence) await project(state, selected);
  }
  async function project(state: Saved, selected: Saved["evidence"][number]) {
    let ops:
        | Schema<"ProposalOperation">[]
        | Schema<"AssistanceBody">
        | ImageOutput
        | VideoOutput
        | AudioOutput
        | null = null,
      failure: string | null = null;
    if (selected.body.kind === "completed")
      try {
        ops =
          state.input.purpose === "audio"
            ? audioOutput(selected.body.output)
            : state.input.purpose === "video"
              ? videoOutput(selected.body.output)
              : state.input.purpose === "image"
                ? imageOutput(selected.body.output)
                : state.input.purpose === "creative_assistance"
                  ? assistanceBody(selected.body.output, state.resolvedInput)
                  : analysisOperations(selected.body.output, state);
      } catch {
        failure =
          state.input.purpose === "audio"
            ? "INVALID_AUDIO_OUTPUT"
            : state.input.purpose === "video"
              ? "INVALID_VIDEO_OUTPUT"
              : state.input.purpose === "image"
                ? "INVALID_IMAGE_OUTPUT"
                : "INVALID_ASSISTANCE_OUTPUT";
      }
    const sql = await options.pool.connect();
    try {
      await sql.query("BEGIN");
      await sql.query(`SELECT ${scope}.finish_generation_job($1,$2,$3,$4)`, [
        state.jobId,
        selected.id,
        ops ? JSON.stringify(ops) : null,
        failure,
      ]);
      if (["image", "video", "audio"].includes(state.input.purpose)) {
        const envelope = (
          await sql.query(
            `SELECT ${scope}.read_generation_archive_envelope($1) AS envelope`,
            [state.jobId],
          )
        ).rows[0]?.envelope;
        if (envelope) {
          if (!options.scheduleArchive)
            throw new Error("ARCHIVE_NOT_CONFIGURED");
          await options.scheduleArchive(sql, parseEnvelope(envelope));
        }
      }
      await sql.query("COMMIT");
    } catch (error) {
      await sql.query("ROLLBACK");
      throw error;
    } finally {
      sql.release();
    }
  }
  async function process(jobId: string, signal = AbortSignal.timeout(120000)) {
    const token = randomUUID();
    const submission = (
      await query(`SELECT ${scope}.claim_generation_job($1,$2) AS submission`, [
        jobId,
        token,
      ])
    ).rows[0]?.submission as AssistanceSubmission | null;
    if (submission) {
      const adapter = adapters.get(submission.connectionVersionId);
      // A missing transport is an explicit local rejection before any call; no fixture fallback.
      if (
        !adapter ||
        adapter.executionMode !== submission.executionMode ||
        (["image", "video", "audio"].includes(submission.input.purpose) &&
          !options.scheduleArchive)
      )
        await save(submission.attemptId, {
          kind: "rejected",
          code:
            ["image", "video", "audio"].includes(submission.input.purpose) &&
            !options.scheduleArchive
              ? "ARCHIVE_NOT_CONFIGURED"
              : "ADAPTER_NOT_CONFIGURED",
          correlation: submission.attemptId,
        });
      else {
        let receipt: AssistanceReceipt;
        try {
          receipt = await adapter.submitOnce(submission, signal);
        } catch {
          receipt = { kind: "unknown", correlation: submission.attemptId };
        }
        await save(submission.attemptId, receipt);
      }
    }
    await finish(jobId);
  }
  async function reconcile(jobId: string, signal = AbortSignal.timeout(120000)) {
    await finish(jobId);
    const token = randomUUID();
    const state = (
      await query(
        `SELECT ${scope}.claim_generation_observation($1,$2) AS state`,
        [jobId, token],
      )
    ).rows[0]?.state as Observation | null;
    if (!state) return;
    if (state.leaseToken !== token)
      throw new Error("OBSERVATION_LEASE_MISMATCH");
    const adapter = adapters.get(state.connectionVersionId);
    const configured = adapter?.executionMode === state.executionMode;
    const task: AssistanceProviderTask | undefined = state.providerJobId
      ? { ...state, providerJobId: state.providerJobId }
      : undefined;
    const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
    let failed = true;
    try {
      if (!["query", "recover", "cancel"].includes(state.action))
        throw new Error("INVALID_OBSERVATION_ACTION");
      if (state.action !== "recover" && !task)
        throw new Error("PROVIDER_TASK_ID_REQUIRED");
      let receipt: AssistanceReceipt | null;
      try {
        if (state.action === "recover") {
          // Recovery is a read of the original submission, never another submitOnce.
          receipt = configured
            ? await adapter!.recoverSubmission(state, boundedSignal)
            : null;
        } else if (state.action === "query") {
          if (!task) throw new Error("PROVIDER_TASK_ID_REQUIRED");
          receipt =
            configured && adapter!.query
              ? await adapter!.query(task, boundedSignal)
              : {
                  kind: "unavailable",
                  correlation: state.attemptId,
                  providerJobId: task.providerJobId,
                  code: "QUERY_ADAPTER_NOT_CONFIGURED",
                };
        } else if (state.action === "cancel") {
          if (!task) throw new Error("PROVIDER_TASK_ID_REQUIRED");
          // This action has already been durably marked as attempted. Even a crash or
          // lost response cannot authorize a second cancellation call.
          receipt =
            configured && adapter!.requestCancel
              ? await adapter!.requestCancel(task, boundedSignal)
              : {
                  kind: configured ? "cancel_unsupported" : "cancel_unknown",
                  correlation: state.attemptId,
                  providerJobId: task.providerJobId,
                };
        } else throw new Error("INVALID_OBSERVATION_ACTION");
      } catch {
        receipt =
          state.action === "recover" || !task
            ? { kind: "unknown", correlation: state.attemptId }
            : state.action === "cancel"
              ? {
                  kind: "cancel_unknown",
                  correlation: state.attemptId,
                  providerJobId: task.providerJobId,
                }
              : {
                  kind: "unavailable",
                  correlation: state.attemptId,
                  providerJobId: task.providerJobId,
                  code: "PROVIDER_QUERY_UNAVAILABLE",
                };
      }
      if (receipt) {
        await save(state.attemptId, receipt);
        await finish(jobId);
        failed = ["unknown", "unavailable", "cancel_unknown"].includes(
          receipt.kind,
        );
      }
    } finally {
      // Failures survive process restarts in SQL. Read-only queries back off with jitter;
      // neither the timer nor releasing a lease can put an attempt back into queued.
      const failures = Number.isSafeInteger(state.observationFailures)
        ? Math.max(0, state.observationFailures!)
        : 0;
      const delay = failed
        ? Math.max(
            1,
            Math.min(
              300,
              Math.ceil(
                5 * 2 ** Math.min(failures, 6) * (0.8 + Math.random() * 0.4),
              ),
            ),
          )
        : 5;
      await query(
        `SELECT ${scope}.release_generation_observation($1,$2,$3,$4)`,
        [jobId, token, delay, failed],
      );
    }
  }
  return {
    process,
    reconcile,
    async scan() {
      const ids = (
        await query(`SELECT ${scope}.scan_generation_work(100) AS id`)
      ).rows.map((r) => r.id as string);
      for (const id of ids) {
        await process(id);
        await reconcile(id);
      }
      return ids.length;
    },
  };
}
