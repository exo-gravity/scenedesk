import { useEffect } from "react";
import { Loader, Text } from "@mantine/core";
import { CaretDown } from "@phosphor-icons/react";
import { useResource, type Schema } from "../business/api";
import { ErrorNotice, projectPath } from "../business/common";
import classes from "./studio.module.css";

/** The three views of the creative workspace. Only the canvas frame exists yet. */
const views = [
  { id: "script", label: "剧本" },
  { id: "canvas", label: "创作台" },
  { id: "shots", label: "镜头整理" },
] as const;

/**
 * Route entry of the rebuilt creative workspace (`…/p/{id}/studio`), beside the
 * unchanged canvas entry. It owns the whole viewport: a top bar that says where
 * you are, and the board. Phase 0 draws the frame only; nothing is interactive.
 */
export default function StudioEntry({
  tenantId,
  projectId,
  environment,
}: {
  tenantId: string;
  projectId: string;
  /** Mock provider and local test identity labels; always shown, never hidden for looks. */
  environment?: string | undefined;
}) {
  const project = useResource<Schema<"Project">>(
    projectPath(tenantId, projectId),
  );
  const projectName = project.isError
    ? "项目不可访问"
    : (project.data?.name ?? "项目");
  useEffect(() => {
    document.title = `${projectName} · 创作台 · SceneDesk`;
  }, [projectName]);
  return (
    <div className={classes.studio}>
      <header className={classes.topBar}>
        <div className={classes.barGroup}>
          <div className={classes.context}>
            <span className={classes.brand}>
              SceneDesk
              <CaretDown size={12} aria-hidden />
            </span>
            <span className={classes.divider} aria-hidden />
            <span
              className={classes.projectName}
              data-loading={project.isPending || undefined}
            >
              {project.isPending ? "正在读取项目" : projectName}
            </span>
          </div>
        </div>
        <nav className={classes.viewSwitch} aria-label="创作区视图">
          {views.map((view) => (
            <span
              key={view.id}
              className={classes.view}
              aria-current={view.id === "canvas" ? "page" : undefined}
            >
              {view.label}
            </span>
          ))}
        </nav>
        <div className={classes.barGroup} data-align="end">
          {environment && (
            <Text size="xs" c="dimmed">
              {environment}
            </Text>
          )}
        </div>
      </header>
      <main className={classes.board} aria-label="创作台">
        {project.isPending ? (
          <Loader aria-label="正在读取项目" />
        ) : project.isError ? (
          <ErrorNotice
            error={project.error}
            retry={() => void project.refetch()}
          />
        ) : null}
      </main>
    </div>
  );
}
