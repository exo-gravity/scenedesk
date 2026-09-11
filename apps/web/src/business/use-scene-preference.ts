import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, useResource, useSession, type Schema } from "./api";

type Preference = Schema<"SaveSceneWorkspacePreference">;
type Saved = Schema<"SceneWorkspacePreference">;
export function useScenePreference(path: string) {
  const session = useSession(),
    initial = useResource<Saved>(path);
  const [view, setView] = useState<Preference | null>(null),
    [error, setError] = useState<Error | null>(null),
    [saving, setSaving] = useState(false);
  const base = useRef<Saved | null>(null),
    draft = useRef<Preference | null>(null),
    writing = useRef(false),
    generation = useRef(0),
    failed = useRef(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!initial.data || base.current) return;
    const {
      sceneId: _scene,
      revision: _revision,
      ...preference
    } = initial.data;
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
    if (JSON.stringify(next) === JSON.stringify(draft.current)) return;
    draft.current = next;
    setView(next);
    setTick((t) => t + 1);
  }, []);
  const save = useCallback(
    async (retry = false) => {
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
        if (retry) base.current = await api<Saved>(path);
        if (epoch !== generation.current) return;
        const desired = draft.current;
        const { sceneId: _scene, revision: _revision, ...saved } = base.current;
        if (JSON.stringify(desired) === JSON.stringify(saved)) {
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
    },
    [path, session.csrfToken],
  );
  useEffect(() => {
    if (!view || !base.current || failed.current) return;
    const { sceneId: _scene, revision: _revision, ...saved } = base.current;
    if (JSON.stringify(draft.current) === JSON.stringify(saved)) return;
    const timer = setTimeout(() => void save(), 500);
    return () => clearTimeout(timer);
  }, [view, tick, save]);
  return {
    view,
    change,
    error: error ?? initial.error,
    saving,
    retry: () => {
      if (!base.current) void initial.refetch();
      else void save(true);
    },
  };
}
