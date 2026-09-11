import type { components } from "@drama/contracts";
import {
  inspectWorkDocument,
  type WorkClip,
  type WorkDocument,
  type WorkTakeFact,
} from "./editing-work.js";

type Schema<K extends keyof components["schemas"]> = components["schemas"][K];
type Item = Schema<"NormalizedItem">;
type Change = Schema<"NormalizationChange">;
type Values = Schema<"TimingChangeValues">;
type MediaClip = Schema<"WorkMediaClip">;
export const CUT_NORMALIZATION_VERSION = "normalization-v1";
const S = 48_000n,
  US = 1_000_000n;

/** Facts are built from authorized, fixed-version, checksum-verified production
 * maps by the worker. Neither the browser nor its media duration echo is a source. */
export type NormalizationMedia = Readonly<{
  mediaId: string;
  sourceSha256: string;
  productionCopyId: string;
  kind: "video" | "audio";
  duration: { numerator: string; denominator: string };
  video?: {
    sourceMapId: string;
    frameCount: number;
    fpsNum: number;
    fpsDen: number;
    conversion?: { before: string; after: string };
  };
  audio?: { sourceMapId: string; sampleCount: number };
}>;
/** Only persisted CONFIRMED results may be supplied by the authority adapter. */
export type ConfirmedTiming = Readonly<{
  id: string;
  cutId: string;
  normalizationVersion: string;
  effectiveTimeline: Schema<"Timeline">;
  normalizedItems: readonly Item[];
}>;
export class CutNormalizationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly clipIds: readonly string[] = [],
  ) {
    super(message);
  }
}
function requireValue(
  value: unknown,
  code: string,
  message: string,
  clip?: string,
): asserts value {
  if (!value)
    throw new CutNormalizationError(code, message, clip ? [clip] : []);
}
const key = (value: string) => value.toLowerCase();
function integer(value: number) {
  requireValue(
    Number.isSafeInteger(value) && value >= 0,
    "NORMALIZATION_VALUE_INVALID",
    "时间边界必须为安全的非负整数。",
  );
  return BigInt(value);
}
function number(value: bigint) {
  requireValue(
    value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER),
    "NORMALIZATION_VALUE_OVERFLOW",
    "剪辑时间边界超出可保存范围。",
  );
  return Number(value);
}
type Fraction = { n: bigint; d: bigint };
function fraction(n: bigint, d: bigint): Fraction {
  requireValue(d > 0n, "NORMALIZATION_VALUE_INVALID", "时间分母必须为正数。");
  let a = n < 0n ? -n : n,
    b = d;
  while (b) [a, b] = [b, a % b];
  return { n: n / a, d: d / a };
}
const add = (a: Fraction, b: Fraction) =>
  fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Fraction, b: Fraction) =>
  fraction(a.n * b.d - b.n * a.d, a.d * b.d);
const compare = (a: Fraction, b: Fraction) => a.n * b.d - b.n * a.d;
const micros = (value: number) => fraction(integer(value), US);
const round = (n: bigint, d: bigint) => (2n * n + d) / (2n * d);
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
const echo = (value: Fraction) => number(round(value.n * US, value.d));
const sampleTime = (sample: bigint) => fraction(sample, S);
const samples = (time: Fraction) => round(time.n * S, time.d);

export type NormalizedCutContent = {
  effectiveTimeline: Schema<"Timeline">;
  normalizedItems: Item[];
  dramaBindings: Schema<"DialogueBinding">[];
  changes: Change[];
  lengthFrames: number;
  durationUs: number;
  normalizationVersion: typeof CUT_NORMALIZATION_VERSION;
};

/** Pure normalization of a SAVED snapshot. No media I/O, authority decisions,
 * profile selection, mutations or partial success. The caller persists the
 * whole result only after every item and binding passes. */
export function normalizeSavedCut(input: {
  cutId: string;
  document: WorkDocument;
  media: ReadonlyMap<string, NormalizationMedia>;
  takes?: ReadonlyMap<string, WorkTakeFact>;
  confirmedOrigins?: readonly ConfirmedTiming[];
  confirmedBase?: ConfirmedTiming;
  /** Deterministic UUID generator bound to this persisted normalization request. */
  changeId: (semanticKey: string) => string;
}): NormalizedCutContent {
  const { document } = input;
  inspectWorkDocument(document);
  requireValue(
    !document.unresolvedEdits.length,
    "UNRESOLVED_EDIT",
    "工作稿仍有待处理事项，请处理后再确认。",
  );
  const { fpsNum, fpsDen } = document.timeline.spec;
  const p = integer(fpsNum),
    q = integer(fpsDen);
  requireValue(
    ["24/1", "25/1", "30/1", "24000/1001", "30000/1001"].includes(`${p}/${q}`),
    "NORMALIZATION_RATE_UNSUPPORTED",
    "输出帧率没有受控的制作规格。",
  );
  const frameTime = (frame: bigint) => fraction(frame * q, p);
  const frameRound = (time: Fraction) => round(time.n * p, time.d * q);
  const A = (frame: bigint) => samples(frameTime(frame));
  const videoTracks = document.timeline.tracks.filter(
    (t) => t.kind === "video" && t.items.length,
  );
  requireValue(
    videoTracks.length === 1,
    "MAIN_VIDEO_REQUIRED",
    "必须恰有一个非空主视频轨。",
  );
  const changes: Change[] = [],
    normalizedItems: Item[] = [];
  const resultClips = new Map<string, WorkClip>();
  const changeKeys = new Set<string>(),
    changeIds = new Set<string>();
  const change = (
    clipId: string,
    component: string,
    kind: Change["kind"],
    message: string,
    before: Values,
    after: Values,
  ) => {
    const semanticKey = `${key(clipId)}:${component}`;
    const id = input.changeId(semanticKey);
    requireValue(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      ) &&
        !changeKeys.has(semanticKey) &&
        !changeIds.has(key(id)),
      "NORMALIZATION_CHANGE_ID_INVALID",
      "确认项身份重复。",
    );
    changeKeys.add(semanticKey);
    changeIds.add(key(id));
    changes.push({
      id,
      clipId,
      kind,
      message,
      requiresAcknowledgement: true,
      before,
      after,
    });
  };
  const originIndex = (origin: ConfirmedTiming) => ({
    origin,
    clips: new Map(
      origin.effectiveTimeline.tracks
        .flatMap((t) => t.items)
        .map((c) => [key(c.id), c]),
    ),
    items: new Map(origin.normalizedItems.map((i) => [key(i.clipId), i])),
  });
  const origins = new Map(
    (input.confirmedOrigins ?? []).map((o) => [key(o.id), originIndex(o)]),
  );
  const base = input.confirmedBase
    ? originIndex(input.confirmedBase)
    : undefined;
  if (base)
    requireValue(
      key(base.origin.cutId) === key(input.cutId),
      "INVALID_TIMING_ORIGIN",
      "时间基线不属于当前剪辑。",
    );
  const requestedOrigins = new Map(
    document.timingOrigins.map((o) => [key(o.clipId), key(o.normalizationId)]),
  );
  for (const [clipId, id] of requestedOrigins) {
    const resolved = origins.get(id);
    requireValue(
      resolved &&
        key(resolved.origin.cutId) === key(input.cutId) &&
        resolved.items.has(clipId) &&
        resolved.clips.has(clipId),
      "INVALID_TIMING_ORIGIN",
      "精确时间来源不是同剪辑的已确认片段。",
      clipId,
    );
  }
  const compatible = (o: ConfirmedTiming) =>
    o.normalizationVersion === CUT_NORMALIZATION_VERSION &&
    o.effectiveTimeline.spec.fpsNum === fpsNum &&
    o.effectiveTimeline.spec.fpsDen === fpsDen;
  const candidates = (clip: WorkClip) => {
    const explicit = requestedOrigins.get(key(clip.id));
    return [explicit ? origins.get(explicit) : undefined, base].filter(
      (o): o is NonNullable<typeof o> => !!o,
    );
  };
  function prior(
    clip: WorkClip,
    predicate: (old: WorkClip, item: Item) => boolean,
  ) {
    for (const o of candidates(clip)) {
      const old = o.clips.get(key(clip.id)),
        item = o.items.get(key(clip.id));
      if (
        compatible(o.origin) &&
        old &&
        item &&
        old.kind === clip.kind &&
        item.kind === clip.kind &&
        predicate(old, item)
      )
        return { old, item };
    }
    return undefined;
  }
  function noteVersion(clip: WorkClip) {
    const previous = candidates(clip).find((o) => o.clips.has(key(clip.id)));
    if (previous && !compatible(previous.origin))
      change(
        clip.id,
        "timebase",
        "frame_snap",
        "输出时基或归一版本已变化，需要重新计算边界。",
        {
          note: `${previous.origin.effectiveTimeline.spec.fpsNum}/${previous.origin.effectiveTimeline.spec.fpsDen}; ${previous.origin.normalizationVersion}`,
        },
        { note: `${fpsNum}/${fpsDen}; ${CUT_NORMALIZATION_VERSION}` },
      );
  }
  const sameSource = (
    clip: MediaClip,
    old: WorkClip,
    item: Item,
    fact: NormalizationMedia,
  ) =>
    old.kind !== "subtitle" &&
    key(old.mediaId) === key(clip.mediaId) &&
    old.streamSelection === clip.streamSelection &&
    item.sourceSha256 === fact.sourceSha256;
  function mediaFact(clip: MediaClip) {
    const fact = input.media.get(key(clip.mediaId));
    requireValue(
      fact && key(fact.mediaId) === key(clip.mediaId),
      "MEDIA_UNAVAILABLE",
      "片段没有已核验的固定制作副本。",
      clip.id,
    );
    requireValue(
      clip.kind === "video"
        ? fact.kind === "video" &&
            fact.video &&
            clip.streamSelection === "default"
        : fact.audio &&
            (clip.streamSelection === "embedded_audio"
              ? fact.kind === "video"
              : fact.kind === "audio"),
      "MEDIA_STREAM_INVALID",
      "片段类型或流选择与来源不一致。",
      clip.id,
    );
    requireValue(
      /^[0-9a-f]{64}$/.test(fact.sourceSha256) &&
        /^\d{1,40}$/.test(fact.duration.numerator) &&
        /^[1-9]\d{0,39}$/.test(fact.duration.denominator),
      "PRODUCTION_FACT_INVALID",
      "制作副本的精确来源事实无效。",
      clip.id,
    );
    if (fact.video)
      requireValue(
        fact.video.fpsNum === fpsNum &&
          fact.video.fpsDen === fpsDen &&
          integer(fact.video.frameCount) > 0n,
        "PRODUCTION_RATE_MISMATCH",
        "制作副本帧率与当前固定规格不一致。",
        clip.id,
      );
    if (fact.audio) integer(fact.audio.sampleCount);
    return fact;
  }
  function sourceTimes(clip: MediaClip, fact: NormalizationMedia) {
    const source = (edge: "inUs" | "outUs") => {
      const previous = prior(
        clip,
        (old, item) =>
          sameSource(clip, old, item, fact) &&
          old.kind !== "subtitle" &&
          old.range[edge] === clip.range[edge],
      );
      const precise =
        previous?.item[
          clip.kind === "video"
            ? edge === "inUs"
              ? "sourceInFrame"
              : "sourceOutFrame"
            : edge === "inUs"
              ? "sourceInSample"
              : "sourceOutSample"
        ];
      return precise !== undefined
        ? clip.kind === "video"
          ? frameTime(integer(precise))
          : sampleTime(integer(precise))
        : micros(clip.range[edge]);
    };
    const start = source("inUs"),
      end = source("outUs");
    const duration = fraction(
      BigInt(fact.duration.numerator),
      BigInt(fact.duration.denominator),
    );
    requireValue(
      compare(end, start) > 0n && compare(end, duration) <= 0n,
      "SOURCE_RANGE_INVALID",
      "源区间为空或超出原片的精确有效时长。",
      clip.id,
    );
    if (clip.takeId) {
      const take = input.takes?.get(key(clip.takeId));
      requireValue(
        take &&
          key(take.mediaId) === key(clip.mediaId) &&
          compare(start, micros(take.range.inUs)) >= 0n &&
          compare(end, micros(take.range.outUs)) <= 0n,
        "SOURCE_RANGE_INVALID",
        "裁切超出绑定候选的允许范围。",
        clip.id,
      );
    }
    return { start, end };
  }
  function placement(clip: WorkClip) {
    const previous = prior(
      clip,
      (old) => old.timelineStartUs === clip.timelineStartUs,
    );
    const exact =
      previous?.item[
        clip.kind === "audio" ? "timelineStartSample" : "timelineStartFrame"
      ];
    return exact !== undefined
      ? clip.kind === "audio"
        ? sampleTime(integer(exact))
        : frameTime(integer(exact))
      : micros(clip.timelineStartUs);
  }
  const videoClips = [...videoTracks[0]!.items].sort(
    (a, b) =>
      a.timelineStartUs - b.timelineStartUs ||
      key(a.id).localeCompare(key(b.id)),
  );
  let requestedEnd = fraction(0n, 1n),
    frameEnd = 0n,
    lastStart: number | undefined;
  for (const clip of videoClips) {
    requireValue(
      clip.kind === "video",
      "MEDIA_STREAM_INVALID",
      "主视频轨包含其他类型片段。",
      clip.id,
    );
    const fact = mediaFact(clip),
      source = sourceTimes(clip, fact);
    requireValue(
      clip.timelineStartUs !== lastStart,
      "TIMELINE_OVERLAP",
      "主视频片段起点重复。",
      clip.id,
    );
    let start = placement(clip);
    // Exact echo equality is the only adjacency recovery. No epsilon window.
    if (clip.timelineStartUs === echo(requestedEnd)) start = requestedEnd;
    const difference = compare(start, requestedEnd);
    requireValue(
      difference === 0n,
      difference > 0n ? "TIMELINE_GAP" : "TIMELINE_OVERLAP",
      difference > 0n
        ? "主视频存在明确空洞，请调整片段位置。"
        : "主视频存在重叠，请调整片段位置。",
      clip.id,
    );
    requestedEnd = add(start, sub(source.end, source.start));
    lastStart = clip.timelineStartUs;
    const sourceIn = ceil(source.start.n * p, source.start.d * q),
      sourceOut = (source.end.n * p) / (source.end.d * q);
    requireValue(
      sourceOut > sourceIn && sourceOut <= integer(fact.video!.frameCount),
      "SOURCE_RANGE_INVALID",
      "源区间不足一帧或超出固定制作副本。",
      clip.id,
    );
    const timelineStart = frameEnd,
      timelineEnd = frameEnd + sourceOut - sourceIn;
    const sourceInSample = A(sourceIn),
      sourceOutSample = A(sourceOut),
      timelineStartSample = A(timelineStart),
      timelineEndSample = A(timelineEnd);
    const tail =
      timelineEndSample -
      timelineStartSample -
      (sourceOutSample - sourceInSample);
    requireValue(
      tail >= -1n && tail <= 1n,
      "NATIVE_AUDIO_PHASE_INVALID",
      "原生音频取整相位超过一个样本。",
      clip.id,
    );
    const item: Item = {
      clipId: clip.id,
      kind: "video",
      sourceMediaId: clip.mediaId,
      sourceSha256: fact.sourceSha256,
      productionCopyId: fact.productionCopyId,
      sourceMapId: fact.video!.sourceMapId,
      sourceInFrame: number(sourceIn),
      sourceOutFrame: number(sourceOut),
      timelineStartFrame: number(timelineStart),
      timelineEndFrame: number(timelineEnd),
      sourceInSample: number(sourceInSample),
      sourceOutSample: number(sourceOutSample),
      timelineStartSample: number(timelineStartSample),
      timelineEndSample: number(timelineEndSample),
      tailAdjustmentSamples: Number(tail),
    };
    const range = {
      inUs: echo(frameTime(sourceIn)),
      outUs: echo(frameTime(sourceOut)),
    };
    resultClips.set(key(clip.id), {
      ...clip,
      range,
      timelineStartUs: echo(frameTime(timelineStart)),
    });
    normalizedItems.push(item);
    noteVersion(clip);
    if (
      compare(source.start, frameTime(sourceIn)) ||
      compare(source.end, frameTime(sourceOut))
    )
      change(
        clip.id,
        "source",
        "frame_snap",
        "源裁切向内吸附到完整视频帧。",
        { range: clip.range },
        { range, startFrame: number(sourceIn), endFrame: number(sourceOut) },
      );
    if (compare(start, frameTime(timelineStart)))
      change(
        clip.id,
        "placement",
        "timeline_shift",
        "源裁切归一后，主视频位置按片段顺序累计。",
        { timelineStartUs: clip.timelineStartUs },
        {
          timelineStartUs: echo(frameTime(timelineStart)),
          startFrame: number(timelineStart),
          endFrame: number(timelineEnd),
        },
      );
    const knownCopy = prior(
      clip,
      (old, previous) =>
        sameSource(clip, old, previous, fact) &&
        previous.productionCopyId === fact.productionCopyId,
    );
    if (fact.video!.conversion && !knownCopy)
      change(
        clip.id,
        "conversion",
        "frame_snap",
        "源画面已按固定帧率制作；帧选择保存在源映射中。",
        { note: fact.video!.conversion.before },
        { note: fact.video!.conversion.after },
      );
    const unchangedAudio = prior(
      clip,
      (old, previous) =>
        sameSource(clip, old, previous, fact) &&
        previous.productionCopyId === fact.productionCopyId &&
        [
          "sourceInSample",
          "sourceOutSample",
          "timelineStartSample",
          "timelineEndSample",
          "tailAdjustmentSamples",
        ].every((k) => previous[k as keyof Item] === item[k as keyof Item]),
    );
    if (!unchangedAudio) {
      if (tail)
        change(
          clip.id,
          "native-phase",
          "sample_snap",
          tail > 0n
            ? "原生音频段尾补一个静音样本以对齐全局采样边界。"
            : "原生音频段尾裁掉一个样本以对齐全局采样边界。",
          {
            startSample: number(sourceInSample),
            endSample: number(sourceOutSample),
          },
          {
            startSample: number(timelineStartSample),
            endSample: number(timelineEndSample),
            note: `tailAdjustmentSamples=${tail}`,
          },
        );
      const available = BigInt(fact.audio?.sampleCount ?? 0);
      if (sourceOutSample > available) {
        const missing =
          sourceOutSample -
          (available > sourceInSample ? available : sourceInSample);
        change(
          clip.id,
          "native-silence",
          "sample_snap",
          fact.audio
            ? "原生音频不足的部分明确补静音。"
            : "来源没有音轨，此视频区间明确使用静音。",
          {
            startSample: number(sourceInSample),
            endSample: number(sourceOutSample),
            note: `availableSamples=${available}`,
          },
          {
            startSample: number(timelineStartSample),
            endSample: number(timelineEndSample),
            note: `missingSourceSamples=${missing}`,
          },
        );
      }
    }
    frameEnd = timelineEnd;
  }
  for (const track of document.timeline.tracks) {
    if (track.kind === "video") continue;
    const subtitleIntervals: { id: string; start: bigint; end: bigint }[] = [];
    for (const clip of track.items) {
      noteVersion(clip);
      if (clip.kind === "audio") {
        const fact = mediaFact(clip),
          source = sourceTimes(clip, fact);
        const sourceIn = ceil(source.start.n * S, source.start.d),
          sourceOut = (source.end.n * S) / source.end.d;
        requireValue(
          sourceOut > sourceIn && sourceOut <= integer(fact.audio!.sampleCount),
          "SOURCE_RANGE_INVALID",
          "声音区间不足一个样本或超出来源。",
          clip.id,
        );
        const requestedStart = placement(clip),
          start = samples(requestedStart),
          end = start + sourceOut - sourceIn;
        requireValue(
          end <= A(frameEnd),
          "AUDIO_OUT_OF_BOUNDS",
          "声音超出主视频范围，请明确裁切或调整位置。",
          clip.id,
        );
        const range = {
          inUs: echo(sampleTime(sourceIn)),
          outUs: echo(sampleTime(sourceOut)),
        };
        resultClips.set(key(clip.id), {
          ...clip,
          range,
          timelineStartUs: echo(sampleTime(start)),
        });
        normalizedItems.push({
          clipId: clip.id,
          kind: "audio",
          sourceMediaId: clip.mediaId,
          sourceSha256: fact.sourceSha256,
          productionCopyId: fact.productionCopyId,
          sourceMapId: fact.audio!.sourceMapId,
          sourceInSample: number(sourceIn),
          sourceOutSample: number(sourceOut),
          timelineStartSample: number(start),
          timelineEndSample: number(end),
        });
        if (
          compare(source.start, sampleTime(sourceIn)) ||
          compare(source.end, sampleTime(sourceOut))
        )
          change(
            clip.id,
            "source",
            "sample_snap",
            "声音源区间向内吸附到完整的 48 kHz 样本。",
            { range: clip.range },
            {
              range,
              startSample: number(sourceIn),
              endSample: number(sourceOut),
            },
          );
        if (compare(requestedStart, sampleTime(start)))
          change(
            clip.id,
            "placement",
            "sample_snap",
            "声音显式位置吸附到最近的全局采样边界。",
            { timelineStartUs: clip.timelineStartUs },
            {
              timelineStartUs: echo(sampleTime(start)),
              startSample: number(start),
              endSample: number(end),
            },
          );
      } else if (clip.kind === "subtitle") {
        requireValue(
          clip.text.trim() && clip.durationUs > 0,
          "EMPTY_CLIP",
          "字幕内容或时长为空。",
          clip.id,
        );
        const requestedStart = placement(clip);
        const endUs = integer(clip.timelineStartUs) + integer(clip.durationUs);
        const previousEnd = prior(
          clip,
          (old) =>
            old.kind === "subtitle" &&
            integer(old.timelineStartUs) + integer(old.durationUs) === endUs,
        );
        const requestedEnd =
          previousEnd?.item.timelineEndFrame !== undefined
            ? frameTime(integer(previousEnd.item.timelineEndFrame))
            : fraction(endUs, US);
        const start = frameRound(requestedStart),
          end = frameRound(requestedEnd);
        requireValue(
          end > start && end <= frameEnd,
          "SUBTITLE_OUT_OF_BOUNDS",
          "字幕不足一帧或超出主视频范围，请调整。",
          clip.id,
        );
        const timelineStartUs = echo(frameTime(start)),
          durationUs = echo(frameTime(end)) - timelineStartUs;
        resultClips.set(key(clip.id), { ...clip, timelineStartUs, durationUs });
        normalizedItems.push({
          clipId: clip.id,
          kind: "subtitle",
          timelineStartFrame: number(start),
          timelineEndFrame: number(end),
        });
        subtitleIntervals.push({ id: clip.id, start, end });
        if (
          compare(requestedStart, frameTime(start)) ||
          compare(requestedEnd, frameTime(end))
        )
          change(
            clip.id,
            "placement",
            "frame_snap",
            "字幕显式起止吸附到最近的输出帧边界。",
            {
              timelineStartUs: clip.timelineStartUs,
              durationUs: clip.durationUs,
            },
            {
              timelineStartUs,
              durationUs,
              startFrame: number(start),
              endFrame: number(end),
            },
          );
      }
    }
    if (!track.muted) {
      subtitleIntervals.sort((a, b) =>
        a.start < b.start
          ? -1
          : a.start > b.start
            ? 1
            : key(a.id).localeCompare(key(b.id)),
      );
      for (let i = 1; i < subtitleIntervals.length; i++)
        requireValue(
          subtitleIntervals[i]!.start >= subtitleIntervals[i - 1]!.end,
          "SUBTITLE_OVERLAP",
          "同一未静音字幕轨存在重叠。",
          subtitleIntervals[i]!.id,
        );
    }
  }
  const effectiveTimeline: Schema<"Timeline"> = {
    ...structuredClone(document.timeline),
    tracks: document.timeline.tracks.map((track) => ({
      ...track,
      items: track.items.map((c) => resultClips.get(key(c.id))!),
    })),
  };
  validateNormalizedBindings(
    document,
    effectiveTimeline,
    normalizedItems,
    input.media,
    frameTime,
  );
  return {
    effectiveTimeline,
    normalizedItems,
    dramaBindings: structuredClone(document.dramaBindings),
    changes,
    lengthFrames: number(frameEnd),
    durationUs: echo(frameTime(frameEnd)),
    normalizationVersion: CUT_NORMALIZATION_VERSION,
  };
}

function validateNormalizedBindings(
  document: WorkDocument,
  timeline: Schema<"Timeline">,
  items: Item[],
  media: ReadonlyMap<string, NormalizationMedia>,
  frameTime: (frame: bigint) => Fraction,
) {
  const clips = new Map(
    timeline.tracks.flatMap((t) => t.items).map((c) => [key(c.id), c]),
  );
  const exact = new Map(items.map((i) => [key(i.clipId), i]));
  const muted = new Set(
    timeline.tracks
      .filter((t) => t.muted)
      .flatMap((t) => t.items.map((c) => key(c.id))),
  );
  const audible = new Map<
    string,
    { clipId: string; start: Fraction; end: Fraction }[]
  >();
  for (const binding of document.dramaBindings) {
    const clip = clips.get(key(binding.clipId)),
      item = exact.get(key(binding.clipId));
    requireValue(
      clip &&
        item &&
        (binding.usage === "subtitle"
          ? clip.kind === "subtitle"
          : binding.usage === "dialogue"
            ? clip.kind === "audio"
            : clip.kind === "video"
              ? media.get(key(clip.mediaId))?.audio
              : clip.kind === "audio" &&
                clip.streamSelection === "embedded_audio"),
      "BINDING_UNRESOLVED",
      "对白关联与实际片段或声音来源不一致。",
      binding.clipId,
    );
    if (clip.kind === "subtitle") {
      requireValue(
        !binding.sourceRange,
        "BINDING_UNRESOLVED",
        "字幕关联不能指定声音源区间。",
        binding.clipId,
      );
      continue;
    }
    const sourceStart =
      clip.kind === "video"
        ? frameTime(integer(item.sourceInFrame!))
        : sampleTime(integer(item.sourceInSample!));
    const sourceEnd =
      clip.kind === "video"
        ? frameTime(integer(item.sourceOutFrame!))
        : sampleTime(integer(item.sourceOutSample!));
    let start = sourceStart,
      end = sourceEnd;
    if (binding.sourceRange) {
      start =
        binding.sourceRange.inUs === echo(sourceStart)
          ? sourceStart
          : micros(binding.sourceRange.inUs);
      end =
        binding.sourceRange.outUs === echo(sourceEnd)
          ? sourceEnd
          : micros(binding.sourceRange.outUs);
      requireValue(
        compare(end, start) > 0n &&
          compare(start, sourceStart) >= 0n &&
          compare(end, sourceEnd) <= 0n,
        "BINDING_UNRESOLVED",
        "归一后的裁切不能包含完整的对白关联区间，请明确调整关联。",
        binding.clipId,
      );
    }
    if (clip.muted || muted.has(key(clip.id))) continue;
    const placement = integer(item.timelineStartSample!);
    const sourceSample = integer(item.sourceInSample!);
    // Dialogue overlap is a sound fact: use the same sample-grid interval as
    // mixing, including the explicit native segment's final +/-1 sample.
    const audibleStart = placement + samples(start) - sourceSample;
    const audibleEnd =
      compare(end, sourceEnd) === 0n
        ? integer(item.timelineEndSample!)
        : placement + samples(end) - sourceSample;
    const group = `${key(binding.shotRevisionId)}:${key(binding.dialogueId)}`;
    const intervals = audible.get(group) ?? [];
    intervals.push({
      clipId: clip.id,
      start: sampleTime(audibleStart),
      end: sampleTime(audibleEnd),
    });
    audible.set(group, intervals);
  }
  for (const intervals of audible.values()) {
    intervals.sort((a, b) =>
      compare(a.start, b.start) < 0n
        ? -1
        : compare(a.start, b.start) > 0n
          ? 1
          : key(a.clipId).localeCompare(key(b.clipId)),
    );
    let furthest: typeof intervals = [];
    for (const interval of intervals) {
      const other = furthest.find(
        (i) => key(i.clipId) !== key(interval.clipId),
      );
      requireValue(
        !other || compare(interval.start, other.end) >= 0n,
        "DUPLICATE_DIALOGUE_SOURCES",
        "同一句台词存在重叠的未静音声源。",
        interval.clipId,
      );
      const existing = furthest.find(
        (i) => key(i.clipId) === key(interval.clipId),
      );
      if (!existing || compare(interval.end, existing.end) > 0n)
        furthest = [
          ...furthest.filter((i) => key(i.clipId) !== key(interval.clipId)),
          interval,
        ]
          .sort((a, b) => (compare(a.end, b.end) > 0n ? -1 : 1))
          .slice(0, 2);
    }
  }
}

/** Export uses the same global frame boundaries as burn-in; no microsecond resnap. */
export function normalizedSubtitlesSrt(
  content: Pick<NormalizedCutContent, "effectiveTimeline" | "normalizedItems">,
): string {
  const { fpsNum, fpsDen } = content.effectiveTimeline.spec;
  const p = integer(fpsNum),
    q = integer(fpsDen);
  requireValue(
    p > 0n && q > 0n,
    "NORMALIZATION_RATE_UNSUPPORTED",
    "字幕导出需要有效帧率。",
  );
  const items = new Map(content.normalizedItems.map((i) => [key(i.clipId), i]));
  const boundaryCache = new Map<number, string>();
  function boundary(frame: number) {
    let value = boundaryCache.get(frame);
    if (value !== undefined) return value;
    const milliseconds = round(integer(frame) * q * 1000n, p);
    value = `${String(milliseconds / 3_600_000n).padStart(2, "0")}:${String((milliseconds / 60_000n) % 60n).padStart(2, "0")}:${String((milliseconds / 1000n) % 60n).padStart(2, "0")},${String(milliseconds % 1000n).padStart(3, "0")}`;
    boundaryCache.set(frame, value);
    return value;
  }
  const cues = content.effectiveTimeline.tracks
    .filter((t) => t.kind === "subtitle" && !t.muted)
    .flatMap((t) => t.items)
    .map((clip) => {
      const item = items.get(key(clip.id));
      requireValue(
        clip.kind === "subtitle" &&
          item?.kind === "subtitle" &&
          item.timelineStartFrame !== undefined &&
          item.timelineEndFrame !== undefined &&
          item.timelineEndFrame > item.timelineStartFrame,
        "NORMALIZATION_ITEM_INVALID",
        "字幕缺少固定帧边界。",
        clip.id,
      );
      return {
        clip,
        start: item.timelineStartFrame,
        end: item.timelineEndFrame,
      };
    })
    .sort(
      (a, b) =>
        a.start - b.start || key(a.clip.id).localeCompare(key(b.clip.id)),
    );
  return cues
    .map(
      ({ clip, start, end }, i) =>
        `${i + 1}\n${boundary(start)} --> ${boundary(end)}\n${clip.kind === "subtitle" ? clip.text.replace(/\r\n?/g, "\n") : ""}\n`,
    )
    .join("\n");
}
