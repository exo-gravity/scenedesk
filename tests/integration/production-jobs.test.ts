import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  ProductionJobs,
  requestMediaProduction,
  type ProductionCopy,
} from "@drama/media";
import type { StepEnvelope } from "@drama/queue";
import { productionJobsFixture } from "../support/production-jobs.js";

test(
  "production job ownership, fixed receipts and cleanup remain authoritative across leases",
  { timeout: 60_000 },
  async (t) => {
    const f = await productionJobsFixture(t),
      source = await f.seed(),
      host = randomUUID();
    const step = (copy: ProductionCopy): StepEnvelope => ({
      taskKind: "media_production",
      businessId: copy.id,
      stepRevision: copy.step_revision,
      epoch: copy.epoch,
    });
    let copy: ProductionCopy;
    await t.test(
      "failed enqueue rolls back a new root even if caller catches the error",
      async () => {
        await f.transaction(async (sql) => {
          await assert.rejects(
            requestMediaProduction(sql, {
              schema: f.schema,
              projectId: f.project.id,
              sourceMediaId: source,
              profile: f.profile,
              schedule: async () => {
                throw new Error("fixture queue failure");
              },
            }),
            /fixture queue failure/,
          );
          assert.equal(
            (
              await sql.query(
                `SELECT * FROM ${f.schema}.media_production_copies`,
              )
            ).rowCount,
            0,
          );
        });
        assert.equal(
          (await f.admin.query(`SELECT * FROM ${f.queueSchema}.job_common`))
            .rowCount,
          0,
        );
      },
    );
    await t.test(
      "concurrent same-content requests deduplicate, retain typed sources and enqueue once",
      async () => {
        const duplicate = await f.seed();
        const [a, b] = await Promise.all([
          f.request(source),
          f.request(duplicate),
        ]);
        copy = a;
        assert.equal(a.id, b.id);
        assert.equal(
          (
            await f.admin.query(
              `SELECT * FROM ${f.schema}.media_production_sources WHERE copy_id=$1`,
              [a.id],
            )
          ).rowCount,
          2,
        );
        assert.equal(
          (
            await f.admin.query(
              `SELECT * FROM ${f.queueSchema}.job_common WHERE data->>'businessId'=$1`,
              [a.id],
            )
          ).rowCount,
          1,
        );
        const reordered = JSON.parse(
          JSON.stringify(f.profile, Object.keys(f.profile).reverse()),
        );
        assert.equal((await f.request(source, reordered)).id, a.id);
        assert.notEqual(
          (await f.request(source, { ...f.profile, rate: "25/1" })).id,
          a.id,
        );
        const other = await f.createProject("另一个项目"),
          foreign = await f.seed(other.id);
        await assert.rejects(f.request(foreign), { code: "42501" });
      },
    );
    let first: string, second: string, artifactId: string;
    await t.test(
      "one live lease wins; takeover preserves upload receipts and fences the old owner",
      async () => {
        const results = await Promise.all([
          f.jobs.claim(step(copy), host),
          f.jobs.claim(step(copy), host),
        ]);
        assert.equal(results.filter(Boolean).length, 1);
        first = results.find(Boolean)!.attemptId;
        assert.equal(
          (await f.jobs.claim(step(copy), host, first))?.attemptId,
          first,
        );
        const item = await f.jobs.reserve(copy.id, first, {
          kind: "video",
          bytes: 64 * 1024 * 1024 + 16,
          sha256: "c".repeat(64),
        });
        artifactId = item.artifact.id;
        await item.journal.started("fixture-multipart");
        await item.journal.part({
          number: 1,
          bytes: 64 * 1024 * 1024,
          sha256: "d".repeat(64),
          etag: "fixture-etag",
        });
        await f.admin.query(
          `UPDATE ${f.schema}.media_production_attempts SET lease_expires_at=now()-interval '1 second' WHERE id=$1`,
          [first],
        );
        await assert.rejects(f.jobs.heartbeat(copy.id, first), {
          code: "P0430",
        });
        second = (await f.jobs.claim(step(copy), host))!.attemptId;
        await assert.rejects(item.journal.completing(), { code: "P0430" });
        const restarted = new ProductionJobs(f.worker, f.schema).journal(
          copy.id,
          second,
          artifactId,
        );
        assert.equal((await restarted.load()).uploadId, "fixture-multipart");
        await assert.rejects(restarted.completing(), { code: "23514" });
        await restarted.part({
          number: 2,
          bytes: 16,
          sha256: "e".repeat(64),
          etag: "fixture-tail",
        });
        await restarted.completing();
        await restarted.verified({
          key: `productions/${artifactId}`,
          versionId: "fixture-fixed-version",
          bytes: 64 * 1024 * 1024 + 16,
          sha256: "c".repeat(64),
        });
        await assert.rejects(
          restarted.verified({
            key: `productions/${artifactId}`,
            versionId: "changed-version",
            bytes: 64 * 1024 * 1024 + 16,
            sha256: "c".repeat(64),
          }),
          { code: "23514" },
        );
        await assert.rejects(f.jobs.finish(copy.id, second), { code: "23514" });
      },
    );
    await t.test(
      "cleanup leases exclude active resources and foreign hosts and retain resweep tombstones",
      async () => {
        const active = await f.jobs.reserveResource(
          copy.id,
          second,
          "container",
        );
        assert.equal(
          (await f.jobs.claimCleanup(host)).some(
            (j) => j.resource?.id === active.id,
          ),
          false,
        );
        await f.jobs.releaseResource(second, active.id);
        assert.equal(
          (await f.jobs.claimCleanup(randomUUID())).some(
            (j) => j.resource?.id === active.id,
          ),
          false,
        );
        const cleanup = (await f.jobs.claimCleanup(host)).find(
          (j) => j.resource?.id === active.id,
        )!;
        assert.ok(cleanup);
        await assert.rejects(
          f.jobs.assertCleanup({ ...cleanup, claimId: randomUUID() }),
          { code: "P0430" },
        );
        await f.jobs.finishCleanup(cleanup);
        assert.equal(
          (await f.jobs.claimCleanup(host)).some(
            (j) => j.resource?.id === active.id,
          ),
          false,
        );
        await f.admin.query(
          `UPDATE ${f.schema}.media_production_cleanup SET last_swept_at=now()-interval '2 minutes' WHERE id=$1`,
          [cleanup.id],
        );
        const again = (await f.jobs.claimCleanup(host)).find(
          (j) => j.resource?.id === active.id,
        )!;
        assert.ok(again);
        assert.notEqual(again.claimId, cleanup.claimId);
        await f.jobs.finishCleanup(again);
      },
    );
    await t.test(
      "ready requires the complete immutable artifact set, and cached requests still authorize",
      async () => {
        const map = await f.jobs.reserve(copy.id, second, {
          kind: "video_map",
          bytes: 21,
          sha256: "f".repeat(64),
        });
        await map.journal.completing();
        await map.journal.verified({
          key: `productions/${map.artifact.id}`,
          versionId: "fixture-map-version",
          bytes: 21,
          sha256: "f".repeat(64),
        });
        await f.jobs.finish(copy.id, second);
        const ready = await f.jobs.read(copy.id);
        assert.equal(ready.copy.status, "ready");
        assert.equal(ready.artifacts.length, 2);
        assert.equal((await f.request(source)).id, copy.id);
        await assert.rejects(f.jobs.finish(copy.id, first), { code: "P0430" });
        await assert.rejects(
          f.admin.query(
            `UPDATE ${f.schema}.media_production_copies SET source_sha256=$2 WHERE id=$1`,
            [copy.id, "f".repeat(64)],
          ),
          { code: "23514" },
        );
        const stranger = await f.identity("production-stranger");
        const client = await f.runtime.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",
            [stranger.userId, f.tenant.id],
          );
          await assert.rejects(
            client.query(
              `SELECT ${f.schema}.request_media_production($1,$2,$3)`,
              [f.project.id, source, JSON.stringify(f.profile)],
            ),
            { code: "42501" },
          );
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
      },
    );
    await t.test(
      "roles cannot forge leases, inspect raw artifacts or skip the scheduler boundary",
      async () => {
        await assert.rejects(
          f.runtime.query(
            `SELECT ${f.schema}.claim_media_production($1,1,1,$2,$3)`,
            [copy.id, host, randomUUID()],
          ),
          { code: "42501" },
        );
        await assert.rejects(
          f.worker.query(
            `SELECT * FROM ${f.schema}.media_production_artifacts`,
          ),
          { code: "42501" },
        );
        await assert.rejects(
          f.worker.query(`SELECT * FROM ${f.schema}.scan_media_production(10)`),
          { code: "42501" },
        );
        const work = (
          await f.scheduler.query(
            `SELECT * FROM ${f.schema}.scan_media_production(10)`,
          )
        ).rows;
        assert.ok(work.some((row) => row.task_kind === "media_production"));
        assert.ok(!work.some((row) => row.business_id === copy.id));
      },
    );
    await t.test(
      "yield preserves receipts; explicit recovery starts a new step and fences prior artifacts",
      async () => {
        const pending = await f.request(source, { ...f.profile, rate: "30/1" });
        const active = (await f.jobs.claim(step(pending), host))!;
        const reserved = await f.jobs.reserve(pending.id, active.attemptId, {
          kind: "video",
          bytes: 16,
          sha256: "b".repeat(64),
        });
        await f.jobs.yield(
          pending.id,
          active.attemptId,
          "MEDIA_SERVICE_UNAVAILABLE",
        );
        const resumed = (await f.jobs.claim(step(pending), host))!;
        assert.equal(
          (
            await f.jobs
              .journal(pending.id, resumed.attemptId, reserved.artifact.id)
              .load()
          ).artifact.id,
          reserved.artifact.id,
        );
        await f.jobs.finish(
          pending.id,
          resumed.attemptId,
          "MEDIA_SOURCE_INVALID",
        );
        const recover = () =>
          f.transaction((sql) =>
            requestMediaProduction(sql, {
              schema: f.schema,
              projectId: f.project.id,
              sourceMediaId: source,
              profile: { ...f.profile, rate: "30/1" },
              recoverCopyId: pending.id,
              schedule: f.schedule,
            }),
          );
        const [a, b] = await Promise.all([recover(), recover()]);
        assert.equal(a.step_revision, 2);
        assert.equal(b.step_revision, 2);
        const next = (await f.jobs.claim(step(a), host))!;
        await assert.rejects(
          f.jobs.journal(a.id, next.attemptId, reserved.artifact.id).load(),
          { code: "42501" },
        );
        assert.equal(
          (
            await f.admin.query(
              `SELECT retired FROM ${f.schema}.media_production_artifacts WHERE id=$1`,
              [reserved.artifact.id],
            )
          ).rows[0].retired,
          true,
        );
        assert.equal(
          (
            await f.admin.query(
              `SELECT * FROM ${f.queueSchema}.job_common WHERE data->>'businessId'=$1 AND data->>'stepRevision'='2'`,
              [pending.id],
            )
          ).rowCount,
          1,
        );
      },
    );
  },
);
