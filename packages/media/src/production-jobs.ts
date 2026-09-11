import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { sqlIdentifier, verifyRuntimeRole } from "@drama/database";
import { parseEnvelope, type StepEnvelope } from "@drama/queue";
import { AUDIO_PRODUCTION_PROFILE } from "./audio-production.js";
import {
  VIDEO_PRODUCTION_PROFILE,
  VIDEO_PRODUCTION_RATES,
} from "./video-production.js";
import { PRODUCTION_NORMALIZATION_VERSION } from "./source-timing.js";
import type {
  ProductionArtifact,
  ProductionPart,
  ProductionUploadJournal,
  ProductionUploadState,
} from "./production-storage.js";
import type { VerifiedObject } from "./policy.js";

export type ProductionProfile = {
  kind: "video" | "audio";
  normalizationVersion: typeof PRODUCTION_NORMALIZATION_VERSION;
  audioProfile: typeof AUDIO_PRODUCTION_PROFILE;
  zero: "first-video-pts" | "first-audio-sample";
  rendererVersion: string;
  imageId: string;
  platform: string;
  videoProfile?: typeof VIDEO_PRODUCTION_PROFILE;
  rate?: (typeof VIDEO_PRODUCTION_RATES)[number];
};
export function makeProductionProfile(
  kind: "video" | "audio",
  rendererVersion: string,
  runtime: { imageId: string; platform: string },
  rate?: (typeof VIDEO_PRODUCTION_RATES)[number],
): ProductionProfile {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(rendererVersion) ||
    !/^sha256:[a-f0-9]{64}$/.test(runtime.imageId) ||
    !["linux/amd64", "linux/arm64"].includes(runtime.platform) ||
    (kind === "video"
      ? !rate || !VIDEO_PRODUCTION_RATES.includes(rate)
      : rate !== undefined)
  )
    throw new Error(
      "Production profile requires a supported rate and fixed build identity",
    );
  return {
    kind,
    rendererVersion,
    ...runtime,
    normalizationVersion: PRODUCTION_NORMALIZATION_VERSION,
    audioProfile: AUDIO_PRODUCTION_PROFILE,
    zero: kind === "video" ? "first-video-pts" : "first-audio-sample",
    ...(kind === "video"
      ? { videoProfile: VIDEO_PRODUCTION_PROFILE, rate: rate! }
      : {}),
  };
}
export type ProductionCopy = {
  id: string;
  tenant_id: string;
  project_id: string;
  source_media_id: string;
  source_sha256: string;
  kind: "video" | "audio";
  has_audio: boolean;
  profile: ProductionProfile;
  profile_hash: string;
  status: "processing" | "ready" | "failed";
  step_revision: number;
  epoch: number;
  current_attempt_id: string | null;
  issue: string | null;
};
type ArtifactRow = ProductionArtifact & {
  copy_id: string;
  step_revision: number;
  upload_id: string | null;
  storage_version_id: string | null;
  phase: "reserved" | "uploading" | "completing" | "verified";
  retired: boolean;
};
export type ProductionResource = {
  id: string;
  attempt_id: string;
  kind: "container" | "directory";
  released: boolean;
};
export type ProductionCleanup = {
  id: string;
  claimId: string;
  artifact?: ArtifactRow;
  resource?: ProductionResource;
};
export type ProductionContext = {
  copy: ProductionCopy;
  source: VerifiedObject & { id: string; mime: string };
  artifacts: ArtifactRow[];
};
type Schedule = (sql: PoolClient, step: StepEnvelope) => Promise<unknown>;

/** The savepoint both requires a caller transaction and prevents a caught enqueue failure from retaining a root. */
export async function requestMediaProduction(
  sql: PoolClient,
  input: {
    schema: string;
    projectId: string;
    sourceMediaId: string;
    profile: ProductionProfile;
    schedule: Schedule;
    recoverCopyId?: string;
  },
): Promise<ProductionCopy> {
  const scope = sqlIdentifier(input.schema);
  await sql.query("SAVEPOINT production_request");
  try {
    const result = await sql.query<{ value: ProductionCopy }>(
      `SELECT to_jsonb(${scope}.${input.recoverCopyId ? "recover_media_production" : "request_media_production"}($1,$2,$3)) AS value`,
      [
        input.recoverCopyId ?? input.projectId,
        input.sourceMediaId,
        JSON.stringify(input.profile),
      ],
    );
    const copy = result.rows[0]!.value;
    if (copy.project_id !== input.projectId)
      throw new Error("Production request project differs");
    if (copy.status === "processing")
      await input.schedule(sql, {
        taskKind: "media_production",
        businessId: copy.id,
        stepRevision: copy.step_revision,
        epoch: copy.epoch,
      });
    await sql.query("RELEASE SAVEPOINT production_request");
    return copy;
  } catch (error) {
    await sql.query("ROLLBACK TO SAVEPOINT production_request");
    await sql.query("RELEASE SAVEPOINT production_request");
    throw error;
  }
}

const state = (row: ArtifactRow): ProductionUploadState => ({
  artifact: {
    id: row.id,
    kind: row.kind,
    bytes: row.bytes,
    sha256: row.sha256,
  },
  retired: row.retired,
  ...(row.upload_id ? { uploadId: row.upload_id } : {}),
  ...(row.storage_version_id ? { versionId: row.storage_version_id } : {}),
});

/** Every method owns a bounded transaction; no storage or decoder IO executes while holding SQL locks. */
export class ProductionJobs {
  private readonly scope: string;
  constructor(
    private readonly pool: Pool,
    schema = "drama",
  ) {
    this.scope = sqlIdentifier(schema);
  }
  async verify() {
    const client = await this.pool.connect();
    try {
      await verifyRuntimeRole(client, this.scope.slice(1, -1));
      if (
        !(
          await client.query(
            `SELECT ${this.scope}.media_worker_login() AS allowed`,
          )
        ).rows[0]?.allowed
      )
        throw new Error("Registered production worker required");
    } finally {
      client.release();
    }
  }
  private async call<T>(
    name: string,
    values: unknown[],
    json = true,
    many = false,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='10s'");
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='10s'");
      const expression = `${this.scope}.${name}(${values.map((_, i) => `$${i + 1}`).join(",")})`;
      const query = many
        ? `SELECT coalesce(jsonb_agg(value),'[]') AS value FROM ${expression} AS items(value)`
        : `SELECT ${json ? `to_jsonb(${expression})` : expression} AS value`;
      const result = await client.query(query, values);
      await client.query("COMMIT");
      return result.rows[0]?.value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async claim(
    envelope: StepEnvelope,
    hostId: string,
    attemptId: string = randomUUID(),
  ) {
    const step = parseEnvelope(envelope);
    if (step.taskKind !== "media_production")
      throw new Error("Expected production task");
    const copy = await this.call<ProductionCopy | null>(
      "claim_media_production",
      [step.businessId, step.stepRevision, step.epoch, hostId, attemptId],
    );
    return copy?.id ? { copy, attemptId } : undefined;
  }
  assertActive(copyId: string, attemptId: string) {
    return this.call<ProductionCopy>("assert_media_production_lease", [
      copyId,
      attemptId,
    ]);
  }
  heartbeat(copyId: string, attemptId: string) {
    return this.call<void>(
      "heartbeat_media_production",
      [copyId, attemptId],
      false,
    );
  }
  read(copyId: string, attemptId?: string) {
    return this.call<ProductionContext>("read_media_production", [
      copyId,
      attemptId ?? null,
    ]);
  }
  finish(copyId: string, attemptId: string, failureCode?: string) {
    return this.call<void>(
      "finish_media_production",
      [copyId, attemptId, failureCode ?? null],
      false,
    );
  }
  yield(copyId: string, attemptId: string, failureCode: string) {
    return this.call<void>(
      "yield_media_production",
      [copyId, attemptId, failureCode],
      false,
    );
  }
  async reserve(
    copyId: string,
    attemptId: string,
    artifact: Omit<ProductionArtifact, "id">,
  ) {
    const row = await this.call<ArtifactRow>(
      "reserve_media_production_artifact",
      [copyId, attemptId, artifact.kind, artifact.bytes, artifact.sha256],
    );
    return {
      artifact: state(row).artifact,
      journal: this.journal(copyId, attemptId, row.id),
    };
  }
  journal(
    copyId: string,
    attemptId: string,
    artifactId: string,
  ): ProductionUploadJournal {
    const record = (event: string, receipt: object = {}) =>
      this.call<ArtifactRow>("journal_media_production", [
        copyId,
        attemptId,
        artifactId,
        event,
        JSON.stringify(receipt),
      ]);
    return {
      load: async () => state(await record("load")),
      assertActive: async () => {
        await this.assertActive(copyId, attemptId);
      },
      started: async (uploadId: string) => {
        await record("started", { uploadId });
      },
      part: async (part: ProductionPart) => {
        await record("part", part);
      },
      completing: async () => {
        await record("completing");
      },
      verified: async (object: VerifiedObject) => {
        await record("verified", object);
      },
    };
  }
  reserveResource(
    copyId: string,
    attemptId: string,
    kind: ProductionResource["kind"],
  ) {
    return this.call<ProductionResource>("reserve_media_production_resource", [
      copyId,
      attemptId,
      kind,
    ]);
  }
  releaseResource(attemptId: string, resourceId: string) {
    return this.call<void>(
      "release_media_production_resource",
      [attemptId, resourceId],
      false,
    );
  }
  async claimCleanup(hostId: string, batchSize = 20) {
    // The set-returning function is consumed in one SQL transaction by call().
    return this.call<ProductionCleanup[]>(
      "claim_media_production_cleanup",
      [hostId, randomUUID(), batchSize],
      true,
      true,
    );
  }
  assertCleanup(item: ProductionCleanup) {
    return this.call<void>(
      "assert_media_production_cleanup",
      [item.id, item.claimId],
      false,
    );
  }
  finishCleanup(item: ProductionCleanup) {
    return this.call<void>(
      "finish_media_production_cleanup",
      [item.id, item.claimId],
      false,
    );
  }
  cleanupJournal(item: ProductionCleanup): ProductionUploadJournal {
    if (!item.artifact) throw new Error("Cleanup item is not an artifact");
    const snapshot = state(item.artifact);
    const refuse = async () => {
      throw new Error("Cleanup cannot publish artifacts");
    };
    return {
      load: async () => {
        await this.assertCleanup(item);
        return snapshot;
      },
      assertActive: () => this.assertCleanup(item),
      started: refuse,
      part: refuse,
      completing: refuse,
      verified: refuse,
    };
  }
}
