import { useEffect } from "react";
import { Loader, Text, UnstyledButton } from "@mantine/core";
import {
  ApiError,
  useCommand,
  useResource,
  type Schema,
} from "../business/api";
import { ErrorNotice, projectPath } from "../business/common";
import { StudioFrame } from "./StudioFrame";
import { StudioCanvas } from "./StudioCanvas";
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
}: {
  tenantId: string;
  projectId: string;
  environment?: string | undefined;
}) {
  const path = projectPath(tenantId, projectId);
  const project = useResource<Schema<"Project">>(path);
  const canvas = useResource<Schema<"ProjectCanvas">>(`${path}/canvas`),
    create = useCommand<Schema<"ProjectCanvas">>();
  const projectName = project.isError
    ? "项目不可访问"
    : (project.data?.name ?? "项目");
  useEffect(() => {
    document.title = `${projectName} · 创作台 · SceneDesk`;
  }, [projectName]);
  const active = project.data?.status === "active";
  const canvasId = canvas.data?.canvas.id ?? create.data?.canvas.id;
  const missing =
    canvas.error instanceof ApiError &&
    canvas.error.code === "PROJECT_CANVAS_NOT_CREATED";
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
      />
    );
  return (
    <StudioFrame
      projectName={project.isPending ? "正在读取项目" : projectName}
      loading={project.isPending}
      environment={environment}
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
