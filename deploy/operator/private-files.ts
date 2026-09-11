import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";

export class OperatorError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export const requireOperator = (condition: unknown, code: string): void => {
  if (!condition) throw new OperatorError(code);
};
const owned = (uid: number) =>
  process.getuid === undefined || uid === process.getuid();
export const PRIVATE_JSON_MAX_BYTES = 262144;
export async function canonicalPrivatePath(file: string) {
  requireOperator(isAbsolute(file), "PRIVATE_ABSOLUTE_PATH_REQUIRED");
  let canonical: string;
  try {
    requireOperator(
      !(await lstat(file)).isSymbolicLink(),
      "PRIVATE_FILE_SYMLINK_REJECTED",
    );
    canonical = await realpath(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    canonical = join(await realpath(dirname(file)), basename(file));
  }
  await privateDirectory(canonical);
  return canonical;
}
export async function privateDirectory(file: string) {
  requireOperator(isAbsolute(file), "PRIVATE_ABSOLUTE_PATH_REQUIRED");
  const directory = await lstat(dirname(file));
  requireOperator(
    directory.isDirectory() &&
      owned(directory.uid) &&
      (directory.mode & 0o777) === 0o700,
    "PRIVATE_DIRECTORY_0700_REQUIRED",
  );
}
export async function readPrivate(
  file: string,
  optional = false,
): Promise<unknown> {
  await privateDirectory(file);
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT")
      return undefined;
    throw error;
  }
  try {
    const info = await handle.stat();
    requireOperator(
      info.isFile() &&
        owned(info.uid) &&
        (info.mode & 0o777) === 0o600 &&
        info.size <= PRIVATE_JSON_MAX_BYTES,
      "PRIVATE_FILE_0600_REQUIRED",
    );
    return JSON.parse(await handle.readFile("utf8")) as unknown;
  } finally {
    await handle.close();
  }
}
async function syncDirectory(file: string) {
  const handle = await open(dirname(file), constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function writePrivate(file: string, value: unknown) {
  await privateDirectory(file);
  await readPrivate(file, true);
  const encoded = JSON.stringify(value, null, 2) + "\n";
  requireOperator(
    Buffer.byteLength(encoded) <= PRIVATE_JSON_MAX_BYTES,
    "PRIVATE_JSON_TOO_LARGE",
  );
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await handle.writeFile(encoded, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, file);
    await syncDirectory(file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
/** A crash deliberately leaves the private lock. An operator must verify the process stopped before removing it. */
export async function withPrivateLock<T>(
  file: string,
  action: () => Promise<T>,
) {
  await privateDirectory(file);
  const lock = `${file}.lock`;
  let handle;
  try {
    handle = await open(
      lock,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new OperatorError("BOOTSTRAP_LOCKED");
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid }));
    await handle.sync();
    await syncDirectory(lock);
    return await action();
  } finally {
    await handle.close();
    await unlink(lock);
    await syncDirectory(lock);
  }
}
