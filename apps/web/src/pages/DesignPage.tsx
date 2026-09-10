import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import * as I from "../icons";
import type { Navigate } from "../App";
import { assets, initialShots } from "../model";
import { tokens } from "../theme/tokens";
import {
  AssetCard,
  GenerationCard,
  InlineNote,
  MediaViewport,
  ShotCard,
  StatusLabel,
} from "../components/workspace/cards";
import type { GenerationPhase } from "../components/workspace/cards";
import { PromptComposer } from "../components/workspace/PromptComposer";
import classes from "./design.module.css";

export function DesignPage({ navigate }: { navigate: Navigate }) {
  const [tab, setTab] = useState<string | null>("controls");
  const [dialog, setDialog] = useState(false);
  const [saved, setSaved] = useState("");
  const [selected, setSelected] = useState(4);
  const [prompt, setPrompt] = useState(initialShots[3]!.prompt);
  const [phase, setPhase] = useState<GenerationPhase>("queued");
  const [errorField, setErrorField] = useState("");
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const form = useForm({
    initialValues: { name: "", camera: "特写", duration: 9 },
    validate: {
      name: (value) => (value.trim() ? null : "请填写镜头名称，便于团队定位。"),
    },
  });
  const swatches = [
    { label: "工作区", value: tokens.surface.canvas },
    { label: "面板", value: tokens.surface.panel },
    { label: "输入与浮层", value: tokens.surface.raised },
    { label: "主文字", value: tokens.text.primary },
    { label: "辅助文字", value: tokens.text.muted },
    { label: "主要动作", value: tokens.accent.solid },
  ];
  const startSimulation = () => {
    if (timer.current) clearTimeout(timer.current);
    setPhase("running");
    timer.current = setTimeout(() => {
      setPhase("processing");
      timer.current = setTimeout(() => setPhase("succeeded"), 800);
    }, 1400);
  };
  return (
    <div className={classes.page}>
      <header className={classes.heading}>
        <div>
          <Group gap="sm" mb="sm">
            <I.Palette size={16} />
            <Text size="xs" c="dimmed">
              片场 / 界面样板
            </Text>
            <Badge>v0.2 · Mantine</Badge>
          </Group>
          <h1>同一套视觉，清楚的制作判断。</h1>
          <Text c="dimmed" mt="sm">
            这些控件与场次制作页共用实现。配色、密度与组件状态可在这里直接验证。
          </Text>
        </div>
        <Group>
          <Button onClick={() => navigate("journey")}>导航与完整流程</Button>
          <Button onClick={() => { location.hash = "/directions/?study=shared&tone=light&state=edit"; }}>共同语言 · 明暗对照</Button>
          <Button onClick={() => navigate("directions")}>
            三套视觉方向
          </Button>
          <Button onClick={() => navigate("layouts")}>
            场次双模式效果图
          </Button>
          <Button
            onClick={() => navigate("scene")}
            rightSection={<I.ArrowUpRight size={16} />}
          >
            打开场次制作
          </Button>
        </Group>
      </header>
      <div className={classes.swatches}>
        {swatches.map((swatch) => (
          <div key={swatch.label}>
            <span
              className={classes.swatch}
              style={{ background: swatch.value }}
            />
            <div>
              <Text size="xs">{swatch.label}</Text>
              <Text size="xs" c="dimmed">
                {swatch.value}
              </Text>
            </div>
          </div>
        ))}
      </div>
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          <Tabs.Tab
            value="controls"
            leftSection={<I.SlidersHorizontal size={16} />}
          >
            基础控件
          </Tabs.Tab>
          <Tabs.Tab value="creative" leftSection={<I.FilmStrip size={16} />}>
            创作组件
          </Tabs.Tab>
          <Tabs.Tab value="states" leftSection={<I.CheckCircle size={16} />}>
            状态与反馈
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>
      {tab === "controls" && (
        <div className={classes.sections}>
          <section className={classes.specimen}>
            <div className={classes.sectionTitle}>
              <span>01</span>
              <h2>操作层级</h2>
              <Text size="xs" c="dimmed">
                32px 默认 · 28px 紧凑
              </Text>
            </div>
            <Text size="xs" c="dimmed" mb="lg">
              主要动作有明确落点，次要动作保持克制。
            </Text>
            <Stack gap="xl">
              <Group gap="md">
                <Button
                  variant="filled"
                  leftSection={<I.Play size={14} weight="fill" />}
                  onClick={() => setDialog(true)}
                >
                  准备生成
                </Button>
                <Button
                  leftSection={<I.Stack size={16} />}
                  onClick={() => setSaved("已演示次要操作反馈。")}
                >
                  选择参考
                </Button>
                <Button
                  variant="subtle"
                  onClick={() => setSaved("已保留当前草稿。")}
                >
                  稍后继续
                </Button>
              </Group>
              <div className={classes.sampleRow}>
                <Text size="xs" c="dimmed">
                  操作状态
                </Text>
                <Group>
                  <Button disabled>权限不足</Button>
                  <Button loading>正在提交</Button>
                  <Button
                    color="danger"
                    variant="light"
                    onClick={() =>
                      setSaved("危险操作样式示例，未删除任何内容。")
                    }
                  >
                    移除引用
                  </Button>
                  <Tooltip label="放大画面">
                    <ActionIcon
                      aria-label="样板：放大画面"
                      onClick={() => setExpanded(true)}
                    >
                      <I.ArrowsOut size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </div>
              <div className={classes.sampleRow}>
                <Text size="xs" c="dimmed">
                  紧凑工具栏
                </Text>
                <Group>
                  <Button
                    size="xs"
                    leftSection={<I.CaretLeft size={14} />}
                    onClick={() => setSaved("已演示前移反馈。")}
                  >
                    前移
                  </Button>
                  <Button
                    size="xs"
                    rightSection={<I.CaretRight size={14} />}
                    onClick={() => setSaved("已演示后移反馈。")}
                  >
                    后移
                  </Button>
                  <Badge>SH-04</Badge>
                  <Text size="xs" c="dimmed">
                    00:21 — 00:30
                  </Text>
                </Group>
              </div>
              <InlineNote>
                按 Tab
                检查焦点。暖色表示主操作或选择，浅蓝色焦点环跟随键盘位置。
              </InlineNote>
            </Stack>
          </section>
          <section className={classes.specimen}>
            <div className={classes.sectionTitle}>
              <span>02</span>
              <h2>表单与校验</h2>
              <Text size="xs" c="dimmed">
                字段 36px
              </Text>
            </div>
            <form
              onSubmit={form.onSubmit((values) =>
                setSaved(
                  `已保存样板：${values.name} / ${values.camera} / ${values.duration} 秒。`,
                ),
              )}
            >
              <Stack gap="lg">
                <TextInput
                  label="镜头名称"
                  placeholder="例如：拿起旧钥匙"
                  withAsterisk
                  {...form.getInputProps("name")}
                />
                <Group grow>
                  <Select
                    label="景别"
                    data={["全景", "中景", "近景", "特写"]}
                    {...form.getInputProps("camera")}
                  />
                  <NumberInput
                    label="计划时长"
                    min={1}
                    max={60}
                    suffix=" 秒"
                    {...form.getInputProps("duration")}
                  />
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    空名称提交可查看错误状态
                  </Text>
                  <Button type="submit">保存样板</Button>
                </Group>
              </Stack>
            </form>
          </section>
          <section className={classes.specimen}>
            <div className={classes.sectionTitle}>
              <span>03</span>
              <h2>可读与不可用</h2>
            </div>
            <Stack gap="lg">
              <TextInput
                label="固定版本"
                value="场次 01 / v1 / SH-04 / A"
                readOnly
                description="只读内容仍然可选择和复制。"
              />
              <Select
                label="模型服务"
                data={["Seedance · 待接入"]}
                value="Seedance · 待接入"
                disabled
                description="真实服务未连接，当前仅能进行本地模拟。"
              />
              <Textarea
                label="修改说明"
                value={errorField}
                onChange={(event) => setErrorField(event.currentTarget.value)}
                minRows={2}
                placeholder="保留哪些内容，需要改变哪里？"
                error={
                  errorField.trim()
                    ? undefined
                    : "错误状态示例：请填写修改要求。"
                }
              />
              <Group gap="xl">
                <Switch label="显示字幕" defaultChecked />
                <Checkbox label="保留当前参考" defaultChecked />
              </Group>
            </Stack>
          </section>
          <section className={classes.specimen}>
            <div className={classes.sectionTitle}>
              <span>04</span>
              <h2>文字与媒体</h2>
            </div>
            <div className={classes.typeSample}>
              <h1>咖啡厅的旧钥匙</h1>
              <Text size="xs" c="dimmed">
                场次标题 / 22px
              </Text>
              <Text className={classes.scriptText}>
                林夏伸出右手，拿起钥匙。她看清上面的磨痕，神情微微一变。
              </Text>
              <Text size="xs" c="dimmed">
                戏文 / 16px · 1.7 行高
              </Text>
              <Text>镜头要求、动作和提示词保持清楚可读。</Text>
              <Text size="xs" c="dimmed">
                正文 14px / 必要辅助信息 12px
              </Text>
            </div>
            <div className={classes.mediaDemo}>
              <MediaViewport
                title="4 秒媒体技术测试片，与剧目无关"
                videoSrc="/demo/technical-preview.mp4"
              />
              <Text size="xs" c="dimmed">
                4 秒技术测试片 ·
                原生播放器示例，与剧目分镜无关；专业播放器选型仍待确认。
              </Text>
            </div>
          </section>
        </div>
      )}
      {tab === "creative" && (
        <div className={classes.creativeGrid}>
          <section className={classes.specimen}>
            <div className={classes.sectionTitle}>
              <span>01</span>
              <h2>分镜卡与版本使用</h2>
            </div>
            <div className={classes.shotPair}>
              {[initialShots[3]!, initialShots[4]!].map((shot) => (
                <ShotCard
                  key={shot.id}
                  shot={{ ...shot, selected: shot.id === 4 ? "B" : "A" }}
                  clip={{
                    shotId: shot.id,
                    label: shot.label,
                    take: "A",
                    seconds: shot.seconds,
                    frame: shot.frame,
                    dialogue: shot.dialogue,
                  }}
                  selected={selected === shot.id}
                  feedbackCount={shot.id === 4 ? 1 : 0}
                  onSelect={() => setSelected(shot.id)}
                  onExpand={() => setExpanded(true)}
                />
              ))}
            </div>
            <Group mt="lg" gap="lg">
              <StatusLabel icon={<I.Check size={14} />}>B 已采用</StatusLabel>
              <StatusLabel icon={<I.FilmStrip size={14} />}>
                剪辑使用 A
              </StatusLabel>
              <StatusLabel tone="success" icon={<I.LockSimple size={14} />}>
                v1 已通过 · 状态样例
              </StatusLabel>
            </Group>
            <Text size="xs" c="dimmed" mt="md">
              选择镜头卡不会改变采用、剪辑使用或审阅状态。
            </Text>
            <div className={classes.sectionTitle}>
              <span>02</span>
              <h2>资产与固定参考</h2>
            </div>
            <div className={classes.assetPair}>
              {assets.slice(0, 2).map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onOpen={() => setExpanded(true)}
                />
              ))}
            </div>
          </section>
          <section className={classes.specimen}>
            <div className={classes.sectionTitle}>
              <span>03</span>
              <h2>本次生成</h2>
              <Text size="xs" c="dimmed">
                独立样板草稿
              </Text>
            </div>
            <PromptComposer
              value={prompt}
              onChange={setPrompt}
              references={assets.slice(0, 4)}
              onReference={() =>
                setSaved("样板参考来自场次示例的固定资产版本。")
              }
              onPrepare={() => setDialog(true)}
              onAssist={() => {
                setPrompt(
                  "保留人物与场景参考。林夏用右手拿起桌面旧钥匙，接触点自然，动作连贯。镜头固定，雨后自然光。",
                );
                setSaved("已填入本地提示样例，没有调用模型。");
              }}
            />
          </section>
        </div>
      )}
      {tab === "states" && (
        <>
          <div className={classes.stateIntro}>
            <div>
              <h2>状态说明正在发生什么</h2>
              <Text c="dimmed" mt="sm">
                生成任务、结果采用、剪辑使用和固定版本审批分别表达。
              </Text>
            </div>
            <Button
              onClick={startSimulation}
              disabled={phase === "running" || phase === "processing"}
              leftSection={<I.Play size={14} />}
            >
              演示一次状态流转
            </Button>
          </div>
          <GenerationCard
            title="本地任务演示"
            phase={phase}
            detail="仅演示排队 → 生成 → 产物处理 → 结果就绪，不调用模型，也不伪造百分比。"
          />
          <div className={classes.stateGrid}>
            <GenerationCard
              title="SH-04 / 第 3 次尝试"
              phase="running"
              detail="正在生成画面，供应商未返回准确进度。"
            />
            <GenerationCard
              title="SH-05 / 第 2 次尝试"
              phase="succeeded"
              detail="2 个候选已就绪，尚未采用，也未更新剪辑。"
            />
            <GenerationCard
              title="SH-02 / 第 2 次尝试"
              phase="failed"
              detail="参考文件不满足输入要求。修正后重新核对生成计划。"
              action={
                <Button
                  size="xs"
                  onClick={() =>
                    setSaved("已演示查看输入错误的入口；未提交新任务。")
                  }
                >
                  查看输入问题
                </Button>
              }
            />
            <GenerationCard
              title="SH-06 / 第 1 次尝试"
              phase="unknown"
              detail="提交后连接中断，任务是否被接收尚未确定。先核对已有任务。"
              action={
                <Button
                  size="xs"
                  onClick={() =>
                    setSaved(
                      "当前为未知状态样例，无真实任务可查询；没有重新生成或扣费。",
                    )
                  }
                >
                  核对已有任务
                </Button>
              }
            />
            <GenerationCard
              title="SH-03 / 第 1 次尝试"
              phase="queued"
              detail="已进入队列，尚未开始执行。"
            />
            <GenerationCard
              title="SH-01 / 第 2 次尝试"
              phase="cancelled"
              detail="已取消这次尝试，费用结算按任务事实另行展示。"
            />
          </div>
          <InlineNote>
            所有操作都是样板反馈。失败、未知提交和取消有不同恢复路径，不能统一提供“再生成一次”。
          </InlineNote>
        </>
      )}
      {saved && (
        <div className={classes.feedback} role="status">
          <I.Info size={16} />
          <Text size="xs">{saved}</Text>
          <ActionIcon aria-label="关闭样板反馈" onClick={() => setSaved("")}>
            <I.X size={14} />
          </ActionIcon>
        </div>
      )}
      <footer className={classes.footer}>
        <Text size="xs">Mantine Theme + CSS Modules · 运行样板 v0.2</Text>
        <Text size="xs">配色与密度待评审 · 专业库选择不由样板定稿</Text>
      </footer>
      <Modal
        opened={dialog}
        onClose={() => setDialog(false)}
        title="核对本次生成 · 样板"
        size={480}
      >
        <Stack gap="lg">
          <Text>SH-04 / 拿起旧钥匙</Text>
          <Select
            label="生成数量"
            data={["1 个候选", "2 个候选", "3 个候选"]}
            defaultValue="1 个候选"
          />
          <InlineNote>本地样板不会调用模型，也不会产生费用。</InlineNote>
          <Group justify="flex-end">
            <Button onClick={() => setDialog(false)}>返回编辑</Button>
            <Button
              variant="filled"
              onClick={() => {
                setDialog(false);
                setTab("states");
                startSimulation();
                setSaved("已开始本地状态演示，未调用模型。");
              }}
            >
              模拟生成 · 不计费
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={expanded}
        onClose={() => setExpanded(false)}
        title="完整画幅 · 分镜示意"
        size={560}
      >
        <MediaViewport
          frame={3}
          title="林夏拿起旧钥匙的分镜示意图"
          className={classes.expanded}
        />
        <Text size="xs" c="dimmed" mt="md">
          画面保持原有亮度与色彩，选择态在媒体外部表达。
        </Text>
      </Modal>
    </div>
  );
}
