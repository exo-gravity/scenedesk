import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { assets, timecode } from "../model";
import type { DemoState, Shot } from "../model";
import type { Navigate, Notify, ReworkSource } from "../App";
import * as I from "../icons";
import { WorkspaceShell } from "../components/workspace/WorkspaceShell";
import {
  AssetCard,
  CandidateCard,
  InlineNote,
  MediaViewport,
  ShotCard,
  StatusLabel,
} from "../components/workspace/cards";
import { PromptComposer } from "../components/workspace/PromptComposer";
import classes from "../components/workspace/workspace.module.css";

type Props = {
  state: DemoState;
  setState: Dispatch<SetStateAction<DemoState>>;
  selected: number;
  setSelected: (id: number) => void;
  inspector: string;
  setInspector: (tab: string) => void;
  onExpand: (id: number) => void;
  onReplace: () => void;
  onAction: (
    action: "suggest" | "plan" | "prompt" | "rework",
    source?: ReworkSource,
  ) => void;
  notify: Notify;
  navigate: Navigate;
};

export function SceneProduction({
  state,
  setState,
  selected,
  setSelected,
  inspector,
  setInspector,
  onExpand,
  onReplace,
  onAction,
  notify,
  navigate,
}: Props) {
  const [layout, setLayout] = useState("grid");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [viewed, setViewed] = useState<{ shotId: number; take: string } | null>(
    null,
  );
  const [assetId, setAssetId] = useState<number | null>(null);
  const shot = state.shots.find((s) => s.id === selected)!;
  const clip = state.clips.find((c) => c.shotId === selected);
  // Comments are attached to a frozen version and resolved against that version's clip order.
  const feedback = state.revisions.flatMap((revision) =>
    revision.comments
      .filter((c) => !c.resolved)
      .flatMap((comment) => {
        let end = 0;
        const source = revision.clips.find((c) => {
          end += c.seconds;
          return comment.time < end;
        });
        return source
          ? [
              {
                number: revision.number,
                time: comment.time,
                text: comment.text,
                shotId: source.shotId,
              },
            ]
          : [];
      }),
  );
  const relevant = feedback.filter((f) => f.shotId === shot.id);
  const needAttention = (s: Shot) =>
    !s.selected || feedback.some((f) => f.shotId === s.id);
  const filtered = state.shots.filter(
    (s) =>
      (filter === "all" || needAttention(s)) &&
      `${s.label} ${s.intent} ${s.title}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  );
  const update = (patch: Partial<Shot>) =>
    setState((s) => ({
      ...s,
      shots: s.shots.map((item) =>
        item.id === selected ? { ...item, ...patch } : item,
      ),
    }));
  const move = (direction: -1 | 1) => {
    setState((s) => {
      const shots = [...s.shots];
      const from = shots.findIndex((item) => item.id === selected);
      const to = from + direction;
      if (to < 0 || to >= shots.length) return s;
      [shots[from], shots[to]] = [shots[to]!, shots[from]!];
      return { ...s, shots };
    });
    notify("分镜顺序已调整，剪辑草稿保留原有编排。");
  };
  const selectedAsset = assets.find((a) => a.id === assetId);
  const viewedShot = state.shots.find((s) => s.id === viewed?.shotId);
  const rightPanel = (
    <aside className={classes.inspector} aria-label="镜头检查与生成面板">
      <div className={classes.inspectorHeading}>
        <Text size="xs" c="dimmed" mb="xs">
          当前镜头 / {shot.label}
        </Text>
        <Group gap="sm">
          <h2>{shot.title}</h2>
          <Text size="xs" c="dimmed">
            {shot.camera} · {shot.seconds}s
          </Text>
        </Group>
      </div>
      {relevant[0] && (
        <div className={classes.feedback}>
          <StatusLabel tone="warning" icon={<I.ChatCircleText size={14} />}>
            v{relevant[0].number} · {timecode(relevant[0].time)} 待处理意见
          </StatusLabel>
          <Text size="xs" lineClamp={2}>
            {relevant[0].text}
          </Text>
          <Button
            size="xs"
            variant="subtle"
            onClick={() => onAction("rework", relevant[0])}
          >
            按这条意见准备修改
            <I.ArrowUpRight size={12} />
          </Button>
        </div>
      )}
      <Tabs
        value={inspector}
        onChange={(value) => value && setInspector(value)}
        className={classes.inspectorTabs}
      >
        <Tabs.List aria-label="镜头详情">
          <Tabs.Tab value="compose">生成</Tabs.Tab>
          <Tabs.Tab value="candidates">候选 {shot.candidates.length}</Tabs.Tab>
          <Tabs.Tab value="requirements">镜头要求</Tabs.Tab>
          <Tabs.Tab value="references">参考</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      <div className={classes.inspectorBody}>
        {inspector === "compose" && (
          <PromptComposer
            key={shot.id}
            value={shot.prompt}
            onChange={(prompt) => update({ prompt })}
            references={assets.slice(0, 4)}
            onReference={() => setInspector("references")}
            onPrepare={() => onAction("plan")}
            onAssist={() => onAction("prompt")}
          />
        )}
        {inspector === "requirements" && (
          <Stack gap="lg">
            <Textarea
              label="镜头意图"
              description="这个镜头需要完成的叙事与动作。"
              value={shot.intent}
              onChange={(event) =>
                update({ intent: event.currentTarget.value })
              }
              minRows={3}
            />
            <Group grow align="start">
              <Select
                label="景别"
                value={shot.camera.split(" · ")[0] ?? "中景"}
                data={["中景", "近景", "特写", "全景"]}
                onChange={(value) =>
                  value &&
                  update({
                    camera: `${value} · ${shot.camera.split(" · ")[1]}`,
                  })
                }
              />
              <NumberInput
                label="计划时长"
                aria-label="镜头计划时长"
                suffix=" 秒"
                min={1}
                max={60}
                allowDecimal={false}
                value={shot.seconds}
                onChange={(value) => {
                  if (typeof value === "number" && value >= 1 && value <= 60)
                    update({ seconds: value });
                }}
              />
            </Group>
            <div>
              <Group gap="sm" mb="md">
                <I.LinkSimple size={16} />
                <Text fw={500}>动作连续性</Text>
              </Group>
              <Stack gap="md">
                <TextInput
                  label="入镜状态"
                  value={shot.entry}
                  onChange={(event) =>
                    update({ entry: event.currentTarget.value })
                  }
                />
                <TextInput
                  label="出镜状态"
                  value={shot.exit}
                  onChange={(event) =>
                    update({ exit: event.currentTarget.value })
                  }
                />
              </Stack>
            </div>
            <div>
              <Group justify="space-between" mb="sm">
                <Text size="xs" fw={500}>
                  正式台词 / 表演
                </Text>
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={() => navigate("script")}
                >
                  查看戏文
                </Button>
              </Group>
              <Text>{shot.dialogue || "无台词，以动作与停顿表达。"}</Text>
            </div>
            <InlineNote>
              镜头规格与试作提示分别保存。修改要求不会改变已有候选或固定版本。
            </InlineNote>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                分镜排序
              </Text>
              <Group gap="sm">
                <Button
                  size="xs"
                  disabled={state.shots[0]?.id === selected}
                  onClick={() => move(-1)}
                  leftSection={<I.CaretLeft size={14} />}
                >
                  前移
                </Button>
                <Button
                  size="xs"
                  disabled={state.shots.at(-1)?.id === selected}
                  onClick={() => move(1)}
                  rightSection={<I.CaretRight size={14} />}
                >
                  后移
                </Button>
              </Group>
            </Group>
            <Button
              onClick={() => setInspector("compose")}
              rightSection={<I.ArrowRight size={14} />}
            >
              继续准备生成
            </Button>
          </Stack>
        )}
        {inspector === "candidates" && (
          <Stack gap="md">
            <div className={classes.usage}>
              <div>
                <Text size="xs" c="dimmed">
                  当前采用
                </Text>
                <strong>{shot.selected || "尚未采用"}</strong>
              </div>
              <div>
                <Text size="xs" c="dimmed">
                  剪辑实际使用
                </Text>
                <strong>{clip?.take || "尚未加入"}</strong>
              </div>
            </div>
            <Text size="xs" c="dimmed">
              下方候选共用同一张分镜示意图，用于验证版本操作。
            </Text>
            {shot.candidates.map((take) => (
              <CandidateCard
                key={take}
                shot={shot}
                take={take}
                viewed={viewed?.shotId === shot.id && viewed.take === take}
                used={clip?.take === take}
                onView={() => setViewed({ shotId: shot.id, take })}
                onAdopt={() => {
                  update({ selected: take });
                  notify(
                    `已采用 ${shot.label} / ${take}。剪辑仍使用 ${clip?.take || "未加入"}。`,
                  );
                }}
              />
            ))}
            {!shot.candidates.length && (
              <InlineNote>还没有候选，先准备参考和提示。</InlineNote>
            )}
            <Button
              disabled={!shot.selected || shot.selected === clip?.take}
              onClick={onReplace}
              leftSection={<I.FilmStrip size={16} />}
            >
              {clip ? "将当前采用用于剪辑" : "加入剪辑草稿"}
            </Button>
            <InlineNote>
              采用与更新剪辑是两个动作。旧审阅稿始终保留其原始版本。
            </InlineNote>
          </Stack>
        )}
        {inspector === "references" && (
          <Stack gap="md">
            <Text size="xs" c="dimmed">
              本场次的固定示例参考。打开可查看画面和版本。
            </Text>
            {assets.slice(0, 4).map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onOpen={() => setAssetId(asset.id)}
              />
            ))}
            <Button
              onClick={() => navigate("assets")}
              leftSection={<I.Stack size={16} />}
            >
              打开资产库
            </Button>
            <InlineNote>
              参考复用明确的版本。更新资产不会悄悄改写已有生成计划。
            </InlineNote>
          </Stack>
        )}
      </div>
    </aside>
  );
  return (
    <>
      <WorkspaceShell inspector={rightPanel}>
        <section className={classes.board} aria-label="分镜工作区">
          <Group justify="space-between" className={classes.boardToolbar}>
            <Group gap="sm">
              <h2>分镜故事板</h2>
              <Badge>{state.shots.length} 镜</Badge>
            </Group>
            <Group gap="sm">
              <Tooltip label="故事板网格">
                <ActionIcon
                  aria-label="故事板网格"
                  variant={layout === "grid" ? "default" : "subtle"}
                  aria-pressed={layout === "grid"}
                  onClick={() => setLayout("grid")}
                >
                  <I.GridFour size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="分镜列表">
                <ActionIcon
                  aria-label="分镜列表"
                  variant={layout === "list" ? "default" : "subtle"}
                  aria-pressed={layout === "list"}
                  onClick={() => setLayout("list")}
                >
                  <I.List size={16} />
                </ActionIcon>
              </Tooltip>
              <Button
                size="xs"
                leftSection={<I.Sparkle size={14} />}
                onClick={() => onAction("suggest")}
              >
                分镜建议
              </Button>
            </Group>
          </Group>
          <Group justify="space-between" className={classes.boardFilter}>
            <SegmentedControl
              size="xs"
              value={filter}
              onChange={setFilter}
              data={[
                { value: "all", label: "全部镜头" },
                {
                  value: "attention",
                  label: `需处理 ${state.shots.filter(needAttention).length}`,
                },
              ]}
            />
            <TextInput
              className={classes.search}
              aria-label="搜索镜头"
              placeholder="搜索镜头"
              leftSection={<I.MagnifyingGlass size={14} />}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </Group>
          <div className={classes.grid} data-layout={layout}>
            {filtered.map((s) => (
              <ShotCard
                key={s.id}
                shot={s}
                clip={state.clips.find((c) => c.shotId === s.id)}
                selected={selected === s.id}
                feedbackCount={feedback.filter((f) => f.shotId === s.id).length}
                onSelect={() => setSelected(s.id)}
                onExpand={() => onExpand(s.id)}
                list={layout === "list"}
              />
            ))}
            {!filtered.length && (
              <div className={classes.empty}>
                <I.MagnifyingGlass size={26} />
                <Text mt="md">没有找到对应镜头</Text>
                <Text size="xs" mt="xs">
                  换一个关键词，或切换到全部镜头。
                </Text>
                <Button
                  mt="lg"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  清除筛选
                </Button>
              </div>
            )}
            <UnstyledButton
              className={classes.addShot}
              onClick={() => onAction("suggest")}
            >
              <I.Plus size={18} />
              补充镜头
              <Text size="xs" c="dimmed">
                从戏文准备分镜建议
              </Text>
            </UnstyledButton>
          </div>
          <div className={classes.boardBottom}>
            <I.Info size={14} />
            分镜顺序与剪辑编排分别保存
            <span style={{ marginLeft: "auto" }}>9:16 · 写实短剧</span>
          </div>
        </section>
      </WorkspaceShell>
      <Modal
        opened={Boolean(viewed && viewedShot)}
        onClose={() => setViewed(null)}
        title={`${viewedShot?.label || ""} · 候选 ${viewed?.take || ""}`}
        size={620}
      >
        {viewedShot && viewed && (
          <Stack gap="lg">
            <MediaViewport
              frame={viewedShot.frame}
              title={`候选 ${viewed.take} 完整分镜示意图`}
              className={classes.expandedMedia}
            />
            <InlineNote>
              静态分镜示意，非实际生成的视频。候选之间的内容尚未接入。
            </InlineNote>
            <Group justify="space-between">
              <StatusLabel>
                {viewedShot.selected === viewed.take
                  ? `已采用 ${viewed.take}`
                  : `当前仅查看 ${viewed.take}`}
              </StatusLabel>
              <Button
                disabled={viewedShot.selected === viewed.take}
                onClick={() => {
                  setState((s) => ({
                    ...s,
                    shots: s.shots.map((item) =>
                      item.id === viewed.shotId
                        ? { ...item, selected: viewed.take }
                        : item,
                    ),
                  }));
                  notify(
                    `已采用 ${viewedShot.label} / ${viewed.take}，剪辑未自动替换。`,
                  );
                }}
              >
                采用此候选
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
      <Modal
        opened={Boolean(selectedAsset)}
        onClose={() => setAssetId(null)}
        title={
          selectedAsset
            ? `${selectedAsset.name} · ${selectedAsset.version}`
            : "参考"
        }
        size={560}
      >
        {selectedAsset && (
          <Stack gap="lg">
            <MediaViewport
              frame={selectedAsset.frame}
              title={`${selectedAsset.name} 参考示意`}
              className={classes.expandedMedia}
            />
            <Text>{selectedAsset.note}</Text>
            <InlineNote>
              当前引用 {selectedAsset.version}，本地固定参考示例。
            </InlineNote>
          </Stack>
        )}
      </Modal>
    </>
  );
}
