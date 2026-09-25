import { useRef, useState } from "react";
import { Menu, Skeleton, Text, TextInput, Tooltip, UnstyledButton } from "@mantine/core";
import { CaretDown, Check, GearSix, MagnifyingGlass, SquaresFour } from "@phosphor-icons/react";
import { useList, type Schema } from "../../business/api";
import { tenantPath } from "../../business/common";
import classes from "../studio.module.css";
import menuClasses from "./project-menu.module.css";

/** Project context and direct, guarded links to the workspace's other projects. */
export function ProjectMenu({ tenantId, projectId, projectName, unavailable, loading }: {
  tenantId: string;
  projectId: string;
  projectName: string;
  unavailable: boolean;
  loading: boolean;
}) {
  const projects = useList<Schema<"Project">>(`${tenantPath(tenantId)}/projects`);
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState("");
  const dropdown = useRef<HTMLDivElement>(null);
  const available = projects.isError ? [] : (projects.data ?? []).filter((project) =>
    project.id === projectId ? !unavailable : project.status === "active",
  );
  const ordered = [...available].sort((a, b) =>
    Number(b.id === projectId) - Number(a.id === projectId) ||
    a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id),
  );
  const visible = ordered.filter((project) => project.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const home = `#/app/t/${tenantId}`;
  return (
    <>
      <Tooltip label="所有项目" withArrow={false} openDelay={350}>
        <UnstyledButton component="a" href={home} className={menuClasses.home} aria-label="返回项目列表">
          <SquaresFour size={20} aria-hidden />
        </UnstyledButton>
      </Tooltip>
      <span className={classes.divider} aria-hidden />
      <Menu opened={opened} onChange={(value) => { setOpened(value); if (!value) setSearch(""); }}
        position="bottom-start" offset={8} width={272} withinPortal>
        <Menu.Target>
          <UnstyledButton className={menuClasses.trigger} aria-label="项目菜单" aria-haspopup="menu" title={projectName}>
            <span className={classes.projectName} data-loading={loading || undefined}>{loading ? "正在读取项目" : projectName}</span>
            <CaretDown size={12} aria-hidden />
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown ref={dropdown} className={menuClasses.dropdown}>
          {ordered.length > 6 && (
            <TextInput className={menuClasses.search} aria-label="搜索其他项目" placeholder="搜索项目"
              leftSection={<MagnifyingGlass size={14} aria-hidden />} value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  dropdown.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
                }
              }} />
          )}
          <Menu.Label>切换项目</Menu.Label>
          <div className={menuClasses.list}>
            {projects.isPending ? (
              <div className={menuClasses.message} role="status" aria-label="正在读取项目">
                <Skeleton height={36} /><Skeleton height={36} />
              </div>
            ) : projects.isError ? (
              <>
                <Text className={menuClasses.message} size="sm" c="dimmed" role="status">项目列表暂不可用</Text>
                <Menu.Item closeMenuOnClick={false} onClick={() => void projects.refetch()}>重新加载项目</Menu.Item>
              </>
            ) : visible.length ? visible.map((project) => {
              const current = project.id === projectId;
              const duplicate = available.some((other) => other.id !== project.id && other.name === project.name);
              const content = <>
                <span className={menuClasses.name}>{project.name}</span>
                {project.status === "archived" && <span className={menuClasses.detail}>已归档 · 只读</span>}
                {duplicate && <span className={menuClasses.detail}>项目编号 {project.id}</span>}
              </>;
              const shared = {
                className: menuClasses.item,
                leftSection: <span className={menuClasses.initial} aria-hidden>{Array.from(project.name)[0]}</span>,
                rightSection: current ? <Check size={14} aria-hidden /> : null,
              };
              return current ? (
                <Menu.Item key={project.id} {...shared} aria-current="true" onClick={() => setOpened(false)}>{content}</Menu.Item>
              ) : (
                <Menu.Item key={project.id} {...shared} component="a" href={`${home}/p/${project.id}/studio`}>{content}</Menu.Item>
              );
            }) : (
              <>
                <Text className={menuClasses.message} size="sm" c="dimmed" role="status">{search.trim() ? "没有匹配的项目" : "暂无可切换的项目"}</Text>
                {search && <Menu.Item closeMenuOnClick={false} onClick={() => setSearch("")}>清空搜索</Menu.Item>}
              </>
            )}
          </div>
          <Menu.Divider />
          <Menu.Item component="a" href={`${home}/p/${projectId}`} disabled={unavailable || loading} leftSection={<GearSix size={14} aria-hidden />}>项目设置</Menu.Item>
          <Menu.Item component="a" href={home} leftSection={<SquaresFour size={14} aria-hidden />}>所有项目</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </>
  );
}
