import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Alert,
  ActionIcon,
  Button,
  Group,
  Loader,
  Popover,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import {
  ArrowLeft,
  ClockCounterClockwise,
  Images,
  FilmStrip,
  DotsThree,
  Sparkle,
  Check,
  Moon,
  Sun,
  CaretRight,
} from "@phosphor-icons/react";
import type { CanvasNode } from "@drama/domain";
import {
  api,
  ApiError,
  useCommand,
  useList,
  usePages,
  useResource,
  useSession,
  type Schema,
} from "./api";
import { projectPath, tenantPath, Empty, ErrorNotice } from "./common";
import CandidateWorkspace from "./CandidateWorkspace";
import { useScenePreference } from "./use-scene-preference";
import { useCanvas } from "./use-canvas";
import { useCanvasNodePreview } from "./use-canvas-node-preview";
import { EditingPresence } from "./EditingPresence";
import { CanvasBoard } from "./CanvasBoard";
import { CanvasGenerationBatch } from "./CanvasGenerationBatch";
import { CanvasUploads } from "./CanvasUploads";
import {
  SceneTaskPanel,
  SceneTasksButton,
  type SceneTaskView,
} from "./SceneTaskPanel";
import { SceneAssistant } from "./SceneAssistant";
import { CanvasNavigator } from "./SceneNavigator";
import { useProjectNavigationGuard } from "./project-navigation-guard";
import { canvasLocationHref, rememberCanvas } from "./canvas-navigation";
import {
  retainProjectAssistantDrafts,
  retryProjectAssistantRetention,
} from "./assistant-lifecycle";
import { CanvasAssistant } from "./CanvasAssistant";
import { AssistantProposal } from "./AssistantProposal";
import { CanvasShotConnections } from "./CanvasShotConnections";
import { ShotListLauncher } from "./ShotListWorkspace";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CanvasEntryDetails } from "./CanvasEntryDetails";
import { CanvasRecovery, canvasSaveLabel } from "./CanvasRecovery";
import { MediaPreview } from "./MediaPreview";
import type { CanvasController } from "./canvas-controller";
import { CanvasImageGeneration } from "./CanvasImageGeneration";
import { jobStatusLabel } from "./assistant-session";
import { retainCanvasEditing } from "./canvas-edit-handoff";
import classes from "./canvas.module.css";
import layout from "./scene-production.module.css";

type Preference = Schema<"SaveSceneWorkspacePreference">;
export default function SceneProductionWorkspace({
  tenantId,
  projectId,
}: {
  tenantId: string;
  projectId: string;
}) {
  const query = new URLSearchParams(location.hash.split("?")[1]),
    sceneId = query.get("scene");
  return sceneId ? (
    <SceneWorkspace
      key={`${tenantId}:${projectId}:${sceneId}`}
      tenantId={tenantId}
      projectId={projectId}
      sceneId={sceneId}
      explicitMode={query.get("mode")}
    />
  ) : (
    <CandidateWorkspace tenantId={tenantId} projectId={projectId} />
  );
}
function SceneWorkspace({
  tenantId,
  projectId,
  sceneId,
  explicitMode,
}: {
  tenantId: string;
  projectId: string;
  sceneId: string;
  explicitMode: string | null;
}) {
  const path = projectPath(tenantId, projectId),
    base = `#/app/t/${tenantId}/p/${projectId}`;
  const session = useSession();
  const guard = useProjectNavigationGuard();
  const project = useResource<Schema<"Project">>(path),
    content = useResource<Schema<"ContentTree">>(`${path}/content`);
  const canvas = useResource<Schema<"SceneCanvas">>(
      `${path}/scenes/${sceneId}/canvas`,
    ),
    create = useCommand<Schema<"SceneCanvas">>();
  const preference = useScenePreference(
    `${path}/scenes/${sceneId}/workspace-preference`,
  );
  const beforeLeave = useRef<(() => Promise<void>) | undefined>(undefined);
  const registerBeforeLeave = useCallback(
    (retain: (() => Promise<void>) | undefined) => {
      beforeLeave.current = retain;
    },
    [],
  );
  const [navigating, setNavigating] = useState(false);
  const navigationLock = useRef(false);
  const pendingDestination = useRef<string | null>(null);
  const [navigationError, setNavigationError] = useState<Error | null>(null);
  const mode: Preference["mode"] =
    explicitMode === "canvas" || explicitMode === "storyboard"
      ? explicitMode
      : "canvas";
  useEffect(() => {
    if (preference.view && preference.view.mode !== mode)
      preference.change({ mode });
  }, [mode, preference.view?.mode, preference.change]);
  const scene = content.data?.scenes.find((s) => s.id === sceneId),
    episode = content.data?.episodes.find((e) => e.id === scene?.episodeId);
  useEffect(() => {
    document.title = `${project.isError || content.isError ? "场次不可访问" : (scene?.title ?? "场次")} · 画布 · SceneDesk`;
  }, [scene?.title, project.isError, content.isError]);
  const active =
    project.data?.status === "active" &&
    scene?.status === "active" &&
    episode?.status === "active";
  const missing =
    canvas.error instanceof ApiError &&
    canvas.error.code === "SCENE_CANVAS_NOT_CREATED";
  const canvasId = canvas.data?.canvas.id ?? create.data?.canvas.id;
  const navigate = useCallback(
    async (destination: string, recheck = false) => {
      if (navigationLock.current) throw new Error("正在保留当前编辑，请稍候。");
      navigationLock.current = true;
      setNavigating(true);
      setNavigationError(null);
      pendingDestination.current = destination;
      try {
        if (recheck)
          await retryProjectAssistantRetention({
            sessionId: session.id,
            userId: session.userId,
            tenantId,
            projectId,
          });
        await beforeLeave.current?.();
        await retainProjectAssistantDrafts({
          sessionId: session.id,
          userId: session.userId,
          tenantId,
          projectId,
        });
        await preference.flush();
        await beforeLeave.current?.();
        await retainProjectAssistantDrafts({
          sessionId: session.id,
          userId: session.userId,
          tenantId,
          projectId,
        });
        location.hash = destination;
        pendingDestination.current = null;
      } catch (cause) {
        const error =
          cause instanceof Error
            ? cause
            : new Error("当前编辑尚未保留，页面仍留在原处。");
        setNavigationError(error);
        throw error;
      } finally {
        navigationLock.current = false;
        setNavigating(false);
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
  useEffect(() => {
    if (
      canvasId &&
      !canvas.isError &&
      !project.isError &&
      !content.isError &&
      scene?.status === "active" &&
      episode?.status === "active"
    )
      rememberCanvas(session, tenantId, projectId, sceneId);
  }, [
    canvasId,
    canvas.isError,
    project.isError,
    content.isError,
    scene?.status,
    episode?.status,
    session,
    tenantId,
    projectId,
    sceneId,
  ]);
  const switchMode = (next: Preference["mode"]) => {
    if (next === mode) return;
    const query = new URLSearchParams(location.hash.split("?")[1]);
    query.set("scene", sceneId);
    query.set("mode", next);
    void navigate(`${base}/production?${query}`).catch(() => {});
  };
  if (project.error || content.error)
    return (
      <Stack p="md">
        <Button
          component="a"
          href={`${base}/content`}
          variant="subtle"
          leftSection={<ArrowLeft size={16} />}
        >
          返回场次目录
        </Button>
        <ErrorNotice
          error={project.error ?? content.error}
          retry={() => {
            void project.refetch();
            void content.refetch();
          }}
        />
      </Stack>
    );
  if (!project.data || !content.data || !preference.view)
    return (
      <Stack>
        <Button
          component="a"
          href={`${base}/content`}
          variant="subtle"
          leftSection={<ArrowLeft size={16} />}
        >
          返回场次目录
        </Button>
        <ErrorNotice error={preference.error} retry={preference.retry} />
        <Loader aria-label="正在读取场次工作区" />
      </Stack>
    );
  if (!scene)
    return (
      <Empty>
        <Text>本场次不存在或不属于当前项目。</Text>
        <Button component="a" href={`${base}/content`} mt="md" variant="subtle">
          返回场次目录
        </Button>
      </Empty>
    );
  const view = { ...preference.view, mode };
  const modeTools = (
    <>
      <Group gap="xs" wrap="nowrap" className={layout.contextTools}>
        <Text
          className={layout.projectName}
          size="sm"
          c="dimmed"
          truncate
          title={project.data.name}
        >
          {project.data.name}
        </Text>
        <CaretRight size={14} className={layout.contextDivider} aria-hidden />
        <CanvasNavigator
          content={content.data}
          sceneId={sceneId}
          disabled={navigating}
          canCreate={project.data.status === "active"}
          onSelect={(id) => navigate(canvasLocationHref(base, id))}
          onDirectory={() => navigate(`${base}/content`)}
          onCreate={() =>
            navigate(`${base}/content?create=scene&episode=${scene.episodeId}`)
          }
        />
      </Group>
      {mode === "storyboard" && (
        <Group
          gap="xs"
          wrap="nowrap"
          className={layout.legacyNavigation}
          aria-label="旧分镜工作区导航"
        >
          <Text size="xs" c="dimmed">
            旧分镜工作区
          </Text>
          <Button
            size="xs"
            variant="subtle"
            disabled={navigating}
            onClick={() => switchMode("canvas")}
          >
            返回画布
          </Button>
        </Group>
      )}
    </>
  );
  return (
    <div className={classes.workspace} data-scene-workspace>
      {navigationError && (
        <Alert
          role="alert"
          title="暂未切换页面"
          className={layout.navigationNotice}
        >
          <Group justify="space-between" gap="sm">
            <Text size="sm">{navigationError.message}</Text>
            <Group gap="xs">
              <Button
                size="xs"
                variant="subtle"
                onClick={() => {
                  pendingDestination.current = null;
                  setNavigationError(null);
                }}
              >
                留在当前页
              </Button>
              <Button
                size="xs"
                loading={navigating}
                onClick={() => {
                  if (pendingDestination.current)
                    void navigate(pendingDestination.current, true).catch(
                      () => {},
                    );
                }}
              >
                重新核对并切换
              </Button>
            </Group>
          </Group>
        </Alert>
      )}
      <ErrorNotice
        error={preference.error}
        retry={preference.retry}
        retryLabel="重新保存本页视图"
      />
      {!active && (
        <Alert title="只读场次">项目或场次已归档，可继续查看原有内容。</Alert>
      )}
      {canvasId && !canvas.isError ? (
        <SceneCanvasSession
          tenantId={tenantId}
          projectId={projectId}
          sceneId={sceneId}
          sceneTitle={scene.title}
          canvasId={canvasId}
          preference={view}
          changePreference={preference.change}
          active={active}
          toolbar={modeTools}
          registerBeforeLeave={registerBeforeLeave}
          navigating={navigating}
          onNavigate={navigate}
        />
      ) : mode === "storyboard" ? (
        <SceneWithoutCanvasAssistant
          tenantId={tenantId}
          projectId={projectId}
          sceneId={sceneId}
          sceneTitle={scene.title}
          active={active}
          open={view.assistantOpen}
          changeOpen={(assistantOpen) => preference.change({ assistantOpen })}
          toolbar={modeTools}
          onNavigate={navigate}
        />
      ) : (
        <Stack>
          <div className={layout.header}>
            {modeTools}
            <div className={layout.headerActions}>
              <SceneAppearanceControls />
            </div>
          </div>
          {missing ? (
            <Empty>
              <Text fw={600}>本场的自由画布还未创建</Text>
              <Text>创建后，文字、素材和创作草稿都保存在这一张画布中。</Text>
              <Button
                mt="md"
                variant="filled"
                disabled={!active}
                loading={create.isPending}
                onClick={() =>
                  create.mutate({ path: `${path}/scenes/${sceneId}/canvas` })
                }
              >
                创建本场画布
              </Button>
            </Empty>
          ) : canvas.isPending ? (
            <Loader aria-label="正在读取场次画布" />
          ) : (
            <ErrorNotice
              error={canvas.error}
              retry={() => void canvas.refetch()}
            />
          )}
          <ErrorNotice error={create.error} />
        </Stack>
      )}
    </div>
  );
}
export function SceneCanvasSession({
  tenantId,
  projectId,
  canvasId,
  sceneId,
  sceneTitle,
  preference,
  changePreference,
  active,
  toolbar,
  registerBeforeLeave,
  navigating,
  onNavigate,
}: {
  tenantId: string;
  projectId: string;
  canvasId: string;
  sceneId: string | undefined;
  sceneTitle: string;
  preference: Preference;
  changePreference: (patch: Partial<Preference>) => void;
  active: boolean;
  toolbar: ReactNode;
  registerBeforeLeave: (retain: (() => Promise<void>) | undefined) => void;
  navigating: boolean;
  onNavigate: (destination: string) => Promise<void>;
}) {
  const { controller, state, error, retry } = useCanvas(
      tenantId,
      projectId,
      canvasId,
    ),
    [dock, setDock] = useState<
      "media" | "history" | "assistant" | "shots" | "results" | null
    >(
      preference.assetPanelOpen
        ? "media"
        : preference.assistantOpen
          ? "assistant"
          : null,
    );
  const [assistantProposalId, setAssistantProposalId] = useState<string>();
  const [editingNodeId, setEditingNodeId] = useState<string>();
  /** Nodes the user asked to review as one batch; nothing is submitted by this. */
  const [batchReview, setBatchReview] = useState<string[] | undefined>();
  const [focusMode, setFocusMode] = useState(false);
  const canvasSessionAlive = useRef(true);
  useEffect(() => {
    canvasSessionAlive.current = true;
    return () => {
      canvasSessionAlive.current = false;
    };
  }, []);
  const [assistantContext, setAssistantContext] = useState<{
    nodeIds: string[];
    nonce: number;
  }>();
  const [inspectedPlanId, setInspectedPlanId] = useState<string>();
  const [taskView, setTaskView] = useState<SceneTaskView | null>(null);
  const inspectPlan = (planId: string) => {
    setInspectedPlanId(planId);
    setTaskView("generation");
  };
  const [assistantView, setAssistantView] = useState<"canvas" | "scene">(
    "canvas",
  );
  const assistantChatSlot = useRef<HTMLDivElement>(null);
  const storyboardTaskTitle = useRef<HTMLParagraphElement>(null);
  const switchAssistantView = (next: "canvas" | "scene") => {
    setAssistantView(next);
    requestAnimationFrame(() => {
      const target =
        next === "canvas"
          ? assistantChatSlot.current?.querySelector<HTMLTextAreaElement>(
              'textarea[aria-label="发送给画布助手"]',
            )
          : storyboardTaskTitle.current;
      if (
        target?.isConnected &&
        !target.closest("[hidden], [inert]") &&
        !target.matches(":disabled")
      )
        target.focus({ preventScroll: true });
    });
  };
  const [moreOpen, setMoreOpen] = useState(false);
  const auxiliaryOpener = useRef<HTMLElement | null>(null);
  const auxiliaryFallback = useRef<HTMLButtonElement>(null);
  const retainGenerationDraft = useRef<(() => Promise<void>) | undefined>(
    undefined,
  );
  const registerGenerationDraft = useCallback(
    (retain: (() => Promise<void>) | undefined) => {
      retainGenerationDraft.current = retain;
    },
    [],
  );
  useEffect(() => {
    registerBeforeLeave(async () => {
      await retainGenerationDraft.current?.();
      if (!controller) return;
      await controller.retryLocal();
      const current = controller.getSnapshot();
      if (
        current.local &&
        !current.localSaved &&
        !current.recovery &&
        !current.recoveryBlocked
      )
        throw (
          current.storageError ??
          new Error("画布输入尚未保留到本机，请先处理保存问题。")
        );
    });
    return () => registerBeforeLeave(undefined);
  }, [controller, registerBeforeLeave]);
  const mediaPath = tenantPath(tenantId),
    path = projectPath(tenantId, projectId);
  const cache = useQueryClient(),
    session = useSession();
  const connections = useResource<Schema<"SceneCanvas">>(
    `${path}/scenes/${sceneId}/canvas`,
    !!sceneId,
  );
  const content = useResource<Schema<"ContentTree">>(`${path}/content`);
  const attempts = useList<Schema<"CanvasPlanEntry">>(
    `${path}/canvases/${canvasId}/generation-plans`,
    preference.mode === "canvas" &&
      !!state?.local &&
      !state.accessChecking &&
      state.phase !== "forbidden",
  );
  const runningAttempts = attempts.data?.some(
    (entry) =>
      entry.jobStatus &&
      !["succeeded", "failed", "cancelled"].includes(entry.jobStatus),
  );
  const nodePreviewMediaIds = useCanvasNodePreview({
    tenantId,
    projectId,
    editingNodeId,
    attempts: attempts.data ?? [],
  });
  useEffect(() => {
    if (
      !runningAttempts ||
      preference.mode !== "canvas" ||
      state?.accessChecking ||
      state?.phase === "forbidden"
    )
      return;
    const timer = setInterval(() => {
      void attempts.refetch();
    }, 5000);
    return () => clearInterval(timer);
  }, [
    runningAttempts,
    preference.mode,
    state?.accessChecking,
    state?.phase,
    attempts.refetch,
  ]);
  const nodeAttemptLabels: Record<string, string> = {};
  for (const entry of [...(attempts.data ?? [])].sort((a, b) =>
    (b.plan.createdAt ?? "").localeCompare(a.plan.createdAt ?? ""),
  )) {
    if (nodeAttemptLabels[entry.origin.nodeId]) continue;
    nodeAttemptLabels[entry.origin.nodeId] = entry.jobStatus
      ? entry.jobStatus === "succeeded"
        ? "成果已就绪"
        : jobStatusLabel[entry.jobStatus]
      : entry.jobId
        ? "任务已受理"
        : {
            ready: "待确认",
            blocked: "需要补充输入",
            expired: "计划已过期",
            consumed: "计划已使用",
          }[entry.plan.status];
  }
  const [bindingTarget, setBindingTarget] = useState<CanvasNode | null>(null);
  /**
   * Open the linkage form for a generated result, with the candidate purpose and
   * the whole fixed interval already filled in. The shot is left for the user: a
   * result node's identity is not the draft the plan was prepared from, so nothing
   * here says which shot the clip belongs to, and guessing it is the mistake this
   * flow exists to avoid. This only opens the form — the candidate is created when
   * that form is submitted.
   */
  const registerCandidate = (nodeId: string) => {
    const node = state?.local?.document.nodes.find((n) => n.id === nodeId);
    if (!node || node.content.type !== "media") return;
    // The shot is deliberately left unset. A result node's id is not the draft the
    // plan was prepared from, so there is nothing here to derive it from, and
    // guessing which shot a clip belongs to is exactly the mistake this flow is
    // meant to avoid. The role and the interval are pre-filled instead.
    setBindingSeed({ shotId: "", shotRevisionId: "", fullCandidate: true });
    setBindingTarget(node);
    if (dock !== "shots") selectDock("shots");
  };
  const [bindingSeed, setBindingSeed] = useState<{
    shotId: string;
    shotRevisionId: string;
    take?: Schema<"Take">;
    fullCandidate?: boolean;
  }>();
  const [bindingBusy, setBindingBusy] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{
    ids: string[];
    nonce: number;
  }>();
  const entryFocus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const nodeId = new URLSearchParams(location.hash.split("?")[1]).get("node");
    if (
      !nodeId ||
      entryFocus.current === nodeId ||
      state?.phase !== "ready" ||
      !state.local?.document.nodes.some((node) => node.id === nodeId)
    )
      return;
    entryFocus.current = nodeId;
    changePreference({ selectedNodeIds: [nodeId], mode: "canvas" });
    setFocusRequest({ ids: [nodeId], nonce: Date.now() });
  }, [state?.phase, state?.local?.document, changePreference]);
  const focusCompleted = useCallback((nonce: number) => {
    setFocusRequest((current) =>
      current?.nonce === nonce ? undefined : current,
    );
  }, []);
  useEffect(() => {
    if (sceneId && state?.local?.base.revision !== undefined)
      void cache.invalidateQueries({
        queryKey: ["user", session.userId, `${path}/scenes/${sceneId}/canvas`],
      });
  }, [state?.local?.base.revision, cache, session.userId, path, sceneId]);
  const changedConnections = async () => {
    await controller?.refresh();
    await Promise.all([connections.refetch(), content.refetch()]);
  };
  const focusNodes = (ids: string[]) => {
    // The requested focus already consumes this entry target. Otherwise the
    // next document edit could replay it and unexpectedly leave focus editing.
    entryFocus.current = ids.length === 1 ? ids[0] : undefined;
    changePreference({ selectedNodeIds: ids, mode: "canvas" });
    setFocusRequest({ ids, nonce: Date.now() });
    const query = new URLSearchParams(location.hash.split("?")[1]);
    query.set("mode", "canvas");
    // An explicit focus supersedes an old entry link. Keep a single-node link
    // refreshable; a multi-node focus stays in the saved selection preference.
    if (ids.length === 1) query.set("node", ids[0]!);
    else query.delete("node");
    location.hash = `${location.hash.split("?")[0]}?${query}`;
  };
  const editBinding = (node: CanvasNode | null) => {
    setBindingTarget(node);
    setBindingSeed(undefined);
    if (dock !== "shots") selectDock("shots");
  };
  const selectDock = (next: typeof dock) => {
    const value = next === dock ? null : next;
    setMoreOpen(false);
    if (value && !dock)
      auxiliaryOpener.current =
        window.document.activeElement instanceof HTMLElement
          ? window.document.activeElement
          : null;
    setDock(value);
    changePreference({
      assetPanelOpen: value === "media",
      assistantOpen: value === "assistant",
    });
    if (!value)
      requestAnimationFrame(() => {
        const target = auxiliaryOpener.current;
        if (target?.isConnected && !target.closest("[inert], [hidden]"))
          target.focus();
        else auxiliaryFallback.current?.focus();
      });
  };
  const selectNode = (id: string) => {
    changePreference({ selectedNodeIds: [id], mode: "canvas" });
    const query = new URLSearchParams(location.hash.split("?")[1]);
    query.set("mode", "canvas");
    location.hash = `${location.hash.split("?")[0]}?${query}`;
  };
  if (error) return <ErrorNotice error={error} retry={retry} />;
  if (!controller || !state)
    return <Loader aria-label="正在核对画布和本机副本" />;
  if (state.phase === "forbidden" || state.accessChecking)
    return (
      <CanvasRecovery
        controller={controller}
        state={state}
        retry={retry}
        selectNode={selectNode}
      />
    );
  const document = state.local?.document;
  const selectedContent =
    preference.selectedNodeIds.length === 1
      ? document?.nodes.find(
          (node) => node.id === preference.selectedNodeIds[0],
        )?.content
      : undefined;
  const readOnly =
    !active ||
    bindingBusy ||
    state.accessChecking ||
    !!state.recovery ||
    state.recoveryBlocked ||
    state.phase === "loading" ||
    state.phase === "discarding";
  const addMedia = (media: Schema<"Media">, assetRevisionId?: string) => {
    if (
      !document ||
      readOnly ||
      media.kind === "document" ||
      media.status !== "ready"
    )
      return;
    const node: CanvasNode = {
      id: crypto.randomUUID(),
      title: media.displayName.slice(0, 160) || "素材",
      kind: media.kind,
      width: 360,
      position: {
        x: -preference.viewport.x / preference.viewport.zoom + 80,
        y: -preference.viewport.y / preference.viewport.zoom + 80,
      },
      content: {
        type: "media",
        mediaId: media.id,
        ...(assetRevisionId ? { assetRevisionId } : {}),
      },
    };
    controller.change({ ...document, nodes: [...document.nodes, node] });
    changePreference({ selectedNodeIds: [node.id] });
    return node;
  };
  return (
    <CanvasUploads
      controller={controller}
      tenantId={tenantId}
      projectId={projectId}
      canvasId={canvasId}
      readOnly={readOnly}
    >
      <div className={classes.session}>
        <header
          className={layout.header}
          inert={focusMode || navigating || undefined}
        >
          {toolbar}
          <Group gap="xs" wrap="nowrap" className={layout.headerActions}>
            <Popover width={280} position="bottom-end">
              <Popover.Target>
                <Button
                  variant="subtle"
                  size="xs"
                  className={classes.saveStatus}
                  hidden={preference.mode !== "canvas"}
                  aria-label={`画布保存状态：${canvasSaveLabel(state)}`}
                  leftSection={<Check size={14} />}
                >
                  <span role="status" aria-live="polite">
                    {canvasSaveLabel(state)}
                  </span>
                </Button>
              </Popover.Target>
              <Popover.Dropdown>
                <Stack gap="xs">
                  <Text size="sm">画布 · {canvasSaveLabel(state)}</Text>
                  <Text size="xs" c="dimmed">
                    {state.local
                      ? `服务器版本 ${state.local.base.revision}`
                      : "正在读取服务器版本"}
                  </Text>
                  <Button
                    size="xs"
                    disabled={readOnly || state.phase === "conflict"}
                    loading={state.phase === "saving"}
                    onClick={() => void controller.save()}
                  >
                    保存画布
                  </Button>
                </Stack>
              </Popover.Dropdown>
            </Popover>
            <Group gap={4} wrap="nowrap" className={layout.canvasActions}>
              {preference.mode === "canvas" &&
                (state.dirty ||
                  state.hasInvalidInput ||
                  state.phase === "saving") && (
                  <Button
                    size="xs"
                    className={layout.saveAction}
                    disabled={readOnly || state.phase === "conflict"}
                    loading={state.phase === "saving"}
                    onClick={() => void controller.save()}
                  >
                    保存画布
                  </Button>
                )}
              <ShotListLauncher
                tenantId={tenantId}
                projectId={projectId}
                sceneId={sceneId}
                sourceMediaId={
                  selectedContent?.type === "media"
                    ? selectedContent.mediaId
                    : undefined
                }
                onBeforeOpen={async () => {
                  await retainGenerationDraft.current?.();
                  await controller.retryLocal();
                  const current = controller.getSnapshot();
                  if (
                    current.local &&
                    !current.localSaved &&
                    !current.recovery &&
                    !current.recoveryBlocked
                  )
                    throw (
                      current.storageError ??
                      new Error("画布输入尚未保留到本机，请先处理保存问题。")
                    );
                }}
              />
              <SceneTasksButton
                open={dock === "results"}
                buttonRef={auxiliaryFallback}
                onClick={() => selectDock("results")}
              />
              <Button
                size="xs"
                variant="subtle"
                leftSection={<Images size={16} />}
                aria-pressed={dock === "media"}
                onClick={() => selectDock("media")}
              >
                素材
              </Button>
              <Popover
                width={300}
                position="bottom-end"
                keepMounted
                opened={moreOpen}
                onChange={setMoreOpen}
              >
                <Popover.Target>
                  <ActionIcon
                    size="md"
                    variant="subtle"
                    aria-label="画布恢复与协作"
                    onClick={() => setMoreOpen(!moreOpen)}
                  >
                    <DotsThree size={20} />
                  </ActionIcon>
                </Popover.Target>
                <Popover.Dropdown>
                  <Stack gap="sm">
                    <Button
                      size="xs"
                      variant="subtle"
                      leftSection={<ClockCounterClockwise size={16} />}
                      hidden={preference.mode !== "canvas"}
                      onClick={() => selectDock("history")}
                    >
                      画布恢复历史
                    </Button>
                    <EditingPresence
                      tenantId={tenantId}
                      projectId={projectId}
                      canvasId={canvasId}
                      enabled={
                        !state.accessChecking && state.phase !== "loading"
                      }
                      editing={
                        active &&
                        (state.dirty ||
                          state.hasInvalidInput ||
                          state.phase === "saving")
                      }
                    />
                    <SceneAppearanceControls />
                  </Stack>
                </Popover.Dropdown>
              </Popover>
              <Button
                size="xs"
                leftSection={<Sparkle size={16} />}
                aria-label="AI 助手"
                aria-pressed={dock === "assistant"}
                onClick={() => selectDock("assistant")}
              >
                AI 助手
              </Button>
            </Group>
          </Group>
        </header>
        <CanvasRecovery
          controller={controller}
          state={state}
          retry={retry}
          selectNode={selectNode}
        />
        {state.phase === "loading" || !document ? (
          <Loader aria-label="正在读取画布" />
        ) : (
          <div
            className={layout.body}
            data-mode={preference.mode}
            data-dock={dock || undefined}
            data-focused={focusMode || undefined}
            inert={navigating || undefined}
          >
            <div className={layout.central}>
              {assistantProposalId ? (
                <AssistantProposal
                  path={path}
                  proposalId={assistantProposalId}
                  sceneTitle={sceneTitle}
                  active={active}
                  onClose={() => setAssistantProposalId(undefined)}
                />
              ) : (
                <>
                  <SceneModePanel
                    visible={preference.mode === "canvas"}
                    label="自由画布工作区"
                  >
                    <CanvasBoard
                      controller={controller}
                      document={document}
                      preference={preference}
                      changePreference={changePreference}
                      mediaPath={mediaPath}
                      readOnly={readOnly || bindingBusy}
                      focusRequest={focusRequest}
                      focusCompleted={focusCompleted}
                      editingNodeId={editingNodeId}
                      nodeAttemptLabels={nodeAttemptLabels}
                      {...(nodePreviewMediaIds ? { nodePreviewMediaIds } : {})}
                      onEditNode={setEditingNodeId}
                      beforeEditNodeChange={async () => {
                        await retainGenerationDraft.current?.();
                        return true;
                      }}
                      auxiliaryOpen={!!dock}
                      auxiliaryDocked={dock === "assistant"}
                      onFocusModeChange={setFocusMode}
                      onOpenResults={() => selectDock("results")}
                      onReviewBatch={setBatchReview}
                      onRegisterCandidate={registerCandidate}
                      onAddAssistantContext={(nodeIds) => {
                        setAssistantContext({ nodeIds, nonce: Date.now() });
                        setAssistantView("canvas");
                        if (dock !== "assistant") selectDock("assistant");
                      }}
                      navigation={
                        sceneId ? (
                          <Tooltip label="本场镜头与探索" position="right">
                            <ActionIcon
                              aria-label="本场镜头与探索"
                              variant="subtle"
                              aria-pressed={dock === "shots"}
                              onClick={() => selectDock("shots")}
                            >
                              <FilmStrip size={19} />
                            </ActionIcon>
                          </Tooltip>
                        ) : undefined
                      }
                      generation={
                        <CanvasImageGeneration
                          tenantId={tenantId}
                          projectId={projectId}
                          sceneId={sceneId}
                          controller={controller}
                          mode="editor"
                          onRetainDraft={registerGenerationDraft}
                          selectedNodeId={editingNodeId}
                          onInspectPlan={(planId) => {
                            inspectPlan(planId);
                            if (dock !== "results") selectDock("results");
                          }}
                          readOnly={readOnly}
                          focus={focusNodes}
                        />
                      }
                      nodeActions={
                        sceneId &&
                        preference.selectedNodeIds.length === 1 &&
                        document.nodes.find(
                          (n) => n.id === preference.selectedNodeIds[0],
                        )?.content.type === "media" ? (
                          <Button
                            size="xs"
                            onClick={() =>
                              editBinding(
                                document.nodes.find(
                                  (n) => n.id === preference.selectedNodeIds[0],
                                )!,
                              )
                            }
                          >
                            镜头关联 ·{" "}
                            {connections.data?.bindings.filter(
                              (b) => b.nodeId === preference.selectedNodeIds[0],
                            ).length ?? 0}
                          </Button>
                        ) : undefined
                      }
                      addMedia={() => {
                        if (dock !== "media") selectDock("media");
                      }}
                    />
                    {batchReview && state.local && (
                      <CanvasGenerationBatch
                        tenantId={tenantId}
                        projectId={projectId}
                        {...(sceneId ? { sceneId } : {})}
                        canvasId={state.local.base.id}
                        canvasRevision={state.local.base.revision}
                        document={document}
                        nodeIds={batchReview}
                        readOnly={readOnly || bindingBusy}
                        close={() => setBatchReview(undefined)}
                      />
                    )}
                  </SceneModePanel>
                  {sceneId && (
                    <SceneModePanel
                      visible={preference.mode === "storyboard"}
                      label="分镜台工作区"
                    >
                      <CandidateWorkspace
                        tenantId={tenantId}
                        projectId={projectId}
                        embedded
                        externalDockOpen={!!dock}
                        closeExternalDock={() => selectDock(null)}
                        onNavigate={onNavigate}
                        selectedShotId={preference.selectedShotId}
                        onSelectShot={(selectedShotId) =>
                          changePreference({ selectedShotId })
                        }
                      />
                    </SceneModePanel>
                  )}
                </>
              )}
            </div>
            <aside
              className={`${layout.dock} ${layout.assistantDock}`}
              aria-label="AI 创作助手"
              inert={focusMode || undefined}
              hidden={dock !== "assistant"}
            >
              {assistantView === "scene" && (
                <div
                  className={`${classes.dockHeading} ${layout.dockHeading} ${layout.storyboardTaskHeading}`}
                >
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      leftSection={<ArrowLeft size={14} />}
                      onClick={() => switchAssistantView("canvas")}
                    >
                      返回对话
                    </Button>
                    <Text
                      size="sm"
                      fw={600}
                      role="heading"
                      aria-level={2}
                      tabIndex={-1}
                      ref={storyboardTaskTitle}
                    >
                      分镜建议
                    </Text>
                    <ActionIcon
                      variant="subtle"
                      aria-label="收起 AI 助手"
                      onClick={() => selectDock("assistant")}
                    >
                      <CaretRight size={18} />
                    </ActionIcon>
                  </Group>
                  <Text size="xs" c="dimmed" lineClamp={1} mt={4}>
                    当前场次 · {sceneTitle}
                  </Text>
                </div>
              )}
              <div
                className={layout.assistantChatSlot}
                ref={assistantChatSlot}
                hidden={assistantView !== "canvas"}
              >
                <CanvasAssistant
                  tenantId={tenantId}
                  projectId={projectId}
                  sceneId={sceneId}
                  controller={controller}
                  active={active && !readOnly}
                  visible={dock === "assistant" && assistantView === "canvas"}
                  requestedContext={assistantContext}
                  onPrepareStoryboard={
                    sceneId ? () => switchAssistantView("scene") : undefined
                  }
                  onEditDraft={async (nodeId) => {
                    await retainCanvasEditing(
                      controller,
                      async () => {
                        await retainGenerationDraft.current?.();
                        return true;
                      },
                      () => canvasSessionAlive.current,
                    );
                    const target = controller
                      .getSnapshot()
                      .local?.document.nodes.find((node) => node.id === nodeId);
                    if (target?.content.type !== "draft")
                      throw Error(
                        "原草稿已移除或改变，请在画布中核对。助手建议仍保留。",
                      );
                    setEditingNodeId(nodeId);
                    focusNodes([nodeId]);
                    selectDock(null);
                  }}
                  onClose={() => selectDock("assistant")}
                />
              </div>
              <div
                className={layout.assistantSceneSlot}
                hidden={assistantView !== "scene"}
              >
                {sceneId && (
                  <SceneAssistant
                    tenantId={tenantId}
                    projectId={projectId}
                    sceneId={sceneId}
                    active={active}
                    visible={dock === "assistant" && assistantView === "scene"}
                    onOpenProposal={setAssistantProposalId}
                  />
                )}
              </div>
            </aside>
            <aside
              hidden={!dock || dock === "assistant"}
              className={layout.dock}
              inert={focusMode || undefined}
              aria-label={
                dock === "media"
                  ? "素材浏览"
                  : dock === "history"
                    ? "画布恢复历史"
                    : dock === "results"
                      ? "任务与结果"
                      : dock === "shots"
                        ? "本场镜头与探索"
                        : "AI 创作助手"
              }
            >
              <div className={`${classes.dockHeading} ${layout.dockHeading}`}>
                <Group justify="space-between">
                  <Text fw={600}>
                    {dock === "media"
                      ? "素材浏览"
                      : dock === "history"
                        ? "画布历史"
                        : dock === "results"
                          ? "任务与结果"
                          : dock === "shots"
                            ? "本场镜头与探索"
                            : "AI 创作助手"}
                  </Text>
                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={() => selectDock(dock)}
                  >
                    收起
                  </Button>
                </Group>
                {dock === "shots" && bindingTarget && (
                  <Text size="xs" lineClamp={1} title={bindingTarget.title}>
                    当前关联：{bindingTarget.title}
                  </Text>
                )}
              </div>
              <AuxiliaryPanel open={dock === "media"}>
                <CanvasMediaBrowser
                  projectId={projectId}
                  path={mediaPath}
                  readOnly={readOnly}
                  add={addMedia}
                />
              </AuxiliaryPanel>
              <AuxiliaryPanel open={dock === "history"}>
                <CanvasHistory
                  path={`${path}/canvases/${canvasId}`}
                  controller={controller}
                  readOnly={
                    readOnly ||
                    state.phase === "conflict" ||
                    !!state.local?.pending
                  }
                />
              </AuxiliaryPanel>
              <AuxiliaryPanel open={dock === "results"}>
                <SceneTaskPanel view={taskView} onChange={setTaskView}>
                  <CanvasImageGeneration
                    mode="history"
                    tenantId={tenantId}
                    projectId={projectId}
                    sceneId={sceneId}
                    controller={controller}
                    readOnly={readOnly}
                    inspectedPlanId={inspectedPlanId}
                    onInspectPlan={inspectPlan}
                    onCloseInspection={() => setInspectedPlanId(undefined)}
                    focus={focusNodes}
                  />
                </SceneTaskPanel>
              </AuxiliaryPanel>
              <AuxiliaryPanel open={dock === "shots"}>
                <Stack>
                  <ErrorNotice
                    error={connections.error ?? content.error}
                    retry={() => void changedConnections()}
                  />
                  <Button size="xs" onClick={() => void changedConnections()}>
                    刷新画布与关联
                  </Button>
                  {sceneId && connections.data && content.data ? (
                    <CanvasShotConnections
                      tenantId={tenantId}
                      path={path}
                      sceneId={sceneId}
                      controller={controller}
                      sceneCanvas={connections.data}
                      shots={content.data.shots.filter(
                        (s) => s.sceneId === sceneId,
                      )}
                      target={bindingTarget}
                      seed={bindingSeed}
                      readOnly={readOnly}
                      changed={changedConnections}
                      focus={focusNodes}
                      editTarget={editBinding}
                      busyChange={setBindingBusy}
                      place={(media, shot, take, assetRevisionId) => {
                        const node = addMedia(media, assetRevisionId);
                        if (!node) return;
                        setBindingTarget(node);
                        setBindingSeed({
                          shotId: shot.id,
                          shotRevisionId:
                            take?.shotRevisionId ?? shot.specRevisionId,
                          ...(take ? { take } : {}),
                        });
                        focusNodes([node.id]);
                      }}
                    />
                  ) : (
                    <Loader size="sm" aria-label="正在读取本场关联" />
                  )}
                </Stack>
              </AuxiliaryPanel>
            </aside>
          </div>
        )}
      </div>
    </CanvasUploads>
  );
}
/** Keep each mode's editor, IME session and scroll position through a view switch. */
function SceneModePanel({
  visible,
  label,
  children,
}: {
  visible: boolean;
  label: string;
  children: ReactNode;
}) {
  const [visited, setVisited] = useState(visible);
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    if (visible) setVisited(true);
  }, [visible]);
  useEffect(() => {
    if (!visible)
      element.current
        ?.querySelectorAll<HTMLMediaElement>("video, audio")
        .forEach((media) => media.pause());
  }, [visible]);
  return visible || visited ? (
    <section
      ref={element}
      className={layout.modePanel}
      hidden={!visible}
      aria-label={label}
    >
      {children}
    </section>
  ) : null;
}

function SceneAppearanceControls() {
  const { setColorScheme } = useMantineColorScheme();
  const colorScheme = useComputedColorScheme("light");
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () =>
      api<{ identityMode?: string; providerMode?: string }>("/health/live"),
  });
  return (
    <Stack gap="xs">
      {health.data?.providerMode === "mock" && (
        <Text size="xs" c="dimmed">
          未连接真实模型
        </Text>
      )}
      {health.data?.identityMode === "local_test" && (
        <Text size="xs" c="dimmed">
          本地测试身份
        </Text>
      )}
      <Button
        size="xs"
        variant="subtle"
        leftSection={
          colorScheme === "light" ? <Moon size={16} /> : <Sun size={16} />
        }
        onClick={() =>
          setColorScheme(colorScheme === "light" ? "dark" : "light")
        }
      >
        {colorScheme === "light" ? "切换深色" : "切换浅色"}
      </Button>
    </Stack>
  );
}
function SceneEnvironmentBadge() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () =>
      api<{ identityMode?: string; providerMode?: string }>("/health/live"),
  });
  const labels = [
    health.data?.providerMode === "mock" ? "未连接真实模型" : "",
    health.data?.identityMode === "local_test" ? "本地测试身份" : "",
  ].filter(Boolean);
  return labels.length ? (
    <Tooltip label={labels.join(" · ")}>
      <Text
        className={layout.environment}
        size="xs"
        c="dimmed"
        tabIndex={0}
        aria-label={labels.join(" · ")}
      >
        本地演示
      </Text>
    </Tooltip>
  ) : null;
}
/** Keep entered filters, chosen revisions and attempt inputs through auxiliary navigation. */
function AuxiliaryPanel({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const [visited, setVisited] = useState(open);
  useEffect(() => {
    if (open) setVisited(true);
  }, [open]);
  return open || visited ? <div hidden={!open}>{children}</div> : null;
}
function CanvasMediaBrowser({
  path,
  projectId,
  readOnly,
  add,
}: {
  path: string;
  projectId: string;
  readOnly: boolean;
  add: (media: Schema<"Media">) => void;
}) {
  const [query, setQuery] = useState(""),
    [scope, setScope] = useState("project");
  const list = usePages<Schema<"Media">>(
    `${path}/media?scope=${scope}${scope === "project" ? `&projectId=${projectId}` : ""}&q=${encodeURIComponent(query)}&status=ready`,
  );
  return (
    <Stack>
      <TextInput
        label="查找素材"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <Select
        label="素材范围"
        value={scope}
        onChange={(v) => setScope(v ?? "project")}
        data={[
          { value: "project", label: "项目素材" },
          { value: "shared", label: "工作室共享" },
        ]}
      />
      <Text size="xs" c="dimmed">
        添加为独立节点，不自动绑定镜头或采用。
      </Text>
      <ErrorNotice error={list.error} retry={() => void list.refetch()} />
      {list.data?.pages
        .flatMap((p) => p.items)
        .filter((m) => m.kind !== "document" && m.status === "ready")
        .map((media) => (
          <div className={classes.choice} key={media.id}>
            <MediaPreview media={media} path={path} thumbnail />
            <Text>{media.displayName}</Text>
            <Button disabled={readOnly} onClick={() => add(media)}>
              添加到画布
            </Button>
          </div>
        ))}
      {list.isPending && <Loader size="sm" aria-label="正在读取素材" />}
      {list.hasNextPage && (
        <Button
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          更多素材
        </Button>
      )}
    </Stack>
  );
}
function CanvasHistory({
  path,
  controller,
  readOnly,
}: {
  path: string;
  controller: CanvasController;
  readOnly: boolean;
}) {
  const history = usePages<Schema<"EditingHistoryEntry">>(`${path}/revisions`),
    [preview, setPreview] = useState<Schema<"Canvas"> | null>(null),
    [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false),
    [context, setContext] = useState("");
  return (
    <Stack>
      <Text size="xs" c="dimmed">
        取回历史内容成为当前草稿，不回滚修订或生成任务。旧记录按有限策略保留。
      </Text>
      <ErrorNotice
        error={history.error ?? error}
        retry={() => void history.refetch()}
      />
      {preview && (
        <Alert title={`正在查看版本 ${preview.revision}`}>
          <Text>
            {preview.document.nodes.length} 个节点 ·{" "}
            {preview.document.edges.length} 条引用
          </Text>
          <Stack gap="xs" mah={320} style={{ overflow: "auto" }}>
            {preview.document.nodes.map((node) => (
              <details key={node.id}>
                <summary>{node.title}</summary>
                <CanvasEntryDetails value={node} document={preview.document} />
              </details>
            ))}
            {preview.document.edges.map((edge) => (
              <CanvasEntryDetails
                key={edge.id}
                value={edge}
                document={preview.document}
              />
            ))}
            {preview.document.groups.map((group) => (
              <CanvasEntryDetails
                key={group.id}
                value={group}
                document={preview.document}
              />
            ))}
          </Stack>
          <Button
            mt="sm"
            disabled={readOnly || context !== controller.localDiscardContext()}
            onClick={() => {
              controller.change(preview.document);
              setPreview(null);
            }}
          >
            取回为当前草稿
          </Button>
          <Text size="xs" mt="sm">
            取回会替换当前草稿内容；可用画布撤销返回刚才的本机内容。
          </Text>
        </Alert>
      )}
      <Button size="xs" variant="subtle" onClick={() => void history.refetch()}>
        刷新历史
      </Button>
      {history.data?.pages
        .flatMap((p) => p.items)
        .map((entry) => (
          <div className={classes.choice} key={entry.revision}>
            <Text>
              版本 {entry.revision} ·{" "}
              {new Date(entry.updatedAt).toLocaleString()}
            </Text>
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                void api<Schema<"Canvas">>(
                  `${path}/revisions/${entry.revision}`,
                )
                  .then((result) => {
                    setPreview(result);
                    setContext(controller.localDiscardContext());
                  })
                  .catch((e) =>
                    setError(
                      e instanceof Error ? e : new Error("历史暂不可用。"),
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              查看内容
            </Button>
          </div>
        ))}
      {history.hasNextPage && (
        <Button onClick={() => void history.fetchNextPage()}>更多历史</Button>
      )}
    </Stack>
  );
}

function SceneWithoutCanvasAssistant({
  tenantId,
  projectId,
  sceneId,
  sceneTitle,
  active,
  open,
  changeOpen,
  toolbar,
  onNavigate,
}: {
  tenantId: string;
  projectId: string;
  sceneId: string;
  sceneTitle: string;
  active: boolean;
  open: boolean;
  changeOpen: (open: boolean) => void;
  toolbar: ReactNode;
  onNavigate: (destination: string) => Promise<void>;
}) {
  const [proposalId, setProposalId] = useState<string>();
  return (
    <div className={classes.session}>
      <header className={layout.header}>
        {toolbar}
        <div className={layout.headerActions}>
          <Button
            leftSection={<Sparkle size={16} />}
            aria-pressed={open}
            onClick={() => changeOpen(!open)}
          >
            AI 助手
          </Button>
        </div>
      </header>
      <div className={classes.body} data-dock={open || undefined}>
        <div className={classes.central}>
          {proposalId ? (
            <AssistantProposal
              path={projectPath(tenantId, projectId)}
              proposalId={proposalId}
              sceneTitle={sceneTitle}
              active={active}
              onClose={() => setProposalId(undefined)}
            />
          ) : (
            <CandidateWorkspace
              tenantId={tenantId}
              projectId={projectId}
              embedded
              externalDockOpen={open}
              closeExternalDock={() => changeOpen(false)}
              onNavigate={onNavigate}
            />
          )}
        </div>
        <aside className={classes.dock} aria-label="AI 创作助手" hidden={!open}>
          <div className={classes.dockHeading}>
            <Group justify="space-between">
              <Text fw={600}>AI 创作助手</Text>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => changeOpen(false)}
              >
                收起
              </Button>
            </Group>
          </div>
          <SceneAssistant
            tenantId={tenantId}
            projectId={projectId}
            sceneId={sceneId}
            active={active}
            visible={open}
            onOpenProposal={setProposalId}
          />
        </aside>
      </div>
    </div>
  );
}
