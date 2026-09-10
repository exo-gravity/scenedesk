/** Four isolated design studies. Fixtures are in memory and do not execute AI, save to a server or play media. */
import { useEffect, useState } from 'react';
import { ActionIcon, Button, Checkbox, Modal, NativeSelect, NumberInput, Textarea, UnstyledButton } from '@mantine/core';
import { Frame } from '../components/ui';
import * as I from '../icons';
import { initialScript, initialShots } from '../model';
import { studyVariables } from '../theme/shared-language-study';
import c from './workspace-recommendation.module.css';
import d from './production-detail.module.css';

type Topic = 'script' | 'sound' | 'asset' | 'recovery';
const topics: { id: Topic; title: string; path: string }[] = [
  { id: 'script', title: '剧本准备', path: '项目 / 剧本与设定' },
  { id: 'sound', title: '声音与字幕', path: '第 1 集 / 咖啡厅 / 剪辑' },
  { id: 'asset', title: '资产版本', path: '项目资产 / 旧铜钥匙' },
  { id: 'recovery', title: '保存与冲突', path: '第 1 集 / 咖啡厅 / 自由画布' },
];
const fragment = '林夏伸出右手，拿起钥匙。她看清钥匙上的磨痕，神情微微一变。\n\n林夏（轻声）\n原来，他一直留着。';
const proposals = [
  { id: 7, title: '匙环的磨痕', intention: '钥匙的磨痕进入画面，建立林夏认出它的依据。', dialogue: '' },
  { id: 8, title: '林夏认出钥匙', intention: '林夏低头辨认，眼神轻微变化后低声说话。', dialogue: '原来，他一直留着。' },
];
type Cue = { text: string; start: number; end: number };
type SoundDraft = { native: 'keep' | 'mute'; replacement: boolean; gain: number; cue: Cue; ambientEnd: number; seconds: number; checked: boolean };
const soundInitial: SoundDraft = { native: 'keep', replacement: false, gain: 0, cue: { text: '原来，他一直留着。', start: 31, end: 35 }, ambientEnd: 46, seconds: 9, checked: false };
const basePrompt = '右手拿起钥匙，保持五指结构自然。';
const localPrompt = '右手先触碰匙环，停半拍，再完整拿离桌面。';
const serverPrompt = '右手缓慢拿起钥匙，动作自然克制。';
function readRoute() { const q = new URLSearchParams(location.hash.split('?')[1]); return { topic: topics.some(t => t.id === q.get('topic')) ? q.get('topic') as Topic : 'script' as Topic, tone: q.get('tone') === 'dark' ? 'dark' as const : 'light' as const }; }

export function ProductionDetailPrototype() {
  const [route, setRoute] = useState(readRoute);
  const [message, setMessage] = useState('');
  const [script, setScript] = useState(initialScript);
  const [scriptRevisions, setScriptRevisions] = useState([{ revision: 1, text: initialScript }]);
  const [formal, setFormal] = useState(1);
  const [range, setRange] = useState('action');
  const [proposal, setProposal] = useState<{ source: string; revision: number; selected: number[]; rows: typeof proposals; applied: boolean } | null>(null);
  const [sound, setSound] = useState<SoundDraft>(structuredClone(soundInitial));
  const [soundTab, setSoundTab] = useState('sound');
  const [soundFocus, setSoundFocus] = useState(5);
  const [versions, setVersions] = useState([{ number: 1, draft: structuredClone(soundInitial) }]);
  const [viewVersion, setViewVersion] = useState(0);
  const [impact, setImpact] = useState(false);
  const [cueDecision, setCueDecision] = useState('');
  const [audioDecision, setAudioDecision] = useState('');
  const [assetVersion, setAssetVersion] = useState(1);
  const [assetScope, setAssetScope] = useState('project');
  const [referenceVersion, setReferenceVersion] = useState(1);
  const [saveState, setSaveState] = useState<'normal' | 'offline' | 'conflict'>('normal');
  const [mine, setMine] = useState(localPrompt);
  const [serverRevision, setServerRevision] = useState(13);
  const [expectedRevision, setExpectedRevision] = useState(13);
  const [remote, setRemote] = useState(serverPrompt);
  const [merged, setMerged] = useState(localPrompt);
  const [compare, setCompare] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [copies, setCopies] = useState<string[]>([]);
  const [savedRevision, setSavedRevision] = useState(12);
  const [savedPrompt, setSavedPrompt] = useState(basePrompt);
  const [baseVersion, setBaseVersion] = useState(12);
  const latest = scriptRevisions.at(-1)!;
  const currentSound = viewVersion ? versions.find(v => v.number === viewVersion)!.draft : sound;
  const invalidCue = currentSound.cue.start < 0 || currentSound.cue.end <= currentSound.cue.start || currentSound.cue.end > 37 + currentSound.seconds;
  const doubleDialogue = currentSound.native === 'keep' && currentSound.replacement;
  const currentTopic = topics.find(t => t.id === route.topic)!;
  useEffect(() => { const sync = () => setRoute(readRoute()); window.addEventListener('hashchange', sync); document.title = '制作专项设计 · 片场'; return () => window.removeEventListener('hashchange', sync); }, []);
  function change(patch: Partial<typeof route>) { const next = { ...route, ...patch }; setRoute(next); setMessage(''); history.replaceState(null, '', `#/journey/?variant=finishing&topic=${next.topic}&tone=${next.tone}`); }
  function core() { location.hash = `#/journey/?variant=recommendation&screen=production&mode=storyboard&tone=${route.tone}&assistant=off`; }
  const b = (label: string, action: () => void, primary = false, disabled = false) => <Button className={`${c.button} ${primary ? c.primary : ''}`} variant="default" onClick={action} disabled={disabled}>{label}</Button>;
  const media = (frame: number, label: string) => <Frame index={frame} alt={label} fit="contain" className={c.media}/>;
  const updateSound = (patch: Partial<SoundDraft>) => { if (!viewVersion) setSound(s => ({ ...s, ...patch, checked: false })); };
  function prepareProposal() {
    if (proposal?.applied || (range === 'action' && !latest.text.includes(fragment))) return;
    setProposal({ source: range === 'action' ? fragment : latest.text, revision: latest.revision, selected: [7, 8], rows: structuredClone(proposals), applied: false });
    setMessage('已载入固定示例提案；未调用 AI，尚未新增镜头。');
  }
  function freezeSound() { if (invalidCue || doubleDialogue) return; const number = versions.at(-1)!.number + 1; setVersions(all => [...all, { number, draft: structuredClone(sound) }]); setViewVersion(number); setMessage(`已模拟固定 v${number} 的画面、声音选择和字幕；尚未渲染或批准。`); }
  function applyImpact() {
    if (!cueDecision || !audioDecision) return;
    setSound(s => ({ ...s, seconds: 6, ambientEnd: audioDecision === 'trim' ? 43 : 0, cue: cueDecision === 'follow' ? { ...s.cue, start: s.cue.start - 3, end: s.cue.end - 3 } : s.cue, checked: false }));
    setImpact(false); setMessage('已应用本次时长示例：后续画面前移 3 秒；声音、字幕按你的选择处理，需重新回放核对。');
  }
  function startConflict() { setSaveState('conflict'); setCompare(false); setReviewed(false); setBaseVersion(savedRevision); setServerRevision(Math.max(savedRevision + 1, 13)); setExpectedRevision(Math.max(savedRevision + 1, 13)); setRemote(serverPrompt); setMerged(mine); setMessage('模拟：同伴已保存新版本。本地修改保留，自动同步暂停。'); }
  function saveMerged() {
    if (!reviewed) return;
    if (expectedRevision !== serverRevision) { setReviewed(false); setMessage('对照期间又有更新。本地合并内容保留，请读取新版后复核。'); return; }
    setCopies(all => [...all, mine]); setMine(merged); setSavedPrompt(merged); setSavedRevision(serverRevision + 1); setSaveState('normal'); setCompare(false); setReviewed(false); setMessage(`演示：保存为 r${serverRevision + 1}，保留同伴的光线说明与节点位置；本地旧内容仍可查看。`);
  }
  return <main className={`${c.page} ${d.page}`} style={studyVariables(route.tone)}>
    <div className={c.reviewBar}><strong>制作专项 · 设计预览</strong><span>独立演示数据 · 刷新重置</span><div className={c.spacer}/>{topics.map(t => <UnstyledButton key={t.id} className={d.topic} aria-pressed={route.topic === t.id} onClick={() => change({ topic: t.id })}>{t.title}</UnstyledButton>)}{b('回已确认方案', core)}<ActionIcon aria-label="切换明暗" className={c.icon} onClick={() => change({ tone: route.tone === 'light' ? 'dark' : 'light' })}><I.Moon size={15}/></ActionIcon></div>
    <div className={c.app}><nav className={c.rail} aria-label="工作室导航"><UnstyledButton className={c.brand} aria-label="回核心流程" onClick={core}><I.FilmSlate size={27}/></UnstyledButton><UnstyledButton className={c.railItem} data-active onClick={() => change({ topic: 'script' })}><I.FolderSimple size={21}/><span>项目</span></UnstyledButton><UnstyledButton className={c.railItem} onClick={() => change({ topic: 'asset' })}><I.Stack size={21}/><span>资产</span></UnstyledButton><div className={c.spacer}/><span className={c.avatar}>予</span></nav>
      <div className={c.workspace}><header className={c.header}><div className={c.row}><strong>旧钥匙</strong><I.CaretRight size={14}/><span className={c.secondary}>{currentTopic.path}</span></div><span className={c.meta}>林予 · 制作成员</span></header>
        {message && <div className={d.feedback} role="status"><I.Info size={15}/>{message}</div>}
        {route.topic === 'script' && <div className={d.scriptLayout}>
          <section className={d.scriptMain}><div className={d.sectionHead}><div><span className={c.eyebrow}>剧本与设定</span><h1>咖啡厅 · 戏文</h1></div><span className={d.tag}>正式依据 r{formal}</span></div>
            <div className={d.line}><span>当前编辑 r{latest.revision}{script !== latest.text ? ' · 有未保存修改' : ''}</span>{b('保存文本修订', () => { setScriptRevisions(all => [...all, { revision: latest.revision + 1, text: script }]); setMessage('已保存新的文本修订；正式创作依据仍保持原版。'); }, false, script === latest.text)}</div>
            <Textarea aria-label="剧本正文" autosize={false} value={script} onChange={e => setScript(e.currentTarget.value)} classNames={{ root: d.scriptEditor, wrapper: d.scriptWrapper, input: d.scriptInput }}/>
            <div className={d.basis}><strong>正式创作依据</strong><p>剧情、正式台词与共同设定有实质变化时，由主创确认。保存草稿和试作可先进行。</p>{b(`模拟主创确认 r${latest.revision}`, () => { setFormal(latest.revision); setMessage(`已模拟将 r${latest.revision} 设为正式依据，旧稿的依据不变。`); }, false, formal === latest.revision || script !== latest.text)}</div>
          </section>
          <aside className={d.proposalPanel} aria-label="分镜提案"><h2>把戏文带入当前场次</h2><p className={c.secondary}>目标固定：第 1 集 / 咖啡厅。现有 6 镜头保留。</p>
            <NativeSelect label="本次来源范围" value={range} onChange={e => setRange(e.currentTarget.value)} data={[{value:'action',label:'示例选区 · 拿起钥匙与认出'}, {value:'scene',label:'当前已保存的整场戏文'}]} classNames={{input:c.field}}/>
            {b('查看分镜建议示例', prepareProposal, true, script !== latest.text || !!proposal?.applied || (range==='action' && !latest.text.includes(fragment)))}<p className={c.meta}>{script !== latest.text ? '先保存文本，再固定提案来源。' : range==='action' && !latest.text.includes(fragment) ? '当前修订不含原示例选区，请改选整场来源。' : '演示固定输出；真实 AI 建议需核对来源、模型与费用后执行。'}</p>
            {proposal && <><details open className={d.source}><summary>来源 r{proposal.revision} · 固定原文</summary><p>{proposal.source}</p></details>{proposal.revision !== latest.revision && <p role="alert">剧本文本已更新，请重新准备提案；当前选择和内容仍保留。</p>}
              {proposal.rows.map(row => <article className={d.proposalRow} key={row.id}><Checkbox label={`新增 SH-${String(row.id).padStart(2,'0')} · ${row.title}`} checked={proposal.selected.includes(row.id)} disabled={proposal.applied} onChange={e => { const selected=e.currentTarget.checked; setProposal(p => p ? {...p,selected:selected?[...p.selected,row.id]:p.selected.filter(id=>id!==row.id)}:p); }}/><Textarea label={`SH-${row.id} 叙事意图`} value={row.intention} readOnly={proposal.applied} onChange={e => { const value=e.currentTarget.value; setProposal(p => p ? {...p, rows:p.rows.map(r=>r.id===row.id?{...r,intention:value}:r)}:p); }} classNames={{input:c.field}} minRows={2} autosize/>{row.dialogue && <p className={c.meta}>台词：{row.dialogue}</p>}</article>)}
              {b(proposal.applied ? `已新增 ${proposal.selected.length} 个示例镜头` : `追加选中的 ${proposal.selected.length} 个镜头`, () => { setProposal(p=>p?{...p,applied:true}:p);setMessage('示例提案已采纳，现有镜头保持不变；真实场次未被修改。'); },true,proposal.applied || !proposal.selected.length || proposal.revision!==latest.revision)}
              {proposal.applied && <div className={d.applied}><strong>咖啡厅 · {6+proposal.selected.length} 个示例镜头</strong><p>原 SH-01—06 保留；新增 {proposal.selected.map(id=>`SH-${String(id).padStart(2,'0')}`).join('、')}，状态为待制作，没有生成或采用。</p></div>}
            </>}
          </aside>
        </div>}
        {route.topic === 'sound' && <div className={c.cutWorkspace}>
          <section className={c.cutViewer}><div className={c.previewHeader}><div><span className={c.eyebrow}>{viewVersion ? `固定稿 v${viewVersion} · 只读` : '场次剪辑草稿'}</span><h1>咖啡厅 · 声音与字幕</h1></div><NativeSelect aria-label="声音字幕版本" value={viewVersion} onChange={e=>setViewVersion(Number(e.currentTarget.value))} data={[{value:'0',label:'当前草稿'},...versions.map(v=>({value:String(v.number),label:`固定稿 v${v.number}`}))]} classNames={{input:c.field}}/></div>
            <div className={c.cutImage}><div className={d.soundFrame}>{media(soundFocus-1,`SH-0${soundFocus} 静帧`)}{soundFocus===5 && <span className={d.subtitle}>{currentSound.cue.text}</span>}</div></div>
            <div className={c.previewFooter}><span className={c.meta}>{viewVersion ? `固定记录：原轨${currentSound.native==='keep'?'保留':'静音'} · 字幕 ${currentSound.cue.start}—${currentSound.cue.end}s` : '文字和静帧排版示意 · 当前没有可回放音视频'}</span></div>
            <nav className={c.filmstrip} aria-label="声音字幕分镜条">{initialShots.map(s=><UnstyledButton className={c.shot} key={s.id} data-selected={soundFocus===s.id||undefined} disabled={![4,5].includes(s.id)} onClick={()=>{setSoundFocus(s.id);setSoundTab(s.id===4?'timing':'sound');}}>{media(s.frame,s.title)}<span><strong>{s.label}</strong><small>{s.id===4?currentSound.seconds:s.seconds}s · 原片 A</small></span></UnstyledButton>)}</nav>
          </section>
          <aside className={d.soundInspector} aria-label="声音字幕编辑"><div className={d.tabs}>{[{id:'sound',title:'声音'},{id:'subtitle',title:'字幕'},{id:'timing',title:'时长影响'}].map(t=><UnstyledButton key={t.id} aria-pressed={soundTab===t.id} onClick={()=>{setSoundTab(t.id);setSoundFocus(t.id==='timing'?4:5);}}>{t.title}</UnstyledButton>)}</div>
            {soundTab==='sound' ? <><h2>SH-05 · 台词与声源</h2><p className={c.secondary}>林夏：“原来，他一直留着。”</p><NativeSelect label="视频原生混合音轨" value={currentSound.native} disabled={!!viewVersion} onChange={e=>updateSound({native:e.currentTarget.value as SoundDraft['native']})} data={[{value:'keep',label:'保留原轨（默认）'},{value:'mute',label:'静音整个原轨'}]} classNames={{input:c.field}}/><p className={c.meta}>原轨可能含对白、环境和配乐。整体静音会一起移除，不能当作对白分离。</p><Checkbox label="加入替代对白示例" checked={currentSound.replacement} disabled={!!viewVersion} onChange={e=>updateSound({replacement:e.currentTarget.checked})}/>{currentSound.replacement && <div className={d.applied}><strong>林夏对白 · voice-01.wav</strong><p>示例占位，无实际音频文件；关联正式台词 r1。</p></div>}{doubleDialogue && <p className={d.issue} role="alert">替代对白与原轨可能重复。此示例已知原轨包含同句对白，请明确静音原轨后再固定。</p>}<NumberInput label="替代对白音量（dB）" min={-24} max={6} value={currentSound.gain} disabled={!!viewVersion||!currentSound.replacement} onChange={v=>updateSound({gain:Number(v)})} classNames={{input:c.field}}/><div className={d.source}><strong>咖啡厅环境声</strong><p>{currentSound.ambientEnd ? `场次 0—${currentSound.ambientEnd}s · 独立环境声示例` : '已从当前草稿移除'}</p></div></> : soundTab==='subtitle' ? <><h2>SH-05 · 字幕条目</h2><p className={c.meta}>来源：正式计划台词 r1；状态：{currentSound.checked?'演示已核对':'待实际回放核对'}。未执行语音转写。</p><Textarea label="字幕正文" value={currentSound.cue.text} readOnly={!!viewVersion} onChange={e=>updateSound({cue:{...currentSound.cue,text:e.currentTarget.value}})} classNames={{input:c.field}} minRows={3} autosize/><div className={d.twoFields}><NumberInput label="场次入点（秒）" min={0} value={currentSound.cue.start} disabled={!!viewVersion} onChange={v=>updateSound({cue:{...currentSound.cue,start:Number(v)}})} classNames={{input:c.field}}/><NumberInput label="场次出点（秒）" min={0} value={currentSound.cue.end} disabled={!!viewVersion} onChange={v=>updateSound({cue:{...currentSound.cue,end:Number(v)}})} classNames={{input:c.field}}/></div>{invalidCue && <p className={d.issue} role="alert">字幕区间无效：入点应早于出点，且不能超过场次时长。</p>}<p>每条字幕单独编辑文字与时间。实际画面核对不由“文字一致”自动完成。</p><Checkbox label="模拟已完成人工回放核对" checked={currentSound.checked} disabled={!!viewVersion||invalidCue} onChange={e=>{const checked=e.currentTarget.checked;setSound(s=>({...s,checked}));}}/></> : <><h2>缩短 SH-04 的使用时长</h2><p>从 9 秒改为 6 秒，SH-05 与 SH-06 前移 3 秒；场次由 46 秒变为 43 秒。</p><div className={d.source}><strong>需要处理</strong><p>1 条 SH-05 字幕<br/>1 条跨切点的咖啡厅环境声</p></div>{b('预览时长影响',()=>{setCueDecision('');setAudioDecision('');setImpact(true);},false,!!viewVersion||sound.seconds===6)}<p className={c.meta}>没有填写处理方式前，不改草稿；不静默截断或删除声音字幕。</p></>}
            <div className={c.inspectorBottom}><p className={c.meta}>{viewVersion?'固定稿的声音选择、字幕文字与时间不会跟随草稿改变。':'固定时包括画面用片、声音选择与字幕。未核对项继续标记，供审阅检查。'}</p>{viewVersion?b('返回可编辑草稿',()=>setViewVersion(0)):b('模拟固定声音字幕稿',freezeSound,true,invalidCue||doubleDialogue)}</div>
          </aside>
        </div>}
        {route.topic === 'asset' && <div className={d.assetLayout}>
          <section className={d.assetMain}><div className={d.sectionHead}><div><span className={c.eyebrow}>{assetScope==='project'?'旧钥匙 · 项目资产':'工作室共享 · 已授权内容'}</span><h1>旧铜钥匙</h1></div><NativeSelect aria-label="资产范围" value={assetScope} onChange={e=>setAssetScope(e.currentTarget.value)} data={[{value:'project',label:'项目内资产'},{value:'studio',label:'工作室共享资产示例'}]} classNames={{input:c.field}}/></div><div className={d.assetImage}><img src="/demo/workspace-v2/key-reference.png" alt="旧铜钥匙设定参考"/></div><div className={d.assetMeta}><span>道具 · 铜制 · 负责人 林予</span><span>v{assetVersion} · {assetVersion===1?'已确认':'草稿，仅试作'}</span></div><p className={c.meta}>两个版本共用示意图片；本轮展示的是设定文字、版本选择与引用关系。</p></section>
          <aside className={d.assetInspector}><h2>设定版本</h2><div className={d.tabs}>{[1,2].map(v=><UnstyledButton key={v} aria-pressed={assetVersion===v} onClick={()=>setAssetVersion(v)}>v{v} · {v===1?'已确认':'草稿'}</UnstyledButton>)}</div><p>{assetVersion===1?'旧铜色，圆形匙环，保留左侧磨痕。':'增加匙环内侧的刻字说明，保留尺寸、铜色与磨痕。'}</p>{assetVersion===2 && <p className={c.meta}>新设定尚未替换项目正式依据，可以明确用于本次试作。</p>}<div className={d.source}><strong>引用目标</strong><p>咖啡厅 / SH-04 / 本次生成草稿</p>{b(referenceVersion===assetVersion?`当前草稿已引用 v${assetVersion}`:`本次尝试引用 v${assetVersion}`,()=>{setReferenceVersion(assetVersion);setMessage(`仅 SH-04 的当前生成草稿改用 v${assetVersion}；其他镜头、已提交计划与审阅稿保留原引用。`);},true,referenceVersion===assetVersion)}</div><h3>使用此资产的内容</h3><dl className={d.usage}><dt>SH-04 · 当前生成草稿</dt><dd>v{referenceVersion}{referenceVersion===2?' · 草稿设定，待主创确认':''}</dd><dt>SH-05 · 镜头参考</dt><dd>v1 · 已确认</dd><dt>已提交生成计划 P-03</dt><dd>v1 · 固定输入</dd><dt>场次审阅稿 v1</dt><dd>资产 v1 · 固定依据</dd></dl><p className={c.meta}>发布到工作室共享是独立动作，不随版本选择或项目引用自动发生。本轮范围切换只展示已授权共享示例。</p></aside>
        </div>}
        {route.topic === 'recovery' && <div className={d.recoveryPage}>
          <div className={d.recoveryToolbar}><div><h1>咖啡厅 · 画布保存</h1><span className={c.meta}>动作优化草稿节点 · 图像与制作事实保持原样</span></div><div className={c.row}>{b('模拟离线',()=>{setSaveState('offline');setCompare(false);setMessage('模拟离线：本次输入保留在原型内存，尚未同步到服务器。');})}{b('模拟同伴修改',startConflict)}</div></div>
          <div className={d.saveBanner} role="status"><I.Info size={17}/><div><strong>{saveState==='conflict'?'保存冲突 · 自动同步已暂停':saveState==='offline'?'本机待同步 · 离线示例':`演示基线 r${savedRevision} · ${mine===savedPrompt?'已模拟保存':'有本地修改'}`}</strong><p>{saveState==='conflict'?`本地基于 r${baseVersion}，服务器已有 r${serverRevision}。保留输入后对照修改，不直接覆盖。`:saveState==='offline'?'可继续输入。真实版本会在重新授权后恢复同步；本原型刷新仍会重置。':'本轮不执行实际网络保存。准备生成前需有明确已保存版本。'}</p></div><div className={c.spacer}/>{saveState==='conflict'?b(compare?'对照已展开':'对照并处理',()=>{setCompare(true);setMerged(mine);setExpectedRevision(serverRevision);setReviewed(false);},false,compare):saveState==='offline'?b('模拟恢复连接并核对',startConflict):b('模拟保存当前输入',()=>{setSavedPrompt(mine);setSavedRevision(v=>v+1);setMessage('演示保存完成；没有调用服务器。');},false,mine===savedPrompt)}</div>
          <div className={d.recoveryBody}><section className={d.localDraft}><div className={d.sectionHead}><h2>我的当前修改</h2><span className={d.tag}>保留本地</span></div><Textarea label="本地动作提示" value={mine} onChange={e=>{setMine(e.currentTarget.value);setReviewed(false);}} classNames={{input:c.field}} minRows={5} autosize/><details className={d.source}><summary>本地原基线</summary><p>{savedPrompt}</p></details><div className={d.miniCanvas}>{media(3,'旧候选与钥匙动作')}<span>仅编辑输入，不覆盖原候选</span></div><div className={c.row}>{b('在本次原型保留一份副本',()=>{setCopies(all=>[...all,mine]);setMessage('副本保留在原型内存，可在下方查看；刷新重置。');})}{b('准备生成',()=>setMessage('已保存版本可准备生成；本专项不执行生成。'),true,saveState!=='normal'||mine!==savedPrompt)}</div>{copies.length>0 && <details className={d.source}><summary>本次本地副本 · {copies.length} 份</summary>{copies.map((copy,i)=><p key={i}>{copy}</p>)}</details>}</section>
            <section className={d.mergePanel} aria-label="保存冲突对照">{compare ? <><div className={d.sectionHead}><h2>服务器 r{serverRevision}</h2>{b('模拟又有同伴更新',()=>{setServerRevision(v=>v+1);setRemote('右手动作放慢，保留同伴新加的反应停顿。');setMessage('模拟新版本到达；当前手动合并内容没有被替换。');})}</div><div className={d.remoteChanges}><strong>周远 · 动作描述</strong><p>{remote}</p><strong>另一个节点的修改</strong><p>光线：窗边自然日光；节点右移 100px。重新保存时保留这些同伴修改。</p></div><Textarea label="准备保存的合并动作" value={merged} onChange={e=>{setMerged(e.currentTarget.value);setReviewed(false);}} classNames={{input:c.field}} minRows={4} autosize/>{expectedRevision!==serverRevision && <div className={d.issue}><p>对照基线 r{expectedRevision} 已过期，服务器是 r{serverRevision}。</p>{b(`读取 r${serverRevision} 后重新核对`,()=>{setExpectedRevision(serverRevision);setReviewed(false);setMessage('已读取新版；手动合并内容继续保留，请重新核对后保存。');})}</div>}<Checkbox label={`已核对 r${expectedRevision}，只应用这段动作修改`} checked={reviewed} onChange={e=>setReviewed(e.currentTarget.checked)}/>{b(`按 r${expectedRevision} 保存合并结果`,saveMerged,true,!reviewed||!merged.trim())}<p className={c.meta}>生产实现需再次校验服务端版本；仍有冲突则保留合并内容，再读新版，不强制覆盖。</p></> : <div className={d.recoveryEmpty}><I.Stack size={30}/><h2>修改有出处，恢复有选择</h2><p>保存冲突时在这里对照本地与服务器内容。当前草稿始终留在左侧。</p></div>}</section>
          </div>
        </div>}
      </div>
    </div>
    <Modal opened={impact} onClose={()=>setImpact(false)} title="改变时长前，处理声音与字幕" size="lg" classNames={{content:c.modal,header:c.modalHeader}} styles={{content:studyVariables(route.tone)}}><div className={d.impact}><p>SH-04：9 秒 → 6 秒。下列处理均需明确选择；应用前保留原草稿。</p><NativeSelect label="SH-05 字幕（31—35 秒）" value={cueDecision} onChange={e=>setCueDecision(e.currentTarget.value)} data={[{value:'',label:'请选择处理方式'},{value:'follow',label:'随已知关联镜头前移到 28—32 秒'},{value:'keep',label:'保持 31—35 秒，之后重新核对'}]} classNames={{input:c.field}}/><NativeSelect label="咖啡厅环境声（0—46 秒）" value={audioDecision} onChange={e=>setAudioDecision(e.currentTarget.value)} data={[{value:'',label:'请选择处理方式'},{value:'trim',label:'明确裁切到 0—43 秒'},{value:'remove',label:'从当前草稿移除此条环境声'}]} classNames={{input:c.field}}/><p className={c.meta}>这只是已知关联的时间处理示例，不能代替实际音画回放。</p>{b('应用本次时长示例',applyImpact,true,!cueDecision||!audioDecision)}</div></Modal>
  </main>;
}
