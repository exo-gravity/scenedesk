/** Pure helpers behind the collapsed-card result previews. */

type AttemptLike = {
  origin: { nodeId: string };
  jobId?: string | undefined;
  jobStatus?: string | undefined;
  plan: {
    id: string;
    createdAt?: string | undefined;
    input: { projectId?: string | undefined; purpose: string };
  };
};

export type SucceededAttempt = {
  jobId: string;
  planId: string;
  kind: "image" | "video" | "audio";
};

/**
 * For each node, the newest attempt in this project that actually succeeded.
 * A newer attempt that is still running or failed does not replace it, so a
 * retry keeps the last picture until it has one of its own.
 */
export function latestSucceededAttempts(
  attempts: readonly AttemptLike[],
  projectId: string,
): Map<string, SucceededAttempt> {
  const latest = new Map<string, SucceededAttempt & { createdAt: number }>();
  for (const entry of attempts) {
    if (
      entry.jobStatus !== "succeeded" ||
      !entry.jobId ||
      entry.plan.input.projectId !== projectId ||
      !["image", "video", "audio"].includes(entry.plan.input.purpose)
    )
      continue;
    const createdAt = Date.parse(entry.plan.createdAt ?? "") || 0;
    const current = latest.get(entry.origin.nodeId);
    if (current && current.createdAt >= createdAt) continue;
    latest.set(entry.origin.nodeId, {
      jobId: entry.jobId,
      planId: entry.plan.id,
      kind: entry.plan.input.purpose as SucceededAttempt["kind"],
      createdAt,
    });
  }
  return new Map(
    [...latest].map(([nodeId, { createdAt: _at, ...rest }]) => [nodeId, rest]),
  );
}

/**
 * Run tasks with at most `limit` in flight. Every task runs; a failure is
 * reported in its slot and does not stop the others.
 */
export async function runWithLimit<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]!() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker),
  );
  return results;
}
