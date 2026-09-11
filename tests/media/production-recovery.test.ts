import assert from "node:assert/strict";
import test from "node:test";
import { fork, execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProductionProcessor } from "@drama/media";
import { removeProductionContainer } from "../../packages/media/src/sandbox.js";
import { storageFixture } from "../support/storage.js";
import { productionJobsFixture } from "../support/production-jobs.js";

test(
  "a killed decoder leaves durable owned resources that a new host coordinator reaps",
  { timeout: 240_000 },
  async (t) => {
    const storage = await storageFixture(t),
      f = await productionJobsFixture(t);
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "scenedesk-production-crash-root-")),
    );
    t.after(() => rm(root, { recursive: true, force: true }));
    const source = await f.seed(),
      copy = await f.request(source);
    const child = fork(
      fileURLToPath(
        new URL("../support/production-resource-crash.ts", import.meta.url),
      ),
      [],
      {
        execArgv: ["--import", "tsx"],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          MEDIA_WORKER_DATABASE_URL: f.worker.options.connectionString,
          ...(process.env.DOCKER_HOST
            ? { DOCKER_HOST: process.env.DOCKER_HOST }
            : {}),
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    const exited = once(child, "exit");
    let reaper:
      Awaited<ReturnType<typeof createProductionProcessor>> | undefined;
    try {
      const checkpoint = Promise.race([
        once(child, "message", { signal: t.signal }).then(
          ([message]) => message,
        ),
        exited.then(() => {
          throw new Error("Decoder exited before checkpoint");
        }),
      ]);
      child.send({
        schema: f.schema,
        workDirectory: root,
        step: {
          taskKind: "media_production",
          businessId: copy.id,
          stepRevision: copy.step_revision,
          epoch: copy.epoch,
        },
      });
      const mark = await checkpoint;
      assert.equal(mark.checkpoint, "decoding");
      assert.ok(
        (await stat(join(root, "jobs", mark.directoryId, "partial.pcm"))).size >
          0,
      );
      child.kill("SIGKILL");
      assert.equal((await exited)[1], "SIGKILL");
      reaper = await createProductionProcessor({
        pool: f.worker,
        schema: f.schema,
        originals: storage.processing,
        artifacts: storage.production,
        workDirectory: root,
        writeLimitBytes: 8 * 1024 ** 2,
      });
      assert.equal(reaper.hostId, mark.hostId);
      assert.equal(
        (await reaper.cleanup()).cleaned,
        0,
        "An unexpired attempt must retain its resources",
      );
      await f.admin.query(
        `UPDATE ${f.schema}.media_production_attempts SET lease_expires_at=now()-interval '1 second' WHERE id=$1`,
        [mark.attemptId],
      );
      const resources = (
        await f.admin.query(
          `SELECT id,kind FROM ${f.schema}.media_production_resources WHERE attempt_id=$1`,
          [mark.attemptId],
        )
      ).rows;
      assert.equal(resources.length, 2);
      assert.deepEqual(await reaper.cleanup(), { cleaned: 2, failed: 0 });
      await assert.rejects(stat(join(root, "jobs", mark.directoryId)), {
        code: "ENOENT",
      });
      const exec = promisify(execFile),
        container = resources.find((r) => r.kind === "container")!;
      assert.equal(
        (
          await exec(
            "docker",
            [
              "ps",
              "--all",
              "--filter",
              `name=^/scenedesk-production-${container.id}$`,
              "--format",
              "{{.ID}}",
            ],
            { timeout: 15_000 },
          )
        ).stdout.trim(),
        "",
      );
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int AS n FROM ${f.schema}.media_production_cleanup WHERE resource_id=ANY($1::uuid[])`,
            [resources.map((r) => r.id)],
          )
        ).rows[0].n,
        2,
        "Cleanup must preserve resweep tombstones",
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await exited;
      if (reaper) {
        await f.admin.query(
          `UPDATE ${f.schema}.media_production_attempts SET lease_expires_at=now()-interval '1 second' WHERE copy_id=$1`,
          [copy.id],
        );
        await reaper.cleanup();
        await reaper.close();
      } else {
        // A failed assertion/startup must still clean this killed fixture's exact resources.
        const owned = await f.admin.query(
          `SELECT r.id,r.kind,a.host_id FROM ${f.schema}.media_production_resources r JOIN ${f.schema}.media_production_attempts a ON a.id=r.attempt_id WHERE a.copy_id=$1`,
          [copy.id],
        );
        for (const resource of owned.rows) {
          if (resource.kind === "container")
            await removeProductionContainer(resource.id, resource.host_id);
          else
            await rm(join(root, "jobs", resource.id), {
              recursive: true,
              force: true,
            });
        }
      }
    }
  },
);
