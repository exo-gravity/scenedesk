import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { fork } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { ProductionJobs } from "@drama/media";
import { productionJobsFixture } from "../support/production-jobs.js";
import { storageFixture } from "../support/storage.js";

test(
  "a killed storage worker is recovered from SQL receipts and the exact stored version",
  { timeout: 240_000 },
  async (t) => {
    const f = await productionJobsFixture(t),
      storage = await storageFixture(t);
    const directory = await mkdtemp(
      join(tmpdir(), "scenedesk-production-crash-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, "artifact"),
      bytes = 64 * 1024 * 1024 + 16,
      fd = await open(file, "wx", 0o600);
    try {
      await fd.truncate(bytes);
    } finally {
      await fd.close();
    }
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const sha256 = hash.digest("hex"),
      source = await f.seed(),
      copy = await f.request(source),
      host = randomUUID();
    const envelope = {
      taskKind: "media_production" as const,
      businessId: copy.id,
      stepRevision: copy.step_revision,
      epoch: copy.epoch,
    };
    const first = (await f.jobs.claim(envelope, host))!;
    const artifact = await f.jobs.reserve(copy.id, first.attemptId, {
      kind: "video",
      bytes,
      sha256,
    });
    const child = fork(
      fileURLToPath(
        new URL("../support/production-crash-worker.ts", import.meta.url),
      ),
      [],
      {
        execArgv: ["--import", "tsx"],
        env: {
          PATH: process.env.PATH,
          MEDIA_WORKER_DATABASE_URL: f.worker.options.connectionString,
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    const exited = once(child, "exit");
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await exited;
    });
    const checkpoint = Promise.race([
      once(child, "message", { signal: t.signal }).then(([message]) => message),
      exited.then(() => {
        throw new Error(
          "Crash fixture exited before its persisted storage checkpoint",
        );
      }),
    ]);
    child.send({
      schema: f.schema,
      copyId: copy.id,
      attemptId: first.attemptId,
      artifactId: artifact.artifact.id,
      file,
      storage: storage.productionConfiguration,
    });
    assert.deepEqual(await checkpoint, { checkpoint: "stored-before-journal" });
    child.kill("SIGKILL");
    const [, signal] = await exited;
    assert.equal(signal, "SIGKILL");
    const before = await artifact.journal.load();
    assert.ok(before.uploadId);
    assert.equal(before.versionId, undefined);
    const receipt = (
      await f.admin.query(
        `SELECT phase FROM ${f.schema}.media_production_artifacts WHERE id=$1`,
        [artifact.artifact.id],
      )
    ).rows[0];
    assert.equal(receipt.phase, "completing");
    await rm(file);
    // Advance only the test lease clock; the new worker has a new attempt and repository instance.
    await f.admin.query(
      `UPDATE ${f.schema}.media_production_attempts SET lease_expires_at=now()-interval '1 second' WHERE id=$1`,
      [first.attemptId],
    );
    const restarted = new ProductionJobs(f.worker, f.schema),
      next = (await restarted.claim(envelope, host))!;
    const journal = restarted.journal(
      copy.id,
      next.attemptId,
      artifact.artifact.id,
    );
    const result = await storage.production.publish(
      undefined,
      journal,
      t.signal,
    );
    assert.equal(result.sha256, sha256);
    assert.equal(result.bytes, bytes);
    assert.equal((await journal.load()).versionId, result.versionId);
    await assert.rejects(artifact.journal.verified(result), { code: "P0430" });
    const versions = await storage.workerClient.send(
      new ListObjectVersionsCommand({
        Bucket: storage.productionBucket,
        Prefix: result.key,
      }),
      { abortSignal: t.signal },
    );
    assert.equal(versions.Versions?.length, 1);
    assert.equal(versions.Versions![0]!.VersionId, result.versionId);
    // Receipt durability alone does not make a complete video + source map production.
    await assert.rejects(restarted.finish(copy.id, next.attemptId), {
      code: "23514",
    });
  },
);
