import { mediaPost } from "./media-imports";
import { useEffect, useState, useSyncExternalStore } from "react";
import { allPages, api, ApiError, useSession, type Schema } from "./api";
import { projectPath, tenantPath } from "./common";
import { AssistantSession } from "./assistant-session";
import { assistantStorage } from "./assistant-storage";
import { registerAssistant } from "./assistant-lifecycle";
import { subscribeEditingAccess } from "./editing-access";
import {
  reworkScope,
  type PromptDraft,
  type ReworkSource,
} from "./prompt-draft";
const entries = new Map<
  string,
  {
    controller: AssistantSession<PromptDraft>;
    owners: number;
    loaded: boolean;
    cleanup?: (() => void) | undefined;
  }
>();
export function usePromptSession(
  tenantId: string,
  projectId: string,
  shot: Schema<"Shot">,
  rework?: ReworkSource,
) {
  const session = useSession(),
    path = projectPath(tenantId, projectId),
    tenant = tenantPath(tenantId);
  const [entry] = useState(() => {
    const reworkKey = reworkScope(rework);
    const key = JSON.stringify([session.id, path, shot.id, reworkKey]);
    const prior = entries.get(key);
    if (prior) return prior;
    const post = <T>(url: string, body: unknown, key: string) =>
      api<T>(url, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": key,
        },
        body: JSON.stringify(body),
      });
    const storage = assistantStorage<PromptDraft>(
      session.userId,
      `${path}/shots/${shot.id}/prompt${reworkKey}`,
      session.id,
    );
    const created: typeof entries extends Map<string, infer Entry>
      ? Entry
      : never = {
      owners: 0,
      loaded: false,
      controller: new AssistantSession<PromptDraft>(storage, {
        checkAccess: async () => {
          const current = await api<Schema<"Session">>("/v1/session", {
            signal: AbortSignal.timeout(15000),
          });
          if (current.id !== session.id || current.userId !== session.userId)
            throw new ApiError(401, "SESSION_CHANGED", "登录会话已改变。");
          await api(
            `${path}/shots/${shot.id}/revisions/${shot.specRevisionId}`,
            { signal: AbortSignal.timeout(15000) },
          );
          if (rework) {
            const take = await api<Schema<"Take">>(
              `${path}/takes/${rework.takeId}`,
            );
            if (
              take.shotId !== shot.id ||
              take.shotRevisionId !== shot.specRevisionId
            )
              throw new Error("候选的固定镜头来源不匹配。");
            await api(`${path}/reviews/${rework.reviewId}`);
          }
          const stored = await storage.read();
          if (stored?.draft.artifact)
            await api(
              `${path}/assistance-artifacts/${stored.draft.artifact.id}`,
              { signal: AbortSignal.timeout(15000) },
            );
        },
        createPlan: (input, key) =>
          post(`${tenant}/generation-plans`, input, key),
        getPlan: (id) =>
          api(`${tenant}/generation-plans/${id}`, {
            signal: AbortSignal.timeout(15000),
          }),
        execute: (planId, key) =>
          post(`${tenant}/generation-jobs`, { planId }, key),
        cancelJob: (jobId, key) =>
          mediaPost(
            session,
            `${tenant}/generation-jobs/${jobId}/cancel`,
            undefined,
            AbortSignal.timeout(15000),
            key,
          ),
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
  const controller = entry.controller;
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
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
        void controller.load({
          ...(rework ? { rework: structuredClone(rework) } : {}),
          source: { shotId: shot.id, shotRevisionId: shot.specRevisionId },
          label: shot.label,
          intent: shot.spec.intent,
          prompt: "",
          references: [],
          instruction: "",
          capabilityId: "",
          targetCapabilityId: "",
        });
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
