/** Companion screens for the scene walkthrough. Shares the parent's in-memory production facts. */
import { Button, NativeSelect, NumberInput, Textarea, UnstyledButton } from '@mantine/core';
import type { ReactNode } from 'react';
import { initialScript } from '../model';
import type { Shot } from '../model';
import * as I from '../icons';
import type { WalkPage, WalkClip, WalkReview, WalkNote } from './workspace-walkthrough-model';
import { duration, stamp, walkTitles } from './workspace-walkthrough-model';
import c from './workspace-recommendation.module.css';

type Props = {
  page: WalkPage; shots: Shot[]; clips: WalkClip[]; reviews: WalkReview[]; revision: number;
  focus: number; adopted: Record<number, string>; episodeVersion: number | null;
  note: string; time: number; setNote: (v: string) => void; setTime: (v: number) => void;
  go: (page: WalkPage) => void; choose: (id: number) => void; selectRevision: (n: number) => void;
  updateClips: (next: WalkClip[]) => void; freeze: () => void;
  reviewStatus: (s: WalkReview['status']) => void; addNote: () => void; rework: (r: WalkReview, n: WalkNote) => void;
  include: (n: number) => void; media: (frame: number, label: string, take?: string) => ReactNode;
  assetMedia: (id: string) => ReactNode;
};
export function WorkspaceWalkthroughPages(p: Props) {
  const b = (label: string, action: () => void, primary = false, disabled = false) => <Button className={`${c.button} ${primary ? c.primary : ''}`} variant="default" onClick={action} disabled={disabled}>{label}</Button>;
  const review = p.reviews.find(r => r.number === p.revision) || p.reviews[0]!;
  const fixed = p.page === 'review';
  const clips = fixed ? review?.clips || [] : p.clips;
  const index = Math.max(0, clips.findIndex(x => x.shotId === p.focus));
  const clip = clips[index];
  const shot = p.shots.find(s => s.id === clip?.shotId) || p.shots[0];
  const start = duration(clips.slice(0, index));
  if (fixed && !review) return <div className={c.emptyScene}><h1>还没有审阅稿</h1><p>在剪辑里固定一个版本后，再开始审阅。</p>{b('回到剪辑', () => p.go('cut'))}</div>;
  if (p.page === 'cut' || fixed) return <div className={c.cutWorkspace}>
    <section className={c.cutViewer} aria-label={fixed ? '固定稿画面' : '剪辑草稿画面'}>
      <div className={c.previewHeader}><div><div className={c.eyebrow}>{fixed ? `审阅稿 v${review.number} · ${review.status}` : '当前剪辑草稿'}</div><h1>{shot ? `${shot.label} / ${clip?.take} · ${shot.title}` : '还没有镜头加入剪辑'}</h1></div><span className={c.meta}>{clips.length} 镜头 · {stamp(duration(clips))}</span></div>
      <div className={c.cutImage}>{shot ? p.media(shot.frame, `${fixed ? `v${review.number}` : '剪辑'} ${shot.label} / ${clip?.take}`, clip?.take) : <p>采用候选后，明确用于剪辑。</p>}</div>
      <div className={c.previewFooter}><span className={c.meta}>{stamp(start)}—{stamp(start + (clip?.seconds || 0))} · 静帧组接示意</span><div className={c.spacer}/>{b('回到此镜头制作', () => { if (shot) p.choose(shot.id); p.go('production'); })}</div>
      <nav className={c.filmstrip} aria-label={fixed ? '固定审阅分镜条' : '剪辑分镜条'}>{clips.map(x => { const s = p.shots.find(s => s.id === x.shotId)!; return <UnstyledButton key={x.shotId} className={c.shot} data-selected={s.id === shot?.id || undefined} aria-label={`${fixed ? '审阅' : '剪辑'} ${s.label} / ${x.take}`} onClick={() => p.choose(s.id)}>{p.media(s.frame, s.title, x.take)}<span><strong>{s.label}</strong><small>{x.take} · {x.seconds}s</small></span></UnstyledButton>; })}</nav>
    </section>
    <aside className={c.cutInspector} aria-label={fixed ? '版本审阅' : '剪辑操作'}>
      {fixed ? <>
        <div className={c.row}><I.LockSimple size={18}/><h2>固定稿审阅</h2></div>
        <NativeSelect label="审阅版本" value={review.number} onChange={e => p.selectRevision(Number(e.currentTarget.value))} data={p.reviews.map(r => ({ value: String(r.number), label: `v${r.number} · ${r.status}` }))} classNames={{ input: c.field }} />
        <p className={c.secondary}>{review.source}</p>
        {review.notes.length === 0 && <p className={c.secondary}>本版暂无意见。检查镜头接续与动作后，再确认此版本。</p>}
        {review.notes.map(n => <article className={c.reviewNote} key={n.id}><UnstyledButton onClick={() => p.choose(n.shotId)}><I.ChatCircleText size={15}/> {stamp(n.time)} · SH-{String(n.shotId).padStart(2, '0')}</UnstyledButton><p>{n.text}</p>{b('按此意见继续制作', () => p.rework(review, n))}</article>)}
        <details className={c.reviewDetails}><summary>添加时间点意见</summary><NumberInput label="本稿时间（秒）" min={start} max={start + (clip?.seconds || 1) - 1} value={Math.min(start + (clip?.seconds || 1) - 1, Math.max(start, p.time))} onChange={v => p.setTime(Number(v))} classNames={{ input: c.field }}/><Textarea label={`v${review.number} 的审阅意见`} value={p.note} onChange={e => p.setNote(e.currentTarget.value)} minRows={3} autosize classNames={{ input: c.field }}/>{b('添加意见', p.addNote, false, !p.note.trim() || !shot)}</details>
        <div className={c.inspectorBottom}><p className={c.meta}>意见与结论只属于 v{review.number}。制作中的新候选不会改动本稿。</p>{b('确认此版可用于整集', () => p.reviewStatus('已确认'), true, review.status === '已确认')}{b('标为需修改', () => p.reviewStatus('需修改'), false, review.status === '需修改')}{b('返回当前剪辑', () => p.go('cut'))}</div>
      </> : <>
        <h2>{shot?.label || '场次'} · 剪辑用 {clip?.take || '—'}</h2>
        {shot && clip && <><p>镜头当前采用 {p.adopted[shot.id] || 'A'}</p>{b(`替换为已采用 ${p.adopted[shot.id] || 'A'}`, () => p.updateClips(p.clips.map(x => x.shotId === shot.id ? { ...x, take: p.adopted[shot.id] || 'A' } : x)), false, clip.take === (p.adopted[shot.id] || 'A'))}<NumberInput label="使用时长（秒）" min={1} max={shot.seconds} allowDecimal={false} value={clip.seconds} onChange={v => p.updateClips(p.clips.map(x => x.shotId === shot.id ? { ...x, seconds: Math.max(1, Math.min(shot.seconds, Number(v) || 1)) } : x))} classNames={{ input: c.field }}/><div className={c.row}>{b('向前移动', () => { const next = [...p.clips]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; p.updateClips(next); }, false, index === 0)}{b('向后移动', () => { const next = [...p.clips]; [next[index + 1], next[index]] = [next[index]!, next[index + 1]!]; p.updateClips(next); }, false, index === p.clips.length - 1)}</div></>}
        <div className={c.inspectorBottom}><h3>准备一份可审阅的版本</h3><p className={c.secondary}>固定当前用片、顺序和时长。之后的修改继续留在剪辑草稿。</p>{b('生成审阅稿', p.freeze, true, !p.clips.length)}<p className={c.meta}>本轮验证组接与版本流转。实际播放、声音和字幕留在专项设计。</p></div>
      </>}
    </aside>
  </div>;
  const inProject = ['project', 'assets', 'script', 'delivery'].includes(p.page);
  return <div className={c.catalogLayout}>
    {inProject && <nav className={c.projectNav} aria-label="项目目录"><strong>旧钥匙</strong>{(['project', 'script', 'assets', 'delivery'] as WalkPage[]).map(page => <UnstyledButton key={page} data-active={page === p.page || undefined} onClick={() => p.go(page)}>{walkTitles[page]}</UnstyledButton>)}</nav>}
    <section className={c.catalog} aria-label={walkTitles[p.page]}><div className={c.catalogTitle}><div><div className={c.eyebrow}>{inProject ? '旧钥匙 · 项目空间' : '拾光工作室'}</div><h1>{walkTitles[p.page]}</h1></div>{b('继续咖啡厅制作', () => p.go('production'))}</div>
      {p.page === 'projects' && <UnstyledButton className={c.projectCover} onClick={() => p.go('project')}>{p.media(0, '旧钥匙')}<strong>旧钥匙</strong><span>AI 写实短剧 · 1 个演示场次</span></UnstyledButton>}
      {p.page === 'project' && <><h2>第 1 集 · 重逢</h2><div className={c.catalogRow}><div><strong>01 · 咖啡厅</strong><p>{p.shots.length} 镜头 · 内景 / 日 · 负责人 林予</p></div><span className={c.secondary}>v{p.reviews.at(-1)?.number} · {p.reviews.at(-1)?.status}</span>{b('进入制作', () => p.go('production'))}</div><p className={c.meta}>按集组织场次；原型仅展开咖啡厅这一场。</p></>}
      {p.page === 'work' && <><p className={c.secondary}>定位我负责的场次和需要处理的意见。</p><div className={c.catalogRow}><div><strong>继续咖啡厅制作</strong><p>旧钥匙 / 第 1 集 · 林予负责</p></div>{b('打开场次', () => p.go('production'))}</div>{p.reviews.filter(r => r.status === '需修改').map(r => <div className={c.catalogRow} key={r.number}><div><strong>咖啡厅 · v{r.number} 有修改意见</strong><p>{r.notes.length} 条意见 · 查看对应固定稿</p></div>{b(`查看 v${r.number}`, () => { p.selectRevision(r.number); p.go('review'); })}</div>)}</>}
      {(p.page === 'library' || p.page === 'assets') && <><p className={c.secondary}>{p.page === 'library' ? '跨项目复用的表演参考。当前是素材范围与返回路径示意。' : '本项目确认的角色、场景与道具版本。制作中可就地引用。'}</p><div className={c.catalogAssets}>{(p.page === 'library' ? [{ id: 'next', name: '克制表演 · 情绪参考', type: '表演' }] : [{ id: 'person', name: '林夏', type: '角色' }, { id: 'place', name: '咖啡厅', type: '场景' }, { id: 'key', name: '旧铜钥匙', type: '道具' }]).map(a => <article key={a.id}>{p.assetMedia(a.id)}<strong>{a.name}</strong><span>{a.type} · v1</span></article>)}</div></>}
      {p.page === 'script' && <div className={c.scriptText}><p className={c.meta}>剧本与设定只读示意 · 制作上下文</p>{initialScript}</div>}
      {p.page === 'delivery' && <><h2>第 1 集 · 场次版本</h2><p className={c.secondary}>{p.episodeVersion ? `整集草稿当前引用：咖啡厅 v${p.episodeVersion}` : '选择一份已确认的场次版本加入整集草稿。'}</p>{p.reviews.map(r => <div className={c.catalogRow} key={r.number}><div><strong>咖啡厅 · v{r.number}</strong><p>{stamp(duration(r.clips))} · {r.status}</p></div>{b(`查看 v${r.number}`, () => { p.selectRevision(r.number); p.go('review'); })}{b(p.episodeVersion === r.number ? '已加入整集草稿' : '加入整集草稿', () => p.include(r.number), false, r.status !== '已确认' || p.episodeVersion === r.number)}</div>)}<p className={c.meta}>此处只验证固定版本引用；没有合成或导出文件。</p></>}
    </section>
  </div>;
}
