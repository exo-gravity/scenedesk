import {
  editingCanonical,
  inspectWorkDocument,
  type WorkDocument,
  type WorkClip,
} from "@drama/domain";

type Track = WorkDocument["timeline"]["tracks"][number];
type Entry = { label: string; value: unknown };
const same = (a: Entry | undefined, b: Entry | undefined) =>
  a === undefined || b === undefined
    ? a === b
    : editingCanonical(a.value) === editingCanonical(b.value);

function entries(document: WorkDocument) {
  const result = new Map<string, Entry>();
  const put = (key: string, label: string, value: unknown) =>
    result.set(key, { label, value });
  const { tracks, ...settings } = document.timeline;
  put("settings", "输出规格与字幕烧录", settings);
  put(
    "tracks",
    "轨道顺序",
    tracks.map((t) => t.id),
  );
  for (const track of tracks) {
    const { items, ...metadata } = track;
    put(
      `track:${track.id}`,
      `${track.kind === "video" ? "画面" : track.kind === "audio" ? "声音" : "字幕"}轨道 · ${track.id.slice(0, 8)}`,
      metadata,
    );
    put(
      `order:${track.id}`,
      `片段顺序 · ${track.id.slice(0, 8)}`,
      items.map((c) => c.id),
    );
    for (const clip of items)
      put(`clip:${clip.id}`, `片段 · ${clip.id.slice(0, 8)}`, {
        trackId: track.id,
        clip,
      });
  }
  for (const name of [
    "dramaBindings",
    "unresolvedEdits",
    "timingOrigins",
  ] as const) {
    put(
      `order:${name}`,
      `${name === "dramaBindings" ? "对白关联" : name === "unresolvedEdits" ? "待处理事项" : "时间来源"}顺序`,
      document[name].map((value) => ("id" in value ? value.id : value.clipId)),
    );
    for (const value of document[name]) {
      const id = "id" in value ? value.id : value.clipId;
      put(
        `${name}:${id}`,
        `${name === "dramaBindings" ? "对白关联" : name === "unresolvedEdits" ? "待处理事项" : "时间来源"} · ${id.slice(0, 8)}`,
        value,
      );
    }
  }
  return result;
}
export function workChanges(
  base: WorkDocument,
  local: WorkDocument,
  remote: WorkDocument,
) {
  const a = entries(base),
    b = entries(local),
    c = entries(remote);
  return [...new Set([...a.keys(), ...b.keys()])].flatMap((key) =>
    same(a.get(key), b.get(key))
      ? []
      : [
          {
            key,
            label: (b.get(key) ?? a.get(key))!.label,
            base: a.get(key)?.value,
            local: b.get(key)?.value,
            remote: c.get(key)?.value,
            sharedChange: !same(a.get(key), c.get(key)),
          },
        ],
  );
}
function ordered<T>(order: string[], values: Map<string, T>): T[] {
  // New peer entries absent from an explicitly replayed old order survive.
  return [...new Set([...order, ...values.keys()])].flatMap((id) =>
    values.has(id) ? [values.get(id)!] : [],
  );
}
/** User-selected local operations replay over the compared remote snapshot.
 * No semantic auto merge and no whole-document force overwrite. */
export function replayWorkChanges(
  base: WorkDocument,
  local: WorkDocument,
  remote: WorkDocument,
  selected: ReadonlySet<string>,
): WorkDocument {
  const result = entries(remote),
    mine = entries(local);
  const changes = workChanges(base, local, remote);
  for (const key of selected) {
    if (!changes.some((change) => change.key === key))
      throw new Error("所选变化已不属于当前比较，请重新核对。");
    const entry = mine.get(key);
    if (entry) result.set(key, entry);
    else result.delete(key);
  }
  const tracks = new Map<string, Track>(),
    clips = new Map<string, { trackId: string; clip: WorkClip }>();
  for (const [key, entry] of result) {
    if (key.startsWith("track:"))
      tracks.set(key.slice(6), { ...(entry.value as Track), items: [] });
    if (key.startsWith("clip:"))
      clips.set(
        key.slice(5),
        entry.value as { trackId: string; clip: WorkClip },
      );
  }
  for (const { trackId, clip } of clips.values()) {
    const track = tracks.get(trackId);
    if (!track || track.kind !== clip.kind)
      throw new Error("有片段缺少对应轨道，请一起核对轨道和片段的增删。");
  }
  for (const track of tracks.values()) {
    const items = ordered(
      (result.get(`order:${track.id}`)?.value ?? []) as string[],
      new Map(
        [...clips]
          .filter(([, value]) => value.trackId === track.id)
          .map(([id, value]) => [id, value.clip]),
      ),
    );
    tracks.set(track.id, { ...track, items } as Track);
  }
  const collection = <
    K extends "dramaBindings" | "unresolvedEdits" | "timingOrigins",
  >(
    name: K,
  ) =>
    ordered(
      (result.get(`order:${name}`)?.value ?? []) as string[],
      new Map(
        [...result]
          .filter(([key]) => key.startsWith(`${name}:`))
          .map(([key, entry]) => [key.slice(name.length + 1), entry.value]),
      ),
    ) as WorkDocument[K];
  const document: WorkDocument = {
    timeline: {
      ...(result.get("settings")!.value as Omit<
        WorkDocument["timeline"],
        "tracks"
      >),
      tracks: ordered(result.get("tracks")!.value as string[], tracks),
    },
    dramaBindings: collection("dramaBindings"),
    unresolvedEdits: collection("unresolvedEdits"),
    timingOrigins: collection("timingOrigins"),
  };
  inspectWorkDocument(document);
  return structuredClone(document);
}
