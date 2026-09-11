import { useEffect, useRef, useState } from "react";
import { Group, Text } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, useSession, type Schema } from "./api";
import { tabIdentity } from "./content-drafts";
import { notifyEditingAccess } from "./editing-access";
import { suspendEditingAccess } from "./editing-lifecycle";
import { useProjectUpdateStatus } from "./ProjectUpdates";
import { editingPresenceLabel } from "./editing-presence-state";

export function EditingPresence({
  tenantId,
  projectId,
  canvasId,
  editing,
  enabled,
}: {
  tenantId: string;
  projectId: string;
  canvasId: string;
  editing: boolean;
  enabled: boolean;
}) {
  const session = useSession(),
    cache = useQueryClient();
  const updates = useProjectUpdateStatus();
  const [label, setLabel] = useState("正在读取编辑状态");
  const activity = useRef(editing),
    kick = useRef<(() => void) | undefined>(undefined);
  activity.current = editing;
  useEffect(() => {
    if (!enabled) {
      setLabel("编辑状态暂不可用");
      return;
    }
    let live = true,
      pending = false,
      again = false,
      clientId: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const heartbeat = async () => {
      if (!live || !clientId) return;
      if (pending) {
        again = true;
        return;
      }
      pending = true;
      clearTimeout(timer);
      const startedAt = performance.now();
      try {
        const result = await api<Schema<"EditingPresence">>(
          `/v1/tenants/${tenantId}/projects/${projectId}/editing-presence`,
          {
            method: "PUT",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(10_000),
            ]),
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
            },
            body: JSON.stringify({
              target: { kind: "canvas", objectId: canvasId },
              clientSessionId: clientId,
              activity: activity.current ? "editing" : "viewing",
            }),
          },
        );
        if (!live) return;
        const show = () => {
          clearTimeout(expiry);
          if (!live) return;
          const view = editingPresenceLabel(
            result,
            clientId!,
            performance.now() - startedAt,
          );
          setLabel(view.label);
          if (view.refreshInMs !== null)
            expiry = setTimeout(show, view.refreshInMs);
        };
        show();
      } catch (error) {
        if (!live) return;
        clearTimeout(expiry);
        setLabel("编辑状态暂不可用");
        if (
          error instanceof ApiError &&
          (error.status === 401 ||
            ["CSRF_REJECTED", "EDITING_CLIENT_CHANGED"].includes(error.code))
        ) {
          const hint = {
            kind: "session" as const,
            sessionId: session.id,
            userId: session.userId,
          };
          suspendEditingAccess(hint);
          notifyEditingAccess(hint);
          void cache.invalidateQueries({ queryKey: ["session"] });
        }
      } finally {
        pending = false;
        if (live) {
          const soon = again;
          again = false;
          timer = setTimeout(() => void heartbeat(), soon ? 250 : 30_000);
        }
      }
    };
    kick.current = () => void heartbeat();
    void tabIdentity()
      .then((id) => {
        if (live) {
          clientId = id;
          void heartbeat();
        }
      })
      .catch(() => {
        if (live) setLabel("编辑状态暂不可用");
      });
    const online = () => void heartbeat();
    const focused = () => {
      setLabel("正在读取编辑状态");
      void heartbeat();
    };
    const offline = () => {
      clearTimeout(expiry);
      if (live) setLabel("编辑状态暂不可用");
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("focus", focused);
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
      clearTimeout(expiry);
      kick.current = undefined;
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("focus", focused);
    };
  }, [
    tenantId,
    projectId,
    canvasId,
    enabled,
    session.id,
    session.userId,
    session.csrfToken,
    cache,
  ]);
  useEffect(() => {
    kick.current?.();
  }, [editing]);
  return (
    <Group gap="md" role="status" aria-live="polite">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="xs" c="dimmed">
        {updates}
      </Text>
    </Group>
  );
}
