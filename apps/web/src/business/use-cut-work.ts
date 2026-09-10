import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, useSession, type Schema } from "./api";
import { tabIdentity } from "./content-drafts";
import { CutWorkController, type WorkTransport } from "./cut-work-controller";
import { clearEditingLocal } from "./editing-local";

const controllers = new Map<string, CutWorkController>();
export async function clearUserEditing(userId: string) {
  await Promise.all(
    [...controllers]
      .filter(([, c]) => c.partition.userId === userId)
      .map(async ([key, controller]) => {
        await controller.revoke();
        controllers.delete(key);
      }),
  );
  await clearEditingLocal(userId);
}
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
        const transport: WorkTransport = {
          read: () =>
            api<Schema<"CutWorkDraft">>(path, {
              signal: AbortSignal.timeout(15_000),
            }),
          save: (pending) =>
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
        };
        let found = controllers.get(key);
        const reopening = !!found;
        if (!found) {
          found = new CutWorkController(
            {
              userId: session.userId,
              tenantId,
              projectId,
              objectId: cutId,
              kind: "cut_work_draft",
              clientSessionId,
            },
            transport,
          );
          controllers.set(key, found);
        } else found.updateTransport(transport);
        current = found;
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
      current?.pause();
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
