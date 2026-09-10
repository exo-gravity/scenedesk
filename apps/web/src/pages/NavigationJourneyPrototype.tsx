import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ActionIcon, Button, Drawer, Modal, NativeSelect, NumberInput, Textarea, UnstyledButton } from "@mantine/core";
import { Frame } from "../components/ui";
import * as I from "../icons";
import { assets, timecode } from "../model";
import { studyVariables } from "../theme/shared-language-study";
import { episodes, feedback, makeJourney, readJourneyRoute, sumClips } from "./navigation-journey-model";
import type { Job, JourneyPage, JourneyReview, JourneyShot, ReviewNote, Route, SceneDraft, SceneKey } from "./navigation-journey-model";
import classes from "./navigation-journey.module.css";

const projectPages: { page: JourneyPage; label: string; Icon: typeof I.FilmStrip }[] = [
  { page: "project", label: "场次", Icon: I.FilmStrip }, { page: "script", label: "剧本与设定", Icon: I.BookOpenText },
  { page: "assets", label: "项目资产", Icon: I.Stack }, { page: "delivery", label: "整集与交付", Icon: I.FilmSlate },
];
const names: Record<JourneyPage, string> = { projects: "项目", work: "我的工作", library: "工作室资产", project: "场次", script: "剧本与设定", assets: "项目资产", delivery: "整集与交付", scene: "场次制作" };

export function NavigationJourneyPrototype() {
  const [route, setRoute] = useState(readJourneyRoute);
  const [scenes, setScenes] = useState(makeJourney);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [drawer, setDrawer] = useState<"scenes" | "assets" | "jobs" | "assistant" | null>(null);
  const [modal, setModal] = useState<"map" | "generation" | "freeze" | "settings" | "reset" | null>(null);
  const [scope, setScope] = useState("project");
  const [notice, setNotice] = useState("");
  const [versionNote, setVersionNote] = useState("");
  const [episodeClips, setEpisodeClips] = useState<Partial<Record<SceneKey, number>>>({});
  const [reviewText, setReviewText] = useState("");
  const [reviewTime, setReviewTime] = useState(24);
  const scene = scenes[route.scene];
  const shot = scene.shots.find(s => s.id === route.shot) || scene.shots[0]!;
  const candidate = scene.candidates[shot.id] || shot.selected;
  const used = scene.clips.find(c => c.shotId === shot.id);
  const review = scene.reviews.find(r => r.number === route.rev) || scene.reviews.at(-1);
  const activeClips = route.view === "review" ? review?.clips || [] : scene.clips;
  const clipIndex = Math.max(0, activeClips.findIndex(c => c.shotId === shot.id));
  const clip = activeClips[clipIndex];
  const clipStart = sumClips(activeClips.slice(0, clipIndex));
  const inProject = projectPages.some(p => p.page === route.page);

  useEffect(() => { const sync = () => setRoute(readJourneyRoute()); window.addEventListener("hashchange", sync); return () => window.removeEventListener("hashchange", sync); }, []);
  useEffect(() => { document.title = `${names[route.page]} · 导航方案预览`; }, [route.page]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(""), 6500); return () => clearTimeout(t); }, [notice]);
  useEffect(() => { if (route.page === "scene") setScenes(all => ({ ...all, [route.scene]: { ...all[route.scene], mode: route.mode, focus: route.shot } })); }, [route.page, route.scene, route.mode, route.shot]);
  function go(patch: Partial<Route>) { const next = { ...route, ...patch }; setRoute(next); location.hash = `/journey/?${new URLSearchParams(Object.entries(next).map(([k, v]) => [k, String(v)]))}`; }
  function openScene(key: SceneKey, patch: Partial<Route> = {}) { const s = scenes[key]; setDrawer(null); go({ page: "scene", scene: key, episode: s.episode, view: "production", mode: s.mode, shot: s.focus, ...patch }); }
  function updateScene(fn: (s: SceneDraft) => SceneDraft) { setScenes(all => ({ ...all, [route.scene]: fn(all[route.scene]) })); }
  function updateShot(patch: Partial<JourneyShot>) { updateScene(s => ({ ...s, shots: s.shots.map(x => x.id === shot.id ? { ...x, ...patch } : x) })); }
  function chooseCandidate(value: string) { updateScene(s => ({ ...s, candidates: { ...s.candidates, [shot.id]: value } })); }
  function adopt() { updateShot({ selected: candidate }); setNotice(`${shot.label} 已采用 ${candidate}；剪辑仍使用 ${used?.take || "空"}。`); }
  function useInCut() { updateScene(s => ({ ...s, clips: s.clips.some(c => c.shotId === shot.id) ? s.clips.map(c => c.shotId === shot.id ? { ...c, take: shot.selected } : c) : [...s.clips, { shotId: shot.id, take: shot.selected, seconds: shot.seconds }] })); setNotice(`${shot.label} 的采用版本 ${shot.selected} 已用于剪辑草稿。固定审阅稿保持原样。`); }
  function generate() {
    const next = String.fromCharCode(65 + shot.candidates.length);
    updateScene(s => ({ ...s, shots: s.shots.map(x => x.id === shot.id ? { ...x, candidates: [...x.candidates, next] } : x), candidates: { ...s.candidates, [shot.id]: next } }));
    setJobs(js => [...js, { id: js.length + 1, scene: scene.key, shot: shot.id, candidate: next }]);
    setModal(null); setNotice(`模拟生成完成：新增候选 ${next}。当前采用与剪辑使用均未改变。`);
  }
  function freeze() {
    const number = (scene.reviews.at(-1)?.number || 0) + 1;
    const next: JourneyReview = { number, clips: structuredClone(scene.clips), status: "待审阅", notes: [], source: versionNote || (scene.rework ? `根据 v${scene.rework.revision} 的意见调整 ${scene.shots.find(s => s.id === scene.rework!.note.shotId)?.label}` : "当前剪辑草稿") };
    updateScene(s => ({ ...s, reviews: [...s.reviews, next] })); setModal(null); setVersionNote(""); go({ view: "review", rev: number }); setNotice(`已固定审阅稿 v${number}（演示）。后续制作改动不会修改它。`);
  }
  function beginRework(r: JourneyReview, note: ReviewNote) {
    updateScene(s => ({ ...s, rework: { revision: r.number, note: structuredClone(note) }, shots: s.shots.map(x => x.id === note.shotId ? { ...x, prompt: `${note.text}\n保留当前人物、造型和场景参考。` } : x) }));
    go({ view: "production", shot: note.shotId }); setNotice(`已定位 ${scene.shots.find(s => s.id === note.shotId)?.label}，并带入 v${r.number} 的返工意见。`);
  }
  function setReviewStatus(status: JourneyReview["status"]) { if (!review) return; updateScene(s => ({ ...s, reviews: s.reviews.map(r => r.number === review.number ? { ...r, status } : r) })); setNotice(`v${review.number} 已标为${status}（主创操作演示）。`); }
  function moveClip(direction: number) { updateScene(s => { const clips = [...s.clips]; const i = clips.findIndex(c => c.shotId === shot.id); const j = i + direction; if (j < 0 || j >= clips.length) return s; [clips[i], clips[j]] = [clips[j]!, clips[i]!]; return { ...s, clips }; }); }
  function addReviewNote() { if (!review || !reviewText.trim() || !clip) return; const note = { id: `v${review.number}-${review.notes.length + 1}`, shotId: clip.shotId, time: Math.min(clipStart + clip.seconds - 1, Math.max(clipStart, reviewTime)), text: reviewText.trim() }; updateScene(s => ({ ...s, reviews: s.reviews.map(r => r.number === review.number ? { ...r, notes: [...r.notes, note] } : r) })); setReviewText(""); setNotice("意见已附到此固定审阅稿；审阅结论仍由主创单独确认。"); }
  function button(label: string, action: () => void, primary = false, icon?: ReactNode, disabled = false) { return <Button key={label} variant="default" className={`${classes.button} ${primary ? classes.primary : ""}`} onClick={action} leftSection={icon} disabled={disabled}>{label}</Button>; }
  function icon(label: string, glyph: ReactNode, action: () => void) { return <ActionIcon className={classes.icon} variant="subtle" aria-label={label} title={label} onClick={action}>{glyph}</ActionIcon>; }
  function thumbnail(frame: number, alt: string, extra = "") { return <Frame index={frame} fit="contain" alt={alt} className={`${classes.media} ${extra}`} />; }
  function pageTitle(title: string, subtitle: string, action?: ReactNode) { return <div className={classes.pageTitle}><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>; }
  function projectAssetList(selecting = false) {
    const list = (selecting ? scope === "studio" : route.page === "library") ? assets.slice(4) : assets.slice(0, 4);
    return <div className={classes.assetGrid}>{list.map(a => <div className={classes.assetItem} key={a.id}>{thumbnail(a.frame, a.name)}<div className={classes.row}><strong>{a.name}</strong><span className={classes.meta}>{a.version}</span></div><p>{a.kind} · {a.note}</p>{selecting ? button(shot.refs.includes(a.id) ? "已引用" : "引用到当前镜头", () => { updateShot({ refs: [...shot.refs, a.id] }); setNotice(`${a.name} ${a.version} 已加入 ${shot.label} 的参考。`); }, false, <I.LinkSimple size={14} />, shot.refs.includes(a.id)) : <span className={classes.meta}>{a.status} · {route.page === "library" ? "工作室共享" : "旧钥匙"}</span>}</div>)}</div>;
  }
  function productionComposer() {
    return <aside className={classes.inspector} aria-label="当前镜头制作"><div className={classes.composer}>
      <div className={classes.composerHead}><div><h3>{shot.label} · {shot.title}</h3><p>{shot.camera} · {shot.seconds} 秒</p></div>{icon("查看镜头要求", <I.Info size={17} />, () => document.getElementById("journey-shot-details")?.setAttribute("open", ""))}</div>
      <div className={classes.candidateList} aria-label="候选版本">{shot.candidates.map(c => <UnstyledButton key={c} className={classes.candidate} data-selected={candidate === c || undefined} aria-label={`查看候选 ${c}`} aria-pressed={candidate === c} onClick={() => chooseCandidate(c)}>{thumbnail(shot.frame, `${shot.label} 候选 ${c}`)}<span>{c}{shot.selected === c ? " · 采用" : ""}</span></UnstyledButton>)}</div>
      <div className={classes.facts}><span>正在看 <b>{candidate}</b></span><span>采用 <b>{shot.selected}</b></span><span>剪辑用 <b>{used?.take || "—"}</b></span></div>
      <div className={classes.candidateActions}>{button(`采用 ${candidate}`, adopt, false, <I.Check size={14} />, candidate === shot.selected)}{button(`将 ${shot.selected} 用于剪辑`, useInCut, false, undefined, used?.take === shot.selected)}</div>
      <div className={classes.references}>{shot.refs.map(id => { const a = assets.find(a => a.id === id)!; return <div key={id} className={classes.ref}>{thumbnail(a.frame, a.name)}<span>{a.name}</span>{icon(`移除参考 ${a.name}`, <I.X size={11} />, () => updateShot({ refs: shot.refs.filter(x => x !== id) }))}</div>; })}{button("参考", () => { setScope("project"); setDrawer("assets"); }, false, <I.Plus size={13} />)}</div>
      <Textarea label="画面与动作" aria-label={`${shot.label} 提示词`} value={shot.prompt} onChange={e => updateShot({ prompt: e.currentTarget.value })} classNames={{ input: classes.prompt }} styles={{ label: { marginBottom: 10, color: "var(--study-secondary)" } }} />
      <div className={classes.composerFoot}><span className={classes.meta}>Seedance · {shot.seconds}s<br />视频生成计划</span>{button("查看计划", () => setModal("generation"), true, <I.ArrowRight size={14} />)}</div>
      <details id="journey-shot-details" className={classes.details}><summary>镜头要求与连续性</summary><p>{shot.intent}</p><p>入镜：{shot.entry}<br />出镜：{shot.exit}</p>{shot.dialogue && <p>对白：{shot.dialogue}</p>}</details>
    </div><p className={classes.meta}>候选为静帧示意，共用图片；实际视频质量不在本轮评审范围。</p></aside>;
  }
  function cutOrReview() {
    const fixed = route.view === "review";
    if (fixed && !review) return <div className={classes.content}>{pageTitle("还没有审阅稿", "从剪辑草稿固定一个版本后，即可按时间点审阅。", button("回到剪辑", () => go({ view: "cut" })))}</div>;
    return <div className={classes.cutBody}>
      <div className={classes.viewerArea}>
        <div className={classes.sectionTitle}><div className={classes.row}>{fixed ? <I.LockSimple size={17} /> : <I.Scissors size={17} />}<strong>{fixed ? `审阅稿 v${review!.number}` : "场次剪辑草稿"}</strong><span className={classes.meta}>{fixed ? review!.status : `${activeClips.length} 个镜头 · ${sumClips(activeClips)} 秒`}</span></div>{fixed && <NativeSelect aria-label="审阅版本" value={review!.number} onChange={e => go({ rev: Number(e.currentTarget.value) })} data={scene.reviews.map(r => ({ value: String(r.number), label: `v${r.number} · ${r.status}` }))} classNames={{ input: classes.input }} />}</div>
        <div className={classes.viewer}>{thumbnail(shot.frame, `${shot.label} ${fixed ? "固定审阅" : "剪辑使用"} ${clip?.take || "空"}`)}</div>
        <div className={classes.viewerMeta}><strong>{shot.label} / {clip?.take || "—"} · {shot.title}</strong><span>{timecode(clipStart)}—{timecode(clipStart + (clip?.seconds || 0))} / {timecode(sumClips(activeClips))} · 静帧预览</span></div>
        <div className={classes.filmstrip} aria-label={fixed ? "固定审阅稿镜头" : "剪辑分镜条"}>{activeClips.map(c => { const s = scene.shots.find(s => s.id === c.shotId)!; return <UnstyledButton className={classes.clip} data-active={c.shotId === shot.id || undefined} key={c.shotId} aria-label={`${fixed ? "审阅" : "剪辑"} ${s.label} / ${c.take}`} onClick={() => { go({ shot: c.shotId }); setReviewTime(sumClips(activeClips.slice(0, activeClips.indexOf(c)))); }}>{thumbnail(s.frame, s.title)}<span>{s.label} / {c.take} · {c.seconds}s</span></UnstyledButton>; })}</div>
      </div>
      <aside className={classes.cutPanel} aria-label={fixed ? "版本审阅" : "剪辑操作"}>
        {fixed ? <><h2>审这一版，意见有出处</h2><p className={classes.secondary}>v{review!.number} · {sumClips(review!.clips)} 秒 · {review!.clips.length} 镜头</p><p className={classes.meta}>{review!.source || "首次场次审阅稿"}</p>
          {review!.notes.map(n => <article key={n.id} className={classes.comment}><UnstyledButton aria-label={`定位意见 ${timecode(n.time)} SH-${String(n.shotId).padStart(2, "0")}`} className={classes.row} onClick={() => { go({ shot: n.shotId }); setReviewTime(n.time); }}><I.ChatCircleText size={16} /><strong>{timecode(n.time)} · SH-{String(n.shotId).padStart(2, "0")}</strong></UnstyledButton><p>{n.text}</p>{button("按此意见继续制作", () => beginRework(review!, n), false, <I.ArrowRight size={14} />)}</article>)}
          <details className={classes.details}><summary>添加时间点意见</summary><NumberInput label="当前镜头内的时间（秒）" aria-label="意见时间" min={clipStart} max={clipStart + (clip?.seconds || 1) - 1} value={Math.min(clipStart + (clip?.seconds || 1) - 1, Math.max(clipStart, reviewTime))} onChange={v => setReviewTime(Number(v))} classNames={{ input: classes.input }} /><Textarea label="审阅意见" value={reviewText} onChange={e => setReviewText(e.currentTarget.value)} classNames={{ input: classes.input }} autosize minRows={3} />{button("添加意见", addReviewNote, false, undefined, !reviewText.trim())}</details>
          <div className={classes.note}>当前制作已采用 {shot.selected}；这份固定稿仍使用 {clip?.take}。制作改动不会覆盖本稿。</div>
          {button("确认可用于整集", () => setReviewStatus("已确认"), true, <I.CheckCircle size={15} />, review!.status === "已确认")}{button("标为需修改", () => setReviewStatus("需修改"), false, undefined, review!.status === "需修改")}<p className={classes.meta}>主创审阅权限示意，仅确认此场次版本。</p>
        </> : <><h2>{shot.label} · 使用 {clip?.take || "—"}</h2><p className={classes.secondary}>{shot.title}</p><div className={classes.note}>当前镜头采用 {shot.selected}，剪辑实际使用 {clip?.take || "—"}。可明确替换后再提交审阅。</div>{button(`替换为已采用 ${shot.selected}`, useInCut, false, <I.ArrowsClockwise size={15} />, clip?.take === shot.selected)}
          <div style={{ marginTop: 24 }}><NumberInput label="使用时长（秒）" aria-label="剪辑使用时长" value={clip?.seconds || shot.seconds} min={1} max={shot.seconds} allowDecimal={false} classNames={{ input: classes.input }} onChange={v => updateScene(s => ({ ...s, clips: s.clips.map(c => c.shotId === shot.id ? { ...c, seconds: Math.min(shot.seconds, Math.max(1, Number(v) || 1)) } : c) }))} /></div>
          <div className={classes.row}>{button("向前", () => moveClip(-1), false, <I.CaretLeft size={14} />, clipIndex === 0)}{button("向后", () => moveClip(1), false, <I.CaretRight size={14} />, clipIndex === activeClips.length - 1)}</div>
          {button("回到这个镜头制作", () => go({ view: "production" }), false, <I.ArrowUpRight size={14} />)}
          <div className={classes.note}>首版以分镜条完成组接与基础裁切。此页演示顺序、用片和时长；声音、字幕及视频播放将在对应专项继续细化。</div>
          {button("生成审阅稿", () => setModal("freeze"), true, <I.LockSimple size={15} />)}
        </>}
      </aside>
    </div>;
  }

  return <main className={classes.page}>
    <div className={classes.reviewBar}><strong>导航与核心流程 · 推荐方案</strong><span>设计预览 · 操作只保留到刷新</span><Button size="xs" variant="default" onClick={() => { location.hash = "/journey/?variant=recommendation&mode=storyboard&tone=light&assistant=on"; }}>新方案效果图</Button><Button size="xs" variant="default" onClick={() => setModal("map")}>导航总览</Button><Button size="xs" variant="subtle" onClick={() => go({ tone: route.tone === "light" ? "dark" : "light" })}>{route.tone === "light" ? "切换深色" : "切换浅色"}</Button><Button size="xs" variant="subtle" onClick={() => setModal("reset")}>重置示例</Button><Button size="xs" variant="subtle" onClick={() => { location.hash = "/directions/?study=shared&tone=light&state=edit"; }}>视觉对照</Button></div>
    <section className={classes.prototype} style={studyVariables(route.tone)} data-tone={route.tone} aria-label="导航与核心流程原型">
      <nav className={classes.rail} aria-label="工作室导航"><UnstyledButton className={classes.brand} aria-label="片场，返回项目" onClick={() => go({ page: "projects" })}><I.FilmSlate size={26} weight="fill" /></UnstyledButton>
        {[{ page: "projects", label: "项目", Icon: I.FolderSimple }, { page: "work", label: "我的工作", Icon: I.CheckSquare }, { page: "library", label: "共享资产", Icon: I.Stack }].map(n => <UnstyledButton key={n.page} className={classes.railItem} data-active={(route.page === n.page || n.page === "projects" && (inProject || route.page === "scene")) || undefined} onClick={() => go({ page: n.page as JourneyPage })}><n.Icon size={21} /><span>{n.label}</span></UnstyledButton>)}
        <div className={classes.railBottom}><UnstyledButton className={classes.railItem} onClick={() => setModal("settings")}><I.GearSix size={21} /><span>工作室</span></UnstyledButton></div>
      </nav>
      <div className={classes.workspace}>
        <header className={classes.header}>
          {route.page === "scene" ? <div className={classes.breadcrumbs}>{icon("返回场次列表", <I.ArrowLeft size={18} />, () => go({ page: "project", episode: scene.episode }))}<UnstyledButton onClick={() => go({ page: "project", episode: scene.episode })}>旧钥匙</UnstyledButton><I.CaretRight size={12} /><span className={classes.secondary}>{scene.episode === "e1" ? "第 1 集" : "第 2 集"}</span><I.CaretRight size={12} />{button(scene.name, () => setDrawer("scenes"), false, <I.CaretDown size={13} />)}<span className={`${classes.meta} ${classes.sceneHeaderMeta}`}>{scene.shots.length} 镜头</span></div> : <div className={classes.breadcrumbs}><span className={classes.secondary}>拾光工作室</span>{inProject && <><I.CaretRight size={12} /><strong>旧钥匙</strong></>}</div>}
          <div className={classes.headerActions}>{route.page === "scene" && (route.view === "review" ? button("返回当前剪辑", () => go({ view: "cut" }), false, <I.ArrowLeft size={14} />) : scene.reviews.length > 0 && button(`审阅稿 v${scene.reviews.at(-1)!.number} · ${scene.reviews.at(-1)!.status}`, () => go({ view: "review", rev: scene.reviews.at(-1)!.number }), false, <I.LockSimple size={14} />))}{button(`生成作业${jobs.length ? ` · ${jobs.length}` : ""}`, () => setDrawer("jobs"), false, <I.Clock size={16} />)}{icon("当前成员：林予", <I.UserCircle size={25} />, () => setModal("settings"))}</div>
        </header>
        <div className={classes.body}>
          {inProject && <nav className={classes.projectNav} aria-label="项目导航"><span className={classes.meta}>旧钥匙 · 项目空间</span>{projectPages.map(n => <UnstyledButton className={classes.projectNavItem} key={n.page} data-active={route.page === n.page || undefined} onClick={() => go({ page: n.page })}><n.Icon size={17} />{n.label}</UnstyledButton>)}</nav>}
          {route.page !== "scene" && <div className={classes.content}><div className={classes.contentInner}>
            {route.page === "projects" && <>{pageTitle("项目", "从一场戏开始，把故事做出来。") }<div className={classes.sectionTitle}><h3>最近制作</h3><span className={classes.meta}>1 个示例项目</span></div><UnstyledButton className={classes.projectCard} onClick={() => go({ page: "project" })}>{thumbnail(0, "旧钥匙项目封面", classes.poster)}<div className={classes.projectInfo}><span className={classes.meta}>AI 写实短剧 · 竖屏</span><h2>旧钥匙</h2><p className={classes.secondary}>一把钥匙，一段尚未说完的往事。</p><span className={classes.meta}>2 集 · 3 场 · 内部制作</span><span className={classes.row}>进入项目 <I.ArrowRight size={18} /></span></div></UnstyledButton></>}
            {route.page === "work" && <>{pageTitle("我的工作", "这里收拢我负责的场次和需要处理的审阅意见。") }<div className={classes.workItem}><div><span className={classes.meta}>旧钥匙 / 第 1 集 / 咖啡厅</span><h2>继续场次制作</h2><p className={classes.secondary}>负责人：我 · 林予 · 6 个镜头</p></div>{button("进入制作", () => openScene("cafe"), true)}</div><div className={classes.workItem}><div><span className={classes.meta}>审阅稿 v1 / 00:24 / SH-04</span><h3>{feedback}</h3><p className={classes.secondary}>固定版本中的意见，进入后可追溯来源。</p></div>{button("查看意见", () => openScene("cafe", { view: "review", rev: 1, shot: 4 }))}</div><p className={classes.note}>角色责任示例。机器排队、生成结果统一在右上角“生成作业”，避免把两种工作混在一起。</p></>}
            {route.page === "project" && <>{pageTitle("场次", "按集组织故事；每个场次拥有自己的镜头、画布与审阅稿。", <NativeSelect aria-label="选择集" value={route.episode} data={episodes} onChange={e => go({ episode: e.currentTarget.value })} classNames={{ input: classes.input }} />)}<div className={classes.table}><div className={classes.tableHead}><span>场次</span><span>镜头</span><span>负责人</span><span>最新审阅</span><span /></div>{Object.values(scenes).filter(s => s.episode === route.episode).map(s => <div className={classes.sceneRow} key={s.key}><div className={classes.sceneIdentity}>{thumbnail(s.shots[0]!.frame, s.name)}<div><h3>{s.name}</h3><p>{s.description}</p></div></div><span>{s.shots.length} 镜头</span><span>{s.owner}</span><span className={classes.meta}>{s.reviews.at(-1) ? `v${s.reviews.at(-1)!.number} · ${s.reviews.at(-1)!.status}` : "尚未送审"}</span>{button("进入制作", () => openScene(s.key), false, <I.ArrowRight size={14} />)}</div>)}</div></>}
            {(route.page === "assets" || route.page === "library") && <>{pageTitle(route.page === "library" ? "工作室资产" : "项目资产", route.page === "library" ? "供不同项目引用的通用风格与表演参考。" : "这部短剧已确认的角色、场景和道具版本。")}{projectAssetList()}<p className={classes.note}>进入镜头制作后，可通过“参考”就地选择这里的资产。引用保留版本，不因切换页面而重新上传。</p></>}
            {route.page === "script" && <>{pageTitle("剧本与设定", "场次制作的故事依据与连续性要求。", button("进入咖啡厅制作", () => openScene("cafe")))}<div className={classes.sectionTitle}><strong>第 1 集 · 咖啡厅</strong><span className={classes.meta}>剧本 v1 · 已确认 · 本页只读预览</span></div><pre className={classes.script}>{scenes.cafe.script}</pre></>}
            {route.page === "delivery" && <>{pageTitle("整集与交付", "从已确认的场次版本，组接完整一集。", <NativeSelect aria-label="选择交付集" value={route.episode} data={episodes} onChange={e => go({ episode: e.currentTarget.value })} classNames={{ input: classes.input }} />)}<div className={classes.callout}><h3>第 {route.episode === "e1" ? "1" : "2"} 集 · 组接草稿</h3><p className={classes.secondary}>需要各场次可用版本后继续整集制作。本轮展示场次版本进入整集的边界。</p></div>{Object.values(scenes).filter(s => s.episode === route.episode).map(s => { const approved = s.reviews.filter(r => r.status === "已确认").at(-1); return <div className={classes.workItem} key={s.key}><div><h3>{s.name}</h3><p className={classes.secondary}>{approved ? `可使用 v${approved.number} · ${sumClips(approved.clips)} 秒` : "待场次确认"}{episodeClips[s.key] ? ` / 整集草稿使用 v${episodeClips[s.key]}` : ""}</p></div>{approved ? button(episodeClips[s.key] === approved.number ? `已加入 v${approved.number}` : `将 v${approved.number} 加入整集草稿`, () => { setEpisodeClips(c => ({ ...c, [s.key]: approved.number })); setNotice(`已引用 ${s.name} v${approved.number}，后续场次版本不会自动替换此引用。`); }, false, undefined, episodeClips[s.key] === approved.number) : button("进入场次", () => openScene(s.key))}</div>; })}<p className={classes.note}>整集排序、审阅与交付操作后续另作页面细化；场次确认不等于整集确认。</p></>}
          </div></div>}
          {route.page === "scene" && <section className={classes.scene} aria-label={`${scene.name}场次工作区`}>
            {route.view !== "review" && <div className={classes.tabs} role="tablist" aria-label="场次工作内容">{[{ id: "production", label: "镜头制作" }, { id: "cut", label: "剪辑" }].map(t => <UnstyledButton role="tab" aria-selected={route.view === t.id} className={classes.tab} key={t.id} onClick={() => go({ view: t.id as Route["view"] })}>{t.label}</UnstyledButton>)}<span className={classes.meta}>本次预览会话中保留</span></div>}
            {route.view === "production" ? <><div className={classes.modeBar}><div className={classes.modes} aria-label="制作模式">{[{ id: "storyboard", label: "分镜模式", Icon: I.GridFour }, { id: "canvas", label: "自由画布", Icon: I.Compass }].map(m => <UnstyledButton className={classes.mode} aria-pressed={route.mode === m.id} key={m.id} onClick={() => go({ mode: m.id as Route["mode"] })}><m.Icon size={14} />{m.label}</UnstyledButton>)}</div><span className={`${classes.meta} ${classes.sceneHeaderMeta}`}>{scene.name} · 全场 {scene.shots.length} 镜头</span><div className={classes.tools}>{button("参考资产", () => { setScope("project"); setDrawer("assets"); }, false, <I.Stack size={14} />)}{button("助手", () => setDrawer("assistant"), false, <I.ChatCircleText size={14} />)}</div></div>
              {scene.rework && <div className={classes.rework}><span>返工来源：v{scene.rework.revision} · {timecode(scene.rework.note.time)} · {scene.rework.note.text}</span>{button("查看原稿", () => go({ view: "review", rev: scene.rework!.revision, shot: scene.rework!.note.shotId }))}</div>}
              <div className={classes.production}>{route.mode === "storyboard" ? <div className={classes.shotGrid} aria-label="全场分镜">{scene.shots.map(s => <article key={s.id} className={classes.shotCard}><UnstyledButton className={classes.shotMedia} data-active={s.id === shot.id || undefined} aria-label={`制作 ${s.label} ${s.title}`} onClick={() => go({ shot: s.id })}>{thumbnail(s.frame, s.title)}</UnstyledButton><div className={classes.shotCaption}><strong>{s.label} · {s.title}</strong><span className={classes.meta}>{s.seconds}s</span></div><span className={classes.meta}>{s.camera} · 采用 {s.selected}{scene.clips.find(c => c.shotId === s.id)?.take !== s.selected ? ` / 剪辑用 ${scene.clips.find(c => c.shotId === s.id)?.take || "—"}` : ""}</span></article>)}</div> : <JourneyCanvas key={scene.key} scene={scene} selected={shot.id} candidate={candidate} onSelect={id => go({ shot: id })} onViewport={viewport => updateScene(s => ({ ...s, viewport }))} onMove={(id, p) => updateScene(s => ({ ...s, positions: { ...s.positions, [id]: p } }))} />}{productionComposer()}</div>
            </> : cutOrReview()}
          </section>}
        </div>
      </div>
      <Drawer opened={drawer !== null} onClose={() => setDrawer(null)} withinPortal={false} position="right" size={drawer === "scenes" ? 440 : 420} title={drawer === "scenes" ? "切换场次" : drawer === "assets" ? `给 ${shot.label} 添加参考` : drawer === "assistant" ? `助手 · ${scene.name} / ${shot.label}` : "生成作业"} closeButtonProps={{ "aria-label": "关闭面板" }} classNames={{ inner: classes.overlayInner, content: classes.overlayContent, header: classes.overlayHeader }}>
        <div className={classes.modalStack}>
          {drawer === "scenes" && <>{episodes.map(e => <div key={e.value}><h3>{e.label}</h3>{Object.values(scenes).filter(s => s.episode === e.value).map(s => <div key={s.key} className={classes.workItem}><div><strong>{s.name}</strong><p className={classes.meta}>{s.shots.length} 镜头 · {s.owner}</p></div>{button(scene.key === s.key ? "当前场次" : "进入", () => openScene(s.key), false, undefined, scene.key === s.key)}</div>)}</div>)}</>}
          {drawer === "assets" && <><NativeSelect aria-label="参考资产范围" value={scope} onChange={e => setScope(e.currentTarget.value)} data={[{ value: "project", label: "旧钥匙 · 项目资产" }, { value: "studio", label: "拾光工作室 · 共享资产" }]} classNames={{ input: classes.input }} />{projectAssetList(true)}<p className={classes.meta}>选择后直接加入当前镜头；关闭侧栏继续制作。</p></>}
          {drawer === "jobs" && <><p className={classes.secondary}>生成执行及结果，不承载人的任务分派。</p>{jobs.length === 0 ? <div className={classes.note}>暂无作业。进入场次，从镜头制作的“查看计划”模拟生成一次。</div> : jobs.map(j => <div className={classes.workItem} key={j.id}><div><h3>{scenes[j.scene].name} / SH-{String(j.shot).padStart(2, "0")} / {j.candidate}</h3><p className={classes.meta}>演示完成 · 无真实模型调用</p></div>{button("定位结果", () => { setScenes(all => ({ ...all, [j.scene]: { ...all[j.scene], candidates: { ...all[j.scene].candidates, [j.shot]: j.candidate } } })); openScene(j.scene, { shot: j.shot }); })}</div>)}</>}
          {drawer === "assistant" && <><div className={classes.note}>引用范围：当前镜头的提示词和参考。本轮使用固定示例建议，不执行真实对话。</div><div className={classes.callout}><h3>如何让动作接触更自然？</h3><p>把动作拆清楚：右手靠近钥匙，手指接触后收拢，再完整拿离桌面。保持道具形状、手的方向和光线。</p></div>{button("填入提示词，再由我调整", () => { updateShot({ prompt: `${shot.prompt}\n动作分为靠近、接触、收拢和拿离四步，保持手部结构自然。` }); setDrawer(null); setNotice("示例建议已填入提示词，尚未生成。"); })}</>}
        </div>
      </Drawer>
      <Modal opened={modal !== null} onClose={() => setModal(null)} withinPortal={false} centered size={modal === "map" ? 930 : 560} title={modal === "map" ? "推荐导航 · 三层空间，一条制作路径" : modal === "generation" ? "生成计划预览" : modal === "freeze" ? "固定当前剪辑，生成审阅稿" : modal === "reset" ? "重置本轮预览" : "拾光工作室"} closeButtonProps={{ "aria-label": "关闭面板" }} classNames={{ inner: classes.overlayInner, content: classes.overlayContent, header: classes.overlayHeader }}>
        <div className={classes.modalStack}>
          {modal === "map" && <><p className={classes.secondary}>点击入口可以直接跳转。导航仍待评审；本轮推荐将创作空间与固定版本审阅明确分开。</p><div className={classes.mapGrid}><div className={classes.mapColumn}><h3>01 · 工作室</h3>{["projects", "work", "library"].map(p => button(names[p as JourneyPage], () => { go({ page: p as JourneyPage }); setModal(null); }))}<p>项目入口、我负责的工作、跨项目资产。生成作业在全局右上角。</p></div><div className={classes.mapColumn}><h3>02 · 项目：旧钥匙</h3>{projectPages.map(p => button(p.label, () => { go({ page: p.page }); setModal(null); }))}<p>默认进入“集 → 场次”，剧本、资产与整集工作留在项目范围。</p></div><div className={classes.mapColumn}><h3>03 · 场次：咖啡厅</h3>{button("镜头制作 · 分镜 / 自由画布", () => { openScene("cafe"); setModal(null); })}{button("剪辑 · 使用已采用的镜头", () => { openScene("cafe", { view: "cut" }); setModal(null); })}{button("固定审阅稿 ↗ 返工回制作", () => { openScene("cafe", { view: "review", rev: 1, shot: 4 }); setModal(null); })}<p>两种制作方式共享同一场的数据。审阅稿独立固定版本，意见能定位镜头。</p></div></div><div className={classes.note}>建议体验：项目 → 咖啡厅 → 审阅稿 v1 → 按意见继续制作 → 模拟生成 → 采用 → 用于剪辑 → 生成审阅稿 v2。</div></>}
          {modal === "generation" && <><div><h3>{scene.name} / {shot.label}</h3><p className={classes.secondary}>Seedance 优先 · {shot.seconds} 秒 · 1 个候选 · {shot.refs.length} 项参考</p></div><p>{shot.prompt}</p><div className={classes.note}>这是设计演示。按钮只创建本地候选标记；不会调用模型、产生费用或替换现有采用与剪辑。实际能力与报价需在真实生成计划中核对。</div>{button("模拟生成新候选", generate, true, <I.Sparkle size={16} />)}</>}
          {modal === "freeze" && <><p>固定 {scene.clips.length} 个镜头、{sumClips(scene.clips)} 秒，建立 v{(scene.reviews.at(-1)?.number || 0) + 1}。</p><div className={classes.note}>{scene.clips.map(c => `SH-${String(c.shotId).padStart(2, "0")} / ${c.take}`).join("　")}</div><Textarea label="本版说明" placeholder="例如：调整 SH-04 拿钥匙的接触动作" value={versionNote} onChange={e => setVersionNote(e.currentTarget.value)} autosize minRows={3} classNames={{ input: classes.input }} />{button("固定并打开审阅稿（演示）", freeze, true, <I.LockSimple size={15} />)}</>}
          {modal === "settings" && <><h3>林予 · 内部成员</h3><p className={classes.secondary}>此入口集中放工作室切换、成员、权限及用量设置。本轮只确认其导航归属，不展开管理界面。</p><div className={classes.note}>项目和创作页面的主空间留给内容。角色权限尚未在原型执行。</div></>}
          {modal === "reset" && <><p>清除这套导航原型中的提示词修改、模拟候选和审阅稿，恢复咖啡厅 v1 返工示例。</p>{button("重置示例", () => { setScenes(makeJourney()); setJobs([]); setEpisodeClips({}); setModal(null); setDrawer(null); setNotice(""); go({ page: "projects", scene: "cafe", episode: "e1", view: "production", mode: "storyboard", shot: 4, rev: 1 }); }, true)}</>}
        </div>
      </Modal>
      {notice && <div className={classes.toast} role="status">{notice}{icon("关闭提示", <I.X size={14} />, () => setNotice(""))}</div>}
    </section>
  </main>;
}

function JourneyCanvas({ scene, selected, candidate, onSelect, onMove, onViewport }: { scene: SceneDraft; selected: number; candidate: string; onSelect: (id: number) => void; onViewport: (v: { x: number; y: number; zoom: number }) => void; onMove: (id: string, p: { x: number; y: number }) => void }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const viewport = scene.viewport || { x: 10, y: 42, zoom: .78 };
  const zoom = viewport.zoom;
  const pan = { x: viewport.x, y: viewport.y };
  function setZoom(fn: (z: number) => number) { onViewport({ ...viewport, zoom: fn(zoom) }); }
  function setPan(p: { x: number; y: number }) { onViewport({ ...viewport, ...p }); }
  const drag = useRef<{ id?: string; x: number; y: number; origin: { x: number; y: number } } | null>(null);
  const positions = [{ x: 158, y: 20 }, { x: 158, y: 390 }, { x: 820, y: 28 }, { x: 368, y: 80 }, { x: 820, y: 400 }, { x: 400, y: 554 }];
  const nodes = scene.shots.map((s, i) => ({ id: `shot-${s.id}`, shot: s.id, frame: s.frame, label: `${s.label} / ${s.id === selected ? candidate : s.selected}`, pos: positions[i]!, hero: s.id === selected }));
  const picked = scene.shots.find(s => s.id === selected)!;
  const refs = picked.refs.slice(0, 2).map((id, i) => { const a = assets.find(a => a.id === id)!; return { id: `ref-${id}`, shot: 0, frame: a.frame, label: `参考 · ${a.name}`, pos: { x: 12, y: 130 + i * 345 }, hero: false }; });
  const allNodes = [...refs, ...nodes];
  const hero = nodes.find(n => n.shot === selected)!;
  const heroPos = scene.positions[hero.id] || hero.pos;
  function fit() {
    const el = canvasRef.current;
    if (!el) return;
    const bounds = allNodes.map(n => { const p = scene.positions[n.id] || n.pos; const width = n.shot === 0 ? 96 : n.hero ? 218 : 128; return { ...p, width, height: width * 679 / 394 + 32 }; });
    const left = Math.min(...bounds.map(n => n.x)), top = Math.min(...bounds.map(n => n.y));
    const width = Math.max(...bounds.map(n => n.x + n.width)) - left, height = Math.max(...bounds.map(n => n.y + n.height)) - top;
    const scale = Math.min((el.clientWidth - 48) / width, (el.clientHeight - 100) / height, 1);
    onViewport({ zoom: Math.max(.35, scale), x: (el.clientWidth - width * scale) / 2 - left * scale, y: 44 - top * scale });
  }
  useEffect(() => { if (!scene.viewport) fit(); }, []);
  return <div ref={canvasRef} className={classes.canvas} aria-label="全场自由画布" onPointerDown={e => { if (e.target === e.currentTarget) { drag.current = { x: e.clientX, y: e.clientY, origin: pan }; e.currentTarget.setPointerCapture(e.pointerId); } }} onPointerMove={e => { const d = drag.current; if (!d) return; const next = { x: d.origin.x + (e.clientX - d.x) / (d.id ? zoom : 1), y: d.origin.y + (e.clientY - d.y) / (d.id ? zoom : 1) }; if (d.id) onMove(d.id, next); else setPan(next); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
    <span className={classes.canvasNote}>全场画布 · 拖动图片摆放，拖动空白平移</span>
    <div className={classes.canvasPlane} style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, pointerEvents: "none" }}>
      <svg className={classes.connections} aria-hidden="true">{refs.map(n => { const p = scene.positions[n.id] || n.pos; return <path key={n.id} d={`M ${p.x + 96} ${p.y + 115} C ${p.x + 200} ${p.y + 115}, ${heroPos.x - 50} ${heroPos.y + 200}, ${heroPos.x} ${heroPos.y + 200}`} />; })}</svg>
      {allNodes.map(n => { const p = scene.positions[n.id] || n.pos; return <article className={classes.canvasNode} key={n.id} data-hero={n.hero || undefined} style={{ left: p.x, top: p.y, width: n.shot === 0 ? 96 : undefined, pointerEvents: "auto" }}><header>{n.label}{n.shot && scene.shots.find(s => s.id === n.shot)?.selected === (n.hero ? candidate : scene.shots.find(s => s.id === n.shot)?.selected) ? " · 采用" : ""}</header><UnstyledButton className={classes.shotMedia} data-active={n.hero || undefined} data-drag aria-label={`画布 ${n.label}`} onClick={() => { if (n.shot) onSelect(n.shot); }} onPointerDown={e => { e.stopPropagation(); drag.current = { id: n.id, x: e.clientX, y: e.clientY, origin: p }; e.currentTarget.setPointerCapture(e.pointerId); }} onKeyDown={e => { const d = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[e.key]; if (e.altKey && d) { e.preventDefault(); onMove(n.id, { x: p.x + d[0]!, y: p.y + d[1]! }); } }}><Frame index={n.frame} fit="contain" className={classes.media} alt={n.label} /></UnstyledButton></article>; })}
    </div>
    <div className={classes.canvasTools}><Button className={classes.button} variant="subtle" aria-label="缩小画布" onClick={() => setZoom(z => Math.max(.35, +(z - .1).toFixed(2)))}>−</Button><span>{Math.round(zoom * 100)}%</span><Button className={classes.button} variant="subtle" aria-label="放大画布" onClick={() => setZoom(z => Math.min(1.4, +(z + .1).toFixed(2)))}>+</Button><Button className={classes.button} variant="subtle" onClick={fit}>适应全场</Button></div>
  </div>;
}
