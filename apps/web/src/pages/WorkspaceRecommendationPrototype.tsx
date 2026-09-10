/** Disposable visual prototype on the existing journey route. One recommendation, two scene views.
 * All edits are in memory; no model execution, backend mutations or production persistence. */
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { ActionIcon, Button, Loader, Modal, NativeSelect, Popover, Textarea, TextInput, UnstyledButton } from "@mantine/core";
import { PushPin, Cursor, Hand, Selection, Minus } from "@phosphor-icons/react";
import * as I from "../icons";
import { Frame } from "../components/ui";
import { initialShots } from "../model";
import { studyVariables } from "../theme/shared-language-study";
import classes from "./workspace-recommendation.module.css";
import { WorkspaceWalkthroughPages } from "./WorkspaceWalkthroughPages";
import { makeClips, makeReviews, duration, stamp, walkTitles } from "./workspace-walkthrough-model";
import type { WalkPage, WalkJob, WalkReview, WalkNote } from "./workspace-walkthrough-model";

type Mode = "storyboard" | "canvas";
type SelectionState = { kind: "shot"; id: number } | { kind: "draft" } | null;
type Node = { id: string; x: number; y: number; w: number; h: number; title: string; shot?: number; candidate?: string; frame?: number; kind?: "key" | "note" | "draft" | "result" };
const candidateImage = "/demo/workspace-v2/key-candidate-c.png";
const keyImage = "/demo/workspace-v2/key-reference.png";
const suggestion = "右手缓缓靠近钥匙，拇指与食指先接触匙环，再自然收拢；停顿半拍后完整拿离桌面。保持五指结构自然、钥匙形状一致，保留当前光线与节奏。";
const initialPrompt = "保持林夏灰风衣与咖啡厅日景参考。右手靠近桌面上的旧铜钥匙，指尖接触匙环后轻轻收拢，再缓慢拿离桌面。特写，固定机位；动作自然克制，保持手部结构和钥匙形状一致。";
const baseNodes: Node[] = [
  { id: "person", x: 44, y: 62, w: 128, h: 202, title: "林夏 · 角色参考", frame: 1 },
  { id: "place", x: 32, y: 340, w: 154, h: 204, title: "咖啡厅 · 光线参考", frame: 0 },
  { id: "key", x: 218, y: 74, w: 156, h: 156, title: "旧铜钥匙 · v1", kind: "key" },
  { id: "note", x: 218, y: 324, w: 192, h: 151, title: "本次动作要求", kind: "note" },
  { id: "draft", x: 456, y: 224, w: 148, h: 133, title: "动作优化 · 创作草稿", kind: "draft" },
  { id: "take-a", x: 664, y: 50, w: 166, h: 284, title: "SH-04 / A · 当前采用", shot: 4, candidate: "A", frame: 3 },
  { id: "take-c", x: 884, y: 94, w: 194, h: 332, title: "SH-04 / C · 待比较", shot: 4, candidate: "C", frame: 3 },
  { id: "next", x: 1142, y: 220, w: 154, h: 260, title: "SH-05 · 接续镜头", shot: 5, candidate: "A", frame: 4 },
];
const referenceItems = [
  { id: "person", name: "林夏", type: "角色", frame: 1 },
  { id: "place", name: "咖啡厅", type: "场景", frame: 0 },
  { id: "key", name: "旧铜钥匙", type: "道具", frame: 3 },
  { id: "next", name: "林夏 · 情绪参考", type: "表演", frame: 4 },
];
function readOptions() {
  const q = new URLSearchParams(location.hash.split("?")[1]);
  const screen = q.get("screen") as WalkPage;
  return { screen: screen && screen in walkTitles ? screen : "production" as WalkPage, mode: q.get("mode") === "canvas" ? "canvas" as const : "storyboard" as const, tone: q.get("tone") === "dark" ? "dark" as const : "light" as const, assistant: q.get("assistant") === "on", assets: q.get("assets") === "on" };
}

export function WorkspaceRecommendationPrototype() {
  const [options, setOptions] = useState(readOptions);
  const [selection, setSelection] = useState<SelectionState>(() => readOptions().mode === "canvas" ? { kind: "draft" } : { kind: "shot", id: 4 });
  const [shotId, setShotId] = useState(4);
  const [shots, setShots] = useState(initialShots);
  const [clips, setClips] = useState(makeClips);
  const [reviews, setReviews] = useState(makeReviews);
  const [revision, setRevision] = useState(1);
  const [reviewFocus, setReviewFocus] = useState(4);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [reviewTime, setReviewTime] = useState(24);
  const [reworkSource, setReworkSource] = useState({ revision: 1, note: makeReviews()[0]!.notes[0]! });
  const [episodeVersion, setEpisodeVersion] = useState<number | null>(null);
  const [jobs, setJobs] = useState<WalkJob[]>([]);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [outcome, setOutcome] = useState<WalkJob['outcome']>('success');
  const [cutNote, setCutNote] = useState('根据 v1 的意见调整拿钥匙的接触动作');
  const lastCanvasSelection = useRef<SelectionState | undefined>(undefined);
  const [candidates, setCandidates] = useState<Record<number, string>>({ 4: "C" });
  const [adopted, setAdopted] = useState<Record<number, string>>({});
  const used = Object.fromEntries(clips.map(c => [c.shotId, c.take]));
  const [prompts, setPrompts] = useState<Record<string, string>>({ "4": initialPrompt, draft: initialPrompt });
  const [refs, setRefs] = useState<Record<string, string[]>>({ "4": ["person", "place", "key"], draft: ["person", "place", "key"] });
  const [reference, setReference] = useState("key");
  const [pinned, setPinned] = useState(true);
  const [compare, setCompare] = useState(false);
  const [overview, setOverview] = useState(false);
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const [assistantTab, setAssistantTab] = useState<"assistant" | "details">("assistant");
  const [request, setRequest] = useState("让手指与钥匙的接触更自然，保留原来的节奏。");
  const [applied, setApplied] = useState(false);
  const [query, setQuery] = useState("");
  const [quick, setQuick] = useState(false);
  const [refTarget, setRefTarget] = useState<string | null>("4");
  const [modal, setModal] = useState<"plan" | "preview" | "about" | "guide" | "states" | "freeze" | null>(null);
  const [notice, setNotice] = useState("");
  const [viewport, setViewport] = useState({ x: 16, y: 24, zoom: .77 });
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [panMode, setPanMode] = useState(false);
  const [width, setWidth] = useState(window.innerWidth);
  const viewportRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; id?: string; moved: boolean } | null>(null);
  const shot = shots.find(s => s.id === shotId) || initialShots[3]!;
  const usedNodeTakes = jobs.filter(j => j.status === '结果可用').map((j, i): Node => ({ id: `job-${j.id}`, x: 1400 + i * 218, y: 82, w: 176, h: 302, title: j.target === 'draft' ? `探索结果 ${j.take} · 未关联镜头` : `${targetName(j.target)} / ${j.take}`, ...(j.target !== 'draft' ? { shot: Number(j.target), frame: shots.find(s => String(s.id) === j.target)?.frame || 0, candidate: j.take } : { kind: 'result' as const }) }));
  const nodes = [...baseNodes, ...usedNodeTakes, ...shots.filter(s => ![4, 5].includes(s.id)).map((s, i): Node => ({ id: `extra-${s.id}`, x: 44 + (i % 8) * 178, y: 650 + Math.floor(i / 8) * 324, w: 150, h: 267, title: `${s.label} / A`, shot: s.id, candidate: 'A', frame: s.frame }))];
  const takes = [...new Set([...(shotId === 4 ? ['A', 'C'] : ['A']), ...jobs.filter(j => j.target === String(shotId) && j.status === '结果可用').map(j => j.take)])];
  function adoptedTakeValue() { return adopted[shotId] || 'A'; }
  function targetName(key: string) { return key === 'draft' ? '独立草稿' : `SH-${key.padStart(2, '0')}`; }
  const candidate = candidates[shotId] || "A";
  const compareTake = candidate === adoptedTakeValue() ? takes.find(t => t !== candidate) : adoptedTakeValue();
  const adoptedTake = adopted[shotId] || "A";
  const usedTake = used[shotId] || "—";
  const target = selection?.kind === "draft" ? "draft" : selection?.kind === "shot" ? String(selection.id) : null;
  const targetLabel = (key: string) => key === "draft" ? "动作优化草稿 · 未关联镜头" : `SH-${key.padStart(2, "0")}`;
  const currentRefs = target ? refs[target] || ["person", "place"] : [];
  const prompt = target ? prompts[target] ?? shots.find(s => String(s.id) === target)?.prompt ?? "" : "";
  const showComposer = target !== null && !overview && shots.length > 0;
  const currentJob = [...jobs].reverse().find(j => j.target === target);
  const held = currentJob && ['排队中', '生成中', '提交待核对'].includes(currentJob.status);
  const working = currentJob && ['排队中', '生成中'].includes(currentJob.status);
  const isProduction = options.screen === 'production';
  const isScene = ['production', 'cut', 'review'].includes(options.screen);
  const sourceTarget = String(reworkSource.note.shotId);
  const activeSuggestion = reworkSource.note.shotId === 4 ? suggestion : `修改要求：${reworkSource.note.text}。保留本镜头已经确认的人物、造型与场景参考。`;
  useEffect(() => {
    const timers = jobs.filter(j => j.status === '排队中' || j.status === '生成中').map(j => setTimeout(() => {
      const status: WalkJob['status'] = j.status === '排队中' ? '生成中' : j.outcome === 'success' ? '结果可用' : j.outcome === 'failure' ? '生成失败' : '提交待核对';
      setJobs(all => all.map(x => x.id === j.id ? { ...x, status } : x));
    }, j.status === '排队中' ? 1600 : 2400));
    return () => timers.forEach(clearTimeout);
  }, [jobs]);
  useEffect(() => {
    const sync = () => setOptions(readOptions());
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("hashchange", sync); window.addEventListener("resize", resize);
    document.title = "场次连续体验 · 设计预览";
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("resize", resize); };
  }, []);
  useEffect(() => { if (width < 1454 && options.assets && (options.assistant || jobsOpen)) change({ assets: false }); }, [width, options.assets, options.assistant, jobsOpen]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 4500); return () => clearTimeout(timer); }, [notice]);
  function change(patch: Partial<typeof options>) {
    const next = { ...options, ...patch }; setOptions(next);
    history.replaceState(null, "", `#/journey/?variant=recommendation&screen=${next.screen}&mode=${next.mode}&tone=${next.tone}&assistant=${next.assistant ? "on" : "off"}&assets=${next.assets ? "on" : "off"}`);
  }
  function mode(next: Mode) {
    if (next === options.mode) return;
    if (options.mode === 'canvas') lastCanvasSelection.current = selection;
    change({ mode: next }); setCompare(false); setOverview(false); setQuick(false);
    setSelection(next === 'storyboard' ? { kind: 'shot', id: shotId } : lastCanvasSelection.current === undefined ? { kind: 'shot', id: shotId } : lastCanvasSelection.current);
  }
  function chooseShot(id: number) { setShotId(id); setSelection({ kind: "shot", id }); setOverview(false); setCompare(false); setQuick(false); }
  function toggleAssistant() { const opening = jobsOpen || !options.assistant; setJobsOpen(false); change({ assistant: opening, ...(opening && width < 1454 ? { assets: false } : {}) }); }
  function toggleAssets() { const opening = !options.assets; setRefTarget(target); if (opening && width < 1454) setJobsOpen(false); change({ assets: opening, ...(opening && width < 1454 ? { assistant: false } : {}) }); if (opening && options.assistant && width < 1454) setNotice("已暂收起助手，建议和输入仍保留；可随时返回。"); }
  function addReference(id: string) { if (!refTarget) return; setRefs(all => ({ ...all, [refTarget]: [...new Set([...(all[refTarget] || ["person", "place"]), id])] })); setReference(id); setPinned(true); setQuick(false); setNotice(`已引用到 ${targetLabel(refTarget)}`); }
  function media(frame: number, label: string, take = "A", className = "") {
    return take !== "A" && frame === 3 ? <img src={candidateImage} alt={label} className={`${classes.media} ${className}`} /> : <Frame index={frame} alt={label} fit="contain" className={`${classes.media} ${className}`} />;
  }
  function assetMedia(id: string, className = "") { return id === "key" ? <img src={keyImage} alt="旧铜钥匙道具参考" className={`${classes.media} ${className}`} /> : media(referenceItems.find(a => a.id === id)?.frame || 0, "参考素材", "A", className); }
  function icon(label: string, content: ReactNode, action: () => void, active = false) { return <ActionIcon title={label} aria-label={label} variant="subtle" className={classes.icon} data-active={active || undefined} onClick={action}>{content}</ActionIcon>; }
  function button(label: string, action: () => void, glyph?: ReactNode, primary = false, disabled = false) { return <Button variant="default" className={`${classes.button} ${primary ? classes.primary : ""}`} leftSection={glyph} onClick={action} disabled={disabled}>{label}</Button>; }
  function applySuggestion() { setPrompts(p => ({ ...p, [sourceTarget]: `${p[sourceTarget] ?? shots.find(s => String(s.id) === sourceTarget)?.prompt ?? ''}\n${activeSuggestion}` })); setApplied(true); setNotice(`建议已追加到 ${targetLabel(sourceTarget)}，原文保留；尚未生成。`); }
  function go(screen: WalkPage) { setQuick(false); setModal(null); change({ screen }); }
  function older(page: string, view = 'production') { go(page === 'scene' ? view as WalkPage : page as WalkPage); }
  function openJobs() { setJobsOpen(!jobsOpen); change({ screen: 'production', ...(!jobsOpen && width < 1454 ? { assets: false } : {}) }); }
  function useInCut() { setClips(all => all.some(c => c.shotId === shotId) ? all.map(c => c.shotId === shotId ? { ...c, take: adoptedTake } : c) : [...all, { shotId, take: adoptedTake, seconds: shot.seconds }]); setNotice(`${shot.label} / ${adoptedTake} 已用于剪辑草稿。`); }
  function submitDemo() {
    if (!target || !prompt.trim() || held) return;
    const count = jobs.filter(j => j.target === target).length;
    const take = target === 'draft' ? String(count + 1) : String.fromCharCode((target === '4' ? 68 : 66) + count);
    setJobs(all => [...all, { id: (all.at(-1)?.id || 0) + 1, target, prompt, refs: [...currentRefs], seconds: target === 'draft' ? 5 : shot.seconds, take, outcome, status: '排队中' }]);
    setModal(null); setNotice(`已模拟提交 ${targetLabel(target)}。可继续编辑其他镜头。`);
  }
  function centerNode(n: Node | undefined) { if (!n) return; requestAnimationFrame(() => { const el = viewportRef.current; if (!el) return; const pos = positions[n.id] || n; const zoom = Math.min(1, (el.clientHeight - 120) / (n.h + 26)); setViewport({ x: el.clientWidth / 2 - (pos.x + n.w / 2) * zoom, y: el.clientHeight / 2 - (pos.y + n.h / 2) * zoom, zoom }); }); }
  function locateJob(j: WalkJob) { go('production'); if (j.target === 'draft') { change({ screen: 'production', mode: 'canvas' }); setSelection({ kind: 'draft' }); } else { chooseShot(Number(j.target)); if (j.status === '结果可用') setCandidates(c => ({ ...c, [Number(j.target)]: j.take })); } setJobsOpen(false); if (options.mode === 'canvas' || j.target === 'draft') centerNode(nodes.find(n => n.id === `job-${j.id}`)); }
  function startRework(r: WalkReview, n: WalkNote) { setReworkSource({ revision: r.number, note: { ...n } }); setRequest(n.text); setApplied(false); chooseShot(n.shotId); setComposerCollapsed(false); setAssistantTab('assistant'); setJobsOpen(false); change({ screen: 'production', assistant: true, ...(width < 1454 ? { assets: false } : {}) }); setNotice(`已定位 ${targetLabel(String(n.shotId))}；原提示词保留，意见来自 v${r.number}。`); }
  function freeze() { const number = (reviews.at(-1)?.number || 0) + 1; setReviews(all => [...all, { number, clips: structuredClone(clips), status: '待审阅', notes: [], source: cutNote || '当前剪辑草稿' }]); setRevision(number); setReviewFocus(shotId); setModal(null); go('review'); }
  function addReviewNote() { const r = reviews.find(r => r.number === revision)!; const clip = r.clips.find(c => c.shotId === reviewFocus) || r.clips[0]; const text = reviewNotes[revision]?.trim(); if (!clip || !text) return; const start = duration(r.clips.slice(0, r.clips.indexOf(clip))); const note = { id: (r.notes.at(-1)?.id || 0) + 1, shotId: clip.shotId, text, time: Math.max(start, Math.min(start + clip.seconds - 1, reviewTime)) }; setReviews(all => all.map(x => x.number === revision ? { ...x, notes: [...x.notes, note] } : x)); setReviewNotes(all => ({ ...all, [revision]: '' })); }
  function loadFixture(kind: 'normal' | 'empty' | 'many') {
    const next = kind === 'empty' ? [] : kind === 'many' ? Array.from({ length: 24 }, (_, i) => ({ ...initialShots[i % 6]!, id: i + 1, label: `SH-${String(i + 1).padStart(2, '0')}` })) : initialShots;
    setShots(next); setClips(next.map(s => ({ shotId: s.id, take: 'A', seconds: s.seconds }))); setReviews(kind === 'empty' ? [] : makeReviews()); setRevision(1); setShotId(4); setReviewFocus(4); setSelection(next.length ? { kind: 'shot', id: 4 } : null); setCandidates({ 4: 'C' }); setAdopted({}); setPrompts({ '4': initialPrompt, draft: initialPrompt }); setRefs({ '4': ['person', 'place', 'key'], draft: ['person', 'place', 'key'] }); setJobs([]); setReviewNotes({}); setApplied(false); setReworkSource({ revision: 1, note: makeReviews()[0]!.notes[0]! }); setEpisodeVersion(null); setOverview(false); setCompare(false); setJobsOpen(false); setPositions({}); setModal(null); setPinned(true); setReference("key"); setComposerCollapsed(false); setRefTarget(next.length ? "4" : null); setOutcome("success"); setQuick(false); lastCanvasSelection.current = undefined; change({ screen: 'production', mode: 'storyboard', assets: false, assistant: false });
  }
  function fit() { const el = viewportRef.current; if (!el) return; const rects = nodes.map(n => ({ ...n, ...positions[n.id] })); const minX = Math.min(...rects.map(n => n.x)) - 32; const minY = Math.min(...rects.map(n => n.y)) - 40; const maxX = Math.max(...rects.map(n => n.x + n.w)); const maxY = Math.max(...rects.map(n => n.y + n.h + 26)); const zoom = Math.min((el.clientWidth - 64) / (maxX - minX), (el.clientHeight - 80) / (maxY - minY), 1); setViewport({ x: 24 - minX * zoom, y: 44 - minY * zoom, zoom }); }
  function nodeLabel(n: Node) { return n.shot && n.candidate ? `${targetLabel(String(n.shot))} / ${n.candidate} · ${(adopted[n.shot] || "A") === n.candidate ? "当前采用" : "候选"}` : n.title; }
  function wire(from: string, to: string) {
    const a = nodes.find(n => n.id === from)!, b = nodes.find(n => n.id === to)!;
    const ap = positions[a.id] || a, bp = positions[b.id] || b;
    const x1 = ap.x + a.w, y1 = ap.y + 26 + a.h / 2, x2 = bp.x, y2 = bp.y + 26 + b.h / 2;
    const mid = (x1 + x2) / 2;
    return `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
  }
  function pointerDown(e: PointerEvent, node?: Node) {
    if (e.button !== 0) return;
    e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, startX: node ? (positions[node.id]?.x ?? node.x) : viewport.x, startY: node ? (positions[node.id]?.y ?? node.y) : viewport.y, ...(node ? { id: node.id } : {}), moved: false };
  }
  function pointerMove(e: PointerEvent) { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true; if (!d.moved) return; if (d.id) setPositions(p => ({ ...p, [d.id!]: { x: d.startX + dx / viewport.zoom, y: d.startY + dy / viewport.zoom } })); else setViewport(v => ({ ...v, x: d.startX + dx, y: d.startY + dy })); }
  function pointerUp(node?: Node) { const d = drag.current; drag.current = null; if (d?.moved || panMode) return; if (node?.kind === "draft") { setSelection({ kind: "draft" }); setQuick(false); } else if (node?.shot) { chooseShot(node.shot); if (node.candidate) setCandidates(c => ({ ...c, [node.shot!]: node.candidate! })); } else if (node?.kind === "result") { setSelection(null); setNotice("这是未关联镜头的探索结果，尚未采用或用于剪辑。"); } else if (node?.kind === "key") { setReference("key"); setPinned(true); setNotice("正在查看旧铜钥匙，当前创作目标保持不变。"); } else if (!node) setSelection(null); }

  return <main className={classes.page} style={studyVariables(options.tone)} data-tone={options.tone}>
    <div className={classes.reviewBar}><strong>一场戏 · 连续体验</strong><span>设计原型 · 刷新重置</span>{notice && <span className={classes.reviewNotice} role="status" title={notice}>{notice}</span>}<div className={classes.spacer} />{button("体验指引", () => setModal("guide"))}{button("状态演示", () => setModal("states"))}{button("专项设计", () => { location.hash = `#/journey/?variant=finishing&topic=script&tone=${options.tone}`; })}{icon("切换明暗", options.tone === "light" ? <I.Moon size={15} /> : <I.Sun size={15} />, () => change({ tone: options.tone === "light" ? "dark" : "light" }))}{icon("预览说明", <I.Info size={15} />, () => setModal("about"))}</div>
    <div className={classes.app}>
      <nav className={classes.rail} aria-label="工作室导航"><UnstyledButton className={classes.brand} aria-label="返回项目" onClick={() => older("projects")}><I.FilmSlate size={27} weight="fill" /></UnstyledButton>{[{ icon: I.FolderSimple, name: "项目", page: "projects" }, { icon: I.CheckSquare, name: "我的工作", page: "work" }, { icon: I.Stack, name: "资产", page: "library" }].map(n => <UnstyledButton key={n.page} className={classes.railItem} data-active={(n.page === "projects" ? !["work", "library"].includes(options.screen) : n.page === options.screen) || undefined} onClick={() => older(n.page)}><n.icon size={21} /><span>{n.name}</span></UnstyledButton>)}<div className={classes.spacer} />{icon("工作室设置示意", <I.GearSix size={21} />, () => setModal("about"))}<span className={classes.avatar}>予</span></nav>
      <div className={classes.workspace}>
        <header className={classes.header}>{isScene ? <div className={classes.row}>{icon("返回场次", <I.ArrowLeft size={17} />, () => older("project"))}<UnstyledButton onClick={() => older("project")}>旧钥匙</UnstyledButton><I.CaretRight size={13} /><span className={classes.secondary}>第 1 集</span><I.CaretRight size={13} /><strong>咖啡厅</strong><span className={classes.meta}>{shots.length} 个镜头</span></div> : <div className={classes.row}><strong>拾光工作室</strong><I.CaretRight size={13}/><span>{walkTitles[options.screen]}</span></div>}<div className={classes.row}><span className={`${classes.meta} ${classes.saved}`}><I.Check size={13} /> 仅本次会话保留</span>{isScene && (reviews.length ? button(`审阅稿 v${reviews.at(-1)?.number} · ${reviews.at(-1)?.status}`, () => { setRevision(reviews.at(-1)!.number); setReviewFocus(shotId); go("review"); }, <I.LockSimple size={14} />) : button("暂无审阅稿", () => {}, undefined, false, true))}{icon("生成作业", <I.Clock size={19} />, openJobs, jobsOpen)}</div></header>
        {isScene && <div className={classes.toolbar}><nav className={classes.workTabs} aria-label="工作内容"><UnstyledButton data-active={isProduction || undefined} onClick={() => go("production")}>镜头制作</UnstyledButton><UnstyledButton data-active={options.screen === "cut" || undefined} onClick={() => go("cut")}>剪辑</UnstyledButton></nav>{isProduction && <><span className={classes.divider} /><div className={classes.modeSwitch} role="group" aria-label="场次制作视图">{[{ id: "storyboard", label: "分镜", Icon: I.FilmStrip }, { id: "canvas", label: "自由画布", Icon: I.Compass }].map(v => <UnstyledButton key={v.id} aria-pressed={options.mode === v.id} onClick={() => mode(v.id as Mode)}><v.Icon size={15} />{v.label}</UnstyledButton>)}</div></>}<div className={classes.spacer} />{isProduction && <>{button("参考", toggleAssets, <I.Stack size={16} />)}{button(options.assistant ? "收起助手" : "助手", toggleAssistant, <I.ChatCircleText size={16} />, false, shots.length === 0)}</>}</div>}
        <div className={classes.body}>
          {!isProduction ? <WorkspaceWalkthroughPages page={options.screen} shots={shots} clips={clips} reviews={reviews} revision={revision} focus={options.screen === 'review' ? reviewFocus : shotId} adopted={adopted} episodeVersion={episodeVersion} note={reviewNotes[revision] || ''} time={reviewTime} setNote={v => setReviewNotes(all => ({ ...all, [revision]: v }))} setTime={setReviewTime} go={page => { if (options.screen === 'review' && page === 'production') chooseShot(reviewFocus); go(page); }} choose={id => options.screen === 'review' ? setReviewFocus(id) : chooseShot(id)} selectRevision={setRevision} updateClips={setClips} freeze={() => setModal('freeze')} reviewStatus={status => setReviews(all => all.map(r => r.number === revision ? { ...r, status } : r))} addNote={addReviewNote} rework={startRework} include={setEpisodeVersion} media={media} assetMedia={assetMedia}/> : <>
          {options.assets && <aside className={classes.assets} aria-label="参考浏览"><div className={classes.panelHead}><strong>参考素材</strong>{icon("收起参考浏览", <I.X size={16} />, toggleAssets)}</div><div className={classes.assetSearch}><TextInput aria-label="搜索参考素材" placeholder="搜索角色、场景、道具" leftSection={<I.MagnifyingGlass size={14} />} value={query} onChange={e => setQuery(e.currentTarget.value)} classNames={{ input: classes.field }} /><div className={classes.scope}>项目与工作室<span>4 项</span></div></div><div className={classes.assetList}>{!referenceItems.some(a => a.name.includes(query)) && <div className={classes.searchEmpty}><p>没有匹配的参考素材</p>{button("清空搜索", () => setQuery(""))}</div>}{referenceItems.filter(a => a.name.includes(query)).map(a => <article key={a.id} className={classes.assetItem}><UnstyledButton aria-label={`查看${a.name}`} onClick={() => { setReference(a.id); setPinned(true); }}>{assetMedia(a.id)}</UnstyledButton><div className={classes.row}><strong>{a.name}</strong><span className={classes.meta}>{a.id === "next" ? "工作室共享" : a.type} · v1</span></div>{button(`引用到 ${refTarget ? targetLabel(refTarget) : "未选择对象"}`, () => addReference(a.id), <I.Plus size={13} />, false, !refTarget || (refs[refTarget] || ["person", "place"]).includes(a.id))}</article>)}</div><div className={classes.panelFooter}>{refTarget ? `引用目标固定为 ${targetLabel(refTarget)}` : "先选择镜头或草稿，再添加引用"}</div></aside>}
          <section className={classes.central} aria-label="场次创作区">
            {shots.length === 0 ? <div className={classes.emptyScene}><I.FilmStrip size={36}/><h1>从这场戏开始</h1><p>先准备戏文和角色参考，再拆出镜头。自由探索的内容可以稍后关联镜头。</p>{button("载入六镜头示例", () => loadFixture('normal'), <I.Plus size={15}/>, true)}<span className={classes.meta}>当前为空场次设计状态；按钮载入本地示例。</span></div> : options.mode === "storyboard" ? <>
              <div className={classes.previewHeader}><div><div className={classes.eyebrow}>{overview ? "本场全部镜头" : `${shot.label} / ${candidate} · 正在查看`}</div><h1>{overview ? "咖啡厅 · 分镜总览" : shot.title}</h1></div><div className={classes.row}>{overview ? button("返回当前镜头", () => setOverview(false), <I.ArrowLeft size={14} />) : <><div className={classes.takeSwitch} role="group" aria-label="候选版本">{takes.map(c => <UnstyledButton key={c} aria-label={`查看候选 ${c}`} aria-pressed={candidate === c} onClick={() => setCandidates(x => ({ ...x, [shotId]: c }))}>{c}{adoptedTake === c && <I.Check size={11} />}</UnstyledButton>)}</div>{icon("比较候选", <I.SquaresFour size={18} />, () => { if (!compareTake) { setNotice("至少需要两个候选才能比较。"); return; } setCompare(!compare); setComposerCollapsed(!compare); }, compare)}{icon("放大预览", <I.ArrowsOut size={18} />, () => setModal("preview"))}</>}</div></div>
              {overview ? <div className={classes.overview}>{shots.map(s => <UnstyledButton key={s.id} onClick={() => chooseShot(s.id)}>{media(s.frame, s.title, adopted[s.id] || "A")}<strong>{s.label} · {s.title}</strong><span>{s.seconds}s · 采用 {adopted[s.id] || "A"}</span></UnstyledButton>)}</div> : <div className={classes.previewStage}>
                <div className={classes.heroMedia} data-compare={compare || undefined}>{compare && compareTake && <figure>{media(shot.frame, `${shot.label} 候选 ${compareTake}`, compareTake)}<figcaption>{compareTake} · {compareTake === adoptedTake ? "当前采用" : "对比候选"}</figcaption></figure>}<figure>{media(shot.frame, `${shot.label} 候选 ${candidate}`, candidate)}<figcaption>{candidate} · {shot.camera} · {shot.seconds}s <span>静帧预览</span></figcaption></figure></div>
                {pinned && !compare && <aside className={classes.pinnedReference} aria-label="固定参考"><div className={classes.row}><PushPin size={13} /><span>固定参考</span>{icon("收起固定参考", <I.X size={13} />, () => setPinned(false))}</div><UnstyledButton aria-label="固定参考：可从参考浏览切换" onClick={toggleAssets}>{assetMedia(reference)}</UnstyledButton><strong>{referenceItems.find(a => a.id === reference)?.name} <span>v1</span></strong><p>{reference === "key" ? "保留匙环、磨痕与铜色" : "保持人物与场景一致"}</p><div className={classes.continuity}><I.ArrowRight size={14} /><span>{shot.exit}<br /><small>{shots[shots.indexOf(shot) + 1] ? `接 ${shots[shots.indexOf(shot) + 1]!.label}` : "本场最后一个镜头"}</small></span></div></aside>}
              </div>}
              {!overview && <div className={classes.previewFooter}><span className={classes.facts}>采用 <b>{adoptedTake}</b><span>·</span>剪辑用 <b>{usedTake}</b></span><div className={classes.spacer} />{!pinned && button("固定参考", () => setPinned(true), <PushPin size={14} />)}{button(`采用 ${candidate}`, () => { setAdopted(a => ({ ...a, [shotId]: candidate })); setNotice(`${shot.label} 已采用 ${candidate}，剪辑仍使用 ${usedTake}。`); }, <I.Check size={14} />, false, candidate === adoptedTake)}{adoptedTake !== usedTake && button(`将 ${adoptedTake} 用于剪辑`, useInCut)}</div>}
            </> : <div ref={viewportRef} className={classes.canvas} aria-label="自由画布" data-pan={panMode || undefined} onPointerDown={e => pointerDown(e)} onPointerMove={pointerMove} onPointerUp={() => pointerUp()} onWheel={e => { if (e.ctrlKey || e.metaKey) setViewport(v => ({ ...v, zoom: Math.max(.35, Math.min(1.5, v.zoom - e.deltaY / 900)) })); else setViewport(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })); }}>
              <div className={classes.canvasCaption}>咖啡厅 <span>／</span> 动作与接续探索 <span>·</span> {nodes.length} 项内容</div>
              <div className={classes.canvasWorld} style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}><svg className={classes.wires} viewBox="0 0 1330 600">{[["person", "draft"], ["key", "draft"], ["place", "draft"], ["note", "draft"], ["draft", "take-a"], ["draft", "take-c"]].map(([a, b]) => <path key={`${a}-${b}`} d={wire(a!, b!)} />)}</svg>{nodes.map(n => <div key={n.id} className={classes.node} style={{ left: positions[n.id]?.x ?? n.x, top: positions[n.id]?.y ?? n.y, width: n.w } as CSSProperties} onPointerDown={e => pointerDown(e, panMode ? undefined : n)} onPointerMove={pointerMove} onPointerUp={e => { e.stopPropagation(); pointerUp(n); }}><div className={classes.nodeTitle}>{n.kind === "draft" ? <I.Sparkle size={14} /> : n.kind === "note" ? <I.TextT size={14} /> : <I.ImageSquare size={14} />}<span>{nodeLabel(n)}</span></div>{(selection?.kind === "draft" && n.kind === "draft" || selection?.kind === "shot" && n.shot === selection.id && n.candidate === candidate) && <div className={classes.nodeTools} onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>{button("编辑输入", () => { setComposerCollapsed(false); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("[aria-label=\"当前创作输入\"] textarea")?.focus()); }, <I.PencilSimple size={14} />)}{n.shot && icon("放大当前节点", <I.ArrowsOut size={16} />, () => setModal("preview"))}</div>}<UnstyledButton className={classes.nodeBody} data-selected={selection?.kind === "draft" && n.kind === "draft" || selection?.kind === "shot" && n.shot === selection.id && n.candidate === candidate || undefined} style={{ height: n.h }} aria-label={`选择${nodeLabel(n)}`} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pointerUp(n); } if (e.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); setPositions(p => ({ ...p, [n.id]: { x: (p[n.id]?.x ?? n.x) + (e.key === "ArrowRight" ? 20 : e.key === "ArrowLeft" ? -20 : 0), y: (p[n.id]?.y ?? n.y) + (e.key === "ArrowDown" ? 20 : e.key === "ArrowUp" ? -20 : 0) } })); } }}>
                {n.kind === "result" ? media(3, n.title, "C") : n.kind === "key" ? assetMedia("key") : n.kind === "note" ? <div className={classes.note}><span>保留</span><p>人物、灰风衣、自然日光</p><span>调整</span><p>先接触 → 收拢 → 拿离<br />保持接续时钥匙在右手</p></div> : n.kind === "draft" ? <div className={classes.draftNode}><I.Sparkle size={24} /><strong>准备下一次尝试</strong><span>3 份参考 · 视频草稿</span><span>未关联镜头</span></div> : media(n.frame || 0, nodeLabel(n), n.candidate)}
              </UnstyledButton></div>)}</div>
              <div className={classes.canvasTools} onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}>{icon("选择工具", <Cursor size={17} />, () => setPanMode(false), !panMode)}{icon("平移工具", <Hand size={17} />, () => setPanMode(true), panMode)}<span className={classes.divider} />{icon("缩小画布", <Minus size={16} />, () => setViewport(v => ({ ...v, zoom: Math.max(.35, v.zoom - .1) })))}<span>{Math.round(viewport.zoom * 100)}%</span>{icon("放大画布", <I.Plus size={16} />, () => setViewport(v => ({ ...v, zoom: Math.min(1.5, v.zoom + .1) })))}{icon("适应内容", <Selection size={17} />, fit)}{icon("定位当前内容", <I.ArrowsOut size={17}/>, () => centerNode(nodes.find(n => selection?.kind === "draft" ? n.id === "draft" : selection?.kind === "shot" ? n.shot === selection.id && n.candidate === candidate : false)))}<span className={classes.divider} />{icon("编辑探索草稿", <I.Plus size={18} />, () => setSelection({ kind: "draft" }))}</div>
            </div>}
            {showComposer && <section className={classes.composer} data-collapsed={composerCollapsed || undefined} aria-label="当前创作输入"><div className={classes.composerTop}><strong><I.PencilSimple size={14} />{targetLabel(target!)} <span>创作输入</span></strong><div className={classes.spacer} /><span className={classes.meta}>{target === sourceTarget ? `返工来源 · v${reworkSource.revision} / ${stamp(reworkSource.note.time)}` : target === "draft" ? "自由探索" : shot.camera}</span>{icon(composerCollapsed ? "展开创作输入" : "收起创作输入", <I.CaretDown size={15} style={composerCollapsed ? { transform: "rotate(180deg)" } : undefined} />, () => setComposerCollapsed(!composerCollapsed))}</div>{!composerCollapsed && <><div className={classes.references}>{currentRefs.map(id => <div key={id} className={classes.referenceWrap}><UnstyledButton key={id} className={classes.reference} aria-label={`固定查看${referenceItems.find(a => a.id === id)?.name}`} onClick={() => { setReference(id); setPinned(true); }}>{assetMedia(id)}<span>{referenceItems.find(a => a.id === id)?.name}</span></UnstyledButton>{icon(`移除参考 ${referenceItems.find(a => a.id === id)?.name}`, <I.X size={11}/>, () => setRefs(all => ({ ...all, [target!]: currentRefs.filter(x => x !== id) })))}</div>)}<Popover opened={quick} onChange={setQuick} position="top-start" withinPortal><Popover.Target><Button className={classes.addReference} variant="subtle" leftSection={<I.Plus size={13} />} onClick={() => { setRefTarget(target!); setQuick(!quick); }}>加参考</Button></Popover.Target><Popover.Dropdown className={classes.quickPicker} style={studyVariables(options.tone)}><strong>引用到 {refTarget ? targetLabel(refTarget) : "未选择对象"}</strong>{referenceItems.map(a => <UnstyledButton key={a.id} onClick={() => addReference(a.id)}>{assetMedia(a.id)}<span>{a.name} · v1</span><I.Plus size={13} /></UnstyledButton>)}</Popover.Dropdown></Popover></div><Textarea aria-label={`${targetLabel(target!)}提示词`} value={prompt} onChange={e => { const value = e.currentTarget.value; setPrompts(p => ({ ...p, [target!]: value })); }} classNames={{ input: classes.prompt }} /><div className={classes.composerFoot}><UnstyledButton className={classes.model} onClick={() => setModal("plan")}><I.Sparkle size={15} /><strong>Seedance</strong><I.CaretDown size={12} /></UnstyledButton><span className={classes.divider} /><span className={classes.meta}>9:16 · {target === "draft" ? 5 : shot.seconds}s · 视频</span><div className={classes.spacer} />{button(held ? currentJob!.status : "查看生成计划", () => setModal("plan"), <I.ArrowRight size={15} />, true, !!held || !prompt.trim())}</div></>}</section>}
            {currentJob && <div className={classes.jobStrip} aria-label="当前对象生成状态"><div className={classes.row}>{working ? <Loader size={13} color="var(--study-secondary)"/> : <I.Info size={14}/>}<strong>{targetName(currentJob.target)} · {currentJob.status}</strong><span className={classes.meta}>{currentJob.status === "生成失败" ? "模型服务暂不可用，原输入已保留" : currentJob.status === "提交待核对" ? "提交结果未知，请先核对，暂不再次提交" : currentJob.status === "结果可用" ? `新增 ${currentJob.take}，采用与用片保持原样` : "可继续编辑；此次输入已固定"}</span></div>{currentJob.status === "结果可用" ? button(`查看结果 ${currentJob.take}`, () => locateJob(currentJob)) : currentJob.status === "生成失败" ? button("编辑后重新提交", () => setModal("plan")) : currentJob.status === "提交待核对" ? button("查看作业", () => setJobsOpen(true)) : null}</div>}{options.mode === "storyboard" && shots.length > 0 && <nav className={classes.filmstrip} aria-label="场次分镜条">{shots.map(s => <UnstyledButton key={s.id} className={classes.shot} data-selected={s.id === shotId || undefined} aria-label={`选择 ${s.label}`} onClick={() => chooseShot(s.id)}>{media(s.frame, s.title, adopted[s.id] || "A")}<span><strong>{s.label}<small>{s.seconds}s</small></strong><span>{s.title}</span><small>{`采用 ${adopted[s.id] || "A"}`}</small></span></UnstyledButton>)}<UnstyledButton className={classes.allShots} onClick={() => setOverview(!overview)} aria-pressed={overview}><I.GridFour size={19} /><span>全场总览</span></UnstyledButton></nav>}
          </section>
          {jobsOpen ? <aside className={classes.assistant} aria-label="生成作业"><div className={classes.panelHead}><strong>生成作业 · 本场次</strong>{icon('关闭生成作业', <I.X size={16}/>, () => setJobsOpen(false))}</div><div className={classes.assistantBody}>{jobs.length === 0 ? <p className={classes.secondary}>还没有生成作业。从创作输入查看计划，再模拟提交。</p> : [...jobs].reverse().map(j => <article key={j.id} className={classes.jobCard}><div className={classes.row}><strong>{targetName(j.target)} · {j.take}</strong><span>{j.status}</span></div><p>{j.status === '提交待核对' ? '提交回执未确认。原任务可能仍在执行。' : j.status === '生成失败' ? '服务暂不可用。可以修改输入后重新提交。' : j.status === '结果可用' ? '示意结果已就绪，尚未自动采用。' : '当前为模拟作业，可以继续其他编辑。'}</p><details><summary>本次提交的输入</summary><p>{j.prompt}</p><span className={classes.meta}>{j.refs.map(id => referenceItems.find(a => a.id === id)?.name).join('、')} · {j.seconds}s</span></details>{button(j.status === '结果可用' ? '定位结果' : '回到来源', () => locateJob(j))}{j.status === '提交待核对' && button('模拟核对：确认未成功', () => setJobs(all => all.map(x => x.id === j.id ? { ...x, status: '生成失败' } : x)))}</article>)}</div></aside> : options.assistant && <aside className={classes.assistant} aria-label="创作助手"><div className={classes.panelHead}><strong><I.Sparkle size={17} />创作助手</strong>{icon("关闭助手", <I.X size={17} />, toggleAssistant)}</div><div className={classes.assistantTabs} role="group" aria-label="辅助内容"><UnstyledButton aria-pressed={assistantTab === "assistant"} onClick={() => setAssistantTab("assistant")}>修改建议</UnstyledButton><UnstyledButton aria-pressed={assistantTab === "details"} onClick={() => setAssistantTab("details")}>镜头详情</UnstyledButton></div><div className={classes.assistantBody}>{assistantTab === "assistant" ? <><div className={classes.source}><I.LinkSimple size={13} /><span>{targetLabel(sourceTarget)} · 审阅稿 v{reworkSource.revision} · {stamp(reworkSource.note.time)}</span></div><blockquote>“{reworkSource.note.text}”</blockquote><div className={classes.reply}>{reworkSource.note.shotId !== 4 ? <><strong>按意见准备修改</strong><p>{activeSuggestion}</p></> : <><div className={classes.replyHead}><I.Sparkle size={17} /><strong>把动作拆成三个清楚的阶段</strong></div><p>保留人物与光线，只调整接触动作。</p><ol><li><strong>接触</strong><span>拇指与食指先触碰匙环，手指不要穿过金属。</span></li><li><strong>收拢</strong><span>自然夹住匙环，停顿半拍，形成明确的受力关系。</span></li><li><strong>拿离</strong><span>整把钥匙离开桌面；出镜仍在林夏右手，衔接下一镜。</span></li></ol><div className={classes.source}><I.LinkSimple size={13} /><span>引用：旧铜钥匙 v1 · 保留形状与磨痕</span></div></>}</div></> : <div className={classes.details}><h2>{shot.label} · {shot.title}</h2><p>{shot.intent}</p><dl><dt>景别与运动</dt><dd>{shot.camera}</dd><dt>入镜状态</dt><dd>{shot.entry}</dd><dt>出镜状态</dt><dd>{shot.exit}</dd><dt>对白</dt><dd>{shot.dialogue || "无对白，保留环境声"}</dd></dl></div>}</div>{assistantTab === "assistant" && <div className={classes.assistantApply}>{button(applied ? `已加入 ${targetLabel(sourceTarget)} 提示词` : `加入 ${targetLabel(sourceTarget)} 提示词`, applySuggestion, <I.ArrowLeft size={14} />, false, applied)}<span>保留原文，可继续手动修改</span></div>}<div className={classes.assistantInput}><div className={classes.row}><span><I.LinkSimple size={12} /> 作用于 {targetLabel(sourceTarget)}</span><div className={classes.spacer} /><span>按意见准备修改</span></div><Textarea aria-label="给助手的修改要求" value={request} onChange={e => setRequest(e.currentTarget.value)} classNames={{ input: classes.assistantPrompt }} /><div className={classes.row}><span className={classes.meta}>建议示意 · 不执行模型</span><div className={classes.spacer} />{icon("查看修改建议示意", <I.ArrowUpRight size={18} />, () => { setAssistantTab("assistant"); setNotice("当前展示固定修改建议，输入仅在本次预览保留。"); })}</div></div></aside>}
          </>}
        </div>
      </div>
    </div>
    <Modal opened={modal !== null} onClose={() => setModal(null)} title={modal === 'preview' ? `${shot.label} / ${candidate} · 静帧预览` : modal === 'plan' ? '核对本次生成计划' : modal === 'freeze' ? '生成固定审阅稿' : modal === 'guide' ? '用一场戏体验这套工作台' : modal === 'states' ? '原型状态演示' : '预览说明'} size={modal === 'preview' ? 'lg' : 'md'} classNames={{ content: classes.modal, header: classes.modalHeader }} styles={{ content: studyVariables(options.tone) }}>
      {modal === 'preview' ? <div className={classes.expanded}>{media(shot.frame, shot.title, candidate)}</div> : modal === 'plan' ? <div className={classes.plan}><p><strong>目标：</strong>{target ? targetLabel(target) : '未选择创作对象'}</p><p><strong>模型：</strong>Seedance · 9:16 · {target === 'draft' ? 5 : shot.seconds}s</p><p className={classes.planPrompt}>{prompt}</p><p>参考：{currentRefs.map(id => `${referenceItems.find(a => a.id === id)?.name} v1`).join('、') || '未添加'}</p><NativeSelect label="本次模拟结果" value={outcome} onChange={e => setOutcome(e.currentTarget.value as WalkJob['outcome'])} data={[{ value: 'success', label: '成功 · 生成新候选' }, { value: 'failure', label: '失败 · 保留原输入' }, { value: 'unknown', label: '提交待核对 · 暂不再次提交' }]} classNames={{ input: classes.field }}/><p className={classes.meta}>设计演示，不调用模型或产生费用；结果复用示意静帧。</p>{button('模拟提交', submitDemo, <I.ArrowRight size={15}/>, true, !target || !prompt.trim() || !!held)}</div> : modal === 'freeze' ? <div className={classes.plan}><p>{clips.length} 个镜头 · {stamp(duration(clips))}。固定当前用片、顺序与时长。</p><Textarea label="这次修改了什么" value={cutNote} onChange={e => setCutNote(e.currentTarget.value)} minRows={3} autosize classNames={{ input: classes.field }}/><p className={classes.meta}>新稿不继承旧稿的审阅结论。</p>{button(`固定为 v${(reviews.at(-1)?.number || 0) + 1}`, freeze, <I.LockSimple size={14}/>, true)}</div> : modal === 'guide' ? <div className={classes.plan}><ol className={classes.guideSteps}><li><strong>从修改意见出发</strong><p>打开 v1，按 SH-04 的意见继续制作；原提示词保留。</p></li><li><strong>准备和比较</strong><p>引用旧钥匙、编辑提示、模拟生成；切换分镜与画布、比较两个候选。</p></li><li><strong>采用，再用于剪辑</strong><p>采用新候选；检查剪辑仍用 A，再明确替换。</p></li><li><strong>固定并审阅</strong><p>生成 v2，切回 v1 看原内容；为 v2 添加意见或确认，再加入整集草稿。</p></li></ol><div className={classes.row}>{button('从 v1 审阅开始', () => { setRevision(1); setReviewFocus(4); go('review'); }, undefined, true)}{button('继续当前制作', () => go('production'))}</div><p className={classes.meta}>观察目标是否清楚、画面是否足够大、是否需要反复寻找入口。场次内及导航往返保留本次状态；刷新重置。</p></div> : modal === 'states' ? <div className={classes.plan}><p>下面三个入口会重置本次原型数据，载入对应示例。不会修改真实项目。</p><div className={classes.stateButtons}>{button('重置为六镜头场次', () => loadFixture('normal'))}{button('载入空场次', () => loadFixture('empty'))}{button('载入 24 镜头压力示例', () => loadFixture('many'))}</div><p>等待、失败和待核对：在“查看生成计划”中选择模拟结果。画布点击空白可检查未选中状态。</p></div> : <div className={classes.plan}><p>本轮是可连续操作的设计原型。图像、模型名称和生成状态为示意；没有真实模型、视频、计费、多人协作或存储。</p><p>输入、采用、用片与审阅稿在本次页面会话里保留，刷新重置。生成的新候选复用静帧，不能用来评估生成质量。画布仍是轻量交互示意。</p></div>}
    </Modal>
  </main>;
}
