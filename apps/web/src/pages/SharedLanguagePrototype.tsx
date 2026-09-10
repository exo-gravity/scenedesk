// Visual-only comparison: one scene, one layout, two palettes and three preset states.
// No production mutations, model calls, canvas engine, or final navigation decisions.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ActionIcon, Button, Textarea, UnstyledButton } from "@mantine/core";
import { Frame } from "../components/ui";
import * as I from "../icons";
import { studyVariables } from "../theme/shared-language-study";
import type { StudyTone } from "../theme/shared-language-study";
import classes from "./shared-language-prototype.module.css";

type StudyState = "idle" | "edit" | "assistant";
const states = [
  { id: "idle", label: "未选中" },
  { id: "edit", label: "局部制作" },
  { id: "assistant", label: "助手展开" },
] as const;
const nodes = [
  { id: "ref-person", label: "人物参考 · 林夏", frame: 1, x: 28, y: 104, width: 94 },
  { id: "ref-space", label: "空间参考 · 咖啡厅", frame: 0, x: 28, y: 436, width: 94 },
  { id: "sh01", label: "SH01 · 相对而坐", frame: 0, x: 196, y: 58, width: 124 },
  { id: "sh02", label: "SH02 · 迟来的追问", frame: 1, x: 196, y: 409, width: 124 },
  { id: "sh04-a", label: "SH04 / A", frame: 3, x: 366, y: 142, width: 144, adopted: true },
  { id: "sh04-b", label: "SH04 / B", frame: 3, x: 556, y: 86, width: 214 },
  { id: "sh03", label: "SH03 · 欲言又止", frame: 2, x: 850, y: 34, width: 112 },
  { id: "sh05", label: "SH05 · 被唤起的记忆", frame: 4, x: 850, y: 274, width: 112 },
  { id: "sh06", label: "SH06 · 无声的回答", frame: 5, x: 366, y: 484, width: 124 },
];

function readStudy(): { tone: StudyTone; state: StudyState } {
  const p = new URLSearchParams(location.hash.split("?")[1]);
  const state = p.get("state");
  return { tone: p.get("tone") === "dark" ? "dark" : "light", state: state === "idle" || state === "assistant" ? state : "edit" };
}

export function SharedLanguagePrototype({ onBack }: { onBack: () => void }) {
  const [selection, setSelection] = useState(readStudy);
  const [prompt, setPrompt] = useState("接触点更自然，保持右手拿起钥匙。保留人物、钥匙形状和咖啡厅光线。");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const active = selection.state !== "idle";
  const assistant = selection.state === "assistant";
  useEffect(() => {
    const sync = () => setSelection(readStudy());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  function select(patch: Partial<typeof selection>) {
    const next = { ...selection, ...patch };
    setSelection(next);
    setNotice("");
    history.replaceState(null, "", `#/directions/?study=shared&tone=${next.tone}&state=${next.state}`);
  }
  function demo(label: string) { setNotice(`${label}为视觉示意。本页只切换主题与预设状态。`); }
  function icon(label: string, glyph: ReactNode, action?: () => void) {
    return <ActionIcon variant="subtle" className={classes.icon} aria-label={label} title={label} onClick={action ?? (() => demo(label))}>{glyph}</ActionIcon>;
  }
  return (
    <main className={classes.page}>
      <div className={classes.reviewBar} aria-label="视觉对照控制">
        <div className={classes.reviewLabel}><strong>共同视觉语言</strong><span>同布局 · 仅切换明暗</span></div>
        <div className={classes.switches} role="group" aria-label="比较主题">
          <Button variant={selection.tone === "light" ? "filled" : "default"} aria-pressed={selection.tone === "light"} onClick={() => select({ tone: "light" })}>浅色</Button>
          <Button variant={selection.tone === "dark" ? "filled" : "default"} aria-pressed={selection.tone === "dark"} onClick={() => select({ tone: "dark" })}>深色</Button>
        </div>
        <div className={classes.switches} role="group" aria-label="比较操作状态">
          {states.map(s => <Button key={s.id} variant={selection.state === s.id ? "filled" : "default"} aria-pressed={selection.state === s.id} onClick={() => select({ state: s.id })}>{s.label}</Button>)}
        </div>
        <Button variant="default" onClick={() => { location.hash = "/journey/"; }}>导航与完整流程</Button>
        <Button variant="subtle" onClick={onBack}>上一轮方案</Button>
      </div>
      <section className={classes.study} style={studyVariables(selection.tone)} data-tone={selection.tone} data-study-state={selection.state} aria-label="共同语言场次效果图">
        <nav className={classes.rail} aria-label="工作区导航示意">
          <div className={classes.brand} title="片场"><I.FilmSlate size={25} weight="fill" /></div>
          {icon("项目", <I.FolderSimple size={20} />)}
          {icon("素材库", <I.Stack size={20} />)}
          {icon("生成作业", <I.Clock size={20} />)}
          <div className={classes.railBottom}>{icon("设置", <I.GearSix size={20} />)}{icon("拾光工作室", <I.UserCircle size={25} />)}</div>
        </nav>
        <div className={classes.workspace}>
          <header className={classes.context}>
            <div className={classes.breadcrumb}><span>旧钥匙</span><I.CaretRight size={12} /><span>第 1 集</span><I.CaretRight size={12} /><strong>咖啡厅</strong><span className={classes.sceneCount}>6 镜头</span></div>
            <div className={classes.contextActions}>
              <span className={classes.saved}><I.Check size={14} />已保存</span>
              <Button variant="subtle" className={classes.button} onClick={() => demo("审阅稿 v1")}>审阅稿 v1 · 待修改</Button>
              <Button variant="default" className={classes.button} leftSection={<I.Play size={14} />} onClick={() => demo("预览整场")}>预览整场</Button>
            </div>
          </header>
          <div className={classes.modeRow}>
            <div className={classes.modeTabs}><span className={classes.currentMode}>自由画布</span><UnstyledButton className={classes.modeLink} onClick={() => demo("分镜模式")}>分镜模式</UnstyledButton><span className={classes.divider} /><UnstyledButton className={classes.modeLink} onClick={() => demo("剪辑")}>剪辑</UnstyledButton></div>
            <div className={classes.utilities}>{icon("查找素材", <I.MagnifyingGlass size={17} />)}{icon("历史", <I.ArrowCounterClockwise size={17} />)}<Button className={classes.button} variant="subtle" leftSection={<I.ChatCircleText size={17} />} aria-pressed={assistant} onClick={() => select({ state: assistant ? "edit" : "assistant" })}>助手</Button></div>
          </div>
          <div className={classes.creation}>
            <div className={classes.canvasScroll}>
              <div className={classes.board}>
                <svg className={classes.connections} viewBox="0 0 1010 758" aria-hidden="true">
                  <path d="M122 222 C260 222 265 285 366 285" />
                  <path d="M122 549 C246 549 215 300 366 300" />
                  <path d="M510 300 C535 300 531 302 556 302" />
                </svg>
                {nodes.map(node => {
                  const focused = active && node.id === "sh04-b";
                  return <figure key={node.id} className={classes.node} style={{ left: node.x, top: node.y, width: node.width }} data-node-id={node.id}>
                    <figcaption><span>{node.label}</span>{node.adopted && <span className={classes.adopted}><I.Check size={12} />采用</span>}{node.id === "sh04-b" && <span className={classes.nodeState}>未采用</span>}</figcaption>
                    {node.id === "sh04-b" ? <UnstyledButton className={classes.nodeButton} data-selected={focused || undefined} aria-label="选择 SH04 候选 B" aria-pressed={focused} onClick={() => select({ state: "edit" })}><Frame index={node.frame} fit="contain" className={classes.media} alt="SH04 候选 B，手与旧钥匙，静帧示意" /></UnstyledButton> : <Frame index={node.frame} fit="contain" className={classes.media} alt={node.label} />}
                    {focused && <><span className={classes.portLeft} /><span className={classes.portRight} /></>}
                  </figure>;
                })}
                {active && <>
                  <div className={classes.objectTools} aria-label="选中素材工具">
                    {icon("标记修改位置", <I.PencilSimple size={17} />)}<span className={classes.divider} />
                    <Button className={classes.button} variant="subtle" leftSection={<I.SlidersHorizontal size={16} />} onClick={() => demo("调整画面")}>调整</Button>
                    <Button className={classes.button} variant="subtle" leftSection={<I.Sun size={16} />} onClick={() => demo("打光")}>打光</Button>
                    {icon("放大素材", <I.ArrowsOut size={17} />)}{icon("更多素材操作", <I.DotsThree size={20} />)}
                  </div>
                  <section className={classes.composer} aria-label="基于候选 B 继续制作">
                    <div className={classes.composerHeading}><span>基于 B 的新尝试</span>{icon("收起局部制作", <I.X size={15} />, () => select({ state: "idle" }))}</div>
                    <div className={classes.references}><span className={classes.reference}><Frame index={1} fit="contain" className={classes.referenceImage} />林夏</span><span className={classes.reference}><Frame index={3} fit="contain" className={classes.referenceImage} />候选 B</span><Button className={classes.button} variant="subtle" size="xs" leftSection={<I.Plus size={14} />} onClick={() => demo("添加参考")}>参考</Button></div>
                    <Textarea aria-label="新尝试提示词" value={prompt} onChange={e => setPrompt(e.currentTarget.value)} rows={2} autosize={false} classNames={{ input: classes.prompt }} />
                    <div className={classes.composerFooter}><Button className={classes.button} variant="subtle" rightSection={<I.CaretDown size={12} />} onClick={() => demo("选择模型")}>Seedance</Button><span className={classes.meta}>9:16 · 1 个候选</span><Button variant="default" className={classes.primary} onClick={() => demo("查看生成计划")}>查看生成计划<I.ArrowUpRight size={15} /></Button></div>
                  </section>
                </>}
              </div>
              <div className={classes.canvasTools}>{icon("添加内容", <I.Plus size={19} />)}<span className={classes.divider} />{icon("定位全场", <I.Crosshair size={18} />)}<span>全场 6 镜头</span></div>
            </div>
            {assistant && <aside className={classes.assistant} aria-label="场次助手">
              <div className={classes.assistantHeading}><strong>场次助手</strong>{icon("关闭助手", <I.X size={17} />, () => select({ state: "edit" }))}</div>
              <div className={classes.chatBody}><div className={classes.userMessage}>先看看这次手部动作的问题，保留其他内容。</div><div className={classes.chatReply}><I.Sparkle size={18} /><div><p>可以从候选 B 继续调整。</p><p>本次先明确手指与钥匙的接触位置，保留人物、道具形状和光线。</p><p className={classes.secondary}>参考已带入下方局部输入，生成前还可以修改。</p></div></div><div className={classes.contextReference}><I.LinkSimple size={14} />当前参考：SH04 / B · 林夏</div></div>
              <div className={classes.chatComposer}><Textarea value={message} onChange={e => setMessage(e.currentTarget.value)} aria-label="助手消息草稿" placeholder="描述你想调整的地方…" rows={3} autosize={false} classNames={{ input: classes.prompt }} /><div className={classes.chatComposerActions}>{icon("为助手添加参考", <I.Plus size={18} />)}<span>先讨论，再制作</span>{icon("发送消息示意", <I.ArrowUpRight size={18} />)}</div></div>
            </aside>}
          </div>
        </div>
      </section>
      <footer className={classes.reviewFooter}><span aria-live="polite">{notice || "共同语言已确认；深浅主题仍待评审。A / B 共用静帧示意，本页不执行生成。"}</span><span>可编辑提示词 · 切换主题保留草稿</span></footer>
    </main>
  );
}
