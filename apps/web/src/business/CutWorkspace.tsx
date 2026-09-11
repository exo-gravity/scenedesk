import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { ArrowLeft, Plus } from "@phosphor-icons/react";
import { type WorkDocument, type WorkClip } from "@drama/domain";
import { ApiError, useCommand, useList, useResource, type Schema } from "./api";
import { DraftNotice, useContentDraft } from "./content-drafts";
import { Empty, ErrorNotice, projectPath, tenantPath } from "./common";
import { useCutWork } from "./use-cut-work";
import {
  type CutWorkController,
  type WorkEditorState,
} from "./cut-work-controller";
import { parseSourceSeconds, sourceSeconds } from "./candidate-time";
import { MediaPreview } from "./MediaPreview";
import {
  CutSources,
  CutRecovery,
  CutHistory,
  CutConflict,
} from "./CutWorkPanels";
import classes from "./candidates.module.css";
import cutClasses from "./cuts.module.css";
import { CutDialoguePanel, CutPendingEdits } from "./CutDialoguePanel";
import { CutLocalRecoveryPanel } from "./CutLocalRecoveryPanel";

export default function CutWorkspace({
  tenantId,
  projectId,
}: {
  tenantId: string;
  projectId: string;
}) {
  const path = projectPath(tenantId, projectId),
    query = new URLSearchParams(location.hash.split("?")[1]);
  const sceneId = query.get("scene"),
    cutId = query.get("cut");
  const project = useResource<Schema<"Project">>(path),
    content = useResource<Schema<"ContentTree">>(`${path}/content`);
  const cuts = useList<Schema<"Cut">>(
    `${path}/cuts?sceneId=${sceneId ?? ""}`,
    !!sceneId,
  );
  const requested = useResource<Schema<"Cut">>(
    `${path}/cuts/${cutId ?? ""}`,
    !!cutId,
  );
  const requestedError =
    requested.error instanceof ApiError && requested.error.status === 404
      ? null
      : requested.error;
  const [create, setCreate] = useState(false);
  const scene = content.data?.scenes.find((s) => s.id === sceneId),
    episode = content.data?.episodes.find((e) => e.id === scene?.episodeId);
  const base = `#/app/t/${tenantId}/p/${projectId}`,
    href = `${base}/editing?scene=${sceneId ?? ""}`;
  useEffect(() => {
    document.title = `${scene?.title ?? "场次"} · 剪辑 · 幕序`;
  }, [scene?.title]);
  if (project.error || content.error || cuts.error || requestedError)
    return (
      <ErrorNotice
        error={project.error ?? content.error ?? cuts.error ?? requestedError}
        retry={() => {
          void project.refetch();
          void content.refetch();
          void cuts.refetch();
          if (cutId) void requested.refetch();
        }}
      />
    );
  if (
    !project.data ||
    !content.data ||
    (sceneId && !cuts.data) ||
    (cutId && requested.isPending)
  )
    return <Loader aria-label="正在读取场次剪辑" />;
  const cut = cutId
    ? requested.data?.sceneId === sceneId && !requested.error
      ? requested.data
      : undefined
    : cuts.data?.[0];
  const choices =
    cut && !cuts.data?.some((c) => c.id === cut.id)
      ? [...(cuts.data ?? []), cut]
      : (cuts.data ?? []);
  const active =
    project.data.status === "active" &&
    scene?.status === "active" &&
    episode?.status === "active";
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Group>
          <Button
            component="a"
            href={`${base}/content?scene=${sceneId ?? ""}`}
            variant="subtle"
            leftSection={<ArrowLeft size={16} />}
          >
            场次目录
          </Button>
          <div>
            <Text fw={600}>
              {project.data.name} / {episode?.title} /{" "}
              {scene?.title ?? "场次不可用"}
            </Text>
            <Text size="sm" c="dimmed">
              剪辑 · 工作稿
            </Text>
          </div>
        </Group>
        <Group>
          <Button
            component="a"
            href={`${base}/production?scene=${sceneId ?? ""}`}
          >
            镜头制作
          </Button>
          <Button component="a" href={`${base}/media`}>
            素材
          </Button>
        </Group>
      </Group>
      {!scene ? (
        <Empty>指定场次不在当前项目中，请返回场次目录。</Empty>
      ) : (
        <>
          <Group justify="space-between">
            <Select
              label="本场剪辑"
              value={cut?.id ?? null}
              data={choices.map((c) => ({
                value: c.id,
                label: c.name,
              }))}
              onChange={(id) => {
                if (id) location.hash = `${href}&cut=${id}`;
              }}
              placeholder="尚未建立剪辑"
            />
            <Button
              disabled={!active}
              leftSection={<Plus size={16} />}
              onClick={() => setCreate(true)}
            >
              新建剪辑
            </Button>
          </Group>
          {cut ? (
            <CutEditor
              key={cut.id}
              tenantId={tenantId}
              projectId={projectId}
              cut={cut}
              sceneId={scene.id}
              active={!!active && cut.status === "active"}
              href={`${href}&cut=${cut.id}`}
            />
          ) : (
            <Empty>
              {cutId
                ? "指定剪辑不存在于本场次。请重新选择。"
                : "建立剪辑后，可以从候选或素材加入画面、声音和字幕。"}
            </Empty>
          )}
          <Modal
            title={`新建剪辑 · ${scene.title}`}
            opened={create}
            onClose={() => setCreate(false)}
          >
            {create && (
              <NewCut
                key={scene.id}
                path={path}
                scene={scene}
                active={!!active}
                done={(created) => {
                  setCreate(false);
                  location.hash = `${href}&cut=${created.id}`;
                }}
              />
            )}
          </Modal>
        </>
      )}
    </Stack>
  );
}
function NewCut({
  path,
  scene,
  active,
  done,
}: {
  path: string;
  scene: Schema<"Scene">;
  active: boolean;
  done: (cut: Schema<"Cut">) => void;
}) {
  const draft = useContentDraft(
      `${path}/cuts/new/${scene.id}`,
      { name: `${scene.title} · 初剪` },
      scene.revision,
    ),
    save = useCommand<Schema<"Cut">>();
  if (draft.committed) return <DraftNotice draft={draft} />;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (
          !active ||
          !draft.ready ||
          draft.recovered ||
          !draft.value.name.trim()
        )
          return;
        save.mutate(
          {
            path: `${path}/cuts`,
            body: { sceneId: scene.id, name: draft.value.name.trim() },
          },
          { onCommitted: (cut) => void draft.complete(() => done(cut)) },
        );
      }}
    >
      <Stack>
        <DraftNotice draft={draft} />
        <ErrorNotice error={save.error} />
        <TextInput
          label="剪辑名称"
          value={draft.value.name}
          maxLength={160}
          disabled={
            !active || !draft.ready || !!draft.recovered || save.isPending
          }
          onChange={(e) => draft.setValue({ name: e.currentTarget.value })}
        />
        <Button
          type="submit"
          variant="filled"
          loading={save.isPending}
          disabled={
            !active ||
            !draft.ready ||
            !!draft.recovered ||
            !draft.value.name.trim()
          }
        >
          建立空白剪辑
        </Button>
      </Stack>
    </form>
  );
}
function CutEditor({
  tenantId,
  projectId,
  sceneId,
  cut,
  active,
  href,
}: {
  tenantId: string;
  projectId: string;
  sceneId: string;
  cut: Schema<"Cut">;
  active: boolean;
  href: string;
}) {
  const { controller, state, error, retry } = useCutWork(
    tenantId,
    projectId,
    cut.id,
  );
  const [tool, setTool] = useState<
    "source" | "history" | "issues" | "dialogue" | "local" | null
  >(() =>
    new URLSearchParams(location.hash.split("?")[1]).get("tool") === "dialogue"
      ? "dialogue"
      : null,
  );
  const path = projectPath(tenantId, projectId),
    mediaPath = tenantPath(tenantId);
  const clipId = new URLSearchParams(location.hash.split("?")[1]).get("clip");
  if (error) return <ErrorNotice error={error} retry={retry} />;
  if (!controller || !state || state.phase === "loading")
    return <Loader aria-label="正在核对工作稿和本机恢复" />;
  if (state.phase === "forbidden")
    return (
      <Alert title="访问权限已失效">
        已停止编辑并清除工作稿显示。
        <ErrorNotice error={state.storageError} />
      </Alert>
    );
  if (!state.local)
    return (
      <ErrorNotice
        error={state.error}
        retry={() => void controller.initialize()}
      />
    );
  const document = state.local.document;
  const clips = document.timeline.tracks.flatMap<WorkClip>((t) => t.items);
  const clip = clipId ? clips.find((c) => c.id === clipId) : clips[0];
  const blocked =
    !active ||
    !!state.recovery ||
    state.recoveryBlocked ||
    state.phase === "discarding";
  const update = (next: WorkDocument) => controller.edit(next);
  return (
    <Stack
      gap="md"
      onCompositionStart={() => controller.setComposing(true)}
      onCompositionEnd={() => controller.setComposing(false)}
    >
      <CutRecovery controller={controller} state={state} />
      {!active && (
        <Alert title="当前场次或剪辑已归档">
          可查阅已保存内容，恢复后才能继续编辑。
        </Alert>
      )}
      <Group justify="space-between" align="start">
        <Stack gap="xs">
          <Text fw={600}>{cut.name}</Text>
          <WorkSaveStatus state={state} />
          <Text size="xs" c="dimmed">
            工作稿 r{state.local.base.revision} · 已确认编排 r
            {state.remote?.currentCutRevision} · 当前尚未生成固定审阅稿
          </Text>
        </Stack>
        <Group>
          <Button
            onClick={() => setTool(tool === "source" ? null : "source")}
            disabled={blocked}
          >
            加入片段
          </Button>
          <Button
            onClick={() => setTool(tool === "history" ? null : "history")}
          >
            恢复历史
          </Button>
          <Button onClick={() => setTool(tool === "issues" ? null : "issues")}>
            待处理 {state.remote?.issues.length ?? 0}
          </Button>
          <Button onClick={() => setTool(null)} disabled={!clip}>
            片段设置
          </Button>
          <Button
            onClick={() => setTool(tool === "dialogue" ? null : "dialogue")}
          >
            对白与声音
          </Button>
          <Button onClick={() => setTool(tool === "local" ? null : "local")}>
            本机恢复管理
          </Button>
          <Button
            onClick={() => void controller.save()}
            disabled={
              blocked || state.phase === "conflict" || state.hasInvalidInput
            }
            loading={state.phase === "saving" || state.phase === "checking"}
          >
            保存工作稿
          </Button>
        </Group>
      </Group>
      <ErrorNotice
        error={state.error}
        retry={() => void controller.refresh()}
      />
      {state.phase === "conflict" && (
        <CutConflict
          key={state.local.base.revision}
          controller={controller}
          state={state}
        />
      )}
      <div className={classes.workspace}>
        <Stack className={classes.stage} gap="md">
          {clip && clip.kind !== "subtitle" ? (
            <CutClipPreview key={clip.mediaId} path={mediaPath} clip={clip} />
          ) : (
            <div className={classes.empty}>
              <Text fw={600}>
                {clip?.kind === "subtitle"
                  ? "字幕文字"
                  : "从画面开始组接这一场"}
              </Text>
              <Text className={classes.prose}>
                {clip?.kind === "subtitle"
                  ? clip.text || "这条字幕暂未填写文字"
                  : "选择已验收的视频或本场候选，再明确加入工作稿。"}
              </Text>
            </div>
          )}
          <Text size="xs" c="dimmed">
            当前显示所选源片段。声音混合、字幕烧录及整场成片须完成归一和渲染后查看。
          </Text>
        </Stack>
        <aside className={classes.dock} aria-label="剪辑工具">
          {tool === "source" ? (
            <CutSources
              controller={controller}
              state={state}
              path={path}
              mediaPath={mediaPath}
              projectId={projectId}
              sceneId={sceneId}
              href={href}
              disabled={blocked}
            />
          ) : tool === "history" ? (
            <CutHistory
              controller={controller}
              state={state}
              path={`${path}/cuts/${cut.id}`}
              disabled={blocked}
            />
          ) : tool === "local" ? (
            <CutLocalRecoveryPanel
              controller={controller}
              close={() => setTool(null)}
            />
          ) : tool === "dialogue" ? (
            <CutDialoguePanel
              controller={controller}
              state={state}
              path={path}
              mediaPath={mediaPath}
              projectId={projectId}
              sceneId={sceneId}
              {...(clip ? { clipId: clip.id } : {})}
              disabled={blocked}
              href={href}
            />
          ) : tool === null && clip ? (
            <fieldset className={classes.fieldset} disabled={blocked}>
              <ClipFields
                key={clip.id}
                controller={controller}
                state={state}
                clip={clip}
              />
            </fieldset>
          ) : (
            <>
              <Text fw={600}>编排检查</Text>
              <Text size="sm">
                工作稿允许保留空白、重叠和待处理事项。保存工作稿不会修改已确认编排。
              </Text>
              {state.dirty && (
                <Text size="sm">
                  以下检查来自服务器 r{state.remote?.revision}
                  ，本机修改保存后重新计算。
                </Text>
              )}
              {(state.remote?.issues ?? []).map((issue, index) => (
                <Stack key={`${issue.code}:${index}`} gap="xs">
                  <Text size="sm">{issue.message}</Text>
                  {issue.clipIds.map((id) => (
                    <Button
                      key={id}
                      component="a"
                      href={`${href}&clip=${id}`}
                      variant="subtle"
                      size="xs"
                    >
                      定位片段 {id.slice(0, 8)}
                    </Button>
                  ))}
                </Stack>
              ))}
              <Checkbox
                label="在最终渲染中烧录字幕"
                checked={document.timeline.burnSubtitles}
                disabled={blocked}
                onChange={(e) =>
                  update({
                    ...document,
                    timeline: {
                      ...document.timeline,
                      burnSubtitles: e.currentTarget.checked,
                    },
                  })
                }
              />
              <CutPendingEdits
                controller={controller}
                state={state}
                disabled={blocked}
                href={href}
              />
            </>
          )}
        </aside>
      </div>
      <nav aria-label="剪辑轨道与片段" className={cutClasses.tracks}>
        <Stack gap="xs">
          {document.timeline.tracks.map((track, index) => (
            <div key={track.id}>
              <Group>
                <Text fw={500}>
                  {index + 1} ·{" "}
                  {track.kind === "video"
                    ? "画面"
                    : track.kind === "audio"
                      ? "声音"
                      : "字幕"}
                </Text>
                <Checkbox
                  label="整轨静音／隐藏"
                  checked={track.muted}
                  disabled={blocked}
                  onChange={(e) => {
                    const muted = e.currentTarget.checked;
                    update({
                      ...document,
                      timeline: {
                        ...document.timeline,
                        tracks: document.timeline.tracks.map((t) =>
                          t.id === track.id ? { ...t, muted } : t,
                        ),
                      },
                    });
                  }}
                />
              </Group>
              <div className={`${classes.strip} ${cutClasses.strip}`}>
                {!track.items.length && (
                  <Text size="sm" c="dimmed">
                    空轨道
                  </Text>
                )}
                {track.items.map((item, ordinal) => (
                  <UnstyledButton
                    component="a"
                    key={item.id}
                    href={`${href}&clip=${item.id}`}
                    className={classes.shot}
                    data-selected={item.id === clip?.id || undefined}
                    aria-current={item.id === clip?.id ? "true" : undefined}
                  >
                    <Text fw={600}>
                      {ordinal + 1} ·{" "}
                      {item.kind === "subtitle"
                        ? "字幕"
                        : item.takeId
                          ? `候选 ${item.takeId.slice(0, 8)}`
                          : item.kind === "video"
                            ? "视频片段"
                            : "声音片段"}
                    </Text>
                    <Text size="sm" lineClamp={2}>
                      {item.kind === "subtitle"
                        ? item.text || "待填写"
                        : `${sourceSeconds(item.range.inUs)}–${sourceSeconds(item.range.outUs)} 秒`}
                    </Text>
                    <Text size="xs" c="dimmed">
                      放置于 {sourceSeconds(item.timelineStartUs)} 秒
                    </Text>
                  </UnstyledButton>
                ))}
              </div>
            </div>
          ))}
        </Stack>
      </nav>
    </Stack>
  );
}
function WorkSaveStatus({ state }: { state: WorkEditorState }) {
  const status = state.recovery
    ? "本机有待核对的工作"
    : state.phase === "saving"
      ? "正在保存工作稿"
      : state.local?.pending
        ? "保存结果待核对"
        : state.phase === "conflict"
          ? "有新版本，需要比较"
          : state.storageError
            ? "本机保留未完成"
            : state.hasInvalidInput
              ? "输入尚未完成 · 暂停自动保存"
              : state.dirty
                ? state.localSaved
                  ? "本机已保留 · 待同步"
                  : "正在保留本机修改"
                : state.localSaved
                  ? "工作稿已保存"
                  : "正在核对本机恢复";
  return (
    <Badge variant="light" aria-live="polite">
      {status}
    </Badge>
  );
}
function CutClipPreview({
  path,
  clip,
}: {
  path: string;
  clip: Schema<"WorkMediaClip">;
}) {
  const media = useResource<Schema<"Media">>(`${path}/media/${clip.mediaId}`);
  if (media.error)
    return (
      <ErrorNotice error={media.error} retry={() => void media.refetch()} />
    );
  if (!media.data) return <Loader aria-label="正在读取片段来源" />;
  return (
    <Stack gap="xs">
      <MediaPreview
        media={media.data}
        path={path}
        range={clip.range.outUs > clip.range.inUs ? clip.range : undefined}
      />
      <Text size="sm">
        {media.data.displayName}
        {clip.streamSelection === "embedded_audio" ? " · 使用视频内嵌声音" : ""}
      </Text>
    </Stack>
  );
}
function ClipFields({
  controller,
  state,
  clip,
}: {
  controller: CutWorkController;
  state: WorkEditorState;
  clip: WorkClip;
}) {
  const document = state.local!.document;
  const replace = (next: WorkClip) =>
    ({
      ...document,
      timeline: {
        ...document.timeline,
        tracks: document.timeline.tracks.map((t) => ({
          ...t,
          items: t.items.map((item) => (item.id === clip.id ? next : item)),
        })),
      },
    }) as WorkDocument;
  const time = (
    field: string,
    label: string,
    current: number,
    change: (value: number) => WorkClip,
    valid: (value: number) => boolean = () => true,
  ) => {
    const key = `${clip.id}:${field}`,
      buffer = state.local!.buffers[key];
    return (
      <TextInput
        key={key}
        label={label}
        inputMode="decimal"
        value={buffer?.value ?? sourceSeconds(current)}
        error={
          buffer && !buffer.valid
            ? "请输入非负秒数，最多六位小数，源区间不能反向。"
            : undefined
        }
        onChange={(e) => {
          const value = e.currentTarget.value,
            parsed = parseSourceSeconds(value),
            accepted = parsed !== undefined && valid(parsed);
          controller.buffer(
            key,
            { value, valid: accepted },
            accepted ? replace(change(parsed)) : document,
          );
        }}
        onBlur={() => {
          if (controller.getSnapshot().local?.buffers[key]?.valid)
            controller.buffer(key, null);
        }}
      />
    );
  };
  return (
    <Stack gap="md">
      <Text fw={600}>片段设置 · {clip.id.slice(0, 8)}</Text>
      {time("start", "放置起点（秒）", clip.timelineStartUs, (value) => ({
        ...clip,
        timelineStartUs: value,
      }))}
      {clip.kind === "subtitle" ? (
        <>
          {time("duration", "字幕时长（秒）", clip.durationUs, (value) => ({
            ...clip,
            durationUs: value,
          }))}
          <Textarea
            label="字幕文字"
            autosize
            minRows={2}
            maxRows={6}
            value={clip.text}
            onChange={(e) =>
              controller.edit(replace({ ...clip, text: e.currentTarget.value }))
            }
          />
        </>
      ) : (
        <>
          <Group grow align="start">
            {time(
              "in",
              "源起点（秒）",
              clip.range.inUs,
              (value) => ({ ...clip, range: { ...clip.range, inUs: value } }),
              (value) => value <= clip.range.outUs,
            )}
            {time(
              "out",
              "源终点（秒）",
              clip.range.outUs,
              (value) => ({ ...clip, range: { ...clip.range, outUs: value } }),
              (value) => value >= clip.range.inUs,
            )}
          </Group>
          <Checkbox
            label={
              clip.kind === "video"
                ? "静音视频原声（整条混合音轨）"
                : "静音此声音片段"
            }
            checked={clip.muted}
            onChange={(e) =>
              controller.edit(
                replace({ ...clip, muted: e.currentTarget.checked }),
              )
            }
          />
          <TextInput
            label="声音增益（dB）"
            inputMode="decimal"
            value={
              state.local!.buffers[`${clip.id}:gain`]?.value ??
              String(clip.gainDb)
            }
            error={
              state.local!.buffers[`${clip.id}:gain`]?.valid === false
                ? "请输入 -96 至 12 的有限数值。"
                : undefined
            }
            onChange={(e) => {
              const value = e.currentTarget.value,
                parsed = Number(value),
                valid =
                  /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) &&
                  Number.isFinite(parsed) &&
                  parsed >= -96 &&
                  parsed <= 12;
              controller.buffer(
                `${clip.id}:gain`,
                { value, valid },
                valid ? replace({ ...clip, gainDb: parsed }) : document,
              );
            }}
            onBlur={() => {
              const key = `${clip.id}:gain`;
              if (controller.getSnapshot().local?.buffers[key]?.valid)
                controller.buffer(key, null);
            }}
          />
          {clip.kind === "video" && (
            <Select
              label="画面适配"
              value={clip.fit ?? "contain"}
              data={[
                { value: "contain", label: "保留完整画幅" },
                { value: "cover", label: "填满并裁切画幅" },
              ]}
              onChange={(value) => {
                if (value === "contain" || value === "cover")
                  controller.edit(replace({ ...clip, fit: value }));
              }}
            />
          )}
          {clip.takeId && (
            <Text size="sm">
              明确使用候选 {clip.takeId.slice(0, 8)}
              {clip.selectionId
                ? ` · 采用记录 ${clip.selectionId.slice(0, 8)}`
                : ""}
              。采用变化不会替换本片段。
            </Text>
          )}
        </>
      )}
      <Button
        variant="subtle"
        onClick={() => {
          const next: WorkDocument = {
            ...document,
            timeline: {
              ...document.timeline,
              tracks: document.timeline.tracks.map((t) => ({
                ...t,
                items: t.items.filter((c) => c.id !== clip.id),
              })) as WorkDocument["timeline"]["tracks"],
            },
            timingOrigins: document.timingOrigins.filter(
              (o) => o.clipId !== clip.id,
            ),
          };
          controller.edit(
            next,
            Object.fromEntries(
              Object.entries(state.local!.buffers).filter(
                ([key]) => !key.startsWith(`${clip.id}:`),
              ),
            ),
          );
        }}
      >
        移除此片段，保留待核对的对白关联
      </Button>
    </Stack>
  );
}
