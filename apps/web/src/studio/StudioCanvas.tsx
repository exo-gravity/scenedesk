import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Loader, UnstyledButton } from "@mantine/core";
import { useList, type Schema } from "../business/api";
import { CanvasUploads } from "../business/CanvasUploads";
import { taskLabels, useNodeResults } from "./results/useNodeResults";
import { Check } from "@phosphor-icons/react";
import { ReactFlowProvider } from "@xyflow/react";
import { useCanvas } from "../business/use-canvas";
import { useScenePreference } from "../business/use-scene-preference";
import { CanvasRecovery, canvasSaveLabel } from "../business/CanvasRecovery";
import type {
  CanvasController,
  CanvasEditorState,
} from "../business/canvas-controller";
import { ErrorNotice, projectPath, tenantPath } from "../business/common";
import { StudioFrame } from "./StudioFrame";
import { Board } from "./board/Board";
import { Shortcuts } from "./shell/Shortcuts";
import classes from "./studio.module.css";

/**
 * One canvas open in the studio: the engine's controller (document, local
 * recovery, save, undo) and the user's view preference, wired to the board.
 * The studio writes only the preference keys it owns (viewport, selection);
 * the docks own theirs when they arrive.
 */
export function StudioCanvas({
  tenantId,
  projectId,
  canvasId,
  active,
  projectName,
  environment,
}: {
  tenantId: string;
  projectId: string;
  canvasId: string;
  active: boolean;
  projectName: string;
  environment?: string | undefined;
}) {
  const path = projectPath(tenantId, projectId);
  const { controller, state, error, retry } = useCanvas(
    tenantId,
    projectId,
    canvasId,
  );
  const preference = useScenePreference(`${path}/workspace-preference`);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const document = state?.local?.document;
  const readOnly =
    !active ||
    !state ||
    state.accessChecking ||
    !!state.recovery ||
    state.recoveryBlocked ||
    state.phase === "loading" ||
    state.phase === "discarding";
  const selected = useMemo(
    () =>
      (preference.view?.selectedNodeIds ?? []).filter((id) =>
        document?.nodes.some((node) => node.id === id),
      ),
    [preference.view?.selectedNodeIds, document?.nodes],
  );
  const change = preference.change;
  const [retainError, setRetainError] = useState<Error | null>(null);
  // Rule 2: the open input panel registers a "keep the draft" check; the
  // selection only moves on once it passes.
  const retain = useRef<(() => Promise<void>) | undefined>(undefined);
  const registerRetain = useCallback((fn: (() => Promise<void>) | undefined) => {
    retain.current = fn;
  }, []);
  const select = useCallback(
    (ids: string[]) => {
      const guard = retain.current;
      if (!guard) {
        change({ selectedNodeIds: ids });
        return;
      }
      guard()
        .then(() => {
          setRetainError(null);
          change({ selectedNodeIds: ids });
        })
        .catch((cause: unknown) =>
          setRetainError(cause instanceof Error ? cause : new Error("当前输入尚未保留。")),
        );
    },
    [change],
  );
  // Rule 8: generation saves the board first and needs the saved canvas back.
  const save = useCallback(async () => {
    if (!controller) throw new Error("创作台尚未就绪。");
    await controller.save();
    const current = controller.getSnapshot();
    if (
      current.accessChecking ||
      current.phase !== "ready" ||
      current.dirty ||
      current.hasInvalidInput ||
      !current.localSaved ||
      !current.local ||
      current.local.pending ||
      current.recovery ||
      current.recoveryBlocked
    )
      throw new Error("请先完成创作台保存或冲突恢复，再开始生成。");
    return current.local.base;
  }, [controller]);
  const awaitingSave =
    !state ||
    state.phase !== "ready" ||
    state.dirty ||
    !state.localSaved ||
    !!state.local?.pending;
  // Every fixed attempt on this canvas: the cards' task tags and results come from it.
  const attempts = useList<Schema<"CanvasPlanEntry">>(
    `${path}/canvases/${canvasId}/generation-plans`,
    !!state?.local && !state.accessChecking && state.phase !== "forbidden",
  );
  const entries = attempts.data ?? [];
  const running = entries.some(
    (entry) => entry.jobStatus && !["succeeded", "failed", "cancelled"].includes(entry.jobStatus),
  );
  const refetchAttempts = attempts.refetch;
  useEffect(() => {
    if (!running || state?.accessChecking || state?.phase === "forbidden") return;
    const timer = setInterval(() => void refetchAttempts(), 5000);
    return () => clearInterval(timer);
  }, [running, state?.accessChecking, state?.phase, refetchAttempts]);
  const results = useNodeResults({ tenantId, projectId, attempts: entries });
  const tasks = useMemo(() => taskLabels(entries), [entries]);
  const afterPlacement = useCallback(async () => {
    await controller?.refresh();
    await refetchAttempts();
    const current = controller?.getSnapshot();
    if (!current || current.accessChecking || current.phase === "forbidden")
      throw new Error("当前创作台访问尚未核对。");
  }, [controller, refetchAttempts]);
  const moveViewport = useCallback(
    (viewport: { x: number; y: number; zoom: number }) =>
      change({ viewport }),
    [change],
  );
  const attention =
    !!state &&
    (state.accessChecking ||
      !!state.recovery ||
      state.recoveryBlocked ||
      state.hasInvalidInput ||
      !["ready", "saving", "loading"].includes(state.phase));
  return (
    <StudioFrame
      projectName={projectName}
      environment={environment}
      status={
        controller && state ? (
          <SaveStatus controller={controller} state={state} readOnly={readOnly} />
        ) : null
      }
    >
      <main className={classes.board} aria-label="创作台">
        {!controller || !state || !preference.view ? (
          <div className={classes.center}>
            <ErrorNotice error={error} retry={retry} />
            <ErrorNotice error={preference.error} retry={preference.retry} />
            {!error && <Loader aria-label="正在读取创作台" />}
          </div>
        ) : (
          <ReactFlowProvider>
            {(attention || !active || preference.error || retainError) && (
              <section className={classes.notice} aria-label="创作台状态">
                <ErrorNotice error={retainError} />
                {!active && (
                  <Alert title="只读项目">
                    项目已归档，可继续查看原有创作台。
                  </Alert>
                )}
                <ErrorNotice
                  error={preference.error}
                  retry={preference.retry}
                  retryLabel="重新保存本页视图"
                />
                {attention && (
                  <CanvasRecovery
                    controller={controller}
                    state={state}
                    retry={retry}
                    selectNode={(id) => select([id])}
                  />
                )}
              </section>
            )}
            {document && (
              <CanvasUploads
                controller={controller}
                tenantId={tenantId}
                projectId={projectId}
                canvasId={canvasId}
                readOnly={readOnly}
              >
                <Board
                  controller={controller}
                  document={document}
                  readOnly={readOnly}
                  selected={selected}
                  onSelect={select}
                  viewport={preference.view.viewport}
                  onViewport={moveViewport}
                  mediaPath={tenantPath(tenantId)}
                  onShortcuts={() => setShortcutsOpen(true)}
                  attempts={entries}
                  results={results}
                  tasks={tasks}
                  generation={{
                    tenantId,
                    projectId,
                    canvasId,
                    sceneId: undefined,
                    active,
                    awaitingSave,
                    save,
                    afterPlacement,
                    registerRetain,
                  }}
                />
              </CanvasUploads>
            )}
            <Shortcuts
              opened={shortcutsOpen}
              onClose={() => setShortcutsOpen(false)}
            />
          </ReactFlowProvider>
        )}
      </main>
    </StudioFrame>
  );
}

/** Where the work stands, in the top bar; a click saves now. */
function SaveStatus({
  controller,
  state,
  readOnly,
}: {
  controller: CanvasController;
  state: CanvasEditorState;
  readOnly: boolean;
}) {
  const label = canvasSaveLabel(state);
  const settled = label === "已保存";
  return (
    <UnstyledButton
      className={classes.status}
      data-settled={settled || undefined}
      aria-label={`创作台保存状态：${label}`}
      title="立即保存"
      disabled={readOnly || state.phase === "conflict" || state.phase === "saving"}
      onClick={() => void controller.save()}
    >
      <Check size={14} aria-hidden />
      <span role="status" aria-live="polite">
        {label}
      </span>
    </UnstyledButton>
  );
}
