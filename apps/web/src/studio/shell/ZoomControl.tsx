import { Menu, UnstyledButton } from "@mantine/core";
import { SidebarSimple } from "@phosphor-icons/react";
import { useReactFlow, useViewport } from "@xyflow/react";
import { canvasZoomLabel } from "../../business/canvas-viewport";
import classes from "./shell.module.css";

/** Bottom-left: the assets panel switch, the zoom, and the ways to change it. */
export function ZoomControl({
  assetsOpen,
  onAssets,
}: {
  assetsOpen: boolean;
  onAssets: () => void;
}) {
  const { zoom } = useViewport();
  const flow = useReactFlow();
  return (
    <div className={classes.corner}>
      <UnstyledButton
        className={classes.cornerTool}
        aria-label="资产"
        aria-pressed={assetsOpen}
        onClick={onAssets}
      >
        <SidebarSimple size={16} aria-hidden />
        <span>资产</span>
      </UnstyledButton>
      <Menu position="top-start" shadow="md" width={180} withinPortal>
        <Menu.Target>
          <UnstyledButton className={classes.zoom} aria-label="创作台缩放">
            {canvasZoomLabel(zoom)}
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            rightSection={<kbd className={classes.kbd} aria-hidden>⌘+</kbd>}
            onClick={() => void flow.zoomIn({ duration: 150 })}
          >
            放大
          </Menu.Item>
          <Menu.Item
            rightSection={<kbd className={classes.kbd} aria-hidden>⌘−</kbd>}
            onClick={() => void flow.zoomOut({ duration: 150 })}
          >
            缩小
          </Menu.Item>
          <Menu.Item
            rightSection={<kbd className={classes.kbd} aria-hidden>⌘0</kbd>}
            onClick={() => void flow.fitView({ padding: 0.2, duration: 200 })}
          >
            适应内容
          </Menu.Item>
          <Menu.Item onClick={() => void flow.zoomTo(1, { duration: 150 })}>
            100%
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}
