import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  ArrowLeft,
  ClockCounterClockwise,
  Images,
  Sparkle,
} from "@phosphor-icons/react";
import type { CanvasNode } from "@drama/domain";
import {
  api,
  ApiError,
  useCommand,
  usePages,
  useResource,
  useSession,
  type Schema,
} from "./api";
import { projectPath, tenantPath, Empty, ErrorNotice } from "./common";
import CandidateWorkspace from "./CandidateWorkspace";
import { useScenePreference } from "./use-scene-preference";
import { useCanvas } from "./use-canvas";
import { EditingPresence } from "./EditingPresence";
import { CanvasBoard } from "./CanvasBoard";
import { CanvasUploads } from "./CanvasUploads";
import { SceneAssistant } from "./SceneAssistant";
import { AssistantProposal } from "./AssistantProposal";
import { CanvasShotConnections } from "./CanvasShotConnections";
import { useQueryClient } from "@tanstack/react-query";
import { CanvasEntryDetails } from "./CanvasEntryDetails";
import { CanvasRecovery, canvasSaveLabel } from "./CanvasRecovery";
import { MediaPreview } from "./MediaPreview";
import type { CanvasController } from "./canvas-controller";
import classes from "./canvas.module.css";

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
  const project = useResource<Schema<"Project">>(path),
    content = useResource<Schema<"ContentTree">>(`${path}/content`);
  const canvas = useResource<Schema<"SceneCanvas">>(
      `${path}/scenes/${sceneId}/canvas`,
    ),
    create = useCommand<Schema<"SceneCanvas">>();
  const preference = useScenePreference(
    `${path}/scenes/${sceneId}/workspace-preference`,
  );
  const mode =
    explicitMode === "canvas" || explicitMode === "storyboard"
      ? explicitMode
      : (preference.view?.mode ?? "storyboard");
  useEffect(() => {
    if (preference.view && preference.view.mode !== mode)
      preference.change({ mode });
  }, [mode, preference.view?.mode, preference.change]);
  const scene = content.data?.scenes.find((s) => s.id === sceneId),
    episode = content.data?.episodes.find((e) => e.id === scene?.episodeId);
  useEffect(() => {
    document.title = `${scene?.title ?? "场次"} · 镜头制作 · 幕序`;
  }, [scene?.title]);
  const active =
    project.data?.status === "active" &&
    scene?.status === "active" &&
    episode?.status === "active";
  const missing =
    canvas.error instanceof ApiError &&
    canvas.error.code === "SCENE_CANVAS_NOT_CREATED";
  const canvasId = canvas.data?.canvas.id ?? create.data?.canvas.id;
  const switchMode = (next: Preference["mode"]) => {
    preference.change({ mode: next });
    const query = new URLSearchParams(location.hash.split("?")[1]);
    query.set("scene", sceneId);
    query.set("mode", next);
    location.hash = `${base}/production?${query}`;
  };
  if (project.error || content.error)
    return (
      <ErrorNotice
        error={project.error ?? content.error}
        retry={() => {
          void project.refetch();
          void content.refetch();
        }}
      />
    );
  if (!project.data || !content.data || !preference.view)
    return (
      <Stack>
        <ErrorNotice error={preference.error} retry={preference.retry} />
        <Loader aria-label="正在读取场次工作区" />
      </Stack>
    );
  if (!scene) return <Empty>本场次不存在或不属于当前项目。</Empty>;
  const view = { ...preference.view, mode };
  return (
    <div className={classes.workspace}>
      <Group justify="space-between">
        <Group>
          <Button
            component="a"
            href={`${base}/content?scene=${sceneId}`}
            variant="subtle"
            leftSection={<ArrowLeft size={16} />}
          >
            场次目录
          </Button>
          <div>
            <Text fw={600}>
              {project.data.name} / {episode?.title} / {scene.title}
            </Text>
            <Text size="xs" c="dimmed">
              镜头制作
            </Text>
          </div>
        </Group>
        <Group>
          <Button
            variant={mode === "storyboard" ? "filled" : "default"}
            aria-pressed={mode === "storyboard"}
            onClick={() => switchMode("storyboard")}
          >
            分镜
          </Button>
          <Button
            variant={mode === "canvas" ? "filled" : "default"}
            aria-pressed={mode === "canvas"}
            onClick={() => switchMode("canvas")}
          >
            自由画布
          </Button>
          <Button component="a" href={`${base}/media`}>
            素材管理
          </Button>
        </Group>
      </Group>
      <ErrorNotice
        error={preference.error}
        retry={preference.retry}
        retryLabel="重新保存本页视图"
      />
      {!active && (
        <Alert title="只读场次">项目或场次已归档，可继续查看原有内容。</Alert>
      )}
      {canvasId ? (
        <SceneCanvasSession
          tenantId={tenantId}
          projectId={projectId}
          sceneId={sceneId}
          sceneTitle={scene.title}
          canvasId={canvasId}
          preference={view}
          changePreference={preference.change}
          active={active}
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
        />
      ) : (
        <Stack>
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
function SceneCanvasSession({
  tenantId,
  projectId,
  canvasId,
  sceneId,
  sceneTitle,
  preference,
  changePreference,
  active,
}: {
  tenantId: string;
  projectId: string;
  canvasId: string;
  sceneId: string;
  sceneTitle: string;
  preference: Preference;
  changePreference: (patch: Partial<Preference>) => void;
  active: boolean;
}) {
  const { controller, state, error, retry } = useCanvas(
      tenantId,
      projectId,
      canvasId,
    ),
    [dock, setDock] = useState<
      "media" | "history" | "assistant" | "shots" | null
    >(
      preference.assetPanelOpen
        ? "media"
        : preference.assistantOpen
          ? "assistant"
          : null,
    );
  const [assistantProposalId, setAssistantProposalId] = useState<string>();
  const mediaPath = tenantPath(tenantId),
    path = projectPath(tenantId, projectId);
  const cache = useQueryClient(),
    session = useSession();
  const connections = useResource<Schema<"SceneCanvas">>(
    `${path}/scenes/${sceneId}/canvas`,
  );
  const content = useResource<Schema<"ContentTree">>(`${path}/content`);
  const [bindingTarget, setBindingTarget] = useState<CanvasNode | null>(null);
  const [bindingSeed, setBindingSeed] = useState<{
    shotId: string;
    shotRevisionId: string;
    take?: Schema<"Take">;
  }>();
  const [bindingBusy, setBindingBusy] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{
    ids: string[];
    nonce: number;
  }>();
  const focusCompleted = useCallback((nonce: number) => {
    setFocusRequest((current) =>
      current?.nonce === nonce ? undefined : current,
    );
  }, []);
  useEffect(() => {
    if (state?.local?.base.revision !== undefined)
      void cache.invalidateQueries({
        queryKey: ["user", session.userId, `${path}/scenes/${sceneId}/canvas`],
      });
  }, [state?.local?.base.revision, cache, session.userId, path, sceneId]);
  const changedConnections = async () => {
    await controller?.refresh();
    await Promise.all([connections.refetch(), content.refetch()]);
  };
  const focusNodes = (ids: string[]) => {
    changePreference({ selectedNodeIds: ids, mode: "canvas" });
    setFocusRequest({ ids, nonce: Date.now() });
    const query = new URLSearchParams(location.hash.split("?")[1]);
    query.set("mode", "canvas");
    location.hash = `${location.hash.split("?")[0]}?${query}`;
  };
  const editBinding = (node: CanvasNode | null) => {
    setBindingTarget(node);
    setBindingSeed(undefined);
    setDock("shots");
  };
  const selectDock = (next: typeof dock) => {
    const value = next === dock ? null : next;
    setDock(value);
    changePreference({
      assetPanelOpen: value === "media",
      assistantOpen: value === "assistant",
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
      <Stack gap="md">
        <Group justify="space-between">
          <Text role="status" aria-live="polite">
            画布 · {canvasSaveLabel(state)}
            {state.local ? ` · 服务器版本 ${state.local.base.revision}` : ""}
          </Text>
          <Group gap="xs">
            <Button
              size="xs"
              disabled={readOnly || state.phase === "conflict"}
              loading={state.phase === "saving"}
              onClick={() => void controller.save()}
            >
              保存画布
            </Button>
            <Button
              size="xs"
              aria-pressed={dock === "shots"}
              onClick={() => selectDock("shots")}
            >
              本场镜头与探索
            </Button>
            <Button
              size="xs"
              leftSection={<Images size={16} />}
              aria-pressed={dock === "media"}
              onClick={() => selectDock("media")}
            >
              素材
            </Button>
            <Button
              size="xs"
              leftSection={<ClockCounterClockwise size={16} />}
              aria-pressed={dock === "history"}
              onClick={() => selectDock("history")}
            >
              历史
            </Button>
            <Button
              size="xs"
              leftSection={<Sparkle size={16} />}
              aria-pressed={dock === "assistant"}
              onClick={() => selectDock("assistant")}
            >
              AI 助手
            </Button>
          </Group>
        </Group>
        <CanvasRecovery
          controller={controller}
          state={state}
          retry={retry}
          selectNode={selectNode}
        />
        <EditingPresence
          tenantId={tenantId}
          projectId={projectId}
          canvasId={canvasId}
          enabled={!state.accessChecking && state.phase !== "loading"}
          editing={
            active &&
            (state.dirty || state.hasInvalidInput || state.phase === "saving")
          }
        />
        {state.phase === "loading" || !document ? (
          <Loader aria-label="正在读取画布" />
        ) : (
          <div className={classes.body} data-dock={dock || undefined}>
            <div>
              {assistantProposalId ? (
                <AssistantProposal
                  path={path}
                  proposalId={assistantProposalId}
                  sceneTitle={sceneTitle}
                  active={active}
                  onClose={() => setAssistantProposalId(undefined)}
                />
              ) : preference.mode === "canvas" ? (
                <CanvasBoard
                  controller={controller}
                  document={document}
                  preference={preference}
                  changePreference={changePreference}
                  mediaPath={mediaPath}
                  readOnly={readOnly || bindingBusy}
                  focusRequest={focusRequest}
                  focusCompleted={focusCompleted}
                  nodeActions={
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
                    setDock("media");
                    changePreference({
                      assetPanelOpen: true,
                      assistantOpen: false,
                    });
                  }}
                />
              ) : (
                <CandidateWorkspace
                  tenantId={tenantId}
                  projectId={projectId}
                  embedded
                />
              )}
            </div>
            <aside
              className={classes.dock}
              aria-label="AI 创作助手"
              hidden={dock !== "assistant"}
            >
              <div className={classes.dockHeading}>
                <Group justify="space-between">
                  <Text fw={600}>AI 创作助手</Text>
                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={() => selectDock("assistant")}
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
                visible={dock === "assistant"}
                onOpenProposal={setAssistantProposalId}
              />
            </aside>
            {dock && dock !== "assistant" && (
              <aside
                className={classes.dock}
                aria-label={
                  dock === "media"
                    ? "素材浏览"
                    : dock === "history"
                      ? "画布恢复历史"
                      : dock === "shots"
                        ? "本场镜头与探索"
                        : "AI 创作助手"
                }
              >
                <div className={classes.dockHeading}>
                  <Group justify="space-between">
                    <Text fw={600}>
                      {dock === "media"
                        ? "素材浏览"
                        : dock === "history"
                          ? "画布历史"
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
                {dock === "media" ? (
                  <CanvasMediaBrowser
                    projectId={projectId}
                    path={mediaPath}
                    readOnly={readOnly}
                    add={addMedia}
                  />
                ) : dock === "history" ? (
                  <CanvasHistory
                    path={`${path}/canvases/${canvasId}`}
                    controller={controller}
                    readOnly={
                      readOnly ||
                      state.phase === "conflict" ||
                      !!state.local?.pending
                    }
                  />
                ) : dock === "shots" ? (
                  <Stack>
                    <ErrorNotice
                      error={connections.error ?? content.error}
                      retry={() => void changedConnections()}
                    />
                    <Button size="xs" onClick={() => void changedConnections()}>
                      刷新画布与关联
                    </Button>
                    {connections.data && content.data ? (
                      <CanvasShotConnections
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
                ) : null}
              </aside>
            )}
          </div>
        )}
      </Stack>
    </CanvasUploads>
  );
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
}: {
  tenantId: string;
  projectId: string;
  sceneId: string;
  sceneTitle: string;
  active: boolean;
  open: boolean;
  changeOpen: (open: boolean) => void;
}) {
  const [proposalId, setProposalId] = useState<string>();
  return (
    <Stack>
      <Group justify="end">
        <Button
          leftSection={<Sparkle size={16} />}
          aria-pressed={open}
          onClick={() => changeOpen(!open)}
        >
          AI 助手
        </Button>
      </Group>
      <div className={classes.body} data-dock={open || undefined}>
        <div>
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
    </Stack>
  );
}
