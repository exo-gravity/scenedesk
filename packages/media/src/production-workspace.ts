import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Pool } from "pg";
import { MediaFailure } from "./policy.js";
import type { ProductionJobs, ProductionResource } from "./production-jobs.js";

export const PRODUCTION_WRITE_LIMIT = 16 * 1024 ** 3;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const entry = await lstat(path);
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    (entry.mode & 0o077) !== 0 ||
    (process.getuid && entry.uid !== process.getuid())
  )
    throw new Error("Production workspace must be an owned private directory");
}
/** One live coordinator per persisted host identity; task directories use database-reserved UUIDs. */
export async function openProductionWorkspace(
  pool: Pool,
  jobs: ProductionJobs,
  path: string,
  writeLimit = PRODUCTION_WRITE_LIMIT,
) {
  if (
    !Number.isSafeInteger(writeLimit) ||
    writeLimit < 1024 ** 2 ||
    writeLimit > PRODUCTION_WRITE_LIMIT
  )
    throw new Error("Production write budget must be between 1 MiB and 16 GiB");
  const root = resolve(path);
  await privateDirectory(root);
  if ((await realpath(root)) !== root)
    throw new Error("Production workspace must not use symbolic paths");
  await privateDirectory(join(root, "jobs"));
  const identity = join(root, "host-id"),
    candidate = join(root, `.host-${randomUUID()}`);
  try {
    // A link publishes complete contents atomically; a killed writer cannot leave half an identity.
    await writeFile(candidate, randomUUID(), { flag: "wx", mode: 0o600 });
    try {
      await link(candidate, identity);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    await rm(candidate, { force: true });
  }
  const file = await lstat(identity);
  if (
    !file.isFile() ||
    file.isSymbolicLink() ||
    file.size !== 36 ||
    (file.mode & 0o077) !== 0
  )
    throw new Error("Invalid persisted production host identity");
  const hostId = await readFile(identity, "utf8");
  if (!uuid.test(hostId)) throw new Error("Invalid production host UUID");
  const lease = await pool.connect(),
    controller = new AbortController();
  let released = false,
    timer: NodeJS.Timeout | undefined,
    pulse: Promise<void> | undefined;
  const lost = () =>
    controller.abort(
      new MediaFailure("MEDIA_HOST_UNAVAILABLE", "制作宿主连接已失效。"),
    );
  lease.on("error", lost);
  lease.on("end", lost);
  try {
    await lease.query("SET statement_timeout='5s'");
    if (
      !(
        await lease.query(
          "SELECT pg_try_advisory_lock(hashtext('scenedesk-production-host'),hashtext($1)) AS acquired",
          [hostId],
        )
      ).rows[0]?.acquired
    )
      throw new Error("Another production worker owns this workspace");
  } catch (error) {
    lease.release(true);
    throw error;
  }
  function heartbeat() {
    if (released) return;
    pulse = lease
      .query("SELECT 1")
      .then(() => undefined)
      .catch(lost)
      .finally(() => {
        if (!released && !controller.signal.aborted)
          timer = setTimeout(heartbeat, 15_000);
      });
  }
  timer = setTimeout(heartbeat, 15_000);
  let reservedBytes = 0,
    admission = Promise.resolve();
  const directoryPath = (id: string) => {
    if (!uuid.test(id))
      throw new Error("Invalid production directory identity");
    return join(root, "jobs", id);
  };
  const remove = async (resource: ProductionResource) => {
    if (resource.kind !== "directory")
      throw new Error("Expected directory resource");
    const path = directoryPath(resource.id);
    try {
      const entry = await lstat(path);
      if (!entry.isDirectory() || entry.isSymbolicLink())
        throw new Error("Reserved directory identity differs");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await rm(path, { recursive: true, force: true });
  };
  return {
    hostId,
    root,
    writeLimit,
    signal: controller.signal,
    remove,
    async allocate(copyId: string, attemptId: string) {
      const previous = admission;
      let unlock!: () => void;
      admission = new Promise<void>((done) => {
        unlock = done;
      });
      await previous;
      try {
        controller.signal.throwIfAborted();
        const space = await statfs(root, { bigint: true });
        if (
          space.bavail * space.bsize <
          BigInt(reservedBytes + writeLimit + 1024 ** 3)
        )
          throw new MediaFailure(
            "MEDIA_DISK_UNAVAILABLE",
            "制作磁盘可用空间不足，稍后自动重试。",
          );
        const resource = await jobs.reserveResource(
          copyId,
          attemptId,
          "directory",
        );
        const path = directoryPath(resource.id);
        // The durable resource exists before the first externally visible directory.
        await mkdir(path, { mode: 0o700 });
        reservedBytes += writeLimit;
        let done = false;
        return {
          path,
          resource,
          async close() {
            if (done) return;
            done = true;
            try {
              await remove(resource);
              await jobs.releaseResource(attemptId, resource.id);
            } finally {
              reservedBytes -= writeLimit;
            }
          },
        };
      } finally {
        unlock();
      }
    },
    stop() {
      controller.abort();
    },
    async close() {
      if (released) return;
      released = true;
      controller.abort();
      clearTimeout(timer);
      await pulse;
      lease.release(true);
    },
  };
}
