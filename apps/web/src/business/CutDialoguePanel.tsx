import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  MultiSelect,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import {
  editingCanonical,
  inspectWorkDocument,
  type WorkClip,
  type WorkDocument,
} from "@drama/domain";
import { api, useList, useResource, useSession, type Schema } from "./api";
import { ErrorNotice } from "./common";
import { FixedVoiceField, FixedVoiceLabel } from "./FixedVoiceField";
import { parseSourceSeconds, sourceSeconds } from "./candidate-time";
import {
  type CutWorkController,
  type WorkEditorState,
} from "./cut-work-controller";
import {
  applyWorkBinding,
  bindingUsage,
  dialogueContext,
  originalSoundClips,
  pendingKind,
  workClipLabel,
} from "./cut-dialogue";
import classes from "./candidates.module.css";

export function CutDialoguePanel({
  controller,
  state,
  path,
  mediaPath,
  projectId,
  sceneId,
  clipId,
  disabled,
  href,
}: {
  controller: CutWorkController;
  state: WorkEditorState;
  path: string;
  mediaPath: string;
  projectId: string;
  sceneId: string;
  clipId?: string;
  disabled: boolean;
  href: string;
}) {
  const document = state.local!.document;
  const [selected, setSelected] = useState<string | null>(
      () =>
        document.dramaBindings.find((b) => b.clipId === clipId)?.id ??
        document.dramaBindings[0]?.id ??
        null,
    ),
    [target, setTarget] = useState(clipId);
  const existing = document.dramaBindings.find((b) => b.id === selected);
  const clips = document.timeline.tracks.flatMap<WorkClip>((t) => t.items);
  const drafts = Object.keys(state.local!.buffers).flatMap((key) => {
    const match = /^dialogue:(new:)?([^:]+):basis$/.exec(key);
    return match ? [{ fresh: !!match[1], id: match[2]! }] : [];
  });
  return (
    <Stack gap="md">
      <Text fw={600}>对白、声音与字幕</Text>
      <Text size="sm">
        关联记录声音或字幕用于表达哪句台词，仍须实际回放核对内容、表演与口型。
      </Text>
      {drafts.length > 0 && (
        <Stack gap="xs">
          <Text size="sm">尚未应用的关联表单 · {drafts.length}</Text>
          {drafts.map((d) => (
            <Button
              key={`${d.fresh}:${d.id}`}
              variant="subtle"
              onClick={() => {
                setSelected(d.fresh ? null : d.id);
                if (d.fresh) setTarget(d.id);
              }}
            >
              继续{d.fresh ? "新建" : "修改"}关联 {d.id.slice(0, 8)}
            </Button>
          ))}
        </Stack>
      )}
      <Select
        label="查看已有关联"
        value={selected}
        clearable
        data={document.dramaBindings.map((b, i) => ({
          value: b.id,
          label: `${i + 1} · ${bindingUsage[b.usage]} · ${clips.find((c) => c.id === b.clipId)?.kind === "subtitle" ? "字幕" : b.clipId.slice(0, 8)}`,
        }))}
        onChange={setSelected}
      />
      <Button
        disabled={disabled || !clipId || !clips.some((c) => c.id === clipId)}
        onClick={() => {
          setSelected(null);
          setTarget(clipId);
        }}
      >
        为当前片段建立关联
      </Button>
      {selected && !existing ? (
        <Alert title="关联已变化">
          当前关联已移除。其他输入仍保留，请重新选择。
        </Alert>
      ) : existing || target ? (
        <BindingForm
          key={existing?.id ?? `new:${target}`}
          controller={controller}
          state={state}
          path={path}
          mediaPath={mediaPath}
          projectId={projectId}
          sceneId={sceneId}
          initialClipId={existing?.clipId ?? target!}
          existing={existing}
          disabled={disabled}
          href={href}
          done={(id) => setSelected(id)}
        />
      ) : (
        <Text size="sm">先在轨道中选择一个片段，再建立关联。</Text>
      )}
    </Stack>
  );
}

function BindingForm({
  controller,
  state,
  path,
  mediaPath,
  projectId,
  sceneId,
  initialClipId,
  existing,
  disabled,
  href,
  done,
}: {
  controller: CutWorkController;
  state: WorkEditorState;
  path: string;
  mediaPath: string;
  projectId: string;
  sceneId: string;
  initialClipId: string;
  existing?: Schema<"DialogueBinding"> | undefined;
  disabled: boolean;
  href: string;
  done: (id: string | null) => void;
}) {
  const document = state.local!.document;
  const prefix = `dialogue:${existing?.id ?? `new:${initialClipId}`}:`;
  const [error, setError] = useState<Error | null>(null),
    [remove, setRemove] = useState<string | null>(null);
  const read = (key: string, fallback = "") =>
    state.local!.buffers[`${prefix}${key}`]?.value ?? fallback;
  const clipId = read("clipId", initialClipId),
    clip = document.timeline.tracks
      .flatMap<WorkClip>((t) => t.items)
      .find((c) => c.id === clipId);
  const snapshot = dialogueContext(document, clipId, existing?.id),
    basis = read("basis", snapshot);
  const write = (changes: Record<string, string>, resetContext = false) => {
    const current = controller.getSnapshot().local;
    if (!current) return;
    const buffers = { ...current.buffers };
    if (resetContext)
      for (const key of Object.keys(buffers))
        if (key.startsWith(`${prefix}sound:`)) delete buffers[key];
    for (const [key, value] of Object.entries(changes))
      buffers[`${prefix}${key}`] = { value, valid: false };
    if (resetContext || !buffers[`${prefix}basis`])
      buffers[`${prefix}basis`] = {
        value: resetContext
          ? dialogueContext(
              current.document,
              changes.clipId ?? clipId,
              existing?.id,
            )
          : basis,
        valid: false,
      };
    controller.edit(current.document, buffers);
  };
  const remainingBuffers = () =>
    Object.fromEntries(
      Object.entries(controller.getSnapshot().local!.buffers).filter(
        ([key]) => !key.startsWith(prefix),
      ),
    );
  const revisionId = read("revision", existing?.shotRevisionId),
    dialogueId = read("dialogue", existing?.dialogueId),
    usage = read(
      "usage",
      existing?.usage ??
        (clip?.kind === "subtitle"
          ? "subtitle"
          : clip?.kind === "video"
            ? "native_mixed"
            : "dialogue"),
    ) as Schema<"DialogueBinding">["usage"];
  const content = useResource<Schema<"ContentTree">>(`${path}/content`);
  const fixed = useResource<Schema<"ShotRevision">>(
    `${path}/shot-revisions/${revisionId}`,
    !!revisionId,
  );
  const shotId = read("shot", fixed.data?.shotId),
    shot = content.data?.shots.find((s) => s.id === shotId);
  const revisions = useList<Schema<"ShotRevision">>(
    `${path}/shots/${shotId}/revisions`,
    !!shotId,
  );
  const dialogue = fixed.data?.spec.dialogue?.find((d) => d.id === dialogueId);
  const voice = read("voice", existing?.voiceAssetRevisionId);
  const native =
    usage === "dialogue" ? originalSoundClips(document, clipId) : [];
  const session = useSession(),
    ids = [...new Set(native.map((c) => c.mediaId))].sort();
  const media = useQuery({
    queryKey: [
      "user",
      session.userId,
      mediaPath,
      "dialogue-native",
      ids.join(","),
    ],
    queryFn: async ({ signal }) =>
      Promise.all(
        ids.map((id) =>
          api<Schema<"Media">>(`${mediaPath}/media/${id}`, { signal }),
        ),
      ),
    enabled: ids.length > 0,
  });
  const knownNoAudio = new Set(
    media.data?.filter((m) => m.hasAudio === false).map((m) => m.id),
  );
  const sound = Object.fromEntries(
    native.flatMap((c) => {
      const value = read(
        `sound:${c.id}`,
        knownNoAudio.has(c.mediaId) ? "keep" : "",
      );
      return value === "keep" || value === "mute" ? [[c.id, value]] : [];
    }),
  ) as Record<string, "keep" | "mute">;
  const ranged = read("ranged", existing?.sourceRange ? "yes" : "no") === "yes";
  const inText = read(
    "in",
    sourceSeconds(
      existing?.sourceRange?.inUs ??
        (clip?.kind !== "subtitle" ? (clip?.range.inUs ?? 0) : 0),
    ),
  );
  const outText = read(
    "out",
    sourceSeconds(
      existing?.sourceRange?.outUs ??
        (clip?.kind !== "subtitle" ? (clip?.range.outUs ?? 0) : 0),
    ),
  );
  const inUs = parseSourceSeconds(inText),
    outUs = parseSourceSeconds(outText);
  const validRange =
    !ranged ||
    (inUs !== undefined &&
      outUs !== undefined &&
      inUs <= outUs &&
      clip?.kind !== "subtitle");
  const validType = clip
    ? usage === "subtitle"
      ? clip.kind === "subtitle"
      : usage === "dialogue"
        ? clip.kind === "audio"
        : clip.kind === "video" ||
          (clip.kind === "audio" && clip.streamSelection === "embedded_audio")
    : !!existing;
  const ready =
    !disabled &&
    !!dialogue &&
    !!fixed.data &&
    !fixed.error &&
    fixed.data.projectId === projectId &&
    validType &&
    validRange &&
    basis === snapshot;
  const apply = (allowPending: boolean, copyDialogueText = false) => {
    try {
      const current = controller.getSnapshot().local;
      if (
        !ready ||
        !current ||
        dialogueContext(current.document, clipId, existing?.id) !== basis
      )
        throw new Error("目标片段或关联已变化，请保留输入后重新核对。");
      const binding: Schema<"DialogueBinding"> = {
        id: existing?.id ?? crypto.randomUUID(),
        shotRevisionId: revisionId,
        dialogueId,
        clipId,
        usage,
        ...(voice ? { voiceAssetRevisionId: voice } : {}),
        ...(ranged ? { sourceRange: { inUs: inUs!, outUs: outUs! } } : {}),
        ...(read("note", existing?.note)
          ? { note: read("note", existing?.note) }
          : {}),
      };
      const next = applyWorkBinding(
        current.document,
        binding,
        sound,
        allowPending,
      );
      if (copyDialogueText && usage === "subtitle" && dialogue) {
        const target = next.timeline.tracks
          .flatMap<WorkClip>((track) => track.items)
          .find((c) => c.id === clipId);
        if (!target || target.kind !== "subtitle")
          throw new Error("字幕目标已变化，请重新核对。");
        target.text = dialogue.text;
        const note = `从固定台词整理的字幕草稿，待按实际声音回放核对（关联 ${binding.id}）。`;
        if (
          !next.unresolvedEdits.some(
            (u) => u.kind === "subtitle_placement" && u.note === note,
          )
        )
          next.unresolvedEdits.push({
            id: crypto.randomUUID(),
            kind: "subtitle_placement",
            clipIds: [clipId],
            note,
          });
      }
      inspectWorkDocument(next);
      controller.edit(next, remainingBuffers());
      done(binding.id);
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason : new Error("对白关联未完成。"),
      );
    }
  };
  return (
    <Stack gap="md">
      <ErrorNotice
        error={
          error ??
          content.error ??
          fixed.error ??
          revisions.error ??
          media.error
        }
      />
      {basis !== snapshot && (
        <Alert title="关联目标已变化">
          已保留选定台词、声音和备注。重新核对目标后再应用；原声处理需要重新选择。
          <Button mt="sm" onClick={() => write({}, true)}>
            已核对新目标，保留输入继续
          </Button>
        </Alert>
      )}
      <fieldset disabled={disabled} className={classes.fieldset}>
        <Select
          label="关联目标片段"
          value={clipId}
          data={[
            ...document.timeline.tracks
              .flatMap<WorkClip>((t) => t.items)
              .map((c) => ({ value: c.id, label: workClipLabel(c) })),
            ...(!clip
              ? [{ value: clipId, label: `片段已移除 · ${clipId.slice(0, 8)}` }]
              : []),
          ]}
          onChange={(id) => {
            if (id) write({ clipId: id }, true);
          }}
        />
        <Text size="sm">
          {clip
            ? workClipLabel(clip)
            : "此关联的片段已移除；可先保留待处理内容，或明确改关联到现有片段。"}
        </Text>
        <Select
          label="台词所属镜头"
          searchable
          value={shotId || null}
          data={(content.data?.shots ?? []).map((s) => ({
            value: s.id,
            label: `${s.sceneId === sceneId ? "本场" : "项目内其他场"} · ${s.label} · ${s.spec.intent}`,
          }))}
          onChange={(id) => {
            const s = content.data?.shots.find((s) => s.id === id);
            if (s)
              write({ shot: s.id, revision: s.specRevisionId, dialogue: "" });
          }}
        />
        <Select
          label="镜头要求固定版"
          value={revisionId || null}
          data={(revisions.data ?? (fixed.data ? [fixed.data] : [])).map(
            (r) => ({ value: r.id, label: `v${r.number} · ${r.spec.intent}` }),
          )}
          onChange={(id) => {
            if (id) write({ revision: id, dialogue: "" });
          }}
        />
        {shot && revisionId && shot.specRevisionId !== revisionId && (
          <Text size="sm">
            当前镜头要求已有新版本；这里继续使用明确选择的固定旧版。
          </Text>
        )}
        <Select
          label="固定版台词"
          value={dialogueId || null}
          data={(fixed.data?.spec.dialogue ?? []).map((d, index) => ({
            value: d.id,
            label: `${index + 1} · ${d.text || "空白台词"}`,
          }))}
          onChange={(id) => {
            if (id) write({ dialogue: id });
          }}
        />
        {fixed.isFetching && <Loader size="sm" aria-label="正在读取固定台词" />}
        {fixed.data && !fixed.data.spec.dialogue?.length && (
          <Text size="sm">
            该固定版没有台词。请先在镜头要求中整理台词，或选择已有台词的其他版本。
          </Text>
        )}
        {dialogue && (
          <Stack gap="xs">
            <Text fw={500}>
              要求 v{fixed.data!.number} · {dialogue.text || "空白台词"}
            </Text>
            {dialogue.performance && (
              <Text size="sm">表演要求：{dialogue.performance}</Text>
            )}
            {dialogue.voiceAssetRevisionId && (
              <>
                <Text size="sm">台词要求中的声音：</Text>
                <FixedVoiceLabel
                  path={mediaPath}
                  id={dialogue.voiceAssetRevisionId}
                />
                <Button
                  variant="subtle"
                  onClick={() =>
                    write({ voice: dialogue.voiceAssetRevisionId! })
                  }
                >
                  明确沿用台词要求的声音版
                </Button>
              </>
            )}
          </Stack>
        )}
        <Select
          label="关联用途"
          value={usage}
          data={Object.entries(bindingUsage).map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={(value) => {
            if (value)
              write({
                usage: value,
                ...(value === "subtitle" ? { ranged: "no" } : {}),
              });
          }}
          error={
            !validType
              ? "此用途与目标片段类型不符，请选择对应的声音、视频或字幕片段。"
              : undefined
          }
        />
        {usage !== "subtitle" && (
          <>
            <Checkbox
              label="限定这句台词在源文件中的区间"
              checked={ranged}
              onChange={(e) =>
                write({ ranged: e.currentTarget.checked ? "yes" : "no" })
              }
            />
            {ranged && (
              <Group grow align="start">
                <TextInput
                  label="台词源起点（秒）"
                  inputMode="decimal"
                  value={inText}
                  onChange={(e) => write({ in: e.currentTarget.value })}
                  error={
                    !validRange ? "请使用非负秒数，区间不能反向。" : undefined
                  }
                />
                <TextInput
                  label="台词源终点（秒）"
                  inputMode="decimal"
                  value={outText}
                  onChange={(e) => write({ out: e.currentTarget.value })}
                />
              </Group>
            )}
          </>
        )}
        <FixedVoiceField
          path={mediaPath}
          projectId={projectId}
          label="本条关联使用的声音固定版"
          removeLabel="移除本条声音引用"
          value={voice || undefined}
          onChange={(id) => write({ voice: id ?? "" })}
        />
        <Textarea
          label="关联备注"
          minRows={2}
          autosize
          maxRows={5}
          maxLength={20000}
          value={read("note", existing?.note)}
          onChange={(e) => write({ note: e.currentTarget.value })}
        />
        {usage === "dialogue" && native.length > 0 && (
          <Stack gap="sm">
            <Text fw={500}>独立对白与原声</Text>
            <Text size="sm">
              原生混合音轨可能含对白、环境声和配乐。整轨静音会一起关闭，不能仅凭静音移除对白并保留背景音乐。未知内容需回放核对。
            </Text>
            {native.map((c) => (
              <Stack key={c.id} gap="xs">
                <Button
                  variant="subtle"
                  component="a"
                  href={`${href}&clip=${c.id}`}
                >
                  查看原声：{workClipLabel(c)}
                </Button>
                {knownNoAudio.has(c.mediaId) ? (
                  <Text size="sm">源文件经核验没有音轨，无需静音。</Text>
                ) : (
                  <Select
                    label={`原声处理 · ${c.id.slice(0, 8)}`}
                    placeholder="尚未决定"
                    value={read(`sound:${c.id}`) || null}
                    clearable
                    data={[
                      { value: "mute", label: "静音该片段的整条混合音轨" },
                      {
                        value: "keep",
                        label: "保留当前原声设置，继续人工核对",
                      },
                    ]}
                    onChange={(value) =>
                      write({ [`sound:${c.id}`]: value ?? "" })
                    }
                  />
                )}
              </Stack>
            ))}
          </Stack>
        )}
        <Button
          variant="filled"
          disabled={!ready || native.some((c) => !sound[c.id])}
          onClick={() => apply(false)}
        >
          {existing ? "应用关联修改" : "建立对白关联"}
        </Button>
        {usage === "subtitle" && (
          <>
            <Text size="sm">
              可只建立关联，保留当前字幕文字；按计划台词整理的文字仍是待核对草稿，不是已验证的音频转写。
            </Text>
            <Button disabled={!ready} onClick={() => apply(false, true)}>
              按固定台词整理字幕草稿
            </Button>
          </>
        )}
        {usage === "dialogue" && native.some((c) => !sound[c.id]) && (
          <Button disabled={!ready} onClick={() => apply(true)}>
            先保存关联与待核对原声
          </Button>
        )}
        <Button
          variant="subtle"
          onClick={() => {
            controller.edit(
              controller.getSnapshot().local!.document,
              remainingBuffers(),
            );
            setError(null);
          }}
        >
          放弃这份关联表单输入
        </Button>
        {existing && (
          <>
            <Button
              variant="subtle"
              onClick={() => setRemove(editingCanonical(existing))}
            >
              移除此关联
            </Button>
            {remove && (
              <>
                <Text size="sm">
                  只移除这条台词关联，保留片段、声音版本与待处理事项。
                </Text>
                <Button
                  disabled={editingCanonical(existing) !== remove}
                  onClick={() => {
                    const current = controller.getSnapshot().local!;
                    const actual = current.document.dramaBindings.find(
                      (b) => b.id === existing.id,
                    );
                    if (!actual || editingCanonical(actual) !== remove) return;
                    controller.edit(
                      {
                        ...current.document,
                        dramaBindings: current.document.dramaBindings.filter(
                          (b) => b.id !== existing.id,
                        ),
                      },
                      remainingBuffers(),
                    );
                    done(null);
                  }}
                >
                  确认移除关联
                </Button>
              </>
            )}
          </>
        )}
      </fieldset>
    </Stack>
  );
}

export function CutPendingEdits({
  controller,
  state,
  disabled,
  href,
}: {
  controller: CutWorkController;
  state: WorkEditorState;
  disabled: boolean;
  href: string;
}) {
  const document = state.local!.document,
    clips = document.timeline.tracks.flatMap<WorkClip>((t) => t.items);
  const [removing, setRemoving] = useState<{
    id: string;
    value: string;
  } | null>(null);
  const update = (id: string, patch: Partial<Schema<"UnresolvedEdit">>) =>
    controller.edit({
      ...document,
      unresolvedEdits: document.unresolvedEdits.map((u) =>
        u.id === id ? { ...u, ...patch } : u,
      ),
    });
  return (
    <Stack gap="md">
      <Text fw={600}>明确待处理事项</Text>
      <Text size="sm">
        未决定的声音、字幕、替换或对白可以先保留；这些事项会阻止应用到可渲染编排。
      </Text>
      {document.unresolvedEdits.map((item, index) => (
        <Stack key={item.id} gap="xs">
          <Select
            label={`事项 ${index + 1} 类型`}
            value={item.kind}
            data={Object.entries(pendingKind).map(([value, label]) => ({
              value,
              label,
            }))}
            disabled={disabled}
            onChange={(value) => {
              if (value && value in pendingKind)
                update(item.id, {
                  kind: value as Schema<"UnresolvedEdit">["kind"],
                });
            }}
          />
          <Textarea
            label={`事项 ${index + 1} 说明`}
            value={item.note}
            autosize
            minRows={2}
            maxRows={5}
            maxLength={20000}
            disabled={disabled}
            onChange={(e) => update(item.id, { note: e.currentTarget.value })}
          />
          <MultiSelect
            label={`事项 ${index + 1} 相关片段`}
            value={item.clipIds}
            data={[
              ...clips.map((c) => ({ value: c.id, label: workClipLabel(c) })),
              ...item.clipIds
                .filter((id) => !clips.some((c) => c.id === id))
                .map((id) => ({
                  value: id,
                  label: `已移除片段 ${id.slice(0, 8)}`,
                })),
            ]}
            searchable
            disabled={disabled}
            onChange={(clipIds) => update(item.id, { clipIds })}
          />
          {item.clipIds.map((id) => (
            <Button
              key={id}
              component="a"
              variant="subtle"
              href={`${href}&clip=${id}`}
            >
              定位 {id.slice(0, 8)}
            </Button>
          ))}
          <Button
            disabled={disabled}
            onClick={() =>
              setRemoving({ id: item.id, value: editingCanonical(item) })
            }
          >
            处理完成，移除这项记录
          </Button>
          {removing?.id === item.id && (
            <>
              <Text size="sm">
                确认已处理此事项。自动检查仍会独立核对区间、关联和重复声源。
              </Text>
              <Button
                disabled={disabled || editingCanonical(item) !== removing.value}
                onClick={() => {
                  const current = controller.getSnapshot().local!;
                  const actual = current.document.unresolvedEdits.find(
                    (u) => u.id === item.id,
                  );
                  if (!actual || editingCanonical(actual) !== removing.value)
                    return;
                  controller.edit({
                    ...current.document,
                    unresolvedEdits: current.document.unresolvedEdits.filter(
                      (u) => u.id !== item.id,
                    ),
                  });
                  setRemoving(null);
                }}
              >
                确认完成此事项
              </Button>
            </>
          )}
        </Stack>
      ))}
      <Button
        disabled={disabled || document.unresolvedEdits.length >= 500}
        onClick={() =>
          controller.edit({
            ...document,
            unresolvedEdits: [
              ...document.unresolvedEdits,
              {
                id: crypto.randomUUID(),
                kind: "sound_placement",
                clipIds: [],
                note: "",
              },
            ],
          })
        }
      >
        添加待处理事项
      </Button>
    </Stack>
  );
}
