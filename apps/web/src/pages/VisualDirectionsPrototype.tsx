// Visual review only: three image-based directions, two pages each. No production mutations.
import { useEffect, useState } from "react";
import { Button, Group, Image, Modal, Stack, Text, Title } from "@mantine/core";
import type { Navigate } from "../App";
import classes from "./visual-directions-prototype.module.css";
import { SharedLanguagePrototype } from "./SharedLanguagePrototype";

const directions = [
  { id: "graphite", name: "A · 石墨沉浸", lead: "统一深色，影像优先", description: "中性石墨背景、少量暖杏强调、安静的工具层次。整体气质偏专业影像制作。", tradeoff: "优势是沉浸与连贯；文字密集页面需要更仔细地处理层级。" },
  { id: "porcelain", name: "B · 瓷白编辑", lead: "统一浅色，清晰舒展", description: "瓷白底色、墨绿强调、细边界与清楚的排版。整体气质偏现代编辑与创意工作室。", tradeoff: "优势是阅读与协作的清晰感；明亮界面对暗景素材的观看感受需要实际验证。" },
  { id: "dual", name: "C · 明暗双域", lead: "浅色管理，深色创作", description: "项目页采用浅色，创作区采用中灰；用同一钴蓝强调色、字形与控件几何保持联系。", tradeoff: "优势是适应不同任务；需要维护两种环境及其切换一致性。" },
] as const;
type Direction = (typeof directions)[number]["id"];
type Screen = "canvas" | "project";

function readSelection(): { direction: Direction; screen: Screen } {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const value = params.get("variant");
  return { direction: value === "porcelain" || value === "dual" ? value : "graphite", screen: params.get("screen") === "project" ? "project" : "canvas" };
}

export function VisualDirectionsPrototype({ navigate }: { navigate: Navigate }) {
  const readStudy = () => new URLSearchParams(location.hash.split("?")[1]).get("study") === "shared";
  const [study, setStudy] = useState(readStudy);
  useEffect(() => {
    const sync = () => setStudy(readStudy());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return study ? <SharedLanguagePrototype onBack={() => { location.hash = "/directions/"; }} /> : <LegacyVisualDirectionsPrototype navigate={navigate} />;
}

function LegacyVisualDirectionsPrototype({ navigate }: { navigate: Navigate }) {
  const [selection, setSelection] = useState(readSelection);
  const [fullscreen, setFullscreen] = useState(false);
  const active = directions.find((item) => item.id === selection.direction)!;
  const screenName = selection.screen === "canvas" ? "场次画布" : "项目页";
  const src = `/previews/visual-directions-v1/${selection.direction}-${selection.screen}.png`;

  useEffect(() => {
    const sync = () => setSelection(readSelection());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  function select(patch: Partial<typeof selection>) {
    const next = { ...selection, ...patch };
    setSelection(next);
    history.replaceState(null, "", `#/directions/?variant=${next.direction}&screen=${next.screen}`);
  }

  function controls(label: string) {
    return (
      <Group justify="space-between" gap="md" className={classes.controls}>
        <Group gap="xs" role="group" aria-label={label}>
          {directions.map((item) => (
            <Button key={item.id} variant="default" className={classes.choice}
              aria-pressed={item.id === selection.direction} onClick={() => select({ direction: item.id })}>
              {item.name}
            </Button>
          ))}
        </Group>
        <Group gap="xs" role="group" aria-label={`${label}页面`}>
          <Button variant="default" className={classes.choice} aria-pressed={selection.screen === "canvas"} onClick={() => select({ screen: "canvas" })}>场次画布</Button>
          <Button variant="default" className={classes.choice} aria-pressed={selection.screen === "project"} onClick={() => select({ screen: "project" })}>项目页</Button>
        </Group>
      </Group>
    );
  }

  return (
    <main className={classes.page}>
      <header className={classes.header}>
        <Group gap="md">
          <Title order={1} size="h2">视觉方向评审</Title>
          <Text size="xs" c="dimmed">三套方向 · 六张效果图</Text>
        </Group>
        <Group gap="xs">
          <Button onClick={() => { location.hash = "/directions/?study=shared&tone=light&state=edit"; }}>共同语言 · 明暗对照</Button>
          <Button variant="subtle" onClick={() => navigate("design")}>返回视觉样板</Button>
          <Button onClick={() => setFullscreen(true)}>全屏比较</Button>
        </Group>
      </header>
      {controls("视觉方向")}
      <div className={classes.summary} aria-live="polite">
        <Text size="sm" fw={500}>{active.lead}</Text>
        <Text size="sm" c="dimmed">{active.description}</Text>
      </div>
      <div className={classes.stage}>
        <Image src={src} alt={`${active.name} · ${screenName}效果图`} className={classes.preview} />
      </div>
      <footer className={classes.footer}>
        <Stack gap="xs">
          <Text size="sm" c="dimmed">{active.tradeoff}</Text>
          <Text size="xs" c="dimmed">先看同一页的风格差异，再切项目页看整体一致性。图中控件为静态示意，尚未选定最终方案。</Text>
        </Stack>
        <Button component="a" href={src} target="_blank" rel="noreferrer" variant="subtle">打开原图</Button>
      </footer>
      <Modal opened={fullscreen} onClose={() => setFullscreen(false)} fullScreen title="视觉方向 · 全屏比较" padding="md">
        {controls("全屏视觉方向")}
        <Image src={src} alt={`${active.name} · ${screenName}全屏效果图`} className={classes.fullscreenPreview} />
      </Modal>
    </main>
  );
}
