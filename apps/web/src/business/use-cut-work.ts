import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, useSession, type Schema } from "./api";
import { tabIdentity } from "./content-drafts";
import {
  type CutWorkController,
  type WorkTransport,
} from "./cut-work-controller";
import { CutWorkSessionRegistry } from "./cut-work-sessions";
import {
  registerEditingSessions,
  suspendEditingAccess,
} from "./editing-lifecycle";
import { notifyEditingAccess, type EditingAccessHint } from "./editing-access";

const controllers = new CutWorkSessionRegistry();
registerEditingSessions(controllers);
export {
  suspendEditingAccess,
  refreshEditingAccess,
  retireEditingSession,
  clearUserEditing,
} from "./editing-lifecycle";
export function useCutWork(tenantId: string, projectId: string, cutId: string) {
  const session = useSession(),
    cache = useQueryClient();
  const [attempt, setAttempt] = useState(0);
  const identity = JSON.stringify([
    session.id,
    session.userId,
    tenantId,
    projectId,
    cutId,
  ]);
  const [binding, setBinding] = useState<{
      identity: string;
      controller: CutWorkController;
    } | null>(null),
    [error, setError] = useState<Error | null>(null);
  const controller = binding?.identity === identity ? binding.controller : null;
  useEffect(() => {
    let live = true,
      currentKey: string | undefined,
      current: CutWorkController | undefined;
    setBinding(null);
    setError(null);
    void tabIdentity()
      .then(async (clientSessionId) => {
        if (!live) return;
        const key = JSON.stringify([
          session.id,
          session.userId,
          tenantId,
          projectId,
          cutId,
          clientSessionId,
        ]);
        const path = `/v1/tenants/${tenantId}/projects/${projectId}/cuts/${cutId}/work-draft`;
        const guarded = async <T>(request: Promise<T>) => {
          try {
            return await request;
          } catch (error) {
            const changedSession =
              error instanceof ApiError &&
              (error.status === 401 || error.code === "CSRF_REJECTED");
            if (changedSession) {
              suspendEditingAccess({
                kind: "session",
                sessionId: session.id,
                userId: session.userId,
              });
              void cache.invalidateQueries({ queryKey: ["session"] });
            }
            if (
              error instanceof ApiError &&
              [401, 403, 404].includes(error.status)
            )
              notifyEditingAccess(
                changedSession
                  ? {
                      kind: "session",
                      sessionId: session.id,
                      userId: session.userId,
                    }
                  : {
                      kind: "cut",
                      sessionId: session.id,
                      userId: session.userId,
                      tenantId,
                      projectId,
                      objectId: cutId,
                    },
              );
            throw error;
          }
        };
        const transport: WorkTransport = {
          read: () =>
            guarded(
              api<Schema<"CutWorkDraft">>(path, {
                signal: AbortSignal.timeout(15_000),
              }),
            ),
          save: (pending) =>
            guarded(
              api<Schema<"CutWorkDraft">>(path, {
                method: "PUT",
                signal: AbortSignal.timeout(15_000),
                headers: {
                  "Content-Type": "application/json",
                  "X-CSRF-Token": session.csrfToken,
                  "If-Match": `"${pending.version}"`,
                },
                body: JSON.stringify({
                  baseCutRevision: pending.baseCutRevision,
                  document: pending.document,
                }),
              }),
            ),
        };
        const { controller: found, reopening } = await controllers.acquire(
          key,
          {
            userId: session.userId,
            tenantId,
            projectId,
            objectId: cutId,
            kind: "cut_work_draft",
            clientSessionId,
          },
          transport,
          session.id,
        );
        currentKey = key;
        current = found;
        if (!live) {
          await controllers.release(key, found);
          return;
        }
        await found.initialize();
        if (!live) return;
        if (
          reopening &&
          found.getSnapshot().phase !== "forbidden" &&
          !(await found.refresh())
        ) {
          if (live)
            setError(
              found.getSnapshot().error ??
                new Error(
                  "尚未重新确认访问权限，请联网后重试；本机输入仍保留。",
                ),
            );
          return;
        }
        if (!live) return;
        setBinding({ identity, controller: found });
        found.resume();
      })
      .catch((reason) => {
        if (live)
          setError(
            reason instanceof Error ? reason : new Error("本机恢复暂不可用。"),
          );
      });
    return () => {
      live = false;
      if (current && currentKey) void controllers.release(currentKey, current);
    };
  }, [
    session.id,
    session.userId,
    session.csrfToken,
    tenantId,
    projectId,
    cutId,
    identity,
    attempt,
  ]);
  const state = useSyncExternalStore(
    controller?.subscribe ?? (() => () => {}),
    controller?.getSnapshot ?? (() => null),
  );
  useEffect(() => {
    if (!controller) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void controller.refresh();
    };
    const tick = setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const warn = (event: BeforeUnloadEvent) => {
      const current = controller.getSnapshot();
      if (
        (current.dirty || current.hasInvalidInput || current.local?.pending) &&
        (!current.localSaved || current.storageError)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      clearInterval(tick);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("beforeunload", warn);
    };
  }, [controller]);
  useEffect(() => {
    if (state?.phase === "forbidden") {
      cache.removeQueries({ queryKey: ["user", session.userId] });
      cache.removeQueries({ queryKey: ["media-access", session.userId] });
      void cache.invalidateQueries({ queryKey: ["session"] });
    }
  }, [state?.phase, cache, session.userId]);
  return {
    controller,
    state,
    error,
    retry: () => setAttempt((value) => value + 1),
  };
}
