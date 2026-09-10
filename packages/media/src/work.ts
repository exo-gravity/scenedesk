import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import { sqlIdentifier, verifyRuntimeRole } from "@drama/database";
import {
  parseEnvelope,
  type StepEnvelope,
  type StepHandler,
} from "@drama/queue";
import {
  MediaFailure,
  type ProbeResult,
  type VerifiedObject,
} from "./policy.js";
import { probeMedia, makeDerivative } from "./probe.js";
import { verifyMediaRuntime } from "./sandbox.js";
import type { MediaStore } from "./storage.js";

type Issue = { code: string; message: string; retryable: boolean };
type Row = Record<string, any>;
type Options = {
  pool: Pool;
  schema?: string;
  store: MediaStore;
  schedule(sql: PoolClient, step: StepEnvelope): Promise<unknown>;
};
type Claim = { row: Row; revision: number; context: Row };
function processingIssue(error: unknown): Issue {
  if (
    error instanceof Error &&
    ["NoSuchVersion", "NoSuchKey"].includes(error.name)
  )
    return {
      code: "MEDIA_SOURCE_MISSING",
      message: "已固定的源文件版本不存在，请重新导入。",
      retryable: false,
    };
  if (error instanceof MediaFailure) {
    const transient = new Set([
      "STORAGE_VERSION_REQUIRED",
      "STORAGE_INTEGRITY_MISMATCH",
      "MEDIA_SANDBOX_UNAVAILABLE",
      "MEDIA_SANDBOX_CLEANUP_FAILED",
      "MEDIA_CANCELLED",
      "MEDIA_BUILD_MISMATCH",
    ]);
    return {
      code: error.code,
      message: error.message,
      retryable: transient.has(error.code),
    };
  }
  return {
    code: "MEDIA_SERVICE_UNAVAILABLE",
    message: "处理服务暂未完成，请稍后重试。",
    retryable: true,
  };
}

/** Internal media writes share real root locks and CAS, never the queue's notion of success. */
export async function createMediaProcessor(
  options: Options,
): Promise<StepHandler> {
  const scope = sqlIdentifier(options.schema ?? "drama");
  const check = await options.pool.connect();
  try {
    await verifyRuntimeRole(check, options.schema ?? "drama");
    const role = await check.query(
      `SELECT ${scope}.media_worker_login() AS allowed`,
    );
    if (!role.rows[0]?.allowed)
      throw new Error("Registered media worker login required");
  } finally {
    check.release();
  }
  await options.store.verify();
  await verifyMediaRuntime();

  async function transaction<T>(
    step: StepEnvelope,
    run: (sql: PoolClient, context: Row) => Promise<T>,
  ): Promise<T | undefined> {
    const sql = await options.pool.connect();
    try {
      await sql.query("BEGIN");
      await sql.query(`SET LOCAL search_path TO ${scope},pg_catalog,pg_temp`);
      await sql.query("SET LOCAL statement_timeout='10s'");
      await sql.query("SET LOCAL lock_timeout='5s'");
      const found = await sql.query(
        "SELECT * FROM resolve_media_work($1,$2,$3,$4)",
        [step.businessId, step.taskKind, step.stepRevision, step.epoch],
      );
      const result = found.rows[0] ? await run(sql, found.rows[0]) : undefined;
      await sql.query("COMMIT");
      return result;
    } catch (error) {
      await sql.query("ROLLBACK");
      throw error;
    } finally {
      sql.release();
    }
  }
  const table = (step: StepEnvelope) =>
    step.taskKind === "media_probe" ? "upload_intents" : "media_derivatives";
  async function claim(step: StepEnvelope): Promise<Claim | undefined> {
    return transaction(step, async (sql, context) => {
      const row = (
        await sql.query(`SELECT * FROM ${table(step)} WHERE id=$1`, [
          step.businessId,
        ])
      ).rows[0];
      if (!row) return;
      if (step.taskKind === "media_probe" && row.status === "pending") {
        if (new Date(row.expires_at).getTime() <= Date.now())
          await sql.query(
            "UPDATE upload_intents SET status='expired',revision=revision+1,step_revision=step_revision+1,updated_at=now() WHERE id=$1",
            [step.businessId],
          );
        return;
      }
      const runnable =
        step.taskKind === "media_probe"
          ? ["uploaded", "verifying"]
          : ["queued", "processing"];
      if (!runnable.includes(row.status)) return;
      if (Number(row.processing_attempts) >= 6) {
        const issue: Issue = {
          code: "MEDIA_RETRIES_EXHAUSTED",
          message: "自动处理已停止，请检查后手动重试。",
          retryable: true,
        };
        if (step.taskKind === "media_probe") {
          await sql.query(
            "UPDATE upload_intents SET status='uploaded',issue=$2,retryable=true,revision=revision+1,updated_at=now() WHERE id=$1",
            [row.id, issue],
          );
          await sql.query(
            "UPDATE media SET issue=$2,revision=revision+1,updated_at=now() WHERE id=$1 AND status='processing'",
            [context.media_id, issue],
          );
        } else
          await sql.query(
            "UPDATE media_derivatives SET status='failed',issue=$2,revision=revision+1,updated_at=now() WHERE id=$1",
            [row.id, issue],
          );
        return;
      }
      const updated = (
        await sql.query(
          `UPDATE ${table(step)} SET status=$2,processing_attempts=processing_attempts+1,issue=NULL,revision=revision+1,updated_at=now()
        ${step.taskKind === "media_probe" ? ",retryable=false" : ""} WHERE id=$1 RETURNING *`,
          [
            row.id,
            step.taskKind === "media_probe" ? "verifying" : "processing",
          ],
        )
      ).rows[0];
      if (step.taskKind === "media_probe")
        await sql.query(
          "UPDATE media SET issue=NULL,revision=revision+1,updated_at=now() WHERE id=$1 AND status='processing' AND issue IS NOT NULL",
          [context.media_id],
        );
      return { row: updated, revision: Number(updated.revision), context };
    });
  }
  async function fail(step: StepEnvelope, active: Claim, issue: Issue) {
    return transaction(step, async (sql) => {
      if (step.taskKind === "media_probe") {
        const done = await sql.query(
          "UPDATE upload_intents SET status=$3,issue=$4,retryable=$5,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING id",
          [
            step.businessId,
            active.revision,
            issue.retryable ? "uploaded" : "rejected",
            issue,
            issue.retryable,
          ],
        );
        if (done.rowCount)
          await sql.query(
            "UPDATE media SET status=$2,issue=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND status='processing'",
            [
              active.context.media_id,
              issue.retryable ? "processing" : "rejected",
              issue,
            ],
          );
        return !!done.rowCount;
      }
      // Retryable failures stay queued until this step's finite automatic attempts are spent.
      const queued =
        issue.retryable && Number(active.row.processing_attempts) < 6;
      const done = await sql.query(
        "UPDATE media_derivatives SET status=$3,issue=$4,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING id",
        [step.businessId, active.revision, queued ? "queued" : "failed", issue],
      );
      return !!done.rowCount;
    });
  }
  async function acceptUpload(
    step: StepEnvelope,
    active: Claim,
    original: VerifiedObject,
    probe: ProbeResult,
  ) {
    return transaction(step, async (sql) => {
      const current = (
        await sql.query(
          "SELECT revision,status FROM upload_intents WHERE id=$1",
          [step.businessId],
        )
      ).rows[0];
      if (
        Number(current?.revision) !== active.revision ||
        current.status !== "verifying"
      )
        return;
      const result = await sql.query(
        `UPDATE media SET status='ready',kind=$2,immutable_key=$3,storage_version_id=$4,sha256=$5,bytes=$6,mime=$7,
        duration_us=$8,width=$9,height=$10,fps_num=$11,fps_den=$12,has_audio=$13,probe_metadata=$14,issue=NULL,revision=revision+1,updated_at=now() WHERE id=$1 AND status='processing' RETURNING id`,
        [
          active.context.media_id,
          probe.kind,
          original.key,
          original.versionId,
          original.sha256,
          original.bytes,
          probe.mime,
          probe.durationUs ?? null,
          probe.width ?? null,
          probe.height ?? null,
          probe.fpsNum ?? null,
          probe.fpsDen ?? null,
          probe.hasAudio,
          probe,
        ],
      );
      if (!result.rowCount)
        throw new Error("Upload result no longer matches media state");
      await sql.query(
        "UPDATE upload_intents SET status='accepted',retryable=false,issue=NULL,step_revision=step_revision+1,revision=revision+1,updated_at=now() WHERE id=$1",
        [step.businessId],
      );
      const variants =
        probe.kind === "image"
          ? ["poster"]
          : probe.kind === "video"
            ? ["poster", "proxy"]
            : probe.kind === "audio"
              ? ["proxy"]
              : [];
      for (const kind of variants) {
        const id = randomUUID();
        await sql.query(
          "INSERT INTO media_derivatives(id,tenant_id,media_id,kind,profile_revision,epoch) VALUES ($1,$2,$3,$4,1,$5)",
          [
            id,
            active.context.tenant_id,
            active.context.media_id,
            kind,
            step.epoch,
          ],
        );
        await options.schedule(sql, {
          taskKind: "media_derivative",
          businessId: id,
          stepRevision: 1,
          epoch: step.epoch,
        });
      }
    });
  }
  async function acceptDerivative(
    step: StepEnvelope,
    active: Claim,
    object: VerifiedObject,
    probe: ProbeResult,
  ) {
    await transaction(step, async (sql) => {
      await sql.query(
        `UPDATE media_derivatives SET status='ready',immutable_key=$3,storage_version_id=$4,sha256=$5,bytes=$6,mime=$7,duration_us=$8,width=$9,height=$10,
        issue=NULL,step_revision=step_revision+1,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 AND status='processing'`,
        [
          step.businessId,
          active.revision,
          object.key,
          object.versionId,
          object.sha256,
          object.bytes,
          probe.mime,
          probe.durationUs ?? null,
          probe.width ?? null,
          probe.height ?? null,
        ],
      );
    });
  }
  return async (envelope, { signal }) => {
    signal.throwIfAborted();
    const step = parseEnvelope(envelope);
    const active = await claim(step);
    if (!active) return;
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(tmpdir(), "scenedesk-work-"));
      const input = join(directory, "input");
      if (step.taskKind === "media_probe") {
        if (!active.row.staging_version_id) {
          const snapshot = await options.store.snapshot(
            active.row.staging_key,
            Number(active.row.expected_bytes),
            signal,
          );
          signal.throwIfAborted();
          const pinned = await transaction(step, async (sql) => {
            const result = await sql.query(
              "UPDATE upload_intents SET staging_version_id=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING revision",
              [step.businessId, active.revision, snapshot.versionId],
            );
            return result.rows[0];
          });
          if (!pinned) return;
          active.row.staging_version_id = snapshot.versionId;
          active.revision = Number(pinned.revision);
        }
        await options.store.download(
          {
            key: active.row.staging_key,
            versionId: active.row.staging_version_id,
            bytes: Number(active.row.expected_bytes),
          },
          input,
          active.row.expected_sha256,
          signal,
        );
        const probe = await probeMedia(input, active.row.mime_hint, signal);
        const original = await options.store.publish(
          input,
          {
            bytes: Number(active.row.expected_bytes),
            sha256: active.row.expected_sha256,
            mime: probe.mime,
          },
          "originals",
          signal,
        );
        signal.throwIfAborted();
        await acceptUpload(step, active, original, probe);
      } else {
        const source = await transaction(
          step,
          async (sql) =>
            (
              await sql.query(
                "SELECT * FROM media WHERE id=$1 AND status IN ('ready','archived')",
                [active.context.media_id],
              )
            ).rows[0] as Row | undefined,
        );
        if (!source) return;
        await options.store.download(
          {
            key: source.immutable_key,
            versionId: source.storage_version_id,
            bytes: Number(source.bytes),
          },
          input,
          source.sha256,
          signal,
        );
        const output = join(directory, "output");
        const derivative = await makeDerivative(
          input,
          source.probe_metadata as ProbeResult,
          active.row.kind,
          output,
          signal,
        );
        const object = await options.store.publish(
          output,
          derivative,
          "derivatives",
          signal,
        );
        signal.throwIfAborted();
        await acceptDerivative(step, active, object, derivative);
      }
    } catch (error) {
      const issue = processingIssue(error);
      const saved = await fail(step, active, issue);
      if (saved && issue.retryable) throw error;
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  };
}
