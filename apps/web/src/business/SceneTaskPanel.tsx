import { useEffect, type ReactNode, type Ref } from "react";
import { Badge, Button, Tabs } from "@mantine/core";
import { Tray } from "@phosphor-icons/react";
import { CanvasUploadPanel, useCanvasUploads } from "./CanvasUploads";

export type SceneTaskView = "generation" | "imports";

export function SceneTasksButton({
  open,
  onClick,
  buttonRef,
}: {
  open: boolean;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const uploads = useCanvasUploads();
  const count = uploads?.rows.length ?? 0;
  const failures =
    uploads?.rows.filter(
      (row) =>
        row.error ||
        ["rejected", "expired"].includes(row.entry?.upload.status ?? ""),
    ).length ?? 0;
  const label = uploads?.error
    ? "导入记录待核对"
    : failures
      ? `导入失败 ${failures}`
      : `文件导入 ${count}`;
  return (
    <Button
      ref={buttonRef}
      size="xs"
      variant="subtle"
      aria-label="任务与结果"
      leftSection={<Tray size={16} />}
      aria-pressed={open}
      title={count || uploads?.error ? label : undefined}
      onClick={onClick}
      rightSection={
        count || uploads?.error ? (
          <Badge size="xs" variant="light" aria-label={label}>
            {uploads?.error ? "!" : count}
          </Badge>
        ) : undefined
      }
    >
      任务
    </Button>
  );
}

export function SceneTaskPanel({
  view,
  onChange,
  children,
}: {
  view: SceneTaskView | null;
  onChange: (view: SceneTaskView) => void;
  children: ReactNode;
}) {
  const uploads = useCanvasUploads();
  const count = uploads?.rows.length ?? 0;
  const value = view ?? (count || uploads?.error ? "imports" : "generation");
  useEffect(() => {
    if (view === null && (!uploads?.loading || uploads?.error)) onChange(value);
  }, [view, uploads?.loading, uploads?.error, value, onChange]);
  return (
    <Tabs
      value={value}
      onChange={(next) => {
        if (next === "generation" || next === "imports") onChange(next);
      }}
    >
      <Tabs.List grow aria-label="任务类别">
        <Tabs.Tab value="generation">生成记录</Tabs.Tab>
        <Tabs.Tab
          value="imports"
          rightSection={
            count ? (
              <Badge size="xs" variant="light">
                {count}
              </Badge>
            ) : undefined
          }
        >
          文件导入
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="generation" pt="md">
        {children}
      </Tabs.Panel>
      <Tabs.Panel value="imports" pt="md">
        <CanvasUploadPanel />
      </Tabs.Panel>
    </Tabs>
  );
}
