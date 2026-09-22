import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { imageGenerationFixture } from "../../tests/support/image-generation.js";
import {
  readGenerationAudit,
  requireGenerationAudit,
} from "../runtime/deployment-audit.js";

test("deployment audit preserves existing generation facts and distinguishes execution from fixed-file archive", async (t) => {
  const f = await imageGenerationFixture(t);
  const audit = async () => {
    const sql = await f.admin.connect();
    try {
      await sql.query("BEGIN READ ONLY");
      const report = await readGenerationAudit(sql, f.schema);
      await sql.query("COMMIT");
      return report;
    } finally {
      sql.release();
    }
  };
  let jobId = "";
  await t.test(
    "enabled descriptors remain enabled without granting execution",
    async () => {
      const report = await audit();
      assert.equal(report.enabled_capabilities, 1);
      assert.equal(report.executor_required_jobs, 0);
      assert.doesNotThrow(() => requireGenerationAudit(report));
      assert.equal(f.calls(), 0);
    },
  );
  await t.test(
    "queued job rejects strict deployment without consuming or failing it",
    async () => {
      jobId = (await f.execute((await f.plan()).id)).id;
      const before = await f.job(jobId);
      const report = await audit();
      assert.equal(report.executor_required_jobs, 1);
      assert.throws(
        () => requireGenerationAudit(report),
        /GENERATION_EXECUTOR_UNAVAILABLE/,
      );
      assert.doesNotThrow(() =>
        requireGenerationAudit(
          { ...report, executor_required_jobs: 1 },
          { executorConfigured: true },
        ),
      );
      assert.throws(
        () => requireGenerationAudit({ ...report, executor_required_jobs: 1 }),
        /GENERATION_EXECUTOR_UNAVAILABLE/,
      );
      assert.deepEqual(await f.job(jobId), before);
      assert.equal(f.calls(), 0);
    },
  );
  await t.test(
    "fixed source permits archiving but missing source is an explicit audit failure",
    async () => {
      await f.worker.process(jobId);
      const before = await f.job(jobId);
      assert.equal(before.status, "archiving");
      const report = await audit();
      assert.equal(report.fixed_archive_jobs, 1);
      assert.doesNotThrow(() => requireGenerationAudit(report));
      assert.deepEqual(await f.job(jobId), before);
      // Simulate damaged imported state inside a rolled-back administrator transaction.
      // This is not a product write path and never removes fixture evidence permanently.
      const sql = await f.admin.connect();
      try {
        await sql.query("BEGIN");
        await sql.query(
          `DELETE FROM ${f.scope}.generation_media_outputs WHERE job_id=$1`,
          [jobId],
        );
        const damaged = await readGenerationAudit(sql, f.schema);
        assert.equal(damaged.missing_archive_sources, 1);
        assert.throws(
          () => requireGenerationAudit(damaged),
          /GENERATION_ARCHIVE_SOURCE_MISSING/,
        );
      } finally {
        await sql.query("ROLLBACK");
        sql.release();
      }
      assert.deepEqual(await f.job(jobId), before);
      assert.doesNotThrow(() => requireGenerationAudit(report));
    },
  );
  await t.test(
    "failed original archive retains its fixed source and is not a new generation authorization",
    async () => {
      const step = await f.envelope(jobId),
        token = randomUUID();
      await f.mediaDb.query(
        `SELECT ${f.scope}.claim_generated_media($1,$2,$3,$4)`,
        [jobId, step.stepRevision, step.epoch, token],
      );
      await f.mediaDb.query(
        `SELECT ${f.scope}.finish_generated_media($1,$2,NULL,$3)`,
        [
          jobId,
          token,
          {
            code: "IMAGE_OUTPUT_MISMATCH",
            message: "Relational fixture archive rejection",
            retryable: false,
          },
        ],
      );
      const before = await f.job(jobId);
      assert.equal(before.status, "archive_failed");
      const report = await audit();
      assert.equal(report.fixed_archive_jobs, 1);
      assert.doesNotThrow(() => requireGenerationAudit(report));
      assert.deepEqual(await f.job(jobId), before);
      assert.equal(f.calls(), 1);
    },
  );
  await t.test(
    "unknown submission remains unresolved and enabled capability is untouched",
    async () => {
      f.setUnknown(true);
      const unknown = await f.execute(
        (await f.plan({ prompt: "Unknown receipt fixture" })).id,
      );
      await f.worker.process(unknown.id);
      const before = await f.job(unknown.id);
      assert.equal(before.status, "submission_unknown");
      const report = await audit();
      assert.equal(report.enabled_capabilities, 1);
      assert.equal(report.executor_required_jobs, 1);
      assert.throws(
        () => requireGenerationAudit(report),
        /GENERATION_EXECUTOR_UNAVAILABLE/,
      );
      assert.deepEqual(await f.job(unknown.id), before);
      assert.equal(f.calls(), 2);
    },
  );
});
