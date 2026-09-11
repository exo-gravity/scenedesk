import { useMemo, useState } from "react";
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
import { useList, usePages, useResource, type Schema } from "./api";
import { Empty, ErrorNotice } from "./common";
import { MediaPreview } from "./MediaPreview";
import { sourceSeconds } from "./candidate-time";
import {
  type CutWorkController,
  type WorkEditorState,
} from "./cut-work-controller";
import { replayWorkChanges, workChanges } from "./cut-work-reconcile";
import type { EditingLocalInspection } from "./editing-local";

export function CutRecovery({
  controller,
  state,
}: {
  controller: CutWorkController;
  state: WorkEditorState;
}) {
  const [discard, setDiscard] = useState<string | null>(null),
    [damaged, setDamaged] = useState<EditingLocalInspection | null>(null);
  const currentContext = discard ? controller.localDiscardContext() : null;
  const canDiscard =
    !state.local?.pending &&
    !state.recoveryBlocked &&
    state.phase !== "loading" &&
    state.phase !== "discarding";
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
          {state.recoveryBlocked && state.recoveryInspection && (
            <Stack mt="sm" gap="xs">
              <Text size="sm">
                这份副本暂时无法恢复。可以先重试，或核对服务器工作稿后明确清理本标签页的异常副本。
              </Text>
              <Button onClick={() => setDamaged(state.recoveryInspection)}>
                核对并清理异常副本
              </Button>
              {damaged && (
                <>
                  <Text size="sm">
                    将删除当前剪辑在本标签页的这份本机恢复记录，未同步输入可能无法找回。服务器工作稿与历史仍保留。
                  </Text>
                  <Button
                    loading={state.phase === "discarding"}
                    disabled={damaged.stamp !== state.recoveryInspection.stamp}
                    onClick={() =>
                      void controller
                        .discardDamagedLocal(damaged)
                        .then((done) => {
                          if (done) setDamaged(null);
                        })
                    }
                  >
                    确认清理这份异常副本
                  </Button>
                  <Button variant="subtle" onClick={() => setDamaged(null)}>
                    继续保留异常副本
                  </Button>
                </>
              )}
            </Stack>
          )}
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
            <Button
              disabled={!canDiscard}
              onClick={() => setDiscard(controller.localDiscardContext())}
            >
              放弃这份本机副本
            </Button>
          </Group>
        </Alert>
      )}
      {!state.recovery &&
        !state.recoveryBlocked &&
        (state.hasInvalidInput ||
          state.phase === "conflict" ||
          (state.dirty &&
            (state.phase === "error" || !!state.storageError))) && (
          <Alert title="本机还有未同步修改">
            <Text size="sm">
              输入继续保留在当前编辑会话。只有明确放弃后，才会以已读取的服务器工作稿继续。
            </Text>
            <Button
              mt="sm"
              disabled={!canDiscard}
              onClick={() => setDiscard(controller.localDiscardContext())}
            >
              核对并放弃本机修改
            </Button>
          </Alert>
        )}
      {discard && (
        <Alert title="核对要放弃的本机内容">
          <Text size="sm">
            将清理当前标签页的这份恢复副本，放弃当前未同步内容，以已读取的服务器工作稿继续。
          </Text>
          {discard !== currentContext && (
            <Text size="sm">
              确认期间内容或版本已变化，请保留输入并重新核对。
            </Text>
          )}
          <Group mt="sm">
            <Button
              loading={state.phase === "discarding"}
              disabled={!canDiscard || discard !== currentContext}
              onClick={() =>
                void controller.discardLocal(discard).then((done) => {
                  if (done) setDiscard(null);
                })
              }
            >
              确认放弃本机副本
            </Button>
            <Button variant="subtle" onClick={() => setDiscard(null)}>
              继续保留
            </Button>
          </Group>
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
function historyRestoreContext(state: WorkEditorState) {
  const local = state.local;
  return editingCanonical({
    local: local
      ? {
          baseRevision: local.base.revision,
          baseCutRevision: local.baseCutRevision,
          document: local.document,
          buffers: local.buffers,
          pending: local.pending?.id ?? null,
        }
      : null,
    remoteRevision: state.remote?.revision ?? null,
    currentCutRevision: state.remote?.currentCutRevision ?? null,
  });
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
  const history = usePages<Schema<"EditingHistoryEntry">>(
      `${path}/work-draft/revisions`,
    ),
    [revision, setRevision] = useState<string | null>(null),
    [confirm, setConfirm] = useState<{
      context: string;
      fixed: Schema<"CutWorkDraft">;
    } | null>(null);
  const fixed = useResource<Schema<"CutWorkDraft">>(
    `${path}/work-draft/revisions/${revision ?? ""}`,
    !!revision,
  );
  const restoreContext = useMemo(
    () => historyRestoreContext(state),
    [state.local, state.remote?.revision, state.remote?.currentCutRevision],
  );
  const confirmed =
    !!confirm &&
    confirm.context === restoreContext &&
    confirm.fixed === fixed.data;
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
        data={(history.data?.pages.flatMap((p) => p.items) ?? []).map((h) => ({
          value: String(h.revision),
          label: `r${h.revision} · ${new Date(h.updatedAt).toLocaleString()}`,
        }))}
        onChange={(value) => {
          setRevision(value);
          setConfirm(null);
        }}
      />
      {history.hasNextPage && (
        <Button
          loading={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          加载更早的保留历史
        </Button>
      )}
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
          <Text size="sm">
            本机尚未应用的输入：{Object.keys(state.local?.buffers ?? {}).length}{" "}
            项。取回将替换当前全部工作内容，包括对白关联、声音版本、输出设置及待处理事项。
          </Text>
          {confirm && !confirmed && (
            <Alert title="取回确认已失效">
              本机内容、服务器版本或所选历史发生变化。请重新核对后勾选确认，当前输入仍保留。
            </Alert>
          )}
          <Checkbox
            label="以此历史替换当前本机工作内容，再作为新修改保存"
            checked={confirmed}
            disabled={
              disabled || !!state.local?.pending || state.phase === "conflict"
            }
            onChange={(e) =>
              setConfirm(
                e.currentTarget.checked && fixed.data
                  ? {
                      context: restoreContext,
                      fixed: fixed.data,
                    }
                  : null,
              )
            }
          />
          <Button
            disabled={
              disabled ||
              !confirmed ||
              !!state.local?.pending ||
              state.phase === "conflict"
            }
            onClick={() => {
              const current = controller.getSnapshot();
              if (
                !disabled &&
                confirm &&
                fixed.data === confirm.fixed &&
                historyRestoreContext(current) === confirm.context &&
                !current.local?.pending &&
                current.phase !== "conflict"
              )
                controller.edit(confirm.fixed.document, {});
              setConfirm(null);
            }}
          >
            取回 r{fixed.data.revision} 的内容
          </Button>
        </>
      )}
      {!history.isFetching &&
        !history.data?.pages.some((p) => p.items.length) && (
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
    return `${c.kind === "subtitle" ? `字幕：${c.text || "（空白）"}，时长 ${sourceSeconds(c.durationUs)} 秒` : `${c.kind === "video" ? "视频" : "声音"} ${c.mediaId}，源区间 ${sourceSeconds(c.range.inUs)}–${sourceSeconds(c.range.outUs)} 秒，${c.muted ? "静音" : "启用"}，${c.gainDb} dB，${c.streamSelection === "embedded_audio" ? "内嵌音频流" : "默认流"}${c.kind === "video" ? `，${c.fit === "cover" ? "填满裁切" : "完整画幅"}` : ""}，候选 ${c.takeId ?? "无"}，采用记录 ${c.selectionId ?? "无"}`}；轨道 ${item.trackId}；放置 ${sourceSeconds(c.timelineStartUs)} 秒`;
  }
  if (item.spec) {
    const s = item.spec as Schema<"Spec">;
    return `${s.width}×${s.height} · ${s.fpsNum}/${s.fpsDen} fps · ${s.language} · ${item.burnSubtitles ? "烧录字幕" : "不烧录字幕"} · 质量参考：${(s.qualityReferenceMediaIds ?? []).join("、") || "无"} · 交付备注：${s.deliveryNotes || "无"}`;
  }
  if ("muted" in item)
    return `${item.kind} · ${item.muted ? "静音／隐藏" : "启用"}`;
  if (item.dialogueId)
    return `固定镜头要求 ${item.shotRevisionId} · 台词 ${item.dialogueId} → 片段 ${item.clipId} · ${item.usage} · 声音固定版 ${item.voiceAssetRevisionId ?? "无"} · 源区间 ${item.sourceRange ? `${sourceSeconds((item.sourceRange as Schema<"Range">).inUs)}–${sourceSeconds((item.sourceRange as Schema<"Range">).outUs)} 秒` : "随整个片段"} · 备注 ${item.note || "无"}`;
  if (item.clipIds)
    return `${item.kind} · 相关片段 ${(item.clipIds as string[]).join("、") || "未关联"} · ${item.note || "尚未说明"}`;
  return `片段 ${item.clipId} · 精确时间来源 ${String(item.normalizationId ?? "")}`;
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
            <Text size="sm" style={{ overflowWrap: "anywhere" }}>
              共同基线：{describe(change.base)}
            </Text>
            <Text size="sm" style={{ overflowWrap: "anywhere" }}>
              本机：{describe(change.local)}
            </Text>
            <Text size="sm" style={{ overflowWrap: "anywhere" }}>
              服务器：{describe(change.remote)}
            </Text>
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
