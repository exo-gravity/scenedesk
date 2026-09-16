import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import {
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
import classes from "./canvas.module.css";
import layout from "./scene-production.module.css";

export default function ProjectCanvasEntry(props: {
  tenantId: string;
  projectId: string;
}) {
  return (
    <ProjectCanvasWorkspace
      key={`${props.tenantId}:${props.projectId}`}
      {...props}
    />
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
  const toolbar = (
    <Group gap="sm" wrap="nowrap" className={layout.contextTools}>
      <Text fw={600}>项目画布</Text>
      {content.isError && (
        <Button
          size="xs"
          variant="subtle"
          onClick={() => void content.refetch()}
        >
          重新读取场次入口
        </Button>
      )}
      {!content.isError && !!content.data?.scenes.length && (
        <Select
          aria-label="打开已有场次画布"
          placeholder="已有场次画布"
          value={null}
          size="xs"
          disabled={navigating}
          searchable
          data={content.data.scenes.map((scene) => ({
            value: scene.id,
            label: `${content.data?.episodes.find((e) => e.id === scene.episodeId)?.title ?? ""} · ${scene.title}${scene.status === "archived" ? " · 已归档" : ""}`,
          }))}
          onChange={(id) => {
            if (id)
              void navigate(`${base}/production?scene=${id}&mode=canvas`).catch(
                () => {},
              );
          }}
        />
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
