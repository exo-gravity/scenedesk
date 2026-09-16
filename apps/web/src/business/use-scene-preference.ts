import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, useResource, useSession, type Schema } from "./api";
import { sameValue } from "./prompt-draft";

type Preference = Schema<"SaveSceneWorkspacePreference">;
type Saved =
  | Schema<"SceneWorkspacePreference">
  | Schema<"ProjectWorkspacePreference">;
function preferenceOnly(value: Saved): Preference {
  const { revision: _revision, ...rest } = value;
  if ("sceneId" in rest) {
    const { sceneId: _scene, ...preference } = rest;
    return preference;
  }
  const { projectId: _project, ...preference } = rest;
  return preference;
}
export function useScenePreference(path: string) {
  const session = useSession(),
    cache = useQueryClient(),
    initial = useResource<Saved>(path);
  const [view, setView] = useState<Preference | null>(null),
    [error, setError] = useState<Error | null>(null),
    [saving, setSaving] = useState(false);
  const base = useRef<Saved | null>(null),
    draft = useRef<Preference | null>(null),
    writing = useRef(false),
    generation = useRef(0),
    failed = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!initial.data || base.current) return;
    const preference = preferenceOnly(initial.data);
    base.current = initial.data;
    draft.current = preference;
    setView(preference);
  }, [initial.data]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const change = useCallback((patch: Partial<Preference>) => {
    if (!draft.current) return;
    const next = { ...draft.current, ...patch };
    if (sameValue(next, draft.current)) return;
    draft.current = next;
    setView(next);
    setTick((t) => t + 1);
  }, []);
  const save = useCallback(
    (retry = false): Promise<void> => {
      if (inFlight.current) return inFlight.current;
      const operation = (async () => {
        if (
          writing.current ||
          !draft.current ||
          !base.current ||
          (failed.current && !retry)
        )
          return;
        const epoch = generation.current;
        writing.current = true;
        setSaving(true);
        try {
          const publish = async (saved: Saved) => {
            const queryKey = ["user", session.userId, path];
            // A mounted page seeds its view once. A stale pre-save read must
            // not restore old viewport/panel state on the next navigation.
            await cache.cancelQueries({ queryKey, exact: true });
            cache.setQueryData(queryKey, saved);
          };
          if (retry) {
            base.current = await api<Saved>(path);
            await publish(base.current);
          }
          if (epoch !== generation.current) return;
          const desired = draft.current;
          const saved = preferenceOnly(base.current);
          if (sameValue(desired, saved)) {
            failed.current = false;
            setError(null);
            return;
          }
          const result = await api<Saved>(path, {
            method: "PUT",
            signal: AbortSignal.timeout(15000),
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
              "If-Match": `"${base.current.revision}"`,
            },
            body: JSON.stringify(desired),
          });
          await publish(result);
          if (epoch !== generation.current) return;
          base.current = result;
          failed.current = false;
          setError(null);
        } catch (e) {
          if (epoch !== generation.current) return;
          failed.current = true;
          setError(
            e instanceof ApiError && e.status === 412
              ? new Error(
                  "其他页面更新了你的视图偏好。本页布局仍保留，可明确重新保存本页视图。",
                )
              : e instanceof Error
                ? e
                : new Error("视图偏好未保存。"),
          );
        } finally {
          writing.current = false;
          if (epoch === generation.current) {
            setSaving(false);
            setTick((t) => t + 1);
          }
        }
      })();
      inFlight.current = operation;
      void operation.finally(() => {
        if (inFlight.current === operation) inFlight.current = null;
      });
      return operation;
    },
    [path, session.csrfToken, session.userId, cache],
  );
  useEffect(() => {
    if (!view || !base.current || failed.current) return;
    const saved = preferenceOnly(base.current);
    if (sameValue(draft.current, saved)) return;
    const timer = setTimeout(() => void save(), 500);
    return () => clearTimeout(timer);
  }, [view, tick, save]);
  const flush = useCallback(async () => {
    await inFlight.current;
    await save();
    if (failed.current)
      throw new Error(
        "视图位置尚未保存，请先重新保存本页视图；当前页面仍保留。",
      );
    if (draft.current && base.current) {
      const saved = preferenceOnly(base.current);
      if (!sameValue(draft.current, saved)) {
        await save();
        if (failed.current)
          throw new Error("视图位置尚未保存，请先重新保存本页视图。");
      }
    }
    if (draft.current && base.current) {
      const saved = preferenceOnly(base.current);
      if (!sameValue(draft.current, saved))
        throw new Error("视图刚有新变化，当前页面仍保留，请再次切换。");
    }
  }, [save]);
  return {
    view,
    change,
    error: error ?? initial.error,
    saving,
    flush,
    retry: () => {
      if (!base.current) void initial.refetch();
      else void save(true);
    },
  };
}
