import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, useSession, type Schema } from "./api";
import { notifyEditingAccess } from "./editing-access";
import { suspendEditingAccess } from "./editing-lifecycle";

type Hint = Schema<"Event">;
type Listener = { projectId: string; receive: (hint: Hint) => void };
const listeners = new Set<Listener>();
export function subscribeProjectUpdates(
  projectId: string,
  receive: Listener["receive"],
) {
  const listener = { projectId, receive };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const UpdatesContext = createContext("正在连接项目更新");
export const useProjectUpdateStatus = () => useContext(UpdatesContext);

/** One transport per visible project; resource reads and local drafts stay separate. */
export function ProjectUpdates({
  tenantId,
  projectId,
  children,
}: {
  tenantId: string;
  projectId: string | undefined;
  children: ReactNode;
}) {
  const session = useSession(),
    cache = useQueryClient();
  const [status, setStatus] = useState("正在连接项目更新");
  useEffect(() => {
    if (!projectId) return;
    let live = true,
      checking = false,
      queued = false,
      verified = false,
      reconnectReset = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const path = `/v1/tenants/${tenantId}/projects/${projectId}`;
    const emit = (hint: Hint) => {
      for (const listener of listeners)
        if (listener.projectId === projectId) listener.receive(hint);
    };
    const refresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        if (!live) return;
        void cache.invalidateQueries({
          predicate: ({ queryKey: key }) =>
            key[0] === "user" &&
            key[1] === session.userId &&
            typeof key[2] === "string" &&
            (key[2] === path ||
              key[2].startsWith(`${path}/`) ||
              key[2].startsWith(`/v1/tenants/${tenantId}/media`) ||
              key[2].startsWith(`/v1/tenants/${tenantId}/assets`)),
        });
      }, 150);
    };
    const changedSession = () => {
      const hint = {
        kind: "session" as const,
        sessionId: session.id,
        userId: session.userId,
      };
      suspendEditingAccess(hint);
      notifyEditingAccess(hint);
      void cache.invalidateQueries({ queryKey: ["session"] });
    };
    // EventSource doesn't expose HTTP errors. A fresh GET distinguishes an
    // outage from actual loss of access without interpreting an event as authority.
    const check = async () => {
      if (checking) {
        queued = true;
        return;
      }
      checking = true;
      try {
        const current = await api<Schema<"Session">>("/v1/session", {
          signal: AbortSignal.timeout(10_000),
        });
        if (!live) return;
        if (current.id !== session.id || current.userId !== session.userId) {
          verified = false;
          source.close();
          changedSession();
          return;
        }
        await api<Schema<"Project">>(path, {
          signal: AbortSignal.timeout(10_000),
        });
        if (live) {
          verified = true;
          if (source.readyState === EventSource.OPEN)
            setStatus("项目更新已连接");
          if (reconnectReset) {
            reconnectReset = false;
            emit({ seq: "0", type: "reset" });
          }
          refresh();
        }
      } catch (error) {
        if (!live) return;
        verified = false;
        if (
          error instanceof ApiError &&
          [401, 403, 404].includes(error.status)
        ) {
          source.close();
          setStatus("项目访问权限需要重新核对");
          emit({ seq: "0", type: "access_revoked" });
          if (error.status === 401) changedSession();
          refresh();
        }
      } finally {
        checking = false;
        if (live && queued) {
          queued = false;
          void check();
        }
      }
    };
    setStatus("正在连接项目更新");
    const source = new EventSource(`${path}/events`);
    source.onopen = () => {
      if (live) {
        verified = false;
        reconnectReset = true;
        setStatus("正在核对项目更新");
        void check();
      }
    };
    source.onmessage = ({ data }) => {
      if (!live) return;
      let hint: Hint;
      try {
        hint = JSON.parse(data);
      } catch {
        return;
      }
      if (
        !hint ||
        typeof hint.seq !== "string" ||
        !/^\d+$/.test(hint.seq) ||
        !["reset", "resource_changed", "access_revoked"].includes(hint.type)
      )
        return;
      if (
        hint.type === "resource_changed" &&
        (typeof hint.resourceKind !== "string" ||
          typeof hint.resourceId !== "string" ||
          !Number.isSafeInteger(hint.resourceRevision) ||
          hint.resourceRevision! < 1)
      )
        return;
      if (verified) emit(hint);
      else reconnectReset = true;
      if (hint.type === "access_revoked") {
        source.close();
        setStatus("项目访问权限需要重新核对");
        void check();
      }
      if (verified) refresh();
    };
    source.onerror = () => {
      if (live) {
        verified = false;
        setStatus("项目更新暂不可用，保留当前输入");
        void check();
      }
    };
    const focused = () => {
      if (document.visibilityState === "visible") void check();
    };
    const offline = () => {
      verified = false;
      setStatus("项目更新暂不可用，保留当前输入");
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", focused);
    window.addEventListener("focus", focused);
    return () => {
      live = false;
      source.close();
      clearTimeout(refreshTimer);
      window.removeEventListener("online", focused);
      window.removeEventListener("focus", focused);
      window.removeEventListener("offline", offline);
    };
  }, [tenantId, projectId, session.id, session.userId, cache]);
  return (
    <UpdatesContext.Provider value={status}>{children}</UpdatesContext.Provider>
  );
}
