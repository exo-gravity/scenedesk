import { useState } from "react";
import { Button, Group, Image, Modal, Select, Stack, Text, Title } from "@mantine/core";
import type { Navigate } from "../App";
import classes from "./layout-options.module.css";

const options = [
  {
    value: "storyboard",
    label: "分镜模式",
    description: "整个场次按镜头顺序组织；当前聚焦 SH04，中间看画面，右侧编辑输入，底部分镜条保留全场顺序。",
    detail: "当前查看 SH04 的候选 B，候选 A 仍为当前采用。",
    image: "/previews/layouts/scene-storyboard-v5.png",
  },
  {
    value: "canvas",
    label: "自由画布",
    description: "同一张场次画布容纳六个镜头、共用参考和自由笔记。当前没有选中节点，保留完整创作空间。",
    detail: "位置不决定播放顺序，历史引用连线不触发生成。可以从全场定位到 SH04，再继续局部创作。",
    image: "/previews/layouts/scene-canvas-overview-v6.png",
  },
] as const;
type Layout = (typeof options)[number]["value"];
type CanvasRange = "overview" | "detail";

function CanvasRangeChoice({ value, onChange }: {
  value: CanvasRange;
  onChange: (value: CanvasRange) => void;
}) {
  return (
    <Group gap="xs">
      <Text size="sm" c="dimmed">画布视野</Text>
      <Select aria-label="画布效果图查看范围" value={value}
        data={[{ value: "overview", label: "全场总览" }, { value: "detail", label: "局部制作 · SH04" }]}
        allowDeselect={false} w={200}
        onChange={(next) => { if (next === "overview" || next === "detail") onChange(next); }} />
    </Group>
  );
}

function LayoutChoices({ value, onChange, label }: {
  value: Layout;
  onChange: (value: Layout) => void;
  label: string;
}) {
  return (
    <Group gap="xs" role="group" aria-label={label}>
      {options.map((option) => (
        <Button key={option.value} aria-pressed={value === option.value}
          variant={value === option.value ? "filled" : "default"}
          onClick={() => onChange(option.value)}>
          {option.label}
        </Button>
      ))}
    </Group>
  );
}

export function LayoutOptionsPage({ navigate }: { navigate: Navigate }) {
  const [layout, setLayout] = useState<Layout>("storyboard");
  const [canvasRange, setCanvasRange] = useState<CanvasRange>("overview");
  const [fullscreen, setFullscreen] = useState(false);
  const mode = options.find((option) => option.value === layout)!;
  const active = layout === "canvas" && canvasRange === "detail" ? {
    ...mode,
    image: "/previews/layouts/scene-canvas-v5.png",
    description: "仍在同一张场次画布内，视口聚焦 SH04；选中候选 B 后就地编辑新尝试，助手按需展开。",
    detail: "候选 A 仍为当前采用。这里只改变画布查看范围，没有进入单镜头工作区。",
  } : mode;
  return (
    <div className={classes.page}>
      <header className={classes.heading}>
        <Stack gap="xs">
          <Title order={1} size="h3">同一场戏，两种制作模式</Title>
          <Text c="dimmed" size="sm">咖啡厅场次 · 6 个镜头。两种模式都覆盖整场；自由画布可查看全场总览或局部制作。</Text>
        </Stack>
        <Group gap="xs">
          <Button onClick={() => navigate("directions")}>三套视觉方向</Button>
          <Button onClick={() => navigate("design")}>返回视觉规范</Button>
        </Group>
      </header>
      <Group justify="space-between">
        <LayoutChoices value={layout} onChange={setLayout} label="查看制作模式效果图" />
        {layout === "canvas" && <CanvasRangeChoice value={canvasRange} onChange={setCanvasRange} />}
      </Group>
      <div className={classes.caption}>
        <Text size="sm" c="dimmed" aria-live="polite">{active.description}</Text>
        <Button onClick={() => setFullscreen(true)}>全屏查看与切换</Button>
      </div>
      <Image
        src={active.image}
        alt={`${active.label}效果图：${active.description}`}
        className={classes.preview}
      />
      <Text size="sm" c="dimmed" mt="md">{active.detail} 图内控件为视觉示意，本页支持切换与全屏查看。</Text>
      <Modal
        opened={fullscreen}
        onClose={() => setFullscreen(false)}
        title="场次双模式 · 全屏效果图"
        fullScreen
        padding="lg"
      >
        <Group justify="space-between" mb="md">
          <LayoutChoices value={layout} onChange={setLayout} label="全屏查看制作模式效果图" />
          {layout === "canvas" && <CanvasRangeChoice value={canvasRange} onChange={setCanvasRange} />}
          <Button component="a" href={active.image} target="_blank" rel="noreferrer">查看原图</Button>
        </Group>
        <Image
          src={active.image}
          alt={`${active.label}完整效果图：${active.description}`}
          className={classes.fullscreenPreview}
        />
      </Modal>
    </div>
  );
}
