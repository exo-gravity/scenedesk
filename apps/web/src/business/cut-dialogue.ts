import {
  editingCanonical,
  inspectWorkDocument,
  type WorkDocument,
  type WorkClip,
} from "@drama/domain";
import type { components } from "@drama/contracts";
import { sourceSeconds } from "./candidate-time.js";
type Schema<K extends keyof components["schemas"]> = components["schemas"][K];

export const bindingUsage = {
  native_mixed: "原生混合音轨中的对白",
  dialogue: "独立对白声音",
  subtitle: "字幕与台词关联",
};
export const pendingKind = {
  sound_placement: "声音位置",
  subtitle_placement: "字幕位置",
  replacement: "画面替换",
  dialogue_binding: "对白关联",
};
export function workClipLabel(clip: WorkClip) {
  return `${clip.kind === "subtitle" ? `字幕：${clip.text || "待填写"}` : clip.kind === "video" ? "视频片段" : clip.streamSelection === "embedded_audio" ? "视频内嵌声音" : "声音片段"} · ${sourceSeconds(clip.timelineStartUs)} 秒 · ${clip.id.slice(0, 8)}`;
}
export function originalSoundClips(document: WorkDocument, clipId: string) {
  const clips = document.timeline.tracks.flatMap<WorkClip>((t) => t.items),
    target = clips.find((c) => c.id === clipId);
  if (!target || target.kind !== "audio") return [];
  const start = BigInt(target.timelineStartUs),
    end = start + BigInt(target.range.outUs) - BigInt(target.range.inUs);
  if (end === start) return [];
  return document.timeline.tracks.flatMap((track) =>
    track.items.flatMap<Schema<"WorkMediaClip">>((clip) => {
      if (
        clip.id === clipId ||
        clip.kind === "subtitle" ||
        (clip.kind !== "video" && clip.streamSelection !== "embedded_audio")
      )
        return [];
      const a = BigInt(clip.timelineStartUs),
        b = a + BigInt(clip.range.outUs) - BigInt(clip.range.inUs);
      return b > a && a < end && b > start ? [clip] : [];
    }),
  );
}
export function dialogueContext(
  document: WorkDocument,
  clipId: string,
  bindingId?: string,
) {
  const relevant = new Set([
    clipId,
    ...originalSoundClips(document, clipId).map((c) => c.id),
  ]);
  return editingCanonical({
    binding: document.dramaBindings.find((b) => b.id === bindingId) ?? null,
    tracks: document.timeline.tracks.flatMap((track) => {
      const items = track.items.filter((c) => relevant.has(c.id));
      return items.length ? [{ id: track.id, muted: track.muted, items }] : [];
    }),
  });
}
export function applyWorkBinding(
  document: WorkDocument,
  binding: Schema<"DialogueBinding">,
  sound: Readonly<Record<string, "mute" | "keep">>,
  allowPending: boolean,
) {
  const result = structuredClone(document);
  const native =
    binding.usage === "dialogue"
      ? originalSoundClips(document, binding.clipId)
      : [];
  const unresolved = native.filter((c) => !sound[c.id]);
  if (unresolved.length && !allowPending)
    throw new Error("先明确原声处理，或把未决定的内容保留为待核对事项。");
  for (const track of result.timeline.tracks)
    for (const clip of track.items)
      if (
        clip.kind !== "subtitle" &&
        native.some((n) => n.id === clip.id) &&
        sound[clip.id] === "mute"
      )
        clip.muted = true;
  // Keep preserves the actual current clip/track state; it never unmutes a
  // previously muted source or fabricates a separated background track.
  const index = result.dramaBindings.findIndex((b) => b.id === binding.id);
  if (index < 0) result.dramaBindings.push(binding);
  else result.dramaBindings[index] = binding;
  if (unresolved.length) {
    const clipIds = [binding.clipId, ...unresolved.map((c) => c.id)];
    const note = `待回放核对原生混合音轨与独立对白，明确保留或静音原声（关联 ${binding.id}）。`;
    if (
      !result.unresolvedEdits.some(
        (u) =>
          u.kind === "dialogue_binding" &&
          u.note === note &&
          editingCanonical(u.clipIds) === editingCanonical(clipIds),
      )
    )
      result.unresolvedEdits.push({
        id: crypto.randomUUID(),
        kind: "dialogue_binding",
        clipIds,
        note,
      });
  }
  inspectWorkDocument(result);
  return result;
}
