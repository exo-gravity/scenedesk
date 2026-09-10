import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import {
  ActionIcon,
  Button,
  Drawer,
  Group,
  Splitter,
  Text,
  Tooltip,
} from "@mantine/core";
import { useLocalStorage, useMediaQuery } from "@mantine/hooks";
import type { SplitterPaneSize, UseSplitterReturnValue } from "@mantine/hooks";
import { useState } from "react";
import { CaretRight, SlidersHorizontal } from "../../icons";
import classes from "./workspace.module.css";

export function WorkspaceShell({
  children,
  inspector,
}: {
  children: ReactNode;
  inspector: ReactNode;
}) {
  const narrow = useMediaQuery("(max-width: 1050px)");
  const [drawer, setDrawer] = useState(false);
  const [sizes, setSizes] = useLocalStorage<SplitterPaneSize[]>({
    key: "pianchang-mantine-scene-layout-v1",
    defaultValue: ["100%", "380px"],
  });
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(parseFloat(String(sizes[1] ?? 380)) === 0);
  }, [sizes]);
  const splitterRef = useRef<UseSplitterReturnValue>(null);
  if (narrow)
    return (
      <div className={classes.narrowWorkspace}>
        <Group justify="space-between" className={classes.narrowToolbar}>
          <Text size="xs" c="dimmed">
            镜头内容在工作区内保留
          </Text>
          <Button
            leftSection={<SlidersHorizontal size={16} />}
            onClick={() => setDrawer(true)}
          >
            镜头面板
          </Button>
        </Group>
        {children}
        <Drawer
          opened={drawer}
          onClose={() => setDrawer(false)}
          position="right"
          size={400}
          title="当前镜头"
          padding="lg"
          classNames={{
            body: classes.drawerBody,
            header: classes.drawerHeader,
          }}
        >
          {inspector}
        </Drawer>
      </div>
    );
  return (
    <div className={classes.workspace} data-testid="workspace-shell">
      <Splitter
        splitterRef={splitterRef}
        sizes={sizes}
        onSizeChange={setSizes}
        step="16px"
        shiftStep="48px"
        lineSize={1}
        resetOnDoubleClick={false}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('[role="separator"]')) {
            setSizes(["100%", "380px"]);
          }
        }}
        classNames={{
          root: classes.splitter,
          handle: classes.splitHandle,
          thumb: classes.splitThumb,
        }}
        onCollapseChange={(index, value) => {
          if (index === 1) setCollapsed(value);
        }}
      >
        <Splitter.Pane defaultSize="100%" min="420px">
          {children}
        </Splitter.Pane>
        <Splitter.Pane defaultSize="380px" min="340px" max="520px" collapsible>
          <div className={classes.inspectorSlot}>{inspector}</div>
        </Splitter.Pane>
      </Splitter>
      <Tooltip label={collapsed ? "展开镜头面板" : "收起镜头面板"}>
        <ActionIcon
          className={classes.collapseHandle}
          aria-label={collapsed ? "展开镜头面板" : "收起镜头面板"}
          onClick={() => {
            splitterRef.current?.toggleCollapse(1);
          }}
        >
          {collapsed ? (
            <SlidersHorizontal size={16} />
          ) : (
            <CaretRight size={16} />
          )}
        </ActionIcon>
      </Tooltip>
    </div>
  );
}
