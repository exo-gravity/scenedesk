import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { ArrowDown, ArrowUp, X } from "@phosphor-icons/react";
import { useList, useResource, type Schema } from "./api";
import { ErrorNotice } from "./common";
import {
  fixedShotSources,
  moveShotSource,
  selectShotSource,
  type ShotSource,
} from "./canvas-shot-sources";
import classes from "./image-generation.module.css";

/** These references belong to this generation draft, not to canvas bindings or navigation. */
export function CanvasShotSources({
  path,
  projectId,
  sceneId,
  sources,
  disabled,
  onChange,
  compact = false,
}: {
  path: string;
  projectId: string;
  sceneId: string | undefined;
  sources: readonly ShotSource[] | undefined;
  disabled: boolean;
  onChange: (sources: ShotSource[]) => void;
  /** One quiet row: the count only when there is one, the guidance only while choosing. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  let selected: ShotSource[];
  try {
    selected = fixedShotSources(sources);
  } catch (cause) {
    return (
      <Alert title="镜头来源需要核对">
        {cause instanceof Error
          ? cause.message
          : "原来源无法读取，请保留草稿。"}
      </Alert>
    );
  }
  return (
    <Stack gap="sm" aria-label="本次镜头来源">
      <Group justify="space-between" wrap="nowrap">
        {compact ? (
          <Text size="sm" {...(selected.length ? {} : { c: "dimmed" })}>
            镜头来源{selected.length ? ` · ${selected.length}` : ""}
          </Text>
        ) : (
          <Text fw={500}>镜头来源 · {selected.length} / 100</Text>
        )}
        <Button
          variant="subtle"
          {...(compact ? { size: "compact-xs" } : {})}
          disabled={disabled}
          onClick={() => setOpen(!open)}
        >
          {compact ? (open ? "收起" : selected.length ? "修改" : "选择") : open ? "收起来源选择" : "选择镜头来源"}
        </Button>
      </Group>
      {(!compact || open) && (
        <Text size="xs" c="dimmed">
          可不选镜头，独立探索。加入后固定该版要求与参考；上下顺序就是本次输入顺序。
        </Text>
      )}
      {!compact && !selected.length && <Text size="sm">不使用镜头来源</Text>}
      {selected.length > 0 && (
        <Stack gap="sm" className={classes.sourceList}>
          {selected.map((source, index) => (
            <SelectedSource
              key={`${source.shotId}:${source.shotRevisionId}`}
              path={path}
              projectId={projectId}
              source={source}
              index={index}
            >
              <Group gap="xs">
                <ActionIcon
                  variant="subtle"
                  aria-label={`上移来源 ${index + 1}`}
                  disabled={disabled || index === 0}
                  onClick={() => onChange(moveShotSource(selected, index, -1))}
                >
                  <ArrowUp size={16} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  aria-label={`下移来源 ${index + 1}`}
                  disabled={disabled || index === selected.length - 1}
                  onClick={() => onChange(moveShotSource(selected, index, 1))}
                >
                  <ArrowDown size={16} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  aria-label={`移除来源 ${index + 1}`}
                  disabled={disabled}
                  onClick={() =>
                    onChange(selected.filter((_, i) => i !== index))
                  }
                >
                  <X size={16} />
                </ActionIcon>
              </Group>
            </SelectedSource>
          ))}
        </Stack>
      )}
      {open && !disabled && (
        <SourcePicker
          path={path}
          projectId={projectId}
          currentSceneId={sceneId}
          sources={selected}
          onChange={onChange}
        />
      )}
    </Stack>
  );
}

function SelectedSource({
  path,
  projectId,
  source,
  index,
  children,
}: {
  path: string;
  projectId: string;
  source: ShotSource;
  index: number;
  children: React.ReactNode;
}) {
  const query = useResource<Schema<"ShotRevision">>(
    `${path}/shots/${source.shotId}/revisions/${source.shotRevisionId}`,
  );
  const revision =
    !query.isFetching &&
    !query.error &&
    query.data?.id === source.shotRevisionId &&
    query.data.shotId === source.shotId &&
    query.data.projectId === projectId
      ? query.data
      : undefined;
  return (
    <Stack
      gap={4}
      className={classes.sourceItem}
      aria-label={`已选来源 ${index + 1}`}
    >
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={500}>
          来源 {index + 1}
          {revision ? ` · 第 ${revision.number} 版` : " · 固定版本"}
        </Text>
        {children}
      </Group>
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      {query.isFetching ? (
        <Text size="xs" c="dimmed">
          正在核对原版本…
        </Text>
      ) : revision ? (
        <Text size="sm" lineClamp={2} className={classes.prose}>
          {revision.spec.intent}
        </Text>
      ) : (
        !query.error && (
          <Text size="sm">原版本尚不可读取，已选来源仍保留。</Text>
        )
      )}
      <details>
        <summary>查看固定来源</summary>
        <Stack gap={4} mt="xs">
          <Text size="xs" className={classes.prose}>
            镜头：{source.shotId} · 修订：{source.shotRevisionId}
          </Text>
          {revision && <ShotSpecSummary spec={revision.spec} />}
        </Stack>
      </details>
    </Stack>
  );
}

function SourcePicker({
  path,
  projectId,
  currentSceneId,
  sources,
  onChange,
}: {
  path: string;
  projectId: string;
  currentSceneId: string | undefined;
  sources: ShotSource[];
  onChange: (sources: ShotSource[]) => void;
}) {
  const tree = useResource<Schema<"ContentTree">>(`${path}/content`);
  const [sceneId, setSceneId] = useState<string | null>(currentSceneId ?? null),
    [shot, setShot] = useState<Schema<"Shot">>();
  // Hide cached text while authority/current availability is being checked. The
  // selected references above survive a failed browse and are never reset to [].
  if (tree.error)
    return <ErrorNotice error={tree.error} retry={() => void tree.refetch()} />;
  if (tree.isFetching || !tree.data) return <Loader size="sm" />;
  const scenes = tree.data.scenes
    .filter(
      (scene) => scene.projectId === projectId && scene.status === "active",
    )
    .sort(
      (a, b) =>
        Number(b.id === currentSceneId) - Number(a.id === currentSceneId) ||
        a.position - b.position ||
        a.id.localeCompare(b.id),
    );
  const shots = tree.data.shots
    .filter(
      (item) =>
        item.projectId === projectId &&
        item.sceneId === sceneId &&
        item.status === "active",
    )
    .sort((a, b) => a.position - b.position);
  const currentShot = shots.find((item) => item.id === shot?.id);
  return (
    <Stack gap="sm" aria-label="选择固定镜头版本">
      <Select
        label="来源场次"
        searchable
        value={sceneId}
        data={scenes.map((scene) => ({
          value: scene.id,
          label: `${scene.id === currentSceneId ? "当前场次 · " : ""}${tree.data!.episodes.find((e) => e.id === scene.episodeId)?.title ?? ""} / ${scene.title}`,
        }))}
        onChange={(id) => {
          setSceneId(id);
          setShot(undefined);
        }}
      />
      <Select
        label="来源镜头"
        searchable
        value={shot?.id ?? null}
        data={shots.map((item) => ({ value: item.id, label: item.label }))}
        onChange={(id) => setShot(shots.find((item) => item.id === id))}
        nothingFoundMessage="该场次暂无可用镜头"
      />
      {shot && currentShot && (
        <RevisionPicker
          key={shot.id}
          path={path}
          projectId={projectId}
          shot={shot}
          sources={sources}
          onChange={onChange}
        />
      )}
      {shot && !currentShot && (
        <Text size="sm">刚才浏览的镜头已不可选择，已有固定来源仍保留。</Text>
      )}
    </Stack>
  );
}

function RevisionPicker({
  path,
  projectId,
  shot,
  sources,
  onChange,
}: {
  path: string;
  projectId: string;
  shot: Schema<"Shot">;
  sources: ShotSource[];
  onChange: (sources: ShotSource[]) => void;
}) {
  const history = useList<Schema<"ShotRevision">>(
      `${path}/shots/${shot.id}/revisions`,
    ),
    existing = sources.find((source) => source.shotId === shot.id);
  // Capture the pointer only when the user opens this shot, never on a GET refresh.
  const [revisionId, setRevisionId] = useState<string | null>(
      existing?.shotRevisionId ?? shot.specRevisionId,
    ),
    [error, setError] = useState<string>();
  const revision =
    !history.isFetching && !history.error
      ? history.data?.find(
          (item) =>
            item.id === revisionId &&
            item.shotId === shot.id &&
            item.projectId === projectId,
        )
      : undefined;
  const same = existing?.shotRevisionId === revisionId;
  return (
    <Stack gap="sm">
      <ErrorNotice error={history.error} retry={() => void history.refetch()} />
      <Select
        label="固定镜头版本"
        value={revisionId}
        disabled={history.isFetching || !!history.error}
        data={
          history.error || history.isFetching
            ? []
            : [...(history.data ?? [])]
                .filter(
                  (item) =>
                    item.shotId === shot.id && item.projectId === projectId,
                )
                .sort((a, b) => b.number - a.number)
                .map((item) => ({
                  value: item.id,
                  label: `第 ${item.number} 版${item.id === shot.specRevisionId ? " · 打开时的当前版本" : ""}`,
                }))
        }
        onChange={setRevisionId}
      />
      {history.isFetching && <Loader size="sm" />}
      {revision && <ShotSpecSummary spec={revision.spec} />}
      {error && <Alert title="来源尚未加入">{error}</Alert>}
      <Button
        variant="default"
        disabled={!revision || same || (!existing && sources.length >= 100)}
        onClick={() => {
          if (!revision) return;
          try {
            onChange(
              selectShotSource(sources, {
                shotId: shot.id,
                shotRevisionId: revision.id,
              }),
            );
            setError(undefined);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "请核对来源。");
          }
        }}
      >
        {same
          ? "已固定此版本"
          : existing
            ? "替换此镜头的固定版本"
            : "加入本次来源"}
      </Button>
      <Text size="xs" c="dimmed">
        浏览不会更改已选来源；替换版本保留它在列表中的位置。
      </Text>
    </Stack>
  );
}

function ShotSpecSummary({ spec }: { spec: Schema<"ShotSpec"> }) {
  return (
    <Stack gap={4}>
      <Text size="sm" className={classes.prose}>
        {spec.intent}
      </Text>
      {spec.action && (
        <Text size="sm" className={classes.prose}>
          动作：{spec.action}
        </Text>
      )}
      {spec.camera && (
        <Text size="xs" className={classes.prose}>
          机位：{spec.camera}
        </Text>
      )}
      <Text size="xs" c="dimmed">
        该版镜头参考 {spec.references.length} 个 · 对白{" "}
        {spec.dialogue?.length ?? 0} 句
      </Text>
    </Stack>
  );
}

/** Historical plans display their own snapshots even if a source is deleted. */
export function FixedPlanShotSources({
  resolved,
}: {
  resolved: Schema<"ResolvedInput">;
}) {
  return (
    <details>
      <summary>固定镜头来源（{resolved.shots.length} 个）</summary>
      <Stack gap="sm" mt="sm" aria-label="计划原镜头来源">
        {!resolved.shots.length && (
          <Text size="sm">本计划不使用镜头来源。</Text>
        )}
        {resolved.shots.map((shot, index) => (
          <Stack gap={4} key={shot.shotId} className={classes.sourceItem}>
            <Text size="sm" fw={500}>
              来源 {index + 1}
            </Text>
            <ShotSpecSummary spec={shot.spec} />
            <Text size="xs" className={classes.prose}>
              镜头：{shot.shotId} · 固定修订：{shot.shotRevisionId}
            </Text>
          </Stack>
        ))}
        {resolved.references.length > 0 && (
          <details>
            <summary>
              查看实际固定参考（{resolved.references.length} 个）
            </summary>
            <Stack gap="xs" mt="xs">
              {resolved.references.map((item, index) => (
                <Text size="xs" className={classes.prose} key={index}>
                  参考 {index + 1} · {item.reference.purpose} ·{" "}
                  {item.reference.note ?? ""} · 素材 {item.reference.mediaId}
                  {item.reference.assetRevisionId
                    ? ` · 资产修订 ${item.reference.assetRevisionId}`
                    : ""}
                  {item.shotId ? ` · 镜头 ${item.shotId}` : ""}
                </Text>
              ))}
            </Stack>
          </details>
        )}
      </Stack>
    </details>
  );
}
