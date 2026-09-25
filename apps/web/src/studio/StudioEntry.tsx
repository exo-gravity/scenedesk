import { useEffect, type ReactNode } from "react";
import { Loader, Text, UnstyledButton } from "@mantine/core";
import {
  ApiError,
  useCommand,
  useResource,
  type Schema,
} from "../business/api";
import { ErrorNotice, projectPath } from "../business/common";
import { StudioFrame, type StudioView } from "./StudioFrame";
import { StudioCanvas } from "./StudioCanvas";
import { ScriptView } from "./script/ScriptView";
import { ShotsView } from "./shots/ShotsView";
import { ProjectMenu } from "./shell/ProjectMenu";
import classes from "./studio.module.css";

/**
 * Route entry of the rebuilt creative workspace (`…/p/{id}/studio`), beside the
 * unchanged canvas entry. It reads the project and its project canvas, offers
 * to create the canvas when there is none yet, and otherwise hands over to the
 * canvas session. Scene canvases join through the canvas switch later.
 */
export default function StudioEntry({
  tenantId,
  projectId,
  environment,
  view: requested,
  account,
}: {
  tenantId: string;
  projectId: string;
  environment?: string | undefined;
  /** The path segment after `studio`: absent for the canvas, `script`, `shots`. */
  view?: string | undefined;
  account?: ReactNode;
}) {
  const path = projectPath(tenantId, projectId);
  const base = `#/app/t/${tenantId}/p/${projectId}/studio`;
  const view: StudioView = requested === "script" ? "script" : requested === "shots" ? "shots" : "canvas";
  const query = new URLSearchParams(location.hash.split("?")[1]);
  const sceneId = view === "canvas" ? (query.get("scene") ?? undefined) : undefined;
  const project = useResource<Schema<"Project">>(path);
  const content = useResource<Schema<"ContentTree">>(`${path}/content`);
  const canvas = useResource<Schema<"ProjectCanvas">>(`${path}/canvas`, !sceneId),
    create = useCommand<Schema<"ProjectCanvas">>();
  const sceneCanvas = useResource<Schema<"SceneCanvas">>(`${path}/scenes/${encodeURIComponent(sceneId ?? "")}/canvas`, !!sceneId),
    createScene = useCommand<Schema<"SceneCanvas">>();
  const scene = content.data?.scenes.find((item) => item.id === sceneId),
    episode = content.data?.episodes.find((item) => item.id === scene?.episodeId);
  const canvasLabel = sceneId
    ? scene
      ? `${episode?.title ?? "未找到所属集"} · ${scene.title} 创作台`
      : "场次创作台"
    : "项目创作台";
  const canvasId = sceneId
    ? (sceneCanvas.data?.canvas.id ?? createScene.data?.canvas.id)
    : (canvas.data?.canvas.id ?? create.data?.canvas.id);
  const canvasError = sceneId ? sceneCanvas.error : canvas.error;
  const canvasPending = sceneId ? sceneCanvas.isPending : canvas.isPending;
  const missing =
    canvasError instanceof ApiError &&
    (canvasError.code === "PROJECT_CANVAS_NOT_CREATED" || canvasError.code === "SCENE_CANVAS_NOT_CREATED");
  // A scene id that is not in this project is a wrong address, not lost access.
  const sceneMissing = !!sceneId && !!content.data && !scene;
  // Query caches keep the last good read after a refetch fails. A denied read
  // of the project, its content or its canvas closes the studio regardless,
  // so revoked access shows neither cached content nor the project's name.
  const isDenied = (error: unknown) =>
    error instanceof ApiError && [401, 403, 404].includes(error.status);
  const denied =
    [project.error, content.error].find(isDenied) ??
    (!missing && !sceneMissing && isDenied(canvasError) ? canvasError : undefined);
  const projectName = project.isError || denied
    ? "项目不可访问"
    : (project.data?.name ?? "项目");
  const menu = <ProjectMenu tenantId={tenantId} projectId={projectId} projectName={projectName}
    unavailable={project.isError || !!denied} loading={project.isPending} />;
  useEffect(() => {
    document.title = `${projectName} · ${view === "script" ? "剧本" : view === "shots" ? "镜头整理" : "创作台"} · SceneDesk`;
  }, [projectName, view]);
  const active =
    project.data?.status === "active" &&
    (!sceneId || (scene?.status === "active" && episode?.status === "active"));
  if (denied)
    return (
      <StudioFrame projectName={projectName} environment={environment} view={view} base={base} menu={menu} account={account}>
        <main className={classes.board} aria-label={view === "script" ? "剧本" : view === "shots" ? "镜头整理" : "创作台"}>
          <div className={classes.center}>
            <ErrorNotice
              error={denied}
              retry={() => {
                void project.refetch();
                void content.refetch();
                void (sceneId ? sceneCanvas.refetch() : canvas.refetch());
              }}
            />
          </div>
        </main>
      </StudioFrame>
    );
  if (sceneMissing && project.data)
    return (
      <StudioFrame projectName={projectName} environment={environment} view={view} base={base} menu={menu} account={account}>
        <main className={classes.board} aria-label="创作台">
          <div className={classes.center}>
            <Text fw={600}>这个项目里没有这一场</Text>
            <Text c="dimmed">地址里的场次不属于本项目，或已被删除。</Text>
            <UnstyledButton className={classes.primaryAction} component="a" href={base}>
              打开项目创作台
            </UnstyledButton>
          </div>
        </main>
      </StudioFrame>
    );
  if (project.data && view === "script")
    return (
      <StudioFrame projectName={projectName} environment={environment} view="script" base={base} menu={menu} account={account}>
        <main className={classes.board} aria-label="剧本">
          <ScriptView
            tenantId={tenantId}
            projectId={projectId}
            active={active}
            revisionId={query.get("revision") ?? undefined}
          />
        </main>
      </StudioFrame>
    );
  if (project.data && view === "shots")
    return (
      <StudioFrame projectName={projectName} environment={environment} view="shots" base={base} menu={menu} account={account}>
        <main className={classes.board} aria-label="镜头整理">
          <ShotsView
            tenantId={tenantId}
            projectId={projectId}
            projectActive={active}
            base={base}
            sceneParam={query.get("scene") ?? undefined}
            shotParam={query.get("shot") ?? undefined}
            mediaParam={query.get("media") ?? undefined}
          />
        </main>
      </StudioFrame>
    );
  if (project.data && canvasId && !canvasError)
    return (
      <StudioCanvas
        key={canvasId}
        tenantId={tenantId}
        projectId={projectId}
        canvasId={canvasId}
        sceneId={sceneId}
        canvasLabel={canvasLabel}
        projectAspect={{ width: project.data.spec.width, height: project.data.spec.height }}
        content={content.data}
        active={active}
        projectName={projectName}
        environment={environment}
        base={base}
        menu={menu}
        account={account}
        focusNodeId={query.get("node") ?? undefined}
      />
    );
  return (
    <StudioFrame
      projectName={project.isPending ? "正在读取项目" : projectName}
      loading={project.isPending}
      environment={environment}
      view={view}
      base={base}
      menu={menu}
      account={account}
    >
      <main className={classes.board} aria-label="创作台">
        {project.isError ? (
          <div className={classes.center}>
            <ErrorNotice
              error={project.error}
              retry={() => void project.refetch()}
            />
          </div>
        ) : missing && project.data ? (
          <div className={classes.center}>
            <Text fw={600}>{sceneId ? `${canvasLabel}还没有内容` : "从第一张画面开始"}</Text>
            <Text c="dimmed">
              添加文字、参考素材或创作草稿，在创作台上探索你的故事。
            </Text>
            <UnstyledButton
              className={classes.primaryAction}
              disabled={!active || create.isPending || createScene.isPending}
              onClick={() =>
                sceneId
                  ? createScene.mutate(
                      { path: `${path}/scenes/${encodeURIComponent(sceneId)}/canvas` },
                      { onSuccess: () => void sceneCanvas.refetch() },
                    )
                  : create.mutate(
                      { path: `${path}/canvas` },
                      { onSuccess: () => void canvas.refetch() },
                    )
              }
            >
              {sceneId ? "创建场次创作台" : "创建项目创作台"}
            </UnstyledButton>
            <ErrorNotice error={create.error ?? createScene.error} />
          </div>
        ) : canvasError ? (
          <div className={classes.center}>
            <ErrorNotice
              error={canvasError}
              retry={() => void (sceneId ? sceneCanvas.refetch() : canvas.refetch())}
            />
          </div>
        ) : (
          <div className={classes.center}>
            <Loader aria-label={canvasPending || project.isPending ? "正在读取创作台" : "正在准备创作台"} />
          </div>
        )}
      </main>
    </StudioFrame>
  );
}
