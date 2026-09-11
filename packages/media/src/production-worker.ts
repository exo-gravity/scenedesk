import { join } from "node:path";
import type { Pool } from "pg";
import {
  parseEnvelope,
  PRODUCTION_JOB_SECONDS,
  type StepHandler,
} from "@drama/queue";
import { makeAudioProduction } from "./audio-production.js";
import { withMediaExecution, mediaWriteBudget } from "./execution.js";
import {
  makeProductionProfile,
  ProductionJobs,
  type ProductionProfile,
} from "./production-jobs.js";
import type {
  ProductionArtifact,
  ProductionStore,
} from "./production-storage.js";
import { openProductionWorkspace } from "./production-workspace.js";
import { MediaFailure } from "./policy.js";
import {
  removeProductionContainer,
  verifyProductionRuntime,
} from "./sandbox.js";
import type { MediaStore } from "./storage.js";
import {
  makeVideoProduction,
  type VIDEO_PRODUCTION_RATES,
} from "./video-production.js";

/** Identifies this shipped internal production recipe; final delivery codecs/fonts are a separate profile. */
export const PRODUCTION_WORKER_VERSION = "production-worker-v1";
type Rate = (typeof VIDEO_PRODUCTION_RATES)[number];
function failure(error: unknown) {
  if (error instanceof MediaFailure)
    return {
      code: error.code,
      permanent: !new Set([
        "MEDIA_CANCELLED",
        "MEDIA_BUILD_MISMATCH",
        "MEDIA_SANDBOX_UNAVAILABLE",
        "MEDIA_SANDBOX_CLEANUP_FAILED",
        "MEDIA_DISK_UNAVAILABLE",
        "MEDIA_HOST_UNAVAILABLE",
        "STORAGE_VERSION_REQUIRED",
        "STORAGE_INTEGRITY_MISMATCH",
      ]).has(error.code),
    };
  if (
    error instanceof Error &&
    ["NoSuchKey", "NoSuchVersion"].includes(error.name)
  )
    return { code: "MEDIA_SOURCE_MISSING", permanent: true };
  return { code: "MEDIA_SERVICE_UNAVAILABLE", permanent: false };
}

export async function createProductionProcessor(options: {
  pool: Pool;
  schema?: string;
  originals: MediaStore;
  artifacts: ProductionStore;
  workDirectory: string;
  writeLimitBytes?: number;
}) {
  if (options.originals.bucket === options.artifacts.bucket)
    throw new Error("Production artifacts require a separate bucket");
  const jobs = new ProductionJobs(options.pool, options.schema);
  await jobs.verify();
  const workspace = await openProductionWorkspace(
    options.pool,
    jobs,
    options.workDirectory,
    options.writeLimitBytes,
  );
  let runtime: Awaited<ReturnType<typeof verifyProductionRuntime>>;
  try {
    await options.originals.verify();
    await options.artifacts.verify();
    runtime = await verifyProductionRuntime();
  } catch (error) {
    await workspace.close();
    throw error;
  }
  const profile = (kind: "video" | "audio", rate?: Rate): ProductionProfile =>
    makeProductionProfile(kind, PRODUCTION_WORKER_VERSION, runtime, rate);
  const active = new Set<Promise<void>>();
  let closing = false;
  const execute: StepHandler = async (envelope, { signal }) => {
    const step = parseEnvelope(envelope);
    if (step.taskKind !== "media_production")
      throw new Error("Expected production task");
    if (closing) throw new Error("Production worker is closing");
    const controller = new AbortController();
    const combined = AbortSignal.any([
      signal,
      workspace.signal,
      controller.signal,
      AbortSignal.timeout(PRODUCTION_JOB_SECONDS * 1000),
    ]);
    combined.throwIfAborted();
    const claimed = await jobs.claim(step, workspace.hostId);
    if (!claimed) return;
    const { copy, attemptId } = claimed;
    let timer: NodeJS.Timeout | undefined, beat: Promise<void> | undefined;
    let stopped = false;
    function heartbeat() {
      if (stopped) return;
      beat = jobs
        .heartbeat(copy.id, attemptId)
        .catch(() => controller.abort())
        .finally(() => {
          if (!stopped && !combined.aborted)
            timer = setTimeout(heartbeat, 15_000);
        });
    }
    timer = setTimeout(heartbeat, 15_000);
    let directory: Awaited<ReturnType<typeof workspace.allocate>> | undefined;
    try {
      const expected = profile(copy.kind, copy.profile.rate);
      if (
        Object.keys(expected).length !== Object.keys(copy.profile).length ||
        Object.entries(expected).some(
          ([key, value]) =>
            copy.profile[key as keyof ProductionProfile] !== value,
        )
      )
        throw new MediaFailure(
          "MEDIA_BUILD_MISMATCH",
          "此制作任务需要其固定的运行构建，不能静默更换。",
        );
      const context = await jobs.read(copy.id, attemptId),
        completed = new Set<string>();
      for (const artifact of context.artifacts) {
        try {
          await options.artifacts.publish(
            undefined,
            jobs.journal(copy.id, attemptId, artifact.id),
            combined,
          );
          completed.add(artifact.kind);
        } catch (error) {
          if (
            !(error instanceof MediaFailure) ||
            error.code !== "MEDIA_ARTIFACT_LOCAL_MISSING"
          )
            throw error;
        }
      }
      const expectedCount =
        (copy.kind === "video" ? 2 : 0) + (copy.has_audio ? 2 : 0);
      if (completed.size !== expectedCount) {
        directory = await workspace.allocate(copy.id, attemptId);
        const work = directory.path;
        await withMediaExecution(
          {
            signal: combined,
            accountWrite: mediaWriteBudget(workspace.writeLimit),
            reserveContainer: async () => {
              const resource = await jobs.reserveResource(
                copy.id,
                attemptId,
                "container",
              );
              return {
                id: resource.id,
                hostId: workspace.hostId,
                release: () => jobs.releaseResource(attemptId, resource.id),
              };
            },
          },
          async () => {
            const source = join(work, "source");
            await options.originals.download(
              context.source,
              source,
              copy.source_sha256,
              combined,
            );
            const publish = async (
              kind: ProductionArtifact["kind"],
              content: { file: string; bytes: number; sha256: string },
            ) => {
              combined.throwIfAborted();
              const reserved = await jobs.reserve(copy.id, attemptId, {
                kind,
                bytes: content.bytes,
                sha256: content.sha256,
              });
              if (!completed.has(kind))
                await options.artifacts.publish(
                  content.file,
                  reserved.journal,
                  combined,
                );
            };
            let zero:
              | {
                  pts: string;
                  timeBase: { numerator: number; denominator: number };
                }
              | undefined;
            if (copy.kind === "video") {
              const [numerator, denominator] = copy.profile
                .rate!.split("/")
                .map(Number);
              const result = await makeVideoProduction(
                source,
                { numerator: numerator!, denominator: denominator! },
                work,
                combined,
              );
              if (
                result.manifest.runtime.imageId !== copy.profile.imageId ||
                result.manifest.runtime.platform !== copy.profile.platform
              )
                throw new MediaFailure(
                  "MEDIA_BUILD_MISMATCH",
                  "处理期间制作构建发生变化。",
                );
              await publish("video", result.video);
              await publish("video_map", result.sourceMap);
              zero = {
                pts: result.manifest.startPts,
                timeBase: result.manifest.timeBase,
              };
            }
            if (copy.has_audio) {
              const result = await makeAudioProduction(
                source,
                work,
                zero,
                combined,
              );
              if (!result)
                throw new MediaFailure(
                  "MEDIA_SOURCE_CHANGED",
                  "原片的音频轨与验收记录不一致。",
                );
              if (
                result.manifest.runtime.imageId !== copy.profile.imageId ||
                result.manifest.runtime.platform !== copy.profile.platform
              )
                throw new MediaFailure(
                  "MEDIA_BUILD_MISMATCH",
                  "处理期间制作构建发生变化。",
                );
              await publish("audio", result.audio);
              await publish("audio_map", result.sourceMap);
            }
          },
        );
      }
      combined.throwIfAborted();
      await jobs.finish(copy.id, attemptId);
    } catch (error) {
      const issue = combined.aborted
        ? { code: "MEDIA_CANCELLED", permanent: false }
        : failure(error);
      try {
        if (issue.permanent) await jobs.finish(copy.id, attemptId, issue.code);
        else await jobs.yield(copy.id, attemptId, issue.code);
      } catch (writeError) {
        if ((writeError as { code?: string }).code !== "P0430")
          throw writeError;
      }
      if (!issue.permanent) throw error;
    } finally {
      stopped = true;
      clearTimeout(timer);
      await beat;
      await directory?.close();
    }
  };
  const process: StepHandler = (step, context) => {
    const running = execute(step, context);
    active.add(running);
    void running.then(
      () => active.delete(running),
      () => active.delete(running),
    );
    return running;
  };
  return {
    process,
    profile,
    hostId: workspace.hostId,
    async cleanup() {
      let cleaned = 0,
        failed = 0;
      for (let i = 0; i < 8 && !workspace.signal.aborted; i++) {
        const [item] = await jobs.claimCleanup(workspace.hostId, 1);
        if (!item) break;
        try {
          await jobs.assertCleanup(item);
          if (item.artifact) {
            const result = await options.artifacts.cleanup(
              jobs.cleanupJournal(item),
              AbortSignal.any([workspace.signal, AbortSignal.timeout(45_000)]),
            );
            if (result.pending)
              throw new Error("Multipart cleanup remains pending");
          } else if (item.resource?.kind === "container")
            await removeProductionContainer(item.resource.id, workspace.hostId);
          else if (item.resource) await workspace.remove(item.resource);
          else throw new Error("Invalid production cleanup record");
          await jobs.finishCleanup(item);
          cleaned++;
        } catch {
          failed++;
        }
      }
      return { cleaned, failed };
    },
    stop() {
      closing = true;
      workspace.stop();
    },
    async close() {
      closing = true;
      workspace.stop();
      await Promise.allSettled([...active]);
      await workspace.close();
    },
  };
}
