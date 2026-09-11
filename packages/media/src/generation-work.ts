import {
  validateGeneratedVisual,
  type GeneratedVisualOptions,
} from "./generated-output.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqlIdentifier } from "@drama/database";
import { parseEnvelope, type StepHandler } from "@drama/queue";
import { probeMedia } from "./probe.js";
import {
  type ObjectVersion,
  type VerifiedObject,
  type ProbeResult,
} from "./policy.js";
import { processingIssue, type Issue } from "./issues.js";
import type { MediaProcessorOptions } from "./work.js";

type Source = {
  kind: "fixture_object";
  object: ObjectVersion;
  sha256: string;
  mime: string;
};
type Claim = {
  id: string;
  mediaId: string;
  tenantId: string;
  projectId: string;
  token: string;
  source: Source;
  output: GeneratedVisualOptions;
};
/** Same verified object storage and strict decode path as imports; never fetches provider-supplied URLs. */
export function generatedMediaProcessor(
  options: MediaProcessorOptions,
): StepHandler {
  const scope = sqlIdentifier(options.schema ?? "drama");
  async function finish(
    active: Claim,
    result: { object: VerifiedObject; probe: ProbeResult } | null,
    issue: Issue | null,
  ) {
    const sql = await options.pool.connect();
    try {
      await sql.query("BEGIN");
      const response = (
        await sql.query(
          `SELECT ${scope}.finish_generated_media($1,$2,$3,$4) AS envelope`,
          [active.id, active.token, result, issue],
        )
      ).rows[0]?.envelope;
      if (response)
        for (const step of Array.isArray(response) ? response : [response])
          await options.schedule(sql, parseEnvelope(step));
      await sql.query("COMMIT");
    } catch (error) {
      await sql.query("ROLLBACK");
      throw error;
    } finally {
      sql.release();
    }
  }
  return async (envelope, { signal }) => {
    signal.throwIfAborted();
    const step = parseEnvelope(envelope);
    if (step.taskKind !== "media_generation")
      throw new Error("Generated media step required");
    const active = (
      await options.pool.query(
        `SELECT ${scope}.claim_generated_media($1,$2,$3,$4) AS claim`,
        [step.businessId, step.stepRevision, step.epoch, randomUUID()],
      )
    ).rows[0]?.claim as Claim | null;
    if (!active) return;
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(tmpdir(), "scenedesk-generated-visual-"));
      const file = join(directory, "input");
      await options.store.download(
        active.source.object,
        file,
        active.source.sha256,
        signal,
      );
      const probe = await probeMedia(file, active.source.mime, signal);
      validateGeneratedVisual(probe, active.source.mime, active.output);
      const original = await options.store.publish(
        file,
        {
          bytes: active.source.object.bytes,
          sha256: active.source.sha256,
          mime: probe.mime,
        },
        "originals",
        signal,
      );
      signal.throwIfAborted();
      await finish(active, { object: original, probe }, null);
    } catch (error) {
      const issue = processingIssue(error);
      if (issue.code === "MEDIA_SOURCE_MISSING")
        issue.message = "已固定的原输出文件不可取，无法通过再次生成来恢复。";
      await finish(active, null, issue);
      if (issue.retryable) throw error;
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  };
}
