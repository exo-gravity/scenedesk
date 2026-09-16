import { useState, type ReactNode } from "react";
import {
  ActionIcon,
  Drawer,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  ArrowLeft,
  ArrowRight,
  Archive,
  FileText,
  FilmSlate,
  GearSix,
  Info,
  Stack,
} from "@phosphor-icons/react";
import { useResource, type Schema } from "./api";
import { projectPath } from "./common";
import styles from "./project-navigation.module.css";

export const projectSections = [
  { id: "script", label: "剧本", Icon: FileText },
  { id: "canvas", label: "画布", Icon: Stack },
  { id: "assets", label: "项目资产", Icon: Archive },
] as const;

/** Project browsing only; production keeps its existing retention-aware exit. */
export function ProjectNavigation({
  tenantId,
  projectId,
  section,
  scriptView,
  footer,
  environment,
}: {
  tenantId: string;
  projectId: string;
  section: string | undefined;
  scriptView: boolean;
  footer: ReactNode;
  environment: string;
}) {
  const project = useResource<Schema<"Project">>(
    projectPath(tenantId, projectId),
  );
  const narrow = useMediaQuery("(max-width: 900px)", false, {
    getInitialValueInEffect: false,
  });
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const base = `#/app/t/${tenantId}/p/${projectId}`;
  // Never render a retained query value after an access/refetch error.
  const name = project.isError
    ? "项目不可访问"
    : (project.data?.name ?? "正在读取项目");
  const active = scriptView
    ? "script"
    : section === "media"
      ? "assets"
      : section;
  const body = (compact: boolean, drawer = false) => (
    <>
      <div className={styles.brand}>
        {!compact && <strong>SceneDesk</strong>}
        {!drawer && (
          <ActionIcon
            variant="subtle"
            aria-label={compact ? "展开项目导航" : "收起项目导航"}
            aria-expanded={narrow ? drawerOpen : !compact}
            onClick={() =>
              narrow ? setDrawerOpen(true) : setCollapsed(!collapsed)
            }
          >
            {compact ? <ArrowRight size={17} /> : <ArrowLeft size={17} />}
          </ActionIcon>
        )}
      </div>
      <UnstyledButton
        component="a"
        href={`#/app/t/${tenantId}`}
        className={styles.returnLink}
        aria-label="所有项目"
        title="所有项目"
      >
        <ArrowLeft size={16} />
        {!compact && <span>所有项目</span>}
      </UnstyledButton>
      <div className={styles.identity} title={name}>
        <span className={styles.projectMark}>
          <FilmSlate size={20} />
        </span>
        {!compact && (
          <div>
            <Text size="sm" fw={600} lineClamp={2}>
              {name}
            </Text>
            <Text size="xs" c="dimmed">
              {!project.isError && project.data?.status === "archived"
                ? "已归档 · 只读"
                : "短剧项目"}
            </Text>
          </div>
        )}
      </div>
      {!compact && (
        <Text className={styles.sectionLabel} size="xs" c="dimmed">
          创作空间
        </Text>
      )}
      <nav
        aria-label={drawer ? "展开的项目导航" : "项目导航"}
        className={styles.links}
        onClick={() => setDrawerOpen(false)}
      >
        {projectSections.map(({ id, label, Icon }) => (
          <UnstyledButton
            component="a"
            key={id}
            href={`${base}/${id}`}
            title={label}
            aria-label={label}
            aria-current={active === id ? "page" : undefined}
            data-active={active === id || undefined}
            className={styles.link}
          >
            <Icon size={19} weight={active === id ? "duotone" : "regular"} />
            {!compact && <span>{label}</span>}
          </UnstyledButton>
        ))}
      </nav>
      <nav
        aria-label={drawer ? "展开的项目管理" : "项目管理"}
        className={styles.management}
        onClick={() => setDrawerOpen(false)}
      >
        <UnstyledButton
          component="a"
          href={`${base}/content`}
          title="场次管理"
          aria-label="场次管理"
          aria-current={active === "content" ? "page" : undefined}
          className={styles.link}
        >
          <FilmSlate size={17} />
          {!compact && <span>场次管理</span>}
        </UnstyledButton>
        <UnstyledButton
          component="a"
          href={base}
          title="项目设置"
          aria-label="项目设置"
          aria-current={!section ? "page" : undefined}
          className={styles.link}
        >
          <GearSix size={17} />
          {!compact && <span>项目设置</span>}
        </UnstyledButton>
      </nav>
      <div className={styles.footer}>
        {footer}
        {environment && (
          <Tooltip label={environment}>
            <span
              tabIndex={0}
              aria-label={environment}
              className={styles.environment}
            >
              <Info size={16} />
              {!compact && (
                <Text size="xs" c="dimmed">
                  {environment}
                </Text>
              )}
            </span>
          </Tooltip>
        )}
      </div>
    </>
  );
  return (
    <>
      <aside
        className={styles.navigation}
        data-collapsed={narrow || collapsed || undefined}
        aria-label="项目工作区"
      >
        {body(narrow || collapsed)}
      </aside>
      <Drawer
        opened={narrow && drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size={232}
        title="项目导航"
        closeButtonProps={{ "aria-label": "关闭项目导航" }}
        padding="sm"
      >
        <div className={styles.drawerContent}>{body(false, true)}</div>
      </Drawer>
    </>
  );
}
