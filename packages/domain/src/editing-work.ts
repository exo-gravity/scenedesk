import type { components } from "@drama/contracts";
import { editingCanonical } from "./editing-canonical.js";

type Schema<K extends keyof components["schemas"]> = components["schemas"][K];
export type WorkDocument = Schema<"CutWorkDocument">;
export type WorkClip = Schema<"WorkMediaClip"> | Schema<"WorkSubtitleClip">;
export type WorkMediaFact = Readonly<{
  id: string;
  kind: string;
  status: string;
  durationUs?: number;
  hasAudio?: boolean;
}>;
export type WorkTakeFact = Readonly<{
  id: string;
  mediaId: string;
  range: { inUs: number; outUs: number };
}>;
export const WORK_DOCUMENT_LIMITS = Object.freeze({
  canonicalBytes: 4 * 1024 * 1024,
  tracks: 32,
  items: 5000,
  timingOrigins: 5000,
  bindings: 5000,
  unresolvedEdits: 500,
});
export class EditingDocumentError extends Error {
  constructor(
    readonly code: "INVALID_WORK_DOCUMENT" | "WORK_DOCUMENT_TOO_LARGE",
    message: string,
  ) {
    super(message);
  }
}
function valid(condition: unknown, message: string): asserts condition {
  if (!condition)
    throw new EditingDocumentError("INVALID_WORK_DOCUMENT", message);
}
function bounded(count: number, max: number) {
  if (count > max)
    throw new EditingDocumentError(
      "WORK_DOCUMENT_TOO_LARGE",
      "工作稿超过容量限制，请保留本机内容并分段整理。",
    );
}
function unique(ids: string[], message: string) {
  valid(
    new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
    message,
  );
}
const key = (id: string) => id.toLowerCase();

/** Contract validation runs first. This adds document-wide semantic constraints,
 * not a second JSON schema. Authority and fixed reference existence belong to SQL. */
export function inspectWorkDocument(document: WorkDocument) {
  bounded(document.timeline.tracks.length, WORK_DOCUMENT_LIMITS.tracks);
  const items = document.timeline.tracks.flatMap<WorkClip>(
    (track) => track.items,
  );
  bounded(items.length, WORK_DOCUMENT_LIMITS.items);
  bounded(document.timingOrigins.length, WORK_DOCUMENT_LIMITS.timingOrigins);
  bounded(document.dramaBindings.length, WORK_DOCUMENT_LIMITS.bindings);
  bounded(
    document.unresolvedEdits.length,
    WORK_DOCUMENT_LIMITS.unresolvedEdits,
  );
  unique(
    [
      ...document.timeline.tracks.map((t) => t.id),
      ...items.map((c) => c.id),
      ...document.dramaBindings.map((b) => b.id),
      ...document.unresolvedEdits.map((u) => u.id),
    ],
    "轨道、片段、关联和待处理事项的 ID 不能重复。",
  );
  unique(
    document.timingOrigins.map((o) => o.clipId),
    "同一片段不能有重复的精确时间来源。",
  );
  unique(
    document.timeline.spec.qualityReferenceMediaIds ?? [],
    "质量参考不能重复。",
  );
  const clips = new Map(items.map((clip) => [key(clip.id), clip]));
  for (const track of document.timeline.tracks)
    for (const clip of track.items) {
      valid(clip.kind === track.kind, "片段与轨道类型不一致。");
      if (clip.kind !== "subtitle") {
        valid(clip.range.outUs >= clip.range.inUs, "源区间不能反向。");
        valid(
          clip.kind !== "video" ||
            (clip.fit !== undefined && clip.streamSelection === "default"),
          "视频片段需要画面适配方式和默认视频流。",
        );
        valid(
          !clip.selectionId || !!clip.takeId,
          "采用来源必须同时指定对应候选。",
        );
      }
    }
  for (const binding of document.dramaBindings)
    if (binding.sourceRange)
      valid(
        binding.sourceRange.outUs >= binding.sourceRange.inUs,
        "对白源区间不能反向。",
      );
  for (const origin of document.timingOrigins)
    valid(
      clips.has(key(origin.clipId)),
      "精确时间来源必须指向工作稿中实际存在的片段。",
    );
  let canonical: string;
  try {
    canonical = editingCanonical(document);
  } catch {
    throw new EditingDocumentError(
      "INVALID_WORK_DOCUMENT",
      "工作稿必须包含有效的 JSON 字符和有限数值。",
    );
  }
  // PostgreSQL JSONB cannot represent U+0000. Escaped literal backslash-u0000 is legal.
  const checkText = (value: unknown): boolean =>
    typeof value === "string"
      ? !value.includes("\0")
      : value !== null && typeof value === "object"
        ? Object.values(value).every(checkText)
        : true;
  valid(checkText(document), "工作稿文字不能包含空字符。");
  const canonicalBytes = new TextEncoder().encode(canonical).byteLength;
  bounded(canonicalBytes, WORK_DOCUMENT_LIMITS.canonicalBytes);
  return {
    canonical,
    canonicalBytes,
    clips,
    mediaClips: items.filter(
      (c): c is Schema<"WorkMediaClip"> => c.kind !== "subtitle",
    ),
  };
}

/** Live diagnostics: no rounding, mutation or authorization decision. BigInt also
 * keeps start+duration exact when two individually safe values exceed 2^53-1. */
export function workDocumentIssues(
  document: WorkDocument,
  media: ReadonlyMap<string, WorkMediaFact>,
  baseChanged = false,
  takes: ReadonlyMap<string, WorkTakeFact> = new Map(),
): Schema<"EditingIssue">[] {
  const issues = new Map<
    Schema<"EditingIssue">["code"],
    { message: string; ids: Set<string> }
  >();
  const add = (
    code: Schema<"EditingIssue">["code"],
    message: string,
    ids: string[] = [],
  ) => {
    const issue = issues.get(code) ?? { message, ids: new Set<string>() };
    for (const id of ids) issue.ids.add(key(id));
    issues.set(code, issue);
  };
  const clips = document.timeline.tracks.flatMap<WorkClip>((t) => t.items);
  if (
    (document.timeline.spec.qualityReferenceMediaIds ?? []).some(
      (id) => media.get(key(id))?.status !== "ready",
    )
  )
    add("MEDIA_UNAVAILABLE", "输出规格的质量参考当前不可用，请核对素材状态。");
  const index = new Map(clips.map((c) => [key(c.id), c]));
  const trackMuted = new Set(
    document.timeline.tracks
      .filter((t) => t.muted)
      .flatMap((t) => t.items.map((c) => key(c.id))),
  );
  const audible = new Map<
    string,
    { clipId: string; start: bigint; end: bigint }[]
  >();
  const length = (clip: WorkClip) =>
    clip.kind === "subtitle"
      ? BigInt(clip.durationUs)
      : BigInt(clip.range.outUs) - BigInt(clip.range.inUs);
  const videos = clips
    .filter((c) => c.kind === "video")
    .sort(
      (a, b) =>
        a.timelineStartUs - b.timelineStartUs || a.id.localeCompare(b.id),
    );
  let end = 0n;
  if (!videos.some((v) => length(v) > 0n))
    add("MAIN_VIDEO_REQUIRED", "请安排至少一个有效的视频片段。");
  for (const clip of videos) {
    const start = BigInt(clip.timelineStartUs);
    if (start > end)
      add("TIMELINE_GAP", "主视频存在空洞，请明确调整片段位置。", [clip.id]);
    if (start < end && length(clip) > 0n)
      add("TIMELINE_OVERLAP", "主视频片段重叠，请核对安排。", [clip.id]);
    if (length(clip) > 0n && start + length(clip) > end)
      end = start + length(clip);
  }
  for (const clip of clips) {
    if (length(clip) === 0n || (clip.kind === "subtitle" && !clip.text.trim()))
      add("EMPTY_CLIP", "有空内容或零时长片段，仍需完成。", [clip.id]);
    if (clip.kind === "subtitle" || clip.kind === "audio") {
      if (BigInt(clip.timelineStartUs) + length(clip) > end)
        add(
          clip.kind === "subtitle"
            ? "SUBTITLE_OUT_OF_BOUNDS"
            : "AUDIO_OUT_OF_BOUNDS",
          clip.kind === "subtitle"
            ? "字幕超出主视频范围。"
            : "声音超出主视频范围。",
          [clip.id],
        );
    }
    if (clip.kind !== "subtitle") {
      const fact = media.get(key(clip.mediaId));
      if (!fact || fact.status !== "ready")
        add(
          "MEDIA_UNAVAILABLE",
          "片段来源当前不可用于新的归一，请核对素材状态。",
          [clip.id],
        );
      if (fact?.durationUs === undefined || clip.range.outUs > fact.durationUs)
        add("SOURCE_RANGE_INVALID", "源区间超出已核验的素材时长。", [clip.id]);
      if (clip.takeId) {
        const take = takes.get(key(clip.takeId));
        if (
          !take ||
          key(take.mediaId) !== key(clip.mediaId) ||
          clip.range.inUs < take.range.inUs ||
          clip.range.outUs > take.range.outUs
        )
          add(
            "SOURCE_RANGE_INVALID",
            "片段超出绑定候选的范围；请先建立明确的派生候选。",
            [clip.id],
          );
      }
    }
  }
  for (const binding of document.dramaBindings) {
    const clip = index.get(key(binding.clipId));
    const typeMatches =
      clip &&
      (binding.usage === "subtitle"
        ? clip.kind === "subtitle"
        : binding.usage === "dialogue"
          ? clip.kind === "audio"
          : (clip.kind === "video" &&
              media.get(key(clip.mediaId))?.hasAudio === true) ||
            (clip.kind === "audio" &&
              clip.streamSelection === "embedded_audio"));
    if (
      !typeMatches ||
      (binding.sourceRange &&
        (!clip ||
          clip.kind === "subtitle" ||
          binding.sourceRange.inUs < clip.range.inUs ||
          binding.sourceRange.outUs > clip.range.outUs ||
          binding.sourceRange.inUs === binding.sourceRange.outUs))
    )
      add("BINDING_UNRESOLVED", "有对白关联尚未对应有效的片段或源区间。", [
        binding.clipId,
      ]);
    else if (
      clip &&
      clip.kind !== "subtitle" &&
      binding.usage !== "subtitle" &&
      !clip.muted &&
      !trackMuted.has(key(clip.id))
    ) {
      const source = binding.sourceRange ?? clip.range;
      if (source.outUs > source.inUs) {
        const group = `${key(binding.shotRevisionId)}:${key(binding.dialogueId)}`;
        const intervals = audible.get(group) ?? [];
        const start =
          BigInt(clip.timelineStartUs) +
          BigInt(source.inUs) -
          BigInt(clip.range.inUs);
        intervals.push({
          clipId: clip.id,
          start,
          end: start + BigInt(source.outUs) - BigInt(source.inUs),
        });
        audible.set(group, intervals);
      }
    }
  }
  // A repeated annotation of one clip is not a second audio source. Keeping
  // the two furthest ends with distinct clip IDs detects all overlap members
  // without enumerating quadratically many pairs in a large dialogue group.
  for (const intervals of audible.values()) {
    intervals.sort((a, b) =>
      a.start < b.start
        ? -1
        : a.start > b.start
          ? 1
          : a.end < b.end
            ? -1
            : a.end > b.end
              ? 1
              : a.clipId.localeCompare(b.clipId),
    );
    let furthest: typeof intervals = [];
    for (const interval of intervals) {
      const other = furthest.find(
        (value) => key(value.clipId) !== key(interval.clipId),
      );
      if (other && interval.start < other.end)
        add(
          "DUPLICATE_DIALOGUE_SOURCES",
          "同一句已知台词存在重叠的未静音声源，请核对原生混合音轨与独立对白。",
          [other.clipId, interval.clipId],
        );
      const existing = furthest.find(
        (value) => key(value.clipId) === key(interval.clipId),
      );
      if (!existing || existing.end < interval.end) {
        furthest = [
          ...furthest.filter(
            (value) => key(value.clipId) !== key(interval.clipId),
          ),
          interval,
        ]
          .sort((a, b) =>
            a.end > b.end
              ? -1
              : a.end < b.end
                ? 1
                : a.clipId.localeCompare(b.clipId),
          )
          .slice(0, 2);
      }
    }
  }
  for (const unresolved of document.unresolvedEdits)
    add(
      "UNRESOLVED_EDIT",
      "仍有明确记录的声音、字幕、替换或对白事项未完成。",
      unresolved.clipIds,
    );
  if (baseChanged)
    add("CUT_BASE_CHANGED", "已确认编排已变化，请比较并明确选择工作稿基线。");
  return [...issues].flatMap(([code, { message, ids }]) => {
    const values = [...ids];
    if (!values.length) return [{ code, message, clipIds: [] }];
    const chunks = [];
    for (let offset = 0; offset < values.length; offset += 5000)
      chunks.push({
        code,
        message,
        clipIds: values.slice(offset, offset + 5000),
      });
    return chunks;
  });
}
