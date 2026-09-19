import { useState } from "react";
import { Button, Group, Progress, SegmentedControl, Stack, Text } from "@mantine/core";
import classes from "./script-journey.module.css";

/**
 * 剧本页完整旅程的效果稿（设计预览，不是生产实现）。
 * 一致性规则见 docs/research/2026-09-18-script-status-consistency-rules.md：
 *   · 状态信息只有两个合法位置 —— 通知轨（内容级）／页级横幅（项目级）
 *   · 所有状态信息用同一个 Notice 组件；语义只有四种；不用图标区分
 *   · 文案统一：全角标点、句尾带句号、不用 · 连接句子、同物同名
 */

type Tone = "info" | "warn" | "danger" | "readonly";

/** 唯一的通知组件：左色条 + 底色 + 可选标题 + 纯文字动作。 */
function Notice({
  tone,
  badge,
  title,
  children,
  links,
}: {
  tone: Tone;
  badge?: string;
  title?: string;
  children: React.ReactNode;
  /** 全部动作都是文字形态：主选加粗、次选常规（见规范「动作形态」）。 */
  links?: { label: string; strong?: boolean }[];
}) {
  return (
    <div className={`${classes.notice} ${classes[tone]}`}>
      <div className={classes.noticeBody}>
        {(badge || title) && (
          <div className={classes.noticeTitleRow}>
            {badge && <span className={classes.noticeBadge}>{badge}</span>}
            {title && <span className={classes.noticeTitle}>{title}</span>}
          </div>
        )}
        <div className={classes.noticeLine}>
          <div className={classes.noticeText}>{children}</div>
          {links && links.length > 0 && (
            <span className={classes.noticeLinks}>
              {links.map((l) => (
                <span key={l.label} className={l.strong ? classes.linkStrong : classes.link}>
                  {l.label}
                </span>
              ))}
            </span>
          )}

        </div>
      </div>
    </div>
  );
}

const DOC = [
  ["第 1 集 · 重逢", "h"],
  ["01　咖啡厅 / 日 / 内", "h2"],
  ["雨刚停。窗外的光落在桌面上。林夏与周远相对而坐，两杯咖啡已经凉了。", "p"],
  ["周远从口袋里取出一把旧钥匙，放在两人之间。", "p"],
  ["林夏（看着钥匙）", "cue"],
  ["这把钥匙，怎么会在你这里？", "p"],
  ["周远避开她的目光，手指停在杯沿。", "p"],
  ["周远", "cue"],
  ["他让我交给你。他说，你会知道。", "p"],
  ["林夏伸出右手，拿起钥匙。她看清钥匙上的磨痕，神情微微一变。", "p"],
] as const;

function Sheet({ children, note }: { children: React.ReactNode; note: string }) {
  return (
    <div className={classes.sheet}>
      <div className={classes.note}>{note}</div>
      <div className={classes.page}>
        <div className={classes.crumb}>旧钥匙 · 完整演示 › 剧本</div>
        {children}
      </div>
    </div>
  );
}

function PageHead({ action = true }: { action?: boolean }) {
  return (
    <div className={classes.head}>
      <Text className={classes.h1}>剧本</Text>
      {action && <span className={classes.dots}>⋯</span>}
    </div>
  );
}

/** 版本行：版本的属性（来源、文件名、时间、是否只读）都在这里。 */
function VersionRow({ badge, meta, right }: { badge?: string; meta: string; right?: React.ReactNode }) {
  return (
    <div className={classes.versionRow}>
      <Group gap="xs">
        {badge && <span className={classes.readonlyBadge}>{badge}</span>}
        <Text size="sm" c="dimmed">
          {meta}
        </Text>
      </Group>
      {right}
    </div>
  );
}

function DocBody({ from = 0, to = DOC.length }: { from?: number; to?: number }) {
  return (
    <div className={classes.doc}>
      {DOC.slice(from, to).map(([line, kind]) => (
        <p key={line} className={classes[kind as "h" | "h2" | "p" | "cue"]}>
          {line}
        </p>
      ))}
    </div>
  );
}

/* ① 空态 */
const V1 = (
  <Sheet note="① 无剧本 · 空态 —— 页面只剩一件事">
    <PageHead action={false} />
    <div className={classes.cta}>
      <Text fw={600}>导入你的初稿剧本</Text>
      <Text size="sm" c="dimmed" mb={8}>
        把已确定的剧本带到这里，与项目成员一起阅读。
      </Text>
      <Group gap="sm" justify="center">
        <Button size="sm" variant="default">
          导入 Word
        </Button>
        <Button size="sm" variant="default">
          从飞书导入
        </Button>
      </Group>
      <Text size="xs" c="dimmed" mt={10}>
        支持 .docx，最大 4 MB。
      </Text>
    </div>
  </Sheet>
);

/* ② 阅读 */
const V2 = (
  <Sheet note="② 有剧本 · 阅读（主屏）—— 通知轨在版本行与正文之间，位置唯一">
    <PageHead />
    <VersionRow
      meta="当前稿 · 纯文本 · 旧钥匙_第1集_初稿.docx · 8 月 12 日更新"
      right={<span className={classes.miniAction}>查看历史稿</span>}
    />
    <Notice tone="info" links={[{ label: "展开" }]}>
      导入时有 3 条说明。
    </Notice>
    <DocBody />
  </Sheet>
);

/* ③ 选段引用 */
const V3 = (
  <Sheet note="③ 选段引用 —— 未选文时不出现；出现时贴在选区旁">
    <PageHead />
    <VersionRow meta="当前稿 · 纯文本 · 旧钥匙_第1集_初稿.docx · 8 月 12 日更新" />
    <div className={classes.doc}>
      <p className={classes.h}>第 1 集 · 重逢</p>
      <p className={classes.h2}>01　咖啡厅 / 日 / 内</p>
      <p className={classes.sel}>
        雨刚停。窗外的光落在桌面上。林夏与周远相对而坐，两杯咖啡已经凉了。
      </p>
      <div className={classes.bubbleWrap}>
        <span className={classes.bubble}>带入画布</span>
        <span className={classes.bubbleHint}>当前稿 · 将带入所选原文范围</span>
      </div>
      <p className={classes.p}>周远从口袋里取出一把旧钥匙，放在两人之间。</p>
      <p className={classes.cue}>林夏（看着钥匙）</p>
    </div>
  </Sheet>
);

/* ④ 历史稿 */
const V4 = (
  <Sheet note="④ 历史稿 · 只读 —— 只读徽标属于版本行（不进通知轨），因为它是版本属性">
    <PageHead />
    <VersionRow
      badge="只读"
      meta="历史稿 · 旧钥匙_第1集_初稿.docx · 8 月 5 日"
      right={
        <Button size="compact-xs" variant="default">
          返回当前稿
        </Button>
      }
    />
    <DocBody from={0} to={6} />
    <Text size="xs" c="dimmed" className={classes.tailNote}>
      仍可选中正文带入画布，带入时会标注来源为历史稿。
    </Text>
  </Sheet>
);

/* ⑤ 导入四态 */
const V5Read = (
  <Sheet note="⑤ 导入 · 读取中 —— 通知轨告知状态，进度在同一条轨里">
    <PageHead />
    <VersionRow meta="当前稿 · 纯文本 · 旧钥匙_第1集_初稿.docx · 8 月 12 日更新" />
    <Notice tone="info">
      正在读取文件。读取期间已选文件会保留。
      <Progress value={62} size="xs" mt={8} />
    </Notice>
    <DocBody from={2} to={6} />
  </Sheet>
);

const V5Preview = (
  <Sheet note="⑤ 导入 · 预览待确认 —— 确认动作与后果说明在同一条轨里">
    <PageHead />
    <VersionRow meta="当前稿 · 纯文本 · 旧钥匙_第1集_初稿.docx · 8 月 12 日更新" />
    <Notice
      tone="info"
      links={[{ label: "确认导入", strong: true }, { label: "取消" }]}
    >
      导入还没有确认，确认后新稿成为当前依据，已有引用继续指向原版本。
    </Notice>
    <div className={classes.previewDoc}>
      <p className={classes.h2}>第 1 集 · 重逢</p>
      <p className={classes.p}>雨刚停。窗外的光落在桌面上。……</p>
    </div>
    <DocBody from={2} to={6} />
  </Sheet>
);

const V5Conflict = (
  <Sheet note="⑤ 导入 · 冲突 —— 需要决定时必须有标题；两个动作一主一次">
    <PageHead />
    <VersionRow meta="当前稿 · 纯文本 · 旧钥匙_第1集_初稿.docx · 8 月 12 日更新" />
    <Notice
      tone="warn"
      links={[
        { label: "继续导入", strong: true },
        { label: "放弃本机文件" },
      ]}
    >
      本机有一个未完成的导入，与当前稿不一致，需要你决定保留哪一份。
    </Notice>
    <DocBody from={2} to={6} />
  </Sheet>
);

const V5Failed = (
  <Sheet note="⑤ 导入 · 失败 —— 说明原因 + 可做什么，动作放在同一位置">
    <PageHead />
    <VersionRow meta="当前稿 · 纯文本 · 旧钥匙_第1集_初稿.docx · 8 月 12 日更新" />
    <Notice
      tone="danger"
      links={[{ label: "重新选择", strong: true }, { label: "尝试纯文本导入" }]}
    >
      文件无法完整解析。已选文件仍保留在本机。
    </Notice>
    <DocBody from={2} to={6} />
  </Sheet>
);

/* ⑥ 草稿恢复 */
const V6 = (
  <Sheet note="⑥ 草稿恢复 —— 与其它状态同一位置、同一句式">
    <PageHead />
    <VersionRow meta="当前稿 · 纯文本 · 旧钥匙_第1集_初稿.docx · 8 月 12 日更新" />
    <Notice tone="info" links={[{ label: "继续导入", strong: true }]}>
      文件已保留，离开后可继续导入。
    </Notice>
    <DocBody from={0} to={6} />
  </Sheet>
);

/* ⑦ 归档 */
const V7 = (
  <Sheet note="⑦ 归档 · 只读 —— 页级横幅与通知轨同一内容列、同一几何；被禁动作不显示">
    <PageHead />
    <Notice tone="readonly">
      项目已归档。仍可阅读与带入画布，恢复项目后可导入新稿。
    </Notice>
    <VersionRow badge="只读" meta="当前稿 · 纯文本 · 旧钥匙_第1集_初稿.docx" />
    <DocBody from={0} to={6} />
  </Sheet>
);

/* ⑧ 读取失败 */
const V8 = (
  <Sheet note="⑧ 读取失败 —— 保留阅读列骨架，避免布局跳动">
    <PageHead />
    <VersionRow meta="当前稿" />
    <Notice tone="danger" links={[{ label: "重试", strong: true }]}>
      剧本正文读取失败。
    </Notice>
    <div className={classes.skeletonLine} />
    <div className={classes.skeletonLine} style={{ width: "82%" }} />
    <div className={classes.skeletonLine} style={{ width: "64%" }} />
  </Sheet>
);

/* ⑨ ⋯ 菜单 */
const V9 = (
  <Sheet note="⑨ 标题行「⋯」—— 所有动作的家；分组与顺序固定">
    <div className={classes.menuDemo}>
      <PageHead />
      <div className={classes.menuPanel}>
        <div className={classes.menuGroup}>导入</div>
        <div className={classes.menuItem}>重新导入 Word</div>
        <div className={classes.menuItem}>从飞书导入</div>
        <div className={classes.menuGroup}>版本</div>
        <div className={classes.menuItem}>查看历史稿</div>
        <div className={classes.menuItem}>下载原件</div>
        <div className={classes.menuGroup}>说明</div>
        <div className={classes.menuItem}>导入说明（3 条）</div>
        <div className={classes.menuGroup}>编辑</div>
        <div className={classes.menuItem}>编辑纯文本</div>
        <div className={classes.menuGroup}>关联</div>
        <div className={classes.menuItem}>剧目设定</div>
        <div className={classes.menuItem}>创作依据</div>
      </div>
    </div>
  </Sheet>
);


/* ---- 三档完整效果：只改动作形态，信息都一行 ---- */
const DECISION = "本机有一个未完成的导入，与当前稿不一致，需要你决定保留哪一份。";

function VariantSheet({
  tag,
  note,
  actions,
}: {
  tag: string;
  note: string;
  actions: React.ReactNode;
}) {
  return (
    <div className={classes.sheet}>
      <div className={classes.note}>
        {tag} —— {note}
      </div>
      <div className={classes.page}>
        <div className={classes.crumb}>旧钥匙 · 完整演示 › 剧本</div>
        <PageHead />
        <VersionRow
          meta="当前稿 · 纯文本 · 旧钥匙_第1集_初稿.docx · 8 月 12 日更新"
          right={<span className={classes.miniAction}>查看历史稿</span>}
        />
        <div className={`${classes.notice} ${classes.warn}`}>
          <div className={classes.noticeBody}>
            <div className={classes.noticeLine}>
              <div className={classes.noticeText}>{DECISION}</div>
              {actions}
            </div>
          </div>
        </div>
        <DocBody from={2} to={7} />
      </div>
    </div>
  );
}

/** 选定的唯一形态：两个文字动作（主选加粗）。此前评估过的按钮形态已不保留。 */
const C_TwoLinks = (
  <VariantSheet
    tag="动作形态（已选定）"
    note="两个文字动作：主选加粗 + 次选常规，跟在说明后面同一行。层级交给字重，不用按钮。"
    actions={
      <span className={classes.noticeLinks}>
        <span className={classes.linkStrong}>继续导入</span>
        <span className={classes.link}>放弃本机文件</span>
      </span>
    }
  />
);

const VIEWS = {
  "① 空态": V1,
  "② 阅读": V2,
  "③ 选段引用": V3,
  "④ 历史稿": V4,
  "⑤ 导入·读取中": V5Read,
  "⑤ 导入·预览": V5Preview,
  "⑤ 导入·冲突": V5Conflict,
  "⑤ 导入·失败": V5Failed,
  "⑥ 草稿恢复": V6,
  "⑦ 归档只读": V7,
  "⑧ 读取失败": V8,
  "⑨ ⋯菜单": V9,
  "动作形态": C_TwoLinks,
} as const;

export function ScriptLayoutPreview() {
  const [view, setView] = useState<keyof typeof VIEWS>("② 阅读");
  return (
    <Stack gap="xs" p="md" className={classes.wrap}>
      <div>
        <Text fw={600}>剧本页：完整旅程与状态（一致性规则已应用）</Text>
        <Text size="xs" c="dimmed">
          设计预览稿，不是生产实现。状态信息只有两个合法位置：通知轨（内容级）与页级横幅（项目级）。
        </Text>
      </div>
      <SegmentedControl
        size="xs"
        value={view}
        onChange={(v) => setView(v as keyof typeof VIEWS)}
        data={Object.keys(VIEWS).map((k) => ({ label: k, value: k }))}
      />
      {VIEWS[view]}
    </Stack>
  );
}
