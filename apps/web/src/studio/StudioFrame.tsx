import type { ReactNode } from "react";
import { Text } from "@mantine/core";
import { CaretDown } from "@phosphor-icons/react";
import classes from "./studio.module.css";

/** The three views of the creative workspace. Only the canvas exists yet. */
const views = [
  { id: "script", label: "剧本" },
  { id: "canvas", label: "创作台" },
  { id: "shots", label: "镜头整理" },
] as const;

/**
 * The frame every studio view shares: a top bar that says where you are and
 * what state the work is in, over whatever the view puts underneath.
 */
export function StudioFrame({
  projectName,
  loading,
  environment,
  status,
  children,
}: {
  projectName: string;
  loading?: boolean | undefined;
  /** Mock provider and local test identity labels; always shown, never hidden for looks. */
  environment?: string | undefined;
  /** Save state of the current view, when it has one. */
  status?: ReactNode;
  children: ReactNode;
}) {
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
              data-loading={loading || undefined}
            >
              {projectName}
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
          {status}
          {environment && (
            <Text size="xs" c="dimmed" className={classes.environment}>
              {environment}
            </Text>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}
