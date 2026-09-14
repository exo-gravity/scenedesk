import { useEffect, useMemo, useState } from "react";
import { api, useSession, type Schema } from "./api";

type MediaKind = "image" | "video" | "audio";
type Preview = { request: object; mediaIds: Record<string, string> };

/** One editing node, one successful attempt, two reads. Never substitutes a reference. */
export function useCanvasNodePreview({
  tenantId,
  projectId,
  editingNodeId,
  attempts,
  kind,
}: {
  tenantId: string;
  projectId: string;
  editingNodeId?: string | undefined;
  attempts: readonly Schema<"CanvasPlanEntry">[];
  kind?: MediaKind | undefined;
}): Record<string, string> | undefined {
  const session = useSession();
  const [preview, setPreview] = useState<Preview>();
  const entry = editingNodeId
    ? attempts
        .filter(
          (item) =>
            item.origin.nodeId === editingNodeId &&
            item.plan.input.projectId === projectId &&
            item.jobStatus === "succeeded" &&
            !!item.jobId &&
            ["image", "video", "audio"].includes(item.plan.input.purpose) &&
            (!kind || item.plan.input.purpose === kind),
        )
        .sort(
          (a, b) =>
            (Date.parse(b.plan.createdAt ?? "") || 0) -
            (Date.parse(a.plan.createdAt ?? "") || 0),
        )[0]
    : undefined;
  const jobId = entry?.jobId;
  const planId = entry?.plan.id;
  const mediaKind = entry?.plan.input.purpose;
  const identity =
    editingNodeId && jobId && planId && mediaKind
      ? JSON.stringify([
          session.userId,
          session.id,
          tenantId,
          projectId,
          editingNodeId,
          planId,
          jobId,
          mediaKind,
        ])
      : undefined;
  // A → B → A must not briefly reveal A's former permission result.
  const request = useMemo(
    () => (identity ? { identity } : undefined),
    [identity],
  );

  useEffect(() => {
    if (!request || !editingNodeId || !jobId || !planId || !mediaKind) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(15000),
    ]);
    const path = `/v1/tenants/${tenantId}`;
    let current = true;
    // Fresh reads on each opened node/session. Cached metadata is not access proof.
    void (async () => {
      const job = await api<Schema<"GenerationJob">>(
        `${path}/generation-jobs/${jobId}`,
        { signal },
      );
      if (
        !current ||
        job.id !== jobId ||
        job.projectId !== projectId ||
        job.planId !== planId ||
        job.status !== "succeeded" ||
        !job.mediaIds[0]
      )
        return;
      const mediaId = job.mediaIds[0];
      const media = await api<Schema<"Media">>(`${path}/media/${mediaId}`, {
        signal,
      });
      if (
        current &&
        media.id === mediaId &&
        media.projectId === projectId &&
        media.sourceJobId === jobId &&
        media.kind === mediaKind &&
        ["ready", "archived"].includes(media.status)
      )
        setPreview({ request, mediaIds: { [editingNodeId]: mediaId } });
    })().catch(() => {
      if (current) setPreview(undefined);
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [request, editingNodeId, jobId, planId, mediaKind, tenantId, projectId]);

  return request && preview?.request === request ? preview.mediaIds : undefined;
}
