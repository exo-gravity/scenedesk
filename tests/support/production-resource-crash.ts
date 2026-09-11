import { Pool } from "pg";
import { Readable } from "node:stream";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { ProductionJobs } from "@drama/media";
import type { StepEnvelope } from "@drama/queue";
import { openProductionWorkspace } from "../../packages/media/src/production-workspace.js";
import {
  withMediaExecution,
  mediaWriteBudget,
} from "../../packages/media/src/execution.js";
import { runMediaProcess } from "../../packages/media/src/sandbox.js";

process.once("message", async (input: unknown) => {
  const value = input as {
    schema: string;
    workDirectory: string;
    step: StepEnvelope;
  };
  const pool = new Pool({
    connectionString: process.env.MEDIA_WORKER_DATABASE_URL,
    max: 3,
  });
  const jobs = new ProductionJobs(pool, value.schema);
  let workspace:
    Awaited<ReturnType<typeof openProductionWorkspace>> | undefined;
  let directory:
    | Awaited<
        ReturnType<
          Awaited<ReturnType<typeof openProductionWorkspace>>["allocate"]
        >
      >
    | undefined;
  let monitor: NodeJS.Timeout | undefined, beat: NodeJS.Timeout | undefined;
  try {
    await jobs.verify();
    workspace = await openProductionWorkspace(
      pool,
      jobs,
      value.workDirectory,
      8 * 1024 ** 2,
    );
    const claim = (await jobs.claim(value.step, workspace.hostId))!;
    directory = await workspace.allocate(claim.copy.id, claim.attemptId);
    const output = join(directory.path, "partial.pcm");
    beat = setInterval(() => {
      void jobs
        .heartbeat(claim.copy.id, claim.attemptId)
        .catch(() => process.exit(2));
    }, 15_000);
    await withMediaExecution(
      {
        signal: workspace.signal,
        accountWrite: mediaWriteBudget(workspace.writeLimit),
        reserveContainer: async () => {
          const resource = await jobs.reserveResource(
            claim.copy.id,
            claim.attemptId,
            "container",
          );
          return {
            id: resource.id,
            hostId: workspace!.hostId,
            release: () => jobs.releaseResource(claim.attemptId, resource.id),
          };
        },
      },
      () =>
        runMediaProcess(
          undefined,
          "/ffmpeg",
          [
            "-v",
            "error",
            "-nostdin",
            "-f",
            "u8",
            "-ar",
            "8000",
            "-ac",
            "1",
            "-i",
            "pipe:0",
            "-c:a",
            "pcm_u8",
            "-f",
            "u8",
            "pipe:1",
          ],
          {
            inputStream: new Readable({
              read() {
                this.push(Buffer.alloc(256 * 1024));
                this._read = () => {};
              },
            }),
            maxInputBytes: 1024 ** 2,
            outputFile: output,
            onCreated: () => {
              monitor = setInterval(() => {
                void stat(output)
                  .then((file) => {
                    if (file.size > 0) {
                      clearInterval(monitor);
                      process.send?.({
                        checkpoint: "decoding",
                        attemptId: claim.attemptId,
                        hostId: workspace!.hostId,
                        directoryId: directory!.resource.id,
                      });
                    }
                  })
                  .catch(() => {});
              }, 50);
            },
          },
        ),
    );
  } catch {
    process.send?.({ failed: true });
    process.exitCode = 1;
  } finally {
    clearInterval(monitor);
    clearInterval(beat);
    await directory?.close();
    await workspace?.close();
    await pool.end();
    process.disconnect?.();
  }
});
