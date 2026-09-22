import type { ReactNode } from "react";
import { Text } from "@mantine/core";
import { CaretDown } from "@phosphor-icons/react";
import classes from "./studio.module.css";

/** The three views of the creative workspace and where each lives. */
const views = [
  { id: "script", label: "剧本", href: (base: string) => `${base}/script` },
  { id: "canvas", label: "创作台", href: (base: string) => base },
  { id: "shots", label: "镜头整理", href: (base: string) => `${base}/shots` },
] as const;
export type StudioView = (typeof views)[number]["id"];

/**
 * The frame every studio view shares: a top bar that says where you are and
 * what state the work is in, over whatever the view puts underneath.
 */
export function StudioFrame({
  projectName,
  loading,
  environment,
  status,
  view,
  base,
  menu,
  canvasSwitch,
  tools,
  account,
  children,
}: {
  projectName: string;
  loading?: boolean | undefined;
  /** Which view is open, and the studio's own address for the others. */
  view: StudioView;
  base: string;
  /** Mock provider and local test identity labels; always shown, never hidden for looks. */
  environment?: string | undefined;
  /** Save state of the current view, when it has one. */
  status?: ReactNode;
  /** The project menu behind the brand; the brand alone when absent. */
  menu?: ReactNode;
  /** The canvas switch, only while a canvas is open. */
  canvasSwitch?: ReactNode;
  /** Task and assistant switches, only while a canvas is open. */
  tools?: ReactNode;
  /** The account menu. */
  account?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={classes.studio}>
      <header className={classes.topBar}>
        <div className={classes.barGroup}>
          <div className={classes.context}>
            {menu ?? (
              <span className={classes.brand}>
                SceneDesk
                <CaretDown size={12} aria-hidden />
              </span>
            )}
            <span className={classes.divider} aria-hidden />
            <span
              className={classes.projectName}
              data-loading={loading || undefined}
            >
              {projectName}
            </span>
          </div>
          {canvasSwitch}
        </div>
        <nav className={classes.viewSwitch} aria-label="创作区视图">
          {views.map((item) =>
            item.href ? (
              <a
                key={item.id}
                className={classes.view}
                href={item.href(base)}
                aria-current={item.id === view ? "page" : undefined}
              >
                {item.label}
              </a>
            ) : (
              <span
                key={item.id}
                className={classes.view}
                aria-current={item.id === view ? "page" : undefined}
              >
                {item.label}
              </span>
            ),
          )}
        </nav>
        <div className={classes.barGroup} data-align="end">
          {status}
          {tools}
          {environment && (
            <Text size="xs" c="dimmed" className={classes.environment}>
              {environment}
            </Text>
          )}
          {account}
        </div>
      </header>
      {children}
    </div>
  );
}
