import { Menu, UnstyledButton } from "@mantine/core";
import { ArrowLeft, ArrowsLeftRight, CaretDown, GearSix } from "@phosphor-icons/react";
import { useList, type Schema } from "../../business/api";
import { tenantPath } from "../../business/common";
import classes from "../studio.module.css";

/**
 * The project menu behind the brand: back to the project list, switch to
 * another project of this studio, or open the project's own page (settings,
 * members, archive live there). Nothing here is a permanent nav column.
 */
export function ProjectMenu({ tenantId, projectId }: { tenantId: string; projectId: string }) {
  const projects = useList<Schema<"Project">>(`${tenantPath(tenantId)}/projects`);
  const others = (projects.data ?? []).filter((project) => project.id !== projectId && project.status === "active");
  return (
    <Menu position="bottom-start" shadow="md" width={240} withinPortal>
      <Menu.Target>
        <UnstyledButton className={classes.brand} aria-label="项目菜单" aria-haspopup="menu">
          SceneDesk
          <CaretDown size={12} aria-hidden />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item component="a" href={`#/app/t/${tenantId}`} leftSection={<ArrowLeft size={14} />}>
          返回项目列表
        </Menu.Item>
        <Menu.Sub>
          <Menu.Sub.Target>
            <Menu.Sub.Item leftSection={<ArrowsLeftRight size={14} />} disabled={!others.length}>
              切换项目
            </Menu.Sub.Item>
          </Menu.Sub.Target>
          <Menu.Sub.Dropdown>
            {others.map((project) => (
              <Menu.Item key={project.id} component="a" href={`#/app/t/${tenantId}/p/${project.id}/studio`}>
                {project.name}
              </Menu.Item>
            ))}
          </Menu.Sub.Dropdown>
        </Menu.Sub>
        <Menu.Item component="a" href={`#/app/t/${tenantId}/p/${projectId}`} leftSection={<GearSix size={14} />}>
          项目设置、成员与归档
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
