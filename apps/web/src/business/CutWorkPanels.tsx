import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import {
  editingCanonical,
  inspectWorkDocument,
  type WorkDocument,
  type WorkClip,
} from "@drama/domain";
import { useList, useResource, type Schema } from "./api";
import { Empty, ErrorNotice } from "./common";
import { MediaPreview } from "./MediaPreview";
import { sourceSeconds } from "./candidate-time";
import {
  type CutWorkController,
  type WorkEditorState,
} from "./cut-work-controller";
import { replayWorkChanges, workChanges } from "./cut-work-reconcile";

export function CutRecovery({
  controller,
  state,
}: {
  controller: CutWorkController;
  state: WorkEditorState;
}) {
  const [discard, setDiscard] = useState(false);
  return (
    <>
      {state.storageError && (
        <Alert title="本机恢复尚未完成">
          <ErrorNotice error={state.storageError} />
          <Text size="sm">
            保留当前页面；本机清理完成前，不会把服务器成功回执当作可以再次提交的新操作。
          </Text>
          <Button mt="sm" onClick={() => void controller.retryLocal()}>
            重试本机保留／清理
          </Button>
        </Alert>
      )}
      {state.recovery && (
        <Alert title="发现本机未完成工作">
          <Text>
            来自工作稿 r{state.recovery.value.base.revision} ·{" "}
            {new Date(state.recovery.savedAt).toLocaleString()}
            。当前身份及对象访问已核对。
          </Text>
          <Group mt="sm">
            <Button variant="filled" onClick={() => controller.restore()}>
              恢复并核对本机工作
            </Button>
            <Button onClick={() => setDiscard(true)}>放弃这份本机副本</Button>
          </Group>
          {discard && (
            <Stack mt="sm" gap="xs">
              <Text>将删除当前标签页的恢复副本，以当前服务器工作稿继续。</Text>
              <Group>
                <Button
                  loading={state.phase === "discarding"}
                  onClick={() => {
                    void controller
                      .discardLocal()
                      .then(() => setDiscard(false));
                  }}
                >
                  确认放弃本机副本
                </Button>
                <Button variant="subtle" onClick={() => setDiscard(false)}>
                  继续保留
                </Button>
              </Group>
            </Stack>
          )}
        </Alert>
      )}
    </>
  );
}
export function CutSources({
  controller,
  state,
  path,
  mediaPath,
  projectId,
  sceneId,
  href,
  disabled,
}: {
  controller: CutWorkController;
  state: WorkEditorState;
  path: string;
  mediaPath: string;
  projectId: string;
  sceneId: string;
  href: string;
  disabled: boolean;
}) {
  const [kind, setKind] = useState("candidate"),
    [scope, setScope] = useState("project"),
    [shotId, setShotId] = useState<string | null>(null),
    [choice, setChoice] = useState<string | null>(null),
    [search, setSearch] = useState("");
  const [q] = useDebouncedValue(search, 250),
    [error, setError] = useState<Error | null>(null);
  const content = useResource<Schema<"ContentTree">>(`${path}/content`),
    shots = content.data?.shots.filter((s) => s.sceneId === sceneId) ?? [];
  const takes = useList<Schema<"Take">>(
    `${path}/takes?shotId=${shotId ?? ""}`,
    kind === "candidate" && !!shotId,
  );
  const filters = new URLSearchParams({
    scope,
    ...(scope === "project" ? { projectId } : {}),
    kind: kind === "audio" ? "audio" : "video",
    status: "ready",
    ...(q ? { q } : {}),
  });
  const media = useList<Schema<"Media">>(
    `${mediaPath}/media?${filters}`,
    kind !== "candidate",
  );
  const take =
    kind === "candidate" ? takes.data?.find((t) => t.id === choice) : undefined;
  const selected = useResource<Schema<"Media">>(
    `${mediaPath}/media/${kind === "candidate" ? (take?.mediaId ?? "") : (choice ?? "")}`,
    kind === "candidate" ? !!take : !!choice,
  );
  const append = (clip: WorkClip) => {
    if (disabled || !state.local) return;
    try {
      const document = structuredClone(state.local.document);
      let track = document.timeline.tracks.find((t) => t.kind === clip.kind);
      if (!track) {
        const created: WorkDocument["timeline"]["tracks"][number] = {
          id: crypto.randomUUID(),
          kind: clip.kind,
          muted: false,
          items: [],
        };
        document.timeline.tracks.push(created);
        track = created;
      }
      (track.items as WorkClip[]).push(clip);
      inspectWorkDocument(document);
      controller.edit(document);
      location.hash = `${href}&clip=${clip.id}`;
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error : new Error("未能加入片段。"));
    }
  };
  return (
    <Stack gap="md">
      <Text fw={600}>加入画面与声音</Text>
      <ErrorNotice
        error={error ?? content.error ?? takes.error ?? media.error}
      />
      <Select
        label="来源类型"
        value={kind}
        data={[
          { value: "candidate", label: "本场镜头候选" },
          { value: "video", label: "视频素材" },
          { value: "audio", label: "音频素材" },
          { value: "embedded", label: "视频的内嵌声音" },
        ]}
        onChange={(value) => {
          if (value) {
            setKind(value);
            setChoice(null);
          }
        }}
      />
      {kind === "candidate" ? (
        <>
          <Select
            label="本场镜头"
            placeholder="先选择镜头"
            value={shotId}
            data={shots.map((s) => ({
              value: s.id,
              label: `${s.label} · ${s.spec.intent}`,
            }))}
            onChange={(value) => {
              setShotId(value);
              setChoice(null);
            }}
          />
          <Select
            label="候选"
            searchable
            value={choice}
            data={(takes.data ?? []).map((t) => ({
              value: t.id,
              label: `${t.id.slice(0, 8)} · ${sourceSeconds(t.range.outUs - t.range.inUs)} 秒${t.note ? ` · ${t.note}` : ""}`,
            }))}
            onChange={setChoice}
            placeholder={takes.isFetching ? "正在读取候选" : "明确选择候选"}
          />
          <Text size="sm" c="dimmed">
            加入工作稿记录实际用片来源；不会改变镜头当前采用。
          </Text>
        </>
      ) : (
        <>
          <Select
            label="素材范围"
            value={scope}
            data={[
              { value: "project", label: "本项目" },
              { value: "shared", label: "工作室共享" },
            ]}
            onChange={(value) => {
              if (value) {
                setScope(value);
                setChoice(null);
              }
            }}
          />
          <TextInput
            label="查找素材"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <Select
            label="已验收素材"
            value={choice}
            data={(media.data ?? [])
              .filter((m) => kind !== "embedded" || m.hasAudio)
              .map((m) => ({ value: m.id, label: m.displayName }))}
            onChange={setChoice}
            placeholder={media.isFetching ? "正在读取素材" : "选择素材"}
          />
        </>
      )}
      <ErrorNotice error={selected.error} />
      {selected.data && (
        <>
          <MediaPreview
            key={selected.data.id}
            media={selected.data}
            path={mediaPath}
            range={take?.range}
          />
          <Text size="sm">
            {selected.data.displayName} ·{" "}
            {sourceSeconds(selected.data.durationUs ?? 0)} 秒
          </Text>
        </>
      )}
      <Button
        variant="filled"
        disabled={
          disabled ||
          !selected.data ||
          selected.isError ||
          selected.data.status !== "ready" ||
          !selected.data.durationUs ||
          (kind === "embedded" && !selected.data.hasAudio)
        }
        onClick={() => {
          const source = selected.data;
          if (!source?.durationUs || !state.local) return;
          const video = kind === "video" || kind === "candidate";
          let end = 0n;
          if (video)
            for (const t of state.local.document.timeline.tracks)
              if (t.kind === "video")
                for (const c of t.items) {
                  const value =
                    BigInt(c.timelineStartUs) +
                    BigInt(c.range.outUs) -
                    BigInt(c.range.inUs);
                  if (value > end) end = value;
                }
          if (end > BigInt(Number.MAX_SAFE_INTEGER)) {
            setError(
              new Error("主视频末尾超出可编辑时间范围，请先调整已有片段。"),
            );
            return;
          }
          append({
            id: crypto.randomUUID(),
            kind: video ? "video" : "audio",
            mediaId: source.id,
            ...(take ? { takeId: take.id } : {}),
            timelineStartUs: Number(end),
            range: take?.range ?? { inUs: 0, outUs: source.durationUs },
            gainDb: 0,
            muted: false,
            streamSelection: kind === "embedded" ? "embedded_audio" : "default",
            ...(video ? { fit: "contain" as const } : {}),
          });
        }}
      >
        明确加入工作稿
      </Button>
      <Button
        disabled={disabled}
        onClick={() =>
          append({
            id: crypto.randomUUID(),
            kind: "subtitle",
            timelineStartUs: 0,
            durationUs: 0,
            text: "",
          })
        }
      >
        添加空白字幕条目
      </Button>
    </Stack>
  );
}
export function CutHistory({
  controller,
  state,
  path,
  disabled,
}: {
  controller: CutWorkController;
  state: WorkEditorState;
  path: string;
  disabled: boolean;
}) {
  const history = useList<Schema<"EditingHistoryEntry">>(
      `${path}/work-draft/revisions`,
    ),
    [revision, setRevision] = useState<string | null>(null),
    [confirm, setConfirm] = useState(false);
  const fixed = useResource<Schema<"CutWorkDraft">>(
    `${path}/work-draft/revisions/${revision ?? ""}`,
    !!revision,
  );
  return (
    <Stack gap="md">
      <Text fw={600}>取回工作历史</Text>
      <Text size="sm">
        取回后作为新的工作修改保存；不会回退已确认编排或固定审阅稿。
      </Text>
      <ErrorNotice
        error={history.error ?? fixed.error}
        retry={() => {
          void history.refetch();
          if (revision) void fixed.refetch();
        }}
      />
      <Button onClick={() => void history.refetch()}>刷新保留历史</Button>
      <Select
        label="保留版本"
        value={revision}
        data={(history.data ?? []).map((h) => ({
          value: String(h.revision),
          label: `r${h.revision} · ${new Date(h.updatedAt).toLocaleString()}`,
        }))}
        onChange={(value) => {
          setRevision(value);
          setConfirm(false);
        }}
      />
      {fixed.data && !fixed.error && (
        <>
          <Text>
            r{fixed.data.revision} ·{" "}
            {fixed.data.document.timeline.tracks.length} 条轨道 ·{" "}
            {fixed.data.document.timeline.tracks.reduce(
              (count, track) => count + track.items.length,
              0,
            )}{" "}
            个片段
          </Text>
          {fixed.data.document.timeline.tracks
            .flatMap<WorkClip>((t) => t.items)
            .map((c) => (
              <Text key={c.id} size="sm">
                {c.kind === "subtitle"
                  ? c.text || "空白字幕"
                  : `${c.kind === "video" ? "画面" : "声音"} ${c.mediaId.slice(0, 8)}`}{" "}
                · {sourceSeconds(c.timelineStartUs)} 秒
              </Text>
            ))}
          <Checkbox
            label="以此历史替换当前本机工作内容，再作为新修改保存"
            checked={confirm}
            onChange={(e) => setConfirm(e.currentTarget.checked)}
          />
          <Button
            disabled={
              disabled ||
              !confirm ||
              !!state.local?.pending ||
              state.phase === "conflict"
            }
            onClick={() => {
              if (fixed.data) controller.edit(fixed.data.document, {});
              setConfirm(false);
            }}
          >
            取回 r{fixed.data.revision} 的内容
          </Button>
        </>
      )}
      {!history.isFetching && !history.data?.length && (
        <Empty>尚无已保存的工作历史。</Empty>
      )}
    </Stack>
  );
}
function describe(value: unknown): string {
  if (value === undefined) return "不存在／已删除";
  if (Array.isArray(value))
    return `${value.length} 项顺序 · ${value.map((v) => String(v).slice(0, 8)).join(" → ")}`;
  const item = value as Record<string, unknown>;
  if (item.clip) {
    const c = item.clip as WorkClip;
    return `${c.kind === "subtitle" ? `字幕：${c.text || "（空白）"}，时长 ${sourceSeconds(c.durationUs)} 秒` : `${c.kind === "video" ? "视频" : "声音"} ${c.mediaId.slice(0, 8)}，源区间 ${sourceSeconds(c.range.inUs)}–${sourceSeconds(c.range.outUs)} 秒，${c.muted ? "静音" : `${c.gainDb} dB`}${c.kind === "video" ? `，${c.fit === "cover" ? "填满裁切" : "完整画幅"}` : ""}`}；放置 ${sourceSeconds(c.timelineStartUs)} 秒`;
  }
  if (item.spec) {
    const s = item.spec as Schema<"Spec">;
    return `${s.width}×${s.height} · ${s.fpsNum}/${s.fpsDen} fps · ${s.language} · ${item.burnSubtitles ? "烧录字幕" : "不烧录字幕"}`;
  }
  if ("muted" in item)
    return `${item.kind} · ${item.muted ? "静音／隐藏" : "启用"}`;
  if (item.note) return String(item.note);
  if (item.dialogueId)
    return `对白 ${String(item.dialogueId).slice(0, 8)} → 片段 ${String(item.clipId).slice(0, 8)} · ${item.usage}`;
  return `来源 ${String(item.normalizationId ?? "").slice(0, 8)}`;
}
export function CutConflict({
  controller,
  state,
}: {
  controller: CutWorkController;
  state: WorkEditorState;
}) {
  const [comparison, setComparison] = useState(() => ({
      local: structuredClone(state.local!),
      remote: structuredClone(state.remote!),
    })),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState<Error | null>(null);
  const changes = workChanges(
    comparison.local.base.document,
    comparison.local.document,
    comparison.remote.document,
  );
  const changed =
    state.remote?.revision !== comparison.remote.revision ||
    editingCanonical(state.local?.document) !==
      editingCanonical(comparison.local.document);
  return (
    <Alert
      title={`比较工作稿 · 本机基线 r${comparison.local.base.revision} / 服务器 r${comparison.remote.revision}`}
    >
      <Stack gap="md">
        <Text size="sm">
          只重放明确勾选的本机变化，未选择的内容采用这次查看的服务器版本。共同修改和删除需要逐项核对。仍可在片段设置中整理本机文字，再重新比较。
        </Text>
        {changed && (
          <Text>
            比较期间内容又有变化。重新比较后再保存，当前本机编辑仍保留。
          </Text>
        )}
        <Button
          onClick={() => {
            setComparison({
              local: structuredClone(state.local!),
              remote: structuredClone(state.remote!),
            });
            setSelected([]);
            setError(null);
          }}
        >
          重新比较当前内容
        </Button>
        {changes.map((change) => (
          <Stack key={change.key} gap="xs">
            <Checkbox
              label={`${change.label}${change.sharedChange ? " · 同伴也有修改" : ""}：重放我的变化`}
              checked={selected.includes(change.key)}
              onChange={(e) =>
                setSelected(
                  e.currentTarget.checked
                    ? [...selected, change.key]
                    : selected.filter((key) => key !== change.key),
                )
              }
            />
            <Text size="sm">共同基线：{describe(change.base)}</Text>
            <Text size="sm">本机：{describe(change.local)}</Text>
            <Text size="sm">服务器：{describe(change.remote)}</Text>
          </Stack>
        ))}
        <ErrorNotice error={error} />
        <Button
          variant="filled"
          disabled={changed || state.hasInvalidInput || !!state.local?.pending}
          onClick={() => {
            try {
              const merged = replayWorkChanges(
                comparison.local.base.document,
                comparison.local.document,
                comparison.remote.document,
                new Set(selected),
              );
              // Numeric raw buffers belong to replayed local clips only. Dropping a
              // local operation must not later replay its input over peer content.
              const buffers = Object.fromEntries(
                Object.entries(comparison.local.buffers).filter(([key]) =>
                  selected.includes(`clip:${key.split(":")[0]}`),
                ),
              );
              void controller.merge(
                merged,
                buffers,
                comparison.remote.revision,
                comparison.remote.baseCutRevision,
              );
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason
                  : new Error("尚不能完成合并。"),
              );
            }
          }}
        >
          按以上选择继续工作稿
        </Button>
      </Stack>
    </Alert>
  );
}
