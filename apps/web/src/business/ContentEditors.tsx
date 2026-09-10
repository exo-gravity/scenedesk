import { useState, type FormEvent } from "react";
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
import { Plus, Trash } from "@phosphor-icons/react";
import { useCommand, type Schema } from "./api";
import { ErrorNotice } from "./common";
import { DraftNotice, useContentDraft } from "./content-drafts";
import classes from "./workbench.module.css";

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
  const draft = useContentDraft<Fields>(
    `${path}/${editing.kind}/${editing.id ?? `new:${editing.parentId}`}`,
    {
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
    },
    entity?.revision ?? tree.revision,
  );
  const command = useCommand<ContentEntity>(),
    [validation, setValidation] = useState<Error>();
  const [scriptId, setScriptId] = useState<string | null>(
      tree.currentScriptRevisionId ?? null,
    ),
    [selected, setSelected] = useState<Schema<"ScriptExcerpt">>();
  const source = scripts.find((s) => s.id === scriptId);
  const values = draft.value,
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
  async function submit(event: FormEvent) {
    event.preventDefault();
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
        state: { ...scene?.state, spatialNotes: values.spatialNotes },
        defaultAssetRevisionIds: scene?.defaultAssetRevisionIds ?? [],
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
      if (values.entry !== (previous.entryState?.spatialNotes ?? ""))
        spec.entryState = {
          ...previous.entryState,
          spatialNotes: values.entry,
        };
      if (values.exit !== (previous.exitState?.spatialNotes ?? ""))
        spec.exitState = { ...previous.exitState, spatialNotes: values.exit };
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
    command.mutate(
      {
        path: `${path}/${editing.kind}s${entity ? `/${entity.id}` : ""}`,
        method: entity ? "PUT" : "POST",
        body,
        version: draft.baseVersion,
      },
      {
        onSuccess: () => {
          void draft.clear();
          done();
        },
      },
    );
  }
  return (
    <form onSubmit={submit}>
      <Stack gap="lg">
        <DraftNotice draft={draft} />
        {conflict && (
          <Alert title="服务器内容已更新">
            <Text>
              当前版本 {version}。
              {entity
                ? `最新${isShot(entity) ? "镜头" : "标题"}：${isShot(entity) ? `${entity.label} · ${entity.spec.intent}` : entity.title}`
                : "集场镜结构已变化，请核对插入位置。"}
            </Text>
            <Button mt="sm" onClick={draft.rebase}>
              核对后使用最新版本作为保存基线
            </Button>
          </Alert>
        )}
        <Fieldset
          disabled={!draft.ready || !!draft.recovered || command.isPending}
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
                <Textarea
                  label="空间与连续性说明"
                  autosize
                  minRows={2}
                  value={values.spatialNotes}
                  onChange={(e) => set("spatialNotes", e.currentTarget.value)}
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
                <div className={classes.grid}>
                  <Textarea
                    label="入口状态"
                    autosize
                    minRows={2}
                    value={values.entry}
                    onChange={(e) => set("entry", e.currentTarget.value)}
                  />
                  <Textarea
                    label="出口状态"
                    autosize
                    minRows={2}
                    value={values.exit}
                    onChange={(e) => set("exit", e.currentTarget.value)}
                  />
                </div>
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
}: {
  tree: Schema<"ContentTree">;
  scripts: Schema<"ScriptRevision">[];
  path: string;
  done: () => void;
}) {
  const current = scripts.find((s) => s.id === tree.currentScriptRevisionId);
  const draft = useContentDraft(
      `${path}/script`,
      { text: current?.text ?? "" },
      tree.revision,
    ),
    command = useCommand<Schema<"ScriptRevision">>();
  const [history, setHistory] = useState<string | null>(null),
    old = scripts.find((s) => s.id === history);
  const conflict = draft.baseVersion !== tree.revision;
  return (
    <Stack gap="lg">
      <DraftNotice draft={draft} />
      <Text c="dimmed">
        每次保存都会新增版本。已经关联到镜头的原文保持不变。
      </Text>
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
      <Textarea
        label="剧本正文"
        minRows={14}
        autosize
        maxRows={26}
        required
        value={draft.value.text}
        disabled={!draft.ready || !!draft.recovered || command.isPending}
        onChange={(e) => draft.setValue({ text: e.currentTarget.value })}
      />
      <ErrorNotice error={command.error} />
      <Button
        variant="filled"
        loading={command.isPending}
        disabled={
          conflict ||
          !draft.ready ||
          !!draft.recovered ||
          !draft.value.text.trim()
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
              onSuccess: () => {
                void draft.clear();
                done();
              },
            },
          )
        }
      >
        保存为第 {(current?.number ?? 0) + 1} 版
      </Button>
      {!!scripts.length && (
        <>
          <Select
            label="查阅历史剧本"
            placeholder="选择版本"
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
