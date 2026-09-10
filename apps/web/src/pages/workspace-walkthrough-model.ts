/** In-memory fixtures for design evaluation only. No API or model calls. */
import { initialShots } from '../model';
export type WalkPage = 'production' | 'cut' | 'review' | 'projects' | 'project' | 'work' | 'library' | 'assets' | 'script' | 'delivery';
export type WalkClip = { shotId: number; take: string; seconds: number };
export type WalkNote = { id: number; shotId: number; time: number; text: string };
export type WalkReview = { number: number; clips: WalkClip[]; status: '待审阅' | '需修改' | '已确认'; notes: WalkNote[]; source: string };
export type WalkJob = { id: number; target: string; prompt: string; refs: string[]; seconds: number; take: string; status: '排队中' | '生成中' | '结果可用' | '生成失败' | '提交待核对'; outcome: 'success' | 'failure' | 'unknown' };
export const makeClips = () => initialShots.map(s => ({ shotId: s.id, take: 'A', seconds: s.seconds }));
export const makeReviews = (): WalkReview[] => [{ number: 1, clips: makeClips(), status: '需修改', source: '首次场次审阅稿', notes: [{ id: 1, shotId: 4, time: 24, text: '拿钥匙的接触点再自然一些，保留人物、衣服和当前节奏。' }] }];
export const duration = (clips: WalkClip[]) => clips.reduce((n, c) => n + c.seconds, 0);
export const stamp = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
export const walkTitles: Record<WalkPage, string> = { production: '镜头制作', cut: '剪辑', review: '固定稿审阅', projects: '项目', project: '场次', work: '我的工作', library: '工作室资产', assets: '项目资产', script: '剧本与设定', delivery: '整集与交付' };
