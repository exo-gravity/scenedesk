import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Fieldset,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { BookOpen, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { useCommand, type Schema } from "./api";
import { ErrorNotice } from "./common";
import { DraftNotice, useContentDraft } from "./content-drafts";
import {
  AssetIdentityLabel,
  AssetPicker,
  ContinuityFields,
  ContinuitySummary,
  DialogueSummary,
  FixedAssetLabel,
  FixedAssetList,
  VoiceBinding,
} from "./CreativeAssetFields";
import { AssetReferenceFields } from "./AssetReferenceFields";
import { reconcileContent } from "./content-reconcile";
import { submitCreation, type CreationIntent } from "./content-creation";
import { ShotReferenceFields } from "./ShotReferenceFields";
import classes from "./workbench.module.css";
import layout from "./content.module.css";

export type ContentEntity =
  Schema<"Episode"> | Schema<"Scene"> | Schema<"Shot">;
export type ContentEditing = {
  kind: "episode" | "scene" | "shot";
  id?: string;
  parentId: string;
};
type Fields = {
  name: string;
  parentId: string;
  summary: string;
  timeLabel: string;
  locationLabel: string;
  spatialNotes: string;
  intent: string;
  action: string;
  camera: string;
  notes: string;
  duration: string;
  entry: string;
  exit: string;
  dialogue: Schema<"Dialogue">[];
  excerpts: Schema<"ScriptExcerpt">[];
  sceneState: Schema<"ContinuityState">;
  entryState: Schema<"ContinuityState">;
  exitState: Schema<"ContinuityState">;
  references: Schema<"Reference">[];
  defaultAssetRevisionIds: string[];
};
const isScene = (value?: ContentEntity): value is Schema<"Scene"> =>
  !!value && "episodeId" in value;
const isShot = (value?: ContentEntity): value is Schema<"Shot"> =>
  !!value && "spec" in value;
function durationText(value?: number) {
  if (value === undefined) return "";
  const n = BigInt(value);
  return `${n / 1000000n}.${(n % 1000000n).toString().padStart(6, "0")}`.replace(
    /\.?0+$/,
    "",
  );
}
function durationUs(value: string) {
  if (!/^\d+(\.\d{1,6})?$/.test(value))
    throw new Error("计划时长请输入秒数，最多六位小数。");
  const [s, f = ""] = value.split(".");
  const us = BigInt(s!) * 1000000n + BigInt(f.padEnd(6, "0"));
  if (us > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("计划时长超出可保存范围。");
  return Number(us);
}

export function StructureEditor({
  editing,
  tree,
  path,
  scripts,
  done,
}: {
  editing: ContentEditing;
  tree: Schema<"ContentTree">;
  path: string;
  scripts: Schema<"ScriptRevision">[];
  done: () => void;
}) {
  const collection =
    editing.kind === "episode"
      ? tree.episodes
      : editing.kind === "scene"
        ? tree.scenes
        : tree.shots;
  const entity = collection.find((e) => e.id === editing.id);
  const scene = isScene(entity) ? entity : undefined,
    shot = isShot(entity) ? entity : undefined;
  const sourceFields: Fields = {
    name: shot?.label ?? (entity && !isShot(entity) ? entity.title : ""),
    parentId: scene?.episodeId ?? shot?.sceneId ?? editing.parentId,
    summary: scene?.summary ?? "",
    timeLabel: scene?.timeLabel ?? "",
    locationLabel: scene?.locationLabel ?? "",
    spatialNotes: scene?.state.spatialNotes ?? "",
    intent: shot?.spec.intent ?? "",
    action: shot?.spec.action ?? "",
    camera: shot?.spec.camera ?? "",
    notes: shot?.spec.notes ?? "",
    duration: durationText(shot?.spec.plannedDurationUs),
    entry: shot?.spec.entryState?.spatialNotes ?? "",
    exit: shot?.spec.exitState?.spatialNotes ?? "",
    dialogue: shot?.spec.dialogue ?? [],
    excerpts: shot?.spec.sourceExcerpts ?? [],
    sceneState: scene?.state ?? {},
    entryState: shot?.spec.entryState ?? {},
    exitState: shot?.spec.exitState ?? {},
    references: shot?.spec.references ?? [],
    defaultAssetRevisionIds: scene?.defaultAssetRevisionIds ?? [],
  };
  const draft = useContentDraft<
    Fields & { baseline?: Fields; creationIntent?: CreationIntent }
  >(
    `${path}/${editing.kind}/${editing.id ?? `new:${editing.parentId}`}`,
    { ...sourceFields, baseline: sourceFields },
    entity?.revision ?? tree.revision,
  );
  const command = useCommand<ContentEntity>(),
    [validation, setValidation] = useState<Error>();
  const [scriptId, setScriptId] = useState<string | null>(
      tree.currentScriptRevisionId ?? null,
    ),
    [selected, setSelected] = useState<Schema<"ScriptExcerpt">>();
  const current = useRef(true),
    staging = useRef(false);
  const [preparing, setPreparing] = useState(false);
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);
  const source = scripts.find((s) => s.id === scriptId);
  // Drafts saved by earlier releases lack the newly exposed binding fields.
  // Keep those inputs and fill only absent fields from the server document.
  const values = { ...sourceFields, ...draft.value },
    set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
      draft.setValue((v) => ({ ...v, [key]: value }));
  const parents =
    editing.kind === "scene"
      ? tree.episodes
          .filter((e) => e.status === "active")
          .map((e) => ({ value: e.id, label: e.title }))
      : tree.scenes
          .filter(
            (s) =>
              s.status === "active" &&
              tree.episodes.some(
                (e) => e.id === s.episodeId && e.status === "active",
              ),
          )
          .map((s) => ({
            value: s.id,
            label: `${tree.episodes.find((e) => e.id === s.episodeId)?.title} · ${s.title}`,
          }));
  const version = entity?.revision ?? tree.revision,
    conflict = version !== draft.baseVersion;
  const tenantPath = path.split("/projects/")[0]!,
    projectId = tree.projectId;
  const creationIntent = draft.value.creationIntent;
  const recoveredCreation = draft.recovered?.value.creationIntent;
  const creationPath = `${path}/${editing.kind}s`;
  async function sendCreation(intent: CreationIntent, initialSend: boolean) {
    if (staging.current || command.isPending || !draft.ready || draft.recovered)
      return;
    staging.current = true;
    setPreparing(true);
    setValidation(undefined);
    try {
      await submitCreation(
        intent,
        creationPath,
        (creationIntent) => draft.stage({ ...draft.value, creationIntent }),
        (request) =>
          command.mutateAsync({
            ...request,
            onCommitted: () => void draft.complete(done),
          }),
        { initialSend, isCurrent: () => current.current },
      );
    } catch (error) {
      if (current.current) setValidation(error as Error);
    } finally {
      staging.current = false;
      if (current.current) setPreparing(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      creationIntent ||
      recoveredCreation ||
      staging.current ||
      command.isPending ||
      !draft.ready ||
      draft.recovered
    )
      return;
    setValidation(undefined);
    let body:
      Schema<"EpisodeInput"> | Schema<"SceneInput"> | Schema<"ShotInput">;
    const siblings = collection.filter(
      (e) =>
        editing.kind === "episode" ||
        (isScene(e) ? e.episodeId : isShot(e) ? e.sceneId : "") ===
          values.parentId,
    );
    const position =
      entity?.position ?? Math.max(-1, ...siblings.map((e) => e.position)) + 1;
    const status = entity?.status ?? "active";
    if (editing.kind === "episode")
      body = { title: values.name, position, status };
    else if (editing.kind === "scene")
      body = {
        episodeId: values.parentId,
        title: values.name,
        position,
        status,
        summary: values.summary,
        state: { ...values.sceneState, spatialNotes: values.spatialNotes },
        defaultAssetRevisionIds: values.defaultAssetRevisionIds,
        ...(values.timeLabel ? { timeLabel: values.timeLabel } : {}),
        ...(values.locationLabel
          ? { locationLabel: values.locationLabel }
          : {}),
      };
    else {
      let plannedDurationUs: number | undefined;
      try {
        plannedDurationUs = values.duration
          ? durationUs(values.duration)
          : undefined;
      } catch (error) {
        setValidation(error as Error);
        return;
      }
      const previous = shot?.spec ?? { intent: "", references: [] };
      const spec: Schema<"ShotSpec"> = { ...previous, intent: values.intent };
      spec.references = values.references;
      for (const key of ["action", "camera", "notes"] as const)
        if (values[key] !== (previous[key] ?? "")) spec[key] = values[key];
      if (
        JSON.stringify(values.dialogue) !==
        JSON.stringify(previous.dialogue ?? [])
      )
        spec.dialogue = values.dialogue;
      if (
        JSON.stringify(values.excerpts) !==
        JSON.stringify(previous.sourceExcerpts ?? [])
      )
        spec.sourceExcerpts = values.excerpts;
      if (
        values.entry !== (previous.entryState?.spatialNotes ?? "") ||
        JSON.stringify(values.entryState) !==
          JSON.stringify(previous.entryState ?? {})
      )
        spec.entryState = {
          ...values.entryState,
          spatialNotes: values.entry,
        };
      if (
        values.exit !== (previous.exitState?.spatialNotes ?? "") ||
        JSON.stringify(values.exitState) !==
          JSON.stringify(previous.exitState ?? {})
      )
        spec.exitState = { ...values.exitState, spatialNotes: values.exit };
      if (plannedDurationUs === undefined) delete spec.plannedDurationUs;
      else spec.plannedDurationUs = plannedDurationUs;
      body = {
        sceneId: values.parentId,
        label: values.name,
        position,
        status,
        spec,
      };
    }
    if (!entity) {
      await sendCreation(
        {
          command: {
            path: creationPath,
            method: "POST",
            body,
            version: draft.baseVersion,
            idempotencyKey: crypto.randomUUID(),
          },
        },
        true,
      );
      return;
    }
    command.mutate(
      {
        path: `${path}/${editing.kind}s${entity ? `/${entity.id}` : ""}`,
        method: entity ? "PUT" : "POST",
        body,
        version: draft.baseVersion,
      },
      {
        onCommitted: () => void draft.complete(done),
      },
    );
  }
  if (draft.committed) return <DraftNotice draft={draft} />;
  return (
    <form onSubmit={submit}>
      <Stack gap="lg">
        <DraftNotice
          draft={draft}
          pendingCreation={
            !!(creationIntent ?? recoveredCreation) &&
            !(creationIntent ?? recoveredCreation)?.rejected
          }
        />
        {creationIntent && !draft.recovered && (
          <Alert
            title={
              creationIntent.rejected
                ? "本次创建未提交"
                : command.isPending
                  ? "正在提交原创建请求"
                  : "创建结果待确认"
            }
          >
            <Text>
              {creationIntent.rejected
                ? creationIntent.rejected.message
                : "原输入和提交位置已保留。请明确恢复原请求以核对结果；刷新或内容更新不会另建一项。"}
            </Text>
            <Text size="sm">
              原输入：{values.name} · 提交时内容版本{" "}
              {creationIntent.command.version}
            </Text>
            {creationIntent.rejected ? (
              <Button
                mt="sm"
                disabled={preparing}
                onClick={() => {
                  const { creationIntent: _intent, ...input } = draft.value;
                  void draft.stage(input).then((saved) => {
                    if (saved && current.current) {
                      command.reset();
                      setValidation(undefined);
                    }
                  });
                }}
              >
                保留输入，返回编辑
              </Button>
            ) : (
              <Button
                mt="sm"
                loading={preparing || command.isPending}
                disabled={!draft.ready}
                onClick={() => void sendCreation(creationIntent, false)}
              >
                恢复原创建请求
              </Button>
            )}
          </Alert>
        )}
        {conflict && !creationIntent && !recoveredCreation && (
          <Alert title="服务器内容已更新">
            <Text>
              当前版本 {version}。
              {entity
                ? `最新${isShot(entity) ? "镜头" : "标题"}：${isShot(entity) ? `${entity.label} · ${entity.spec.intent}` : entity.title}`
                : "集场镜结构已变化，请核对插入位置。"}
            </Text>
            <Text size="sm">
              核对后保留我的修改，未修改字段采用服务器值；同一字段都被修改时以我的输入为准。资产、造型和台词仍按各自标识合并。
            </Text>
            <details>
              <summary>查看服务器当前输入</summary>
              <Stack mt="sm" gap="sm">
                {Object.entries(
                  editing.kind === "shot"
                    ? {
                        name: "镜头编号",
                        intent: "叙事意图",
                        action: "动作与表演",
                        camera: "机位",
                        notes: "备注",
                        duration: "计划秒数",
                      }
                    : editing.kind === "scene"
                      ? {
                          name: "场次标题",
                          summary: "梗概",
                          timeLabel: "时间",
                          locationLabel: "地点",
                        }
                      : { name: "单集标题" },
                ).map(([key, label]) => (
                  <Text key={key} size="sm">
                    {label}：{sourceFields[key as "name"] || "未填写"}
                  </Text>
                ))}
                <Text size="sm">
                  所属位置：
                  {parents.find((p) => p.value === sourceFields.parentId)
                    ?.label ?? "项目"}
                </Text>
                {editing.kind === "scene" && (
                  <ContinuitySummary
                    path={tenantPath}
                    value={sourceFields.sceneState}
                    label="服务器场次状态"
                  />
                )}
                {editing.kind === "shot" && (
                  <>
                    <ContinuitySummary
                      path={tenantPath}
                      value={sourceFields.entryState}
                      label="服务器入口状态"
                    />
                    <ContinuitySummary
                      path={tenantPath}
                      value={sourceFields.exitState}
                      label="服务器出口状态"
                    />
                  </>
                )}
                {sourceFields.defaultAssetRevisionIds.map((id) => (
                  <FixedAssetLabel key={id} path={tenantPath} id={id} />
                ))}
                <AssetReferenceFields
                  path={tenantPath}
                  projectId={projectId}
                  value={sourceFields.references}
                  onChange={() => {}}
                  readOnly
                />
                <DialogueSummary
                  path={tenantPath}
                  value={sourceFields.dialogue}
                />
                {sourceFields.excerpts.map((ex, index) => (
                  <Text key={index} size="sm">
                    原文依据：{ex.quote}
                  </Text>
                ))}
              </Stack>
            </details>
            <Button
              mt="sm"
              onClick={() => {
                const { baseline, ...local } = values;
                draft.setValue({
                  ...(baseline
                    ? reconcileContent(baseline, local, sourceFields)
                    : local),
                  baseline: sourceFields,
                });
                draft.rebase();
              }}
            >
              核对后使用最新版本作为保存基线
            </Button>
          </Alert>
        )}
        <Fieldset
          disabled={
            !draft.ready ||
            !!draft.recovered ||
            command.isPending ||
            preparing ||
            !!creationIntent
          }
          variant="unstyled"
        >
          <Stack gap="lg">
            <TextInput
              required
              label={editing.kind === "shot" ? "镜头编号" : "标题"}
              maxLength={160}
              value={values.name}
              onChange={(e) => set("name", e.currentTarget.value)}
            />
            {editing.kind !== "episode" && (
              <Select
                required
                label={editing.kind === "scene" ? "所属单集" : "所属场次"}
                data={parents}
                value={values.parentId}
                onChange={(v) => {
                  if (v) set("parentId", v);
                }}
              />
            )}
            {editing.kind === "scene" && (
              <>
                <div className={classes.grid}>
                  <TextInput
                    label="时间"
                    placeholder="如：日 · 内景"
                    value={values.timeLabel}
                    onChange={(e) => set("timeLabel", e.currentTarget.value)}
                  />
                  <TextInput
                    label="地点"
                    value={values.locationLabel}
                    onChange={(e) =>
                      set("locationLabel", e.currentTarget.value)
                    }
                  />
                </div>
                <Textarea
                  label="场次梗概"
                  autosize
                  minRows={3}
                  maxRows={8}
                  value={values.summary}
                  onChange={(e) => set("summary", e.currentTarget.value)}
                />
                <ContinuityFields
                  path={tenantPath}
                  projectId={projectId}
                  label="场次状态"
                  value={{
                    ...values.sceneState,
                    spatialNotes: values.spatialNotes,
                  }}
                  onChange={(state) =>
                    draft.setValue((v) => ({
                      ...v,
                      sceneState: state,
                      spatialNotes: state.spatialNotes ?? "",
                    }))
                  }
                />
                <Text fw={600}>场次默认资产</Text>
                <FixedAssetList
                  path={tenantPath}
                  projectId={projectId}
                  value={values.defaultAssetRevisionIds}
                  onChange={(value) => set("defaultAssetRevisionIds", value)}
                />
              </>
            )}
            {editing.kind === "shot" && (
              <>
                <Textarea
                  label="叙事意图"
                  placeholder="这一镜让观众知道什么？"
                  autosize
                  minRows={3}
                  value={values.intent}
                  onChange={(e) => set("intent", e.currentTarget.value)}
                />
                <Textarea
                  label="动作与表演"
                  autosize
                  minRows={2}
                  value={values.action}
                  onChange={(e) => set("action", e.currentTarget.value)}
                />
                <div className={classes.grid}>
                  <TextInput
                    label="镜头与机位"
                    value={values.camera}
                    onChange={(e) => set("camera", e.currentTarget.value)}
                  />
                  <TextInput
                    label="计划时长（秒）"
                    inputMode="decimal"
                    placeholder="可暂不填写"
                    value={values.duration}
                    onChange={(e) => set("duration", e.currentTarget.value)}
                  />
                </div>
                <Text fw={600}>镜头参考素材</Text>
                <ShotReferenceFields
                  path={tenantPath}
                  projectId={projectId}
                  value={values.references}
                  onChange={(refs) => set("references", refs)}
                />
                <ContinuityFields
                  path={tenantPath}
                  projectId={projectId}
                  label="入口状态"
                  value={{ ...values.entryState, spatialNotes: values.entry }}
                  onChange={(state) =>
                    draft.setValue((v) => ({
                      ...v,
                      entryState: state,
                      entry: state.spatialNotes ?? "",
                    }))
                  }
                />
                <ContinuityFields
                  path={tenantPath}
                  projectId={projectId}
                  label="出口状态"
                  value={{ ...values.exitState, spatialNotes: values.exit }}
                  onChange={(state) =>
                    draft.setValue((v) => ({
                      ...v,
                      exitState: state,
                      exit: state.spatialNotes ?? "",
                    }))
                  }
                />
                <Group justify="space-between">
                  <Text fw={600}>台词</Text>
                  <Button
                    size="xs"
                    leftSection={<Plus size={16} />}
                    onClick={() =>
                      set("dialogue", [
                        ...values.dialogue,
                        { id: crypto.randomUUID(), text: "" },
                      ])
                    }
                  >
                    添加台词
                  </Button>
                </Group>
                {values.dialogue.map((line, index) => (
                  <Stack key={line.id} gap="xs">
                    <Group justify="space-between">
                      <Text size="sm">第 {index + 1} 句</Text>
                      <Button
                        variant="subtle"
                        size="xs"
                        aria-label={`删除第 ${index + 1} 句台词`}
                        onClick={() =>
                          set(
                            "dialogue",
                            values.dialogue.filter((d) => d.id !== line.id),
                          )
                        }
                      >
                        <Trash size={16} />
                      </Button>
                    </Group>
                    <Text size="sm" fw={500}>
                      第 {index + 1} 句说话人
                    </Text>
                    {line.characterAssetId ? (
                      <AssetIdentityLabel
                        path={tenantPath}
                        id={line.characterAssetId}
                      />
                    ) : (
                      <Text size="sm" c="dimmed">
                        未指定说话人
                      </Text>
                    )}
                    <Group>
                      <AssetPicker
                        path={tenantPath}
                        projectId={projectId}
                        mode="identity"
                        kind="character"
                        label={`选择第 ${index + 1} 句说话人`}
                        onChoose={({ asset }) =>
                          set(
                            "dialogue",
                            values.dialogue.map((d) =>
                              d.id === line.id
                                ? { ...d, characterAssetId: asset.id }
                                : d,
                            ),
                          )
                        }
                      />
                      {line.characterAssetId && (
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={() =>
                            set(
                              "dialogue",
                              values.dialogue.map((d) => {
                                if (d.id !== line.id) return d;
                                const { characterAssetId: _, ...rest } = d;
                                return rest;
                              }),
                            )
                          }
                        >
                          移除此句说话人
                        </Button>
                      )}
                    </Group>
                    <VoiceBinding
                      path={tenantPath}
                      projectId={projectId}
                      label={`第 ${index + 1} 句声音覆盖`}
                      value={line.voiceAssetRevisionId}
                      onChange={(id) =>
                        set(
                          "dialogue",
                          values.dialogue.map((d) => {
                            if (d.id !== line.id) return d;
                            const { voiceAssetRevisionId: _, ...rest } = d;
                            return id
                              ? { ...rest, voiceAssetRevisionId: id }
                              : rest;
                          }),
                        )
                      }
                    />
                    <Textarea
                      label={`第 ${index + 1} 句台词`}
                      autosize
                      value={line.text}
                      onChange={(e) =>
                        set(
                          "dialogue",
                          values.dialogue.map((d) =>
                            d.id === line.id
                              ? { ...d, text: e.currentTarget.value }
                              : d,
                          ),
                        )
                      }
                    />
                    <TextInput
                      label={`第 ${index + 1} 句表演要求`}
                      value={line.performance ?? ""}
                      onChange={(e) =>
                        set(
                          "dialogue",
                          values.dialogue.map((d) =>
                            d.id === line.id
                              ? { ...d, performance: e.currentTarget.value }
                              : d,
                          ),
                        )
                      }
                    />
                  </Stack>
                ))}
                <Textarea
                  label="备注"
                  autosize
                  minRows={2}
                  value={values.notes}
                  onChange={(e) => set("notes", e.currentTarget.value)}
                />
                <Text fw={600}>剧本原文依据</Text>
                {values.excerpts.map((ex, index) => (
                  <div
                    key={`${ex.scriptRevisionId}:${index}`}
                    className={classes.notice}
                  >
                    <Text size="xs" c="dimmed">
                      剧本第{" "}
                      {scripts.find((s) => s.id === ex.scriptRevisionId)
                        ?.number ?? "历史"}{" "}
                      版
                    </Text>
                    <Text>{ex.quote}</Text>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() =>
                        set(
                          "excerpts",
                          values.excerpts.filter((_, i) => i !== index),
                        )
                      }
                    >
                      移除此处引用
                    </Button>
                  </div>
                ))}
                {scripts.length > 0 ? (
                  <>
                    <Select
                      label="从剧本版本选取原文"
                      data={[...scripts]
                        .sort((a, b) => b.number - a.number)
                        .map((s) => ({
                          value: s.id,
                          label: `第 ${s.number} 版${s.id === tree.currentScriptRevisionId ? " · 当前" : ""}`,
                        }))}
                      value={scriptId}
                      onChange={(id) => {
                        setScriptId(id);
                        setSelected(undefined);
                      }}
                    />
                    {source && (
                      <Textarea
                        label="选中需要引用的文字"
                        readOnly
                        minRows={4}
                        maxRows={10}
                        autosize
                        value={source.text}
                        onSelect={(e) => {
                          const el = e.currentTarget,
                            start = Array.from(
                              el.value.slice(0, el.selectionStart),
                            ).length,
                            end = Array.from(
                              el.value.slice(0, el.selectionEnd),
                            ).length;
                          setSelected(
                            end > start
                              ? {
                                  scriptRevisionId: source.id,
                                  range: { startOffset: start, endOffset: end },
                                  quote: Array.from(el.value)
                                    .slice(start, end)
                                    .join(""),
                                }
                              : undefined,
                          );
                        }}
                      />
                    )}
                    <Button
                      disabled={!selected}
                      onClick={() => {
                        if (
                          selected &&
                          !values.excerpts.some(
                            (e) =>
                              JSON.stringify(e) === JSON.stringify(selected),
                          )
                        )
                          set("excerpts", [...values.excerpts, selected]);
                      }}
                    >
                      添加选中的原文引用
                    </Button>
                  </>
                ) : (
                  <Text size="sm" c="dimmed">
                    保存剧本后，可以把原文片段关联到镜头。
                  </Text>
                )}
              </>
            )}
          </Stack>
        </Fieldset>
        <ErrorNotice error={validation ?? command.error} />
        <Button
          variant="filled"
          type="submit"
          loading={command.isPending}
          disabled={
            !draft.ready ||
            !!draft.recovered ||
            conflict ||
            preparing ||
            !!creationIntent ||
            !values.name.trim() ||
            (editing.kind !== "episode" &&
              !parents.some((p) => p.value === values.parentId))
          }
        >
          {entity
            ? "保存修改"
            : `创建${editing.kind === "episode" ? "单集" : editing.kind === "scene" ? "场次" : "镜头"}`}
        </Button>
      </Stack>
    </form>
  );
}

export function ScriptEditor({
  tree,
  scripts,
  path,
  done,
  presentation = "dialog",
  initialHistoryId,
}: {
  tree: Schema<"ContentTree">;
  scripts: Schema<"ScriptRevision">[];
  path: string;
  done: () => void;
  presentation?: "dialog" | "document";
  initialHistoryId?: string | null;
}) {
  const current = scripts.find((s) => s.id === tree.currentScriptRevisionId);
  const draft = useContentDraft(
      `${path}/script`,
      { text: current?.text ?? "" },
      tree.revision,
    ),
    command = useCommand<Schema<"ScriptRevision">>();
  const [saved, setSaved] = useState(false);
  const [editingText, setEditingText] = useState(!current);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (draft.recovered) setEditingText(true);
  }, [draft.recovered]);
  const [history, setHistory] = useState<string | null>(
      initialHistoryId ?? null,
    ),
    old = scripts.find((s) => s.id === history);
  useEffect(() => {
    setHistory(initialHistoryId ?? null);
  }, [initialHistoryId]);
  const document = presentation === "document";
  if (draft.committed) return <DraftNotice draft={draft} />;
  if (saved && document)
    return (
      <Alert title="服务器已保存">
        <Text>
          正文已保存为新版本。读取完成后继续编辑；读取失败时可重新读取。
        </Text>
        <Button mt="sm" variant="default" onClick={done}>
          重新读取已保存的剧本
        </Button>
      </Alert>
    );
  const conflict = draft.baseVersion !== tree.revision;
  const changed = draft.value.text !== (current?.text ?? "");
  const reading = document && !editingText && !!draft.value.text.trim();
  const save = (
    <Button
      variant="filled"
      loading={command.isPending}
      disabled={
        conflict ||
        !draft.ready ||
        !!draft.recovered ||
        !draft.value.text.trim() ||
        !changed ||
        (document && !!history)
      }
      onClick={() =>
        command.mutate(
          {
            path: `${path}/scripts`,
            body: {
              text: draft.value.text,
              ...(tree.currentScriptRevisionId
                ? { parentRevisionId: tree.currentScriptRevisionId }
                : {}),
            },
            version: draft.baseVersion,
          },
          {
            onCommitted: () => {
              setSaved(true);
              void draft.complete(done);
            },
          },
        )
      }
    >
      保存为第 {(current?.number ?? 0) + 1} 版
    </Button>
  );
  const historyControl = !!scripts.length && (
    <Select
      aria-label="查阅历史剧本"
      placeholder={`当前 · 第 ${current?.number ?? 0} 版`}
      clearable
      value={history}
      onChange={setHistory}
      data={[...scripts]
        .sort((a, b) => b.number - a.number)
        .map((s) => ({
          value: s.id,
          label: `第 ${s.number} 版 · ${s.createdAt ? new Date(s.createdAt).toLocaleString() : ""}`,
        }))}
    />
  );
  return (
    <Stack
      gap={document ? "md" : "lg"}
      className={document ? layout.document : undefined}
    >
      {document && (
        <div className={layout.documentToolbar}>
          <div>
            <Text size="sm" c="dimmed">
              {history
                ? `正在查阅第 ${old?.number ?? "—"} 版 · 只读`
                : changed
                  ? "本机有修改 · 尚未提交"
                  : `第 ${current?.number ?? 0} 版 · 已保存`}
            </Text>
          </div>
          <Group gap="sm">
            {historyControl}
            {!history && (
              <Button
                variant={reading ? "default" : "subtle"}
                leftSection={
                  reading ? <PencilSimple size={16} /> : <BookOpen size={16} />
                }
                disabled={
                  !draft.ready ||
                  !!draft.recovered ||
                  command.isPending ||
                  (!reading && !draft.value.text.trim())
                }
                onClick={() => {
                  setEditingText(reading);
                  if (reading)
                    requestAnimationFrame(() => textRef.current?.focus());
                }}
              >
                {reading ? "编辑正文" : "阅读预览"}
              </Button>
            )}
            {!reading && !history && save}
          </Group>
        </div>
      )}
      {(!document || draft.recovered || draft.error || !draft.ready) && (
        <DraftNotice draft={draft} />
      )}
      {conflict && (
        <Alert title="项目内容已更新">
          <Text>当前剧本为第 {current?.number ?? 0} 版，请核对后提交。</Text>
          {current && (
            <Textarea
              label="服务器当前剧本"
              readOnly
              value={current.text}
              minRows={3}
              maxRows={8}
              autosize
            />
          )}
          <Button mt="sm" onClick={draft.rebase}>
            核对后使用最新版本作为保存基线
          </Button>
        </Alert>
      )}
      {!document && (
        <Text c="dimmed">
          每次保存都会新增版本。已经关联到镜头的原文保持不变。
        </Text>
      )}
      {history && !old && (
        <Alert title="指定剧本版本不可用">
          该版本不存在或不在当前可访问的剧本历史中。请重新选择版本。
        </Alert>
      )}
      {document && old ? (
        <>
          <article
            className={layout.readingPaper}
            aria-label={`第 ${old.number} 版原文`}
          >
            <div className={layout.readingText}>{old.text}</div>
          </article>
          <Button
            variant="default"
            disabled={!draft.ready || !!draft.recovered || command.isPending}
            onClick={() => {
              draft.setValue({ text: old.text });
              setHistory(null);
              setEditingText(true);
            }}
          >
            将此版本复制到正在编辑的正文
          </Button>
        </>
      ) : reading ? (
        <article className={layout.readingPaper} aria-label="剧本正文">
          <div className={layout.readingText}>{draft.value.text}</div>
        </article>
      ) : (
        <Textarea
          ref={textRef}
          {...(document ? { "aria-label": "剧本正文" } : { label: "剧本正文" })}
          {...(document
            ? { classNames: { input: layout.documentInput } }
            : { minRows: 14, autosize: true, maxRows: 26 })}
          required
          value={draft.value.text}
          disabled={
            !draft.ready ||
            !!draft.recovered ||
            command.isPending ||
            (document && !!history)
          }
          onChange={(e) => draft.setValue({ text: e.currentTarget.value })}
        />
      )}
      <ErrorNotice error={command.error} />
      {document ? (
        <Text size="xs" c="dimmed">
          {draft.dirty
            ? draft.saved
              ? "修改已保存在本标签页，尚未提交。"
              : "正在保存本地修改…"
            : "保存会新增版本。镜头与提案已固定的原文保持不变。"}
        </Text>
      ) : (
        <>
          {save}
          {historyControl}
          {old && (
            <>
              <Textarea
                label={`第 ${old.number} 版原文`}
                value={old.text}
                readOnly
                minRows={5}
                maxRows={15}
                autosize
              />
              <Button onClick={() => draft.setValue({ text: old.text })}>
                将此版本复制到正在编辑的正文
              </Button>
            </>
          )}
        </>
      )}
    </Stack>
  );
}
