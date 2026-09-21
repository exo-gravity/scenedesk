import { useEffect } from "react";
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
}: {
  tenantId: string;
  projectId: string;
  environment?: string | undefined;
  /** The path segment after `studio`: absent for the canvas, `script`, `shots`. */
  view?: string | undefined;
}) {
  const path = projectPath(tenantId, projectId);
  const base = `#/app/t/${tenantId}/p/${projectId}/studio`;
  const view: StudioView = requested === "script" ? "script" : requested === "shots" ? "shots" : "canvas";
  const query = new URLSearchParams(location.hash.split("?")[1]);
  const project = useResource<Schema<"Project">>(path);
  const canvas = useResource<Schema<"ProjectCanvas">>(`${path}/canvas`),
    create = useCommand<Schema<"ProjectCanvas">>();
  const projectName = project.isError
    ? "项目不可访问"
    : (project.data?.name ?? "项目");
  useEffect(() => {
    document.title = `${projectName} · ${view === "script" ? "剧本" : view === "shots" ? "镜头整理" : "创作台"} · SceneDesk`;
  }, [projectName, view]);
  const active = project.data?.status === "active";
  const canvasId = canvas.data?.canvas.id ?? create.data?.canvas.id;
  const missing =
    canvas.error instanceof ApiError &&
    canvas.error.code === "PROJECT_CANVAS_NOT_CREATED";
  if (project.data && view === "script")
    return (
      <StudioFrame projectName={projectName} environment={environment} view="script" base={base}>
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
      <StudioFrame projectName={projectName} environment={environment} view="shots" base={base}>
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
  if (project.data && canvasId && !canvas.isError)
    return (
      <StudioCanvas
        key={canvasId}
        tenantId={tenantId}
        projectId={projectId}
        canvasId={canvasId}
        active={active}
        projectName={projectName}
        environment={environment}
        base={base}
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
            <Text fw={600}>从第一张画面开始</Text>
            <Text c="dimmed">
              添加文字、参考素材或创作草稿，在创作台上探索你的故事。
            </Text>
            <UnstyledButton
              className={classes.primaryAction}
              disabled={!active || create.isPending}
              onClick={() =>
                create.mutate(
                  { path: `${path}/canvas` },
                  { onSuccess: () => void canvas.refetch() },
                )
              }
            >
              创建项目创作台
            </UnstyledButton>
            <ErrorNotice error={create.error} />
          </div>
        ) : canvas.isError ? (
          <div className={classes.center}>
            <ErrorNotice
              error={canvas.error}
              retry={() => void canvas.refetch()}
            />
          </div>
        ) : (
          <div className={classes.center}>
            <Loader aria-label="正在读取创作台" />
          </div>
        )}
      </main>
    </StudioFrame>
  );
}
