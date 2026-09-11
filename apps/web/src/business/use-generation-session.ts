import { useEffect, useState, useSyncExternalStore } from "react";
import { allPages, api, ApiError, useSession, type Schema } from "./api";
import { projectPath, tenantPath } from "./common";
import { AssistantSession } from "./assistant-session";
import { assistantStorage } from "./assistant-storage";
import { registerAssistant } from "./assistant-lifecycle";
import { subscribeEditingAccess } from "./editing-access";
import type { ImageDraft, ImageRequest } from "./image-generation";
export type ImageSubject =
  | { kind: "shot"; shotId: string }
  | { kind: "canvas"; canvasId: string; nodeId: string; sceneId: string };
type Entry = {
  controller: AssistantSession<ImageDraft, ImageRequest>;
  owners: number;
  loaded: boolean;
  cleanup?: (() => void) | undefined;
};
const entries = new Map<string, Entry>();
export function useGenerationSession(
  tenantId: string,
  projectId: string,
  subject: ImageSubject,
  kind: "image" | "video" | "audio",
) {
  const session = useSession(),
    path = projectPath(tenantId, projectId),
    tenant = tenantPath(tenantId);
  const subjectPath =
    subject.kind === "shot"
      ? `shots/${subject.shotId}`
      : `canvases/${subject.canvasId}/nodes/${subject.nodeId}`;
  const [entry] = useState(() => {
    const key = JSON.stringify([
      session.id,
      session.userId,
      path,
      subjectPath,
      kind,
    ]);
    const prior = entries.get(key);
    if (prior) return prior;
    const storage = assistantStorage<ImageDraft, ImageRequest>(
      session.userId,
      `${path}/${subjectPath}/${kind}-generation`,
      session.id,
    );
    const post = <T>(
      url: string,
      body: unknown,
      key: string,
      revision?: number,
    ) =>
      api<T>(url, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": key,
          "Content-Type": "application/json",
          ...(revision === undefined ? {} : { "If-Match": `"${revision}"` }),
        },
        body: JSON.stringify(body),
      });
    const created: Entry = {
      owners: 0,
      loaded: false,
      controller: new AssistantSession(storage, {
        checkAccess: async () => {
          const current = await api<Schema<"Session">>("/v1/session", {
            signal: AbortSignal.timeout(15000),
          });
          if (current.id !== session.id || current.userId !== session.userId)
            throw new ApiError(401, "SESSION_CHANGED", "登录会话已改变。");
          if (subject.kind === "canvas")
            await api(`${path}/canvases/${subject.canvasId}`, {
              signal: AbortSignal.timeout(15000),
            });
          else {
            const content = await api<Schema<"ContentTree">>(
              `${path}/content`,
              { signal: AbortSignal.timeout(15000) },
            );
            if (!content.shots.some((s) => s.id === subject.shotId))
              throw new ApiError(
                404,
                "SHOT_NOT_AVAILABLE",
                "当前镜头不可访问。",
              );
          }
          const saved = await storage.read();
          if (saved?.execution?.jobId) {
            const job = await api<Schema<"GenerationJob">>(
              `${tenant}/generation-jobs/${saved.execution.jobId}`,
              { signal: AbortSignal.timeout(15000) },
            );
            await Promise.all(
              job.mediaIds.map((id) =>
                api(`${tenant}/media/${id}`, {
                  signal: AbortSignal.timeout(15000),
                }),
              ),
            );
          }
        },
        createPlan: async (request, key) =>
          request.kind === "shot"
            ? post(`${tenant}/generation-plans`, request.input, key)
            : (
                await post<Schema<"CanvasPlanEntry">>(
                  `${path}/scenes/${request.sceneId}/canvas/generation-plans`,
                  request.input,
                  key,
                  request.canvasRevision,
                )
              ).plan,
        getPlan: (id) =>
          api(`${tenant}/generation-plans/${id}`, {
            signal: AbortSignal.timeout(15000),
          }),
        execute: (planId, key) =>
          post(`${tenant}/generation-jobs`, { planId }, key),
        getJob: (id) =>
          api(`${tenant}/generation-jobs/${id}`, {
            signal: AbortSignal.timeout(15000),
          }),
        findJob: async (planId) =>
          (
            await allPages<Schema<"GenerationJob">>(
              `${tenant}/generation-jobs?scope=project&projectId=${projectId}&planId=${planId}`,
            )
          ).find((job) => job.planId === planId),
      }),
    };
    entries.set(key, created);
    return created;
  });
  const controller = entry.controller,
    state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    entry.owners++;
    if (entry.owners === 1) {
      const unregister = registerAssistant({
        controller,
        userId: session.userId,
        sessionId: session.id,
        tenantId,
        projectId,
      });
      const verify = () => {
        controller.suspend();
        void controller.verify();
      };
      const unsubscribe = subscribeEditingAccess((hint) => {
        if (
          hint.userId === session.userId &&
          hint.sessionId === session.id &&
          (hint.kind === "session" ||
            (hint.tenantId === tenantId && hint.projectId === projectId))
        )
          verify();
      });
      window.addEventListener("focus", verify);
      window.addEventListener("online", verify);
      entry.cleanup = () => {
        unregister();
        unsubscribe();
        window.removeEventListener("focus", verify);
        window.removeEventListener("online", verify);
      };
      if (!entry.loaded) {
        entry.loaded = true;
        void controller.load({ capabilityId: "", output: {} });
      } else void controller.verify();
    }
    return () => {
      if (--entry.owners === 0) {
        entry.cleanup?.();
        entry.cleanup = undefined;
      }
    };
  }, [entry, controller, session.id, session.userId, tenantId, projectId]);
  useEffect(() => {
    if (
      !state.record?.execution ||
      ["succeeded", "failed", "cancelled"].includes(state.job?.status ?? "")
    )
      return;
    const timer = setInterval(() => void controller.refresh(), 4000);
    return () => clearInterval(timer);
  }, [controller, state.record?.execution?.planId, state.job?.status]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (state.record && !state.draftSaved) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.record, state.draftSaved]);
  return { controller, state };
}
