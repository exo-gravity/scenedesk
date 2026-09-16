import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Loader, Stack, Text } from "@mantine/core";
import {
  api,
  ApiError,
  useCommand,
  useResource,
  useSession,
  type Schema,
} from "./api";
import { Empty, ErrorNotice, projectPath } from "./common";
import { useScenePreference } from "./use-scene-preference";
import {
  retainProjectAssistantDrafts,
  retryProjectAssistantRetention,
} from "./assistant-lifecycle";
import { SceneCanvasSession } from "./SceneProductionWorkspace";
import { useProjectNavigationGuard } from "./project-navigation-guard";
import { useQuery } from "@tanstack/react-query";
import { CaretRight } from "@phosphor-icons/react";
import { CanvasNavigator } from "./SceneNavigator";
import {
  canvasLocationHref,
  recentCanvas,
  rememberCanvas,
} from "./canvas-navigation";
import classes from "./canvas.module.css";
import layout from "./scene-production.module.css";

export default function ProjectCanvasEntry(props: {
  tenantId: string;
  projectId: string;
}) {
  const explicitProject =
    new URLSearchParams(location.hash.split("?")[1]).get("scope") === "project";
  return explicitProject ? (
    <ProjectCanvasWorkspace
      key={`${props.tenantId}:${props.projectId}:project`}
      {...props}
    />
  ) : (
    <CanvasEntryResolution
      key={`${props.tenantId}:${props.projectId}:recent`}
      {...props}
    />
  );
}

/** Resolve only from a fresh authorized index. The hint never supplies names or access. */
function CanvasEntryResolution({
  tenantId,
  projectId,
}: {
  tenantId: string;
  projectId: string;
}) {
  const session = useSession();
  const path = projectPath(tenantId, projectId),
    base = `#/app/t/${tenantId}/p/${projectId}`;
  const index = useQuery({
    queryKey: ["user", session.userId, `${path}/canvas-workspaces`],
    queryFn: ({ signal }) =>
      api<Schema<"CanvasWorkspaceIndex">>(`${path}/canvas-workspaces`, {
        signal,
      }),
    refetchOnMount: "always",
  });
  const content = useQuery({
    queryKey: ["user", session.userId, `${path}/content`],
    queryFn: ({ signal }) =>
      api<Schema<"ContentTree">>(`${path}/content`, { signal }),
    refetchOnMount: "always",
  });
  const project = useResource<Schema<"Project">>(path);
  useEffect(() => {
    document.title = "画布 · SceneDesk";
  }, []);
  const [resolution, setResolution] = useState<"choose" | "redirect" | null>(
    null,
  );
  useEffect(() => {
    if (
      resolution ||
      !index.isFetchedAfterMount ||
      !content.isFetchedAfterMount ||
      index.isError ||
      !index.data ||
      !content.data ||
      content.isError ||
      project.isError
    )
      return;
    const choices = index.data.items;
    const hint = recentCanvas(session, tenantId, projectId);
    const choice =
      choices.find((item) => (item.sceneId ?? "project") === hint) ??
      (choices.length === 1 ? choices[0] : undefined);
    if (choice || choices.length === 0) {
      setResolution("redirect");
      // History always names the resolved workspace, so Back cannot re-resolve
      // its former entry using a newer "recent" hint and bounce forward again.
      const query = new URLSearchParams(location.hash.split("?")[1]);
      query.set("scope", "project");
      location.replace(
        choice?.sceneId
          ? canvasLocationHref(base, choice.sceneId)
          : `${base}/canvas?${query}`,
      );
    } else setResolution("choose");
  }, [
    resolution,
    index.isFetchedAfterMount,
    index.isError,
    index.data,
    content.data,
    content.isFetchedAfterMount,
    content.isError,
    project.isError,
    session,
    tenantId,
    projectId,
    base,
  ]);
  const error = index.error ?? content.error ?? project.error;
  if (error)
    return (
      <Stack p="md">
        <ErrorNotice
          error={error}
          retry={() => {
            void index.refetch();
            void content.refetch();
            void project.refetch();
          }}
        />
      </Stack>
    );
  if (resolution === "choose" && content.data)
    return (
      <Stack p="xl" align="center" gap="lg">
        <Text fw={600} size="lg">
          继续在哪张画布创作？
        </Text>
        <Text c="dimmed">选择项目画布或场次。下次会回到你最近使用的画布。</Text>
        <CanvasNavigator
          content={content.data}
          unselected
          canCreate={project.data?.status === "active"}
          onSelect={(id) => {
            location.hash = canvasLocationHref(base, id);
          }}
          onDirectory={() => {
            location.hash = `${base}/content`;
          }}
          onCreate={() => {
            location.hash = `${base}/content?create=scene`;
          }}
        />
      </Stack>
    );
  return (
    <Stack p="md">
      <Loader aria-label="正在读取画布入口" />
    </Stack>
  );
}
function ProjectCanvasWorkspace({
  tenantId,
  projectId,
}: {
  tenantId: string;
  projectId: string;
}) {
  const path = projectPath(tenantId, projectId),
    base = `#/app/t/${tenantId}/p/${projectId}`;
  const session = useSession(),
    guard = useProjectNavigationGuard();
  const project = useResource<Schema<"Project">>(path),
    content = useResource<Schema<"ContentTree">>(`${path}/content`);
  const canvas = useResource<Schema<"ProjectCanvas">>(`${path}/canvas`),
    create = useCommand<Schema<"ProjectCanvas">>();
  const preference = useScenePreference(`${path}/workspace-preference`);
  const beforeLeave = useRef<(() => Promise<void>) | undefined>(undefined);
  const registerBeforeLeave = useCallback(
    (retain: (() => Promise<void>) | undefined) => {
      beforeLeave.current = retain;
    },
    [],
  );
  const [navigating, setNavigating] = useState(false),
    [navigationError, setNavigationError] = useState<Error | null>(null);
  const navigationLock = useRef(false),
    pendingDestination = useRef<string | null>(null);
  const navigate = useCallback(
    async (destination: string, recheck = false) => {
      if (navigationLock.current) throw Error("正在保留当前编辑，请稍候。");
      navigationLock.current = true;
      setNavigating(true);
      setNavigationError(null);
      pendingDestination.current = destination;
      const partition = {
        sessionId: session.id,
        userId: session.userId,
        tenantId,
        projectId,
      };
      try {
        if (recheck) await retryProjectAssistantRetention(partition);
        await beforeLeave.current?.();
        await retainProjectAssistantDrafts(partition);
        await preference.flush();
        // New input may arrive while asynchronous retention is running.
        await beforeLeave.current?.();
        await retainProjectAssistantDrafts(partition);
        location.hash = destination;
        pendingDestination.current = null;
      } catch (cause) {
        const error =
          cause instanceof Error
            ? cause
            : Error("当前编辑尚未保留，页面仍留在原处。");
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
    document.title = `${project.isError ? "项目不可访问" : (project.data?.name ?? "项目")} · 画布 · SceneDesk`;
  }, [project.data?.name, project.isError]);
  const active = project.data?.status === "active",
    canvasId = canvas.data?.canvas.id ?? create.data?.canvas.id;
  const missing =
    canvas.error instanceof ApiError &&
    canvas.error.code === "PROJECT_CANVAS_NOT_CREATED";
  useEffect(() => {
    if (canvasId && !canvas.isError && !project.isError)
      rememberCanvas(session, tenantId, projectId, "project");
  }, [canvasId, canvas.isError, project.isError, session, tenantId, projectId]);
  const toolbar = (
    <Group gap="sm" wrap="nowrap" className={layout.contextTools}>
      <Text className={layout.projectName} size="sm" c="dimmed" truncate>
        {project.isError ? "项目不可访问" : project.data?.name}
      </Text>
      <CaretRight size={14} className={layout.contextDivider} aria-hidden />
      {content.isError ? (
        <Button
          size="xs"
          variant="subtle"
          onClick={() => void content.refetch()}
        >
          重新读取画布入口
        </Button>
      ) : content.data ? (
        <CanvasNavigator
          content={content.data}
          disabled={navigating}
          canCreate={active}
          onSelect={(id) => navigate(canvasLocationHref(base, id))}
          onDirectory={() => navigate(`${base}/content`)}
          onCreate={() => navigate(`${base}/content?create=scene`)}
        />
      ) : (
        <Text fw={600}>项目画布</Text>
      )}
    </Group>
  );
  if (project.isError)
    return (
      <Stack p="md">
        <ErrorNotice
          error={project.error}
          retry={() => void project.refetch()}
        />
      </Stack>
    );
  if (!project.data || !preference.view)
    return (
      <Stack p="md">
        <ErrorNotice error={preference.error} retry={preference.retry} />
        <Loader aria-label="正在读取项目画布" />
      </Stack>
    );
  return (
    <div className={classes.workspace} data-project-canvas-workspace>
      {navigationError && (
        <Alert title="暂未切换页面" role="alert">
          <Group justify="space-between">
            <Text size="sm">{navigationError.message}</Text>
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
        </Alert>
      )}
      <ErrorNotice
        error={preference.error}
        retry={preference.retry}
        retryLabel="重新保存本页视图"
      />
      {!active && (
        <Alert title="只读项目">项目已归档，可继续查看原有画布。</Alert>
      )}
      {canvasId && !canvas.isError ? (
        <SceneCanvasSession
          tenantId={tenantId}
          projectId={projectId}
          canvasId={canvasId}
          sceneId={undefined}
          sceneTitle={project.data.name}
          preference={{
            ...preference.view,
            mode: "canvas",
            selectedShotId: null,
          }}
          changePreference={preference.change}
          active={active}
          toolbar={toolbar}
          registerBeforeLeave={registerBeforeLeave}
          navigating={navigating}
          onNavigate={navigate}
        />
      ) : (
        <Stack>
          <div className={layout.header}>{toolbar}</div>
          {missing ? (
            <Empty>
              <Stack align="center">
                <Text fw={600}>从第一张画面开始</Text>
                <Text c="dimmed">
                  添加文字、参考素材或创作草稿，在画布中探索你的故事。
                </Text>
                <Button
                  variant="filled"
                  disabled={!active}
                  loading={create.isPending}
                  onClick={() =>
                    create.mutate(
                      { path: `${path}/canvas` },
                      { onSuccess: () => void canvas.refetch() },
                    )
                  }
                >
                  创建项目画布
                </Button>
              </Stack>
            </Empty>
          ) : canvas.isPending ? (
            <Loader aria-label="正在读取项目画布" />
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
