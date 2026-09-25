import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Loader, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { ListChecks, Sparkle } from "@phosphor-icons/react";
import { useList, useSession, type Schema } from "../business/api";
import {
  retainProjectAssistantDrafts,
  retryProjectAssistantRetention,
} from "../business/assistant-lifecycle";
import { useProjectNavigationGuard } from "../business/project-navigation-guard";
import { CanvasUploads } from "../business/CanvasUploads";
import { CanvasAssistant } from "../business/CanvasAssistant";
import { SceneTaskPanel, type SceneTaskView } from "../business/SceneTaskPanel";
import { CanvasNavigator } from "../business/SceneNavigator";
import { taskLabels, useNodeResults } from "./results/useNodeResults";
import { AttemptBrowser } from "./results/History";
import { Dock, type DockMode } from "./dock/Dock";
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
  sceneId,
  canvasLabel,
  projectAspect,
  content,
  active,
  projectName,
  environment,
  base,
  menu,
  account,
  focusNodeId,
}: {
  tenantId: string;
  projectId: string;
  canvasId: string;
  /** The scene this canvas belongs to; absent for the project canvas. */
  sceneId: string | undefined;
  canvasLabel: string;
  projectAspect: { width: number; height: number };
  content: Schema<"ContentTree"> | undefined;
  active: boolean;
  projectName: string;
  environment?: string | undefined;
  base: string;
  menu?: ReactNode;
  account?: ReactNode;
  /** A card named in the address (`?node=`): selected and brought into view once. */
  focusNodeId?: string | undefined;
}) {
  const path = projectPath(tenantId, projectId);
  const { controller, state, error, retry } = useCanvas(
    tenantId,
    projectId,
    canvasId,
  );
  // A scene canvas keeps its own view preference, as the old scene page did;
  // the project canvas must not inherit a scene's viewport or selection.
  const preference = useScenePreference(
    sceneId ? `${path}/scenes/${encodeURIComponent(sceneId)}/workspace-preference` : `${path}/workspace-preference`,
  );
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Leaving the studio through an in-app link waits for the open panel's
  // draft, the project's assistant drafts and the view preference, the same
  // barrier the old canvas page had; the shell routes link clicks here.
  const session = useSession(),
    guard = useProjectNavigationGuard();
  const [navigationError, setNavigationError] = useState<Error | null>(null);
  const navigationLock = useRef(false),
    pendingDestination = useRef<string | null>(null);
  // Docks: the assistant's open state is the view preference the studio owns; tasks are per visit.
  const [tasksOpen, setTasksOpen] = useState(false);
  const [taskView, setTaskView] = useState<SceneTaskView | null>(null);
  const [taskPlan, setTaskPlan] = useState<string>();
  const [assistantMode, setAssistantMode] = useState<DockMode>("docked");
  const [tasksMode, setTasksMode] = useState<DockMode>("docked");
  const compact = useMediaQuery("(max-width: 1000px)");
  const [assistantContext, setAssistantContext] = useState<{ nodeIds: string[]; nonce: number }>();
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
  const navigate = useCallback(
    async (destination: string, recheck = false) => {
      if (navigationLock.current) throw new Error("正在保留当前编辑，请稍候。");
      navigationLock.current = true;
      setNavigationError(null);
      pendingDestination.current = destination;
      const partition = { sessionId: session.id, userId: session.userId, tenantId, projectId };
      try {
        if (recheck) await retryProjectAssistantRetention(partition);
        await retain.current?.();
        await retainProjectAssistantDrafts(partition);
        await preference.flush();
        // New input may arrive while asynchronous retention is running.
        await retain.current?.();
        await retainProjectAssistantDrafts(partition);
        location.hash = destination;
        pendingDestination.current = null;
      } catch (cause) {
        const failure = cause instanceof Error ? cause : new Error("当前编辑尚未保留，页面仍留在原处。");
        setNavigationError(failure);
        throw failure;
      } finally {
        navigationLock.current = false;
      }
    },
    [session.id, session.userId, tenantId, projectId, preference.flush],
  );
  useEffect(() => {
    guard.current = navigate;
    return () => {
      if (guard.current === navigate) guard.current = undefined;
    };
  }, [guard, navigate]);
  // Rule 8: generation saves the board first and needs the saved canvas back.
  // A placement review asks for a refresh first, so a board changed elsewhere
  // is adopted (or surfaces as a conflict) before the position is computed.
  const save = useCallback(async (options?: { refresh?: boolean }) => {
    if (!controller) throw new Error("创作台尚未就绪。");
    if (options?.refresh) await controller.refresh();
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
  const setAssetPanel = useCallback(
    (open: boolean) => change({ assetPanelOpen: open }),
    [change],
  );
  const setAssistant = useCallback(
    (open: boolean) => {
      if (open) setTasksOpen(false);
      change({ assistantOpen: open });
    },
    [change],
  );
  const assistantOpen = !!preference.view?.assistantOpen;
  const assistantVisible = assistantOpen && !tasksOpen;
  const docked = !compact && ((tasksOpen && tasksMode === "docked") || (assistantVisible && assistantMode === "docked"));
  const titles = useMemo(
    () => Object.fromEntries((document?.nodes ?? []).map((node) => [node.id, node.title])),
    [document?.nodes],
  );
  // The address can name a card (from the script view's "进入画布"): select it once it exists.
  const focused = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!focusNodeId || focused.current === focusNodeId || !document?.nodes.some((node) => node.id === focusNodeId) || !preference.view)
      return;
    focused.current = focusNodeId;
    change({ selectedNodeIds: [focusNodeId] });
  }, [focusNodeId, document?.nodes, preference.view, change]);
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
      view="canvas"
      base={base}
      menu={menu}
      account={account}
      canvasSwitch={
        content ? (
          <span className={classes.canvasSwitch}>
            <CanvasNavigator
              content={content}
              sceneId={sceneId}
              canCreate={active}
              onSelect={(next) => {
                void navigate(next ? `${base}?scene=${encodeURIComponent(next)}` : base).catch(() => {});
              }}
              onDirectory={() => {
                void navigate(`#/app/t/${tenantId}/p/${projectId}/content`).catch(() => {});
              }}
              onCreate={() => {
                void navigate(`#/app/t/${tenantId}/p/${projectId}/content?create=scene`).catch(() => {});
              }}
            />
          </span>
        ) : null
      }
      tools={
        <>
          <UnstyledButton
            className={classes.tool}
            aria-label="任务"
            aria-pressed={tasksOpen}
            onClick={() => setTasksOpen((open) => !open)}
          >
            <ListChecks size={16} aria-hidden />
            <span>任务</span>
          </UnstyledButton>
          <UnstyledButton
            className={classes.tool}
            aria-label="助手"
            aria-pressed={assistantVisible}
            onClick={() => setAssistant(!assistantVisible)}
          >
            <Sparkle size={16} aria-hidden />
            <span>助手</span>
          </UnstyledButton>
        </>
      }
      status={
        controller && state ? (
          <SaveStatus controller={controller} state={state} readOnly={readOnly} />
        ) : null
      }
    >
      <main
        className={classes.board}
        aria-label="创作台"
        data-dock={docked ? "docked" : undefined}
      >
        {!controller || !state || !preference.view ? (
          <div className={classes.center}>
            <ErrorNotice error={error} retry={retry} />
            <ErrorNotice error={preference.error} retry={preference.retry} />
            {!error && <Loader aria-label="正在读取创作台" />}
          </div>
        ) : (
          <ReactFlowProvider>
            {(attention || !active || preference.error || retainError || navigationError) && (
              <section className={classes.notice} aria-label="创作台状态">
                <ErrorNotice error={retainError} />
                <ErrorNotice
                  error={navigationError}
                  retryLabel="重试保留并离开"
                  retry={() => {
                    const destination = pendingDestination.current;
                    if (destination) void navigate(destination, true).catch(() => {});
                  }}
                />
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
                  projectAspect={projectAspect}
                  docked={docked}
                  viewport={preference.view.viewport}
                  onViewport={moveViewport}
                  mediaPath={tenantPath(tenantId)}
                  onShortcuts={() => setShortcutsOpen(true)}
                  attempts={entries}
                  results={results}
                  tasks={tasks}
                  assetPanelOpen={preference.view.assetPanelOpen}
                  onAssetPanel={setAssetPanel}
                  focusNodeId={focusNodeId}
                  scriptHref={(revisionId) => `${base}/script?revision=${revisionId}`}
                  shotsHref={(mediaId) => `${base}/shots?media=${mediaId}`}
                  onAssistantContext={(nodeIds) => {
                    setAssistantContext({ nodeIds, nonce: Date.now() });
                    if (!assistantVisible) setAssistant(true);
                  }}
                  generation={{
                    tenantId,
                    projectId,
                    canvasId,
                    sceneId,
                    active,
                    awaitingSave,
                    save,
                    afterPlacement,
                    registerRetain,
                  }}
                />
                {tasksOpen && (
                  <Dock label="任务" title={`任务 · ${canvasLabel}`} mode={compact ? "floating" : tasksMode} onMode={compact ? undefined : setTasksMode} onClose={() => setTasksOpen(false)}>
                    <SceneTaskPanel view={taskView} onChange={setTaskView}>
                      <AttemptBrowser tenantId={tenantId} attempts={entries} titles={titles} planId={taskPlan} onPlan={setTaskPlan} />
                    </SceneTaskPanel>
                  </Dock>
                )}
                {assistantOpen && (
                  <Dock label="助手" title="助手" chromeless hidden={!assistantVisible} mode={compact ? "floating" : assistantMode} onMode={compact ? undefined : setAssistantMode} onClose={() => setAssistant(false)}>
                    <CanvasAssistant
                      tenantId={tenantId}
                      projectId={projectId}
                      sceneId={sceneId}
                      controller={controller}
                      active={active && !readOnly}
                      visible={assistantVisible}
                      requestedContext={assistantContext}
                      onEditDraft={async (nodeId) => {
                        const target = controller.getSnapshot().local?.document.nodes.find((node) => node.id === nodeId);
                        if (target?.content.type !== "draft")
                          throw new Error("原草稿已移除或改变，请在创作台中核对。助手建议仍保留。");
                        select([nodeId]);
                      }}
                    />
                  </Dock>
                )}
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
