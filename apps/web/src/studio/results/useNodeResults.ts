import { useEffect, useMemo, useRef, useState } from "react";
import { api, useSession, type Schema } from "../../business/api";
import { latestSucceededAttempts, runWithLimit } from "../../business/canvas-node-previews";
import { jobStatusLabel } from "../../business/assistant-session";

type Entry = Schema<"CanvasPlanEntry">;
/** Reads in flight at once for the cards' result previews. */
const CONCURRENCY = 4;

/**
 * The latest finished result of every draft on the board, as media ids keyed
 * by node id, so a card can fill its frame with it. Each (session, tenant,
 * project, node, plan, job) identity is read once: the job, then its first
 * media, both re-checked against what the attempt claims. A retry that has not
 * finished, or failed, does not replace the last picture. Nothing here places,
 * references or adopts anything.
 */
export function useNodeResults({
  tenantId,
  projectId,
  attempts,
}: {
  tenantId: string;
  projectId: string;
  attempts: readonly Entry[];
}): Record<string, string> | undefined {
  const session = useSession();
  const latest = useMemo(() => latestSucceededAttempts(attempts, projectId), [attempts, projectId]);
  const computed = useMemo(
    () =>
      [...latest].map(([nodeId, attempt]) => ({
        nodeId,
        ...attempt,
        identity: JSON.stringify([
          session.userId,
          session.id,
          tenantId,
          projectId,
          nodeId,
          attempt.planId,
          attempt.jobId,
          attempt.kind,
        ]),
      })),
    [latest, session.userId, session.id, tenantId, projectId],
  );
  const key = computed.map((item) => item.identity).join("\n");
  const stable = useRef({ key, value: computed });
  if (stable.current.key !== key) stable.current = { key, value: computed };
  const wanted = stable.current.value;
  const resolved = useRef(new Map<string, string | null>());
  const [, bump] = useState(0);
  useEffect(() => {
    const pending = wanted.filter((item) => !resolved.current.has(item.identity));
    if (!pending.length) return;
    const controller = new AbortController();
    const path = `/v1/tenants/${tenantId}`;
    let live = true;
    void runWithLimit(
      pending.map((item) => async () => {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
        let mediaId: string | null = null;
        try {
          const job = await api<Schema<"GenerationJob">>(`${path}/generation-jobs/${item.jobId}`, { signal });
          if (
            job.id === item.jobId &&
            job.projectId === projectId &&
            job.planId === item.planId &&
            job.status === "succeeded" &&
            job.mediaIds[0]
          ) {
            const candidate = job.mediaIds[0];
            const media = await api<Schema<"Media">>(`${path}/media/${candidate}`, { signal });
            if (
              media.id === candidate &&
              media.projectId === projectId &&
              media.sourceJobId === item.jobId &&
              media.kind === item.kind &&
              ["ready", "archived"].includes(media.status)
            )
              mediaId = candidate;
          }
        } catch {
          // A failed read is not a result and is not cached; the next change of the attempts list asks again.
          return;
        }
        if (!live) return;
        resolved.current.set(item.identity, mediaId);
        bump((n) => n + 1);
      }),
      CONCURRENCY,
    );
    return () => {
      live = false;
      controller.abort();
    };
  }, [wanted, tenantId, projectId]);
  const results: Record<string, string> = {};
  for (const item of wanted) {
    const mediaId = resolved.current.get(item.identity);
    if (mediaId) results[item.nodeId] = mediaId;
  }
  return Object.keys(results).length ? results : undefined;
}

export type TaskLabel = { label: string; tone: "pending" | "failed" };
/**
 * What each draft's newest attempt is doing, for the small tag in its card.
 * A finished success has no tag: the result itself is shown.
 */
export function taskLabels(attempts: readonly Entry[]): Record<string, TaskLabel> {
  const labels: Record<string, TaskLabel> = {};
  const sorted = [...attempts].sort((a, b) =>
    (b.plan.createdAt ?? "").localeCompare(a.plan.createdAt ?? ""),
  );
  for (const entry of sorted) {
    const nodeId = entry.origin.nodeId;
    if (nodeId in labels) continue;
    if (entry.jobStatus === "succeeded") {
      labels[nodeId] = { label: "", tone: "pending" };
      continue;
    }
    const failed =
      !!entry.jobStatus &&
      ["failed", "archive_failed", "reconciliation_required", "cancelled"].includes(entry.jobStatus);
    labels[nodeId] = {
      label: entry.jobStatus
        ? jobStatusLabel[entry.jobStatus]
        : entry.jobId
          ? "任务已受理"
          : { ready: "待确认", blocked: "需要补充输入", expired: "计划已过期", consumed: "计划已使用" }[
              entry.plan.status
            ],
      tone: failed ? "failed" : "pending",
    };
  }
  for (const [nodeId, value] of Object.entries(labels)) if (!value.label) delete labels[nodeId];
  return labels;
}
