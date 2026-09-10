/** Disposable, in-memory design fixture. Never reads or writes the business demo store. */
import { initialShots, initialScript } from "../model";
import type { Shot } from "../model";

export type JourneyPage = "projects" | "work" | "library" | "project" | "script" | "assets" | "delivery" | "scene";
export type Mode = "storyboard" | "canvas";
export type View = "production" | "cut" | "review";
export type SceneKey = "cafe" | "alley" | "home";
export type JourneyShot = Shot & { refs: number[] };
export type JourneyClip = { shotId: number; take: string; seconds: number };
export type ReviewNote = { id: string; shotId: number; time: number; text: string };
export type JourneyReview = { number: number; clips: JourneyClip[]; status: "需修改" | "待审阅" | "已确认"; notes: ReviewNote[]; source?: string };
export type SceneDraft = { key: SceneKey; name: string; episode: string; description: string; owner: string; script: string; shots: JourneyShot[]; clips: JourneyClip[]; reviews: JourneyReview[]; mode: Mode; focus: number; candidates: Record<number, string>; rework?: { revision: number; note: ReviewNote }; viewport?: { x: number; y: number; zoom: number }; positions: Record<string, { x: number; y: number }> };
export type Route = { page: JourneyPage; scene: SceneKey; episode: string; view: View; mode: Mode; shot: number; rev: number; tone: "light" | "dark" };
export type Job = { id: number; scene: SceneKey; shot: number; candidate: string };
export const feedback = "拿钥匙的接触点再自然一些，保留人物、衣服和当前节奏。";
export const episodes = [{ value: "e1", label: "第 1 集 · 重逢" }, { value: "e2", label: "第 2 集 · 旧居" }];
export function makeJourney(): Record<SceneKey, SceneDraft> {
  function scene(key: SceneKey, name: string, episode: string, count: number, description: string): SceneDraft {
    const shots = structuredClone(initialShots.slice(0, count)).map(s => ({ ...s, candidates: ["A", "B"], refs: [1, 3] }));
    if (key !== "cafe") shots.forEach((s, i) => { s.title = key === "alley" ? ["离开咖啡厅", "回头望去"][i]! : ["门前停步", "试探开锁", "推门而入"][i]!; s.intent = `${name}：${s.title}`; s.prompt = `${s.intent}。保持林夏造型与雨后光线。`; s.dialogue = ""; s.refs = [1, 4]; s.entry = "林夏持有旧钥匙"; s.exit = s.title; });
    const clips = shots.map(s => ({ shotId: s.id, take: "A", seconds: s.seconds }));
    return { key, name, episode, description, owner: key === "cafe" ? "我 · 林予" : "周遥", script: key === "cafe" ? initialScript : `${description}\n\n林夏握着旧钥匙，走向下一段故事。\n（用于验证跨场切换的简化戏文。）`, shots, clips, reviews: key === "cafe" ? [{ number: 1, clips: structuredClone(clips), status: "需修改", notes: [{ id: "note-1", shotId: 4, time: 24, text: feedback }] }] : [], mode: "storyboard", focus: key === "cafe" ? 4 : 1, candidates: {}, positions: {} };
  }
  return { cafe: scene("cafe", "咖啡厅", "e1", 6, "01 · 内景 / 日 · 一把旧钥匙重新连接两人"), alley: scene("alley", "巷口", "e1", 2, "02 · 外景 / 日 · 林夏独自离开"), home: scene("home", "旧居门前", "e2", 3, "01 · 外景 / 黄昏 · 回到记忆开始的地方") };
}
export function readJourneyRoute(): Route {
  const p = new URLSearchParams(location.hash.split("?")[1]);
  const pages = ["projects", "work", "library", "project", "script", "assets", "delivery", "scene"];
  return { page: pages.includes(p.get("page") || "") ? p.get("page") as JourneyPage : "projects", scene: p.get("scene") === "alley" ? "alley" : p.get("scene") === "home" ? "home" : "cafe", episode: p.get("episode") === "e2" ? "e2" : "e1", view: p.get("view") === "cut" ? "cut" : p.get("view") === "review" ? "review" : "production", mode: p.get("mode") === "canvas" ? "canvas" : "storyboard", shot: Math.max(1, Number(p.get("shot")) || 4), rev: Math.max(1, Number(p.get("rev")) || 1), tone: p.get("tone") === "dark" ? "dark" : "light" };
}
export const sumClips = (clips: JourneyClip[]) => clips.reduce((n, c) => n + c.seconds, 0);
