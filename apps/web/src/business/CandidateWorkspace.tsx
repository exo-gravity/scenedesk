import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Menu,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FilmStrip, Plus } from "@phosphor-icons/react";
import { useList, useResource, useSession, type Schema } from "./api";
import { Empty, ErrorNotice, projectPath, tenantPath } from "./common";
import { MediaPreview } from "./MediaPreview";
import { CandidateEditor, SelectionEditor } from "./CandidateEditor";
import { sourceSeconds } from "./candidate-time";
import { useAssetPages } from "./asset-queries";
import { StatusLabel } from "../components/workspace/cards";
import classes from "./candidates.module.css";
import { referencePurposes } from "./asset-queries";
import { TakeFeedback } from "./TakeFeedback";
import { ShotPromptComposer } from "./ShotPromptComposer";
type Take = Schema<"Take">;

export default function CandidateWorkspace({
  tenantId,
  projectId,
  embedded = false,
  externalDockOpen = false,
  closeExternalDock,
}: {
  tenantId: string;
  projectId: string;
  embedded?: boolean;
  externalDockOpen?: boolean;
  closeExternalDock?: () => void;
}) {
  const [overview, setOverview] = useState(false);
  const cache = useQueryClient(),
    session = useSession();
  const path = projectPath(tenantId, projectId),
    mediaPath = tenantPath(tenantId);
  const project = useResource<Schema<"Project">>(path),
    content = useResource<Schema<"ContentTree">>(`${path}/content`);
  const query = new URLSearchParams(location.hash.split("?")[1]),
    sceneId = query.get("scene"),
    shotId = query.get("shot"),
    takeId = query.get("take");
  const scene = content.data?.scenes.find((s) => s.id === sceneId),
    episode = content.data?.episodes.find((e) => e.id === scene?.episodeId);
  const shots = content.data?.shots.filter((s) => s.sceneId === sceneId) ?? [];
  const shot = shotId
    ? shots.find((s) => s.id === shotId)
    : (shots.find((s) => s.status === "active") ?? shots[0]);
  const base = `#/app/t/${tenantId}/p/${projectId}`,
    contentHref = `${base}/content?scene=${sceneId ?? ""}`;
  useEffect(() => {
    document.title = `${scene?.title ?? "场次"} · 镜头制作 · scenedesk`;
  }, [scene?.title]);
  if (project.isError || content.isError)
    return (
      <ErrorNotice
        error={project.error ?? content.error}
        retry={() => {
          void project.refetch();
          void content.refetch();
        }}
      />
    );
  if (!project.data || !content.data)
    return <Loader aria-label="正在读取场次" />;
  const active =
    project.data.status === "active" &&
    episode?.status === "active" &&
    scene?.status === "active";
  return (
    <div className={classes.production}>
      {!embedded && (
        <Group justify="space-between">
          <Group>
            <Button
              component="a"
              href={contentHref}
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
                镜头制作 · 分镜
              </Text>
            </div>
          </Group>
          <Group>
            <Button
              component="a"
              href={`${base}/production?scene=${sceneId ?? ""}&mode=canvas`}
            >
              自由画布
            </Button>
            <Button
              onClick={() =>
                void cache.invalidateQueries({
                  queryKey: ["user", session.userId],
                })
              }
            >
              刷新制作状态
            </Button>
            <Button component="a" href={`${base}/media`}>
              导入与管理视频
            </Button>
          </Group>
        </Group>
      )}
      {!scene ? (
        <Empty>指定场次不存在或不属于当前项目。请返回场次目录。</Empty>
      ) : !shot ? (
        <Empty>
          {shotId
            ? "指定镜头不存在于本场次，请在下方重新选择。"
            : "本场尚无镜头，请先在场次目录添加要求。"}
        </Empty>
      ) : (
        <ShotProduction
          key={shot.id}
          tenantId={tenantId}
          path={path}
          mediaPath={mediaPath}
          projectId={projectId}
          shot={shot}
          active={active && shot.status === "active"}
          takeId={takeId}
          externalDockOpen={externalDockOpen}
          closeExternalDock={closeExternalDock}
          href={`${base}/production?scene=${scene.id}&shot=${shot.id}`}
          contentHref={`${base}/content?shot=${shot.id}`}
        />
      )}
      {shot && (
        <ShotPromptComposer
          tenantId={tenantId}
          projectId={projectId}
          shot={shot}
          active={active && shot.status === "active"}
        />
      )}
      {overview && (
        <section className={classes.overview} aria-label="全场分镜总览">
          <Group justify="space-between">
            <Text fw={600}>全场分镜 · {shots.length} 镜</Text>
            <Button
              size="xs"
              variant="subtle"
              onClick={() => setOverview(false)}
            >
              返回当前镜头
            </Button>
          </Group>
          <div className={classes.overviewGrid}>
            {shots.map((s) => (
              <UnstyledButton
                key={s.id}
                component="a"
                href={`${base}/production?scene=${sceneId}&shot=${s.id}`}
                onClick={() => setOverview(false)}
                className={classes.overviewShot}
              >
                <ShotThumbnail
                  path={path}
                  mediaPath={mediaPath}
                  takeId={s.currentTakeId}
                />
                <Text fw={600}>{s.label}</Text>
                <Text size="sm" lineClamp={2}>
                  {s.spec.intent}
                </Text>
              </UnstyledButton>
            ))}
          </div>
        </section>
      )}
      <nav className={classes.strip} aria-label="本场分镜顺序">
        {shots.map((s) => (
          <UnstyledButton
            key={s.id}
            component="a"
            href={`${base}/production?scene=${sceneId}&shot=${s.id}`}
            className={classes.shot}
            data-selected={s.id === shot?.id || undefined}
            aria-current={s.id === shot?.id ? "true" : undefined}
          >
            <ShotThumbnail
              path={path}
              mediaPath={mediaPath}
              takeId={s.currentTakeId}
            />
            <span className={classes.shotText}>
              <Text fw={600}>
                {s.label} {s.status === "archived" ? "· 已归档" : ""}
              </Text>
              <Text size="sm" lineClamp={1}>
                {s.spec.intent}
              </Text>
              <Text size="xs" c="dimmed">
                {s.currentTakeId ? "当前采用" : "尚未采用"}
              </Text>
            </span>
          </UnstyledButton>
        ))}
        <Button
          className={classes.allShots}
          size="xs"
          variant="subtle"
          onClick={() => setOverview(!overview)}
        >
          全场总览
        </Button>
      </nav>
    </div>
  );
}
function ShotProduction({
  tenantId,
  path,
  mediaPath,
  projectId,
  shot,
  active,
  takeId,
  href,
  contentHref,
  externalDockOpen,
  closeExternalDock,
}: {
  tenantId: string;
  path: string;
  mediaPath: string;
  projectId: string;
  shot: Schema<"Shot">;
  active: boolean;
  takeId: string | null;
  href: string;
  contentHref: string;
  externalDockOpen: boolean;
  closeExternalDock?: (() => void) | undefined;
}) {
  const takes = useList<Take>(`${path}/takes?shotId=${shot.id}`),
    history = useList<Schema<"Selection">>(
      `${path}/shots/${shot.id}/selections`,
    );
  const members = useList<Schema<"Membership">>(`${mediaPath}/members`);
  const [dock, setDock] = useState<"candidates" | "media" | "feedback" | null>(
      null,
    ),
    [editor, setEditor] = useState<{ mediaId: string; source?: Take }>(),
    [decision, setDecision] = useState<{ take?: Take }>();
  useEffect(() => {
    if (externalDockOpen) setDock(null);
  }, [externalDockOpen]);
  const openDock = (next: typeof dock) => {
    if (next) closeExternalDock?.();
    setDock(next);
  };
  const take = takeId
    ? takes.data?.find((t) => t.id === takeId)
    : (takes.data?.find((t) => t.id === shot.currentTakeId) ?? takes.data?.[0]);
  const mediaId = editor?.mediaId ?? take?.mediaId;
  const media = useResource<Schema<"Media">>(
    `${mediaPath}/media/${mediaId ?? ""}`,
    !!mediaId,
  );
  const revision = useResource<Schema<"ShotRevision">>(
    `${path}/shots/${shot.id}/revisions/${take?.shotRevisionId ?? ""}`,
    !!take,
  );
  const obsolete = take?.shotRevisionId !== shot.specRevisionId;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <div className={classes.shotProduction}>
      {!active && (
        <Alert>
          此镜头或上级内容已归档，可查看历史。恢复后再建立候选或修改采用。
        </Alert>
      )}
      <Group
        justify="space-between"
        className={classes.previewHeader}
        wrap="nowrap"
      >
        <Group className={classes.previewIdentity} gap="sm" wrap="nowrap">
          <Text component="h1" className={classes.title}>
            {shot.label}
          </Text>
          <Text
            size="sm"
            c="dimmed"
            lineClamp={1}
            title={shot.spec.intent}
            className={classes.shotSummary}
          >
            {shot.spec.intent}
          </Text>
          <StatusLabel>
            {shot.currentTakeId ? "当前采用" : "尚未采用"}
          </StatusLabel>
        </Group>
        <Group gap={4} wrap="nowrap">
          <Button
            size="xs"
            variant="subtle"
            aria-pressed={dock === "candidates"}
            onClick={() =>
              openDock(dock === "candidates" ? null : "candidates")
            }
          >
            候选与历史
          </Button>
          <Menu position="bottom-end">
            <Menu.Target>
              <Button size="xs" variant="subtle">
                镜头操作
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                disabled={!take}
                onClick={() =>
                  openDock(dock === "feedback" ? null : "feedback")
                }
              >
                候选意见
              </Menu.Item>
              <Menu.Item component="a" href={contentHref}>
                镜头要求与历史
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Button
            size="xs"
            variant="default"
            leftSection={<Plus size={15} />}
            disabled={!active}
            onClick={() => openDock("media")}
          >
            从素材建候选
          </Button>
        </Group>
      </Group>
      <div className={classes.workspace} data-dock={dock || undefined}>
        <section className={classes.stage} aria-label="当前镜头制作">
          <ErrorNotice
            error={takes.error ?? media.error}
            retry={() => {
              void takes.refetch();
              void media.refetch();
            }}
          />
          {editor && media.data ? (
            <CandidateEditor
              key={`${shot.id}/${editor.source?.id ?? editor.mediaId}`}
              path={path}
              mediaPath={mediaPath}
              shot={shot}
              media={media.data}
              active={active}
              source={editor.source}
              onClose={() => setEditor(undefined)}
              onCreated={(created) => {
                if (!mounted.current) return;
                setEditor(undefined);
                setDock("candidates");
                location.hash = `${href}&take=${created.id}`;
              }}
            />
          ) : editor ? (
            <Loader aria-label="正在读取候选视频" />
          ) : takeId && !take && takes.data ? (
            <Empty>
              指定候选不存在或不属于当前镜头。请从候选列表重新选择。
            </Empty>
          ) : take ? (
            <div className={classes.takeView}>
              <div className={classes.previewStage}>
                <div
                  className={classes.hero}
                  data-ratio={
                    media.data?.width && media.data.height ? true : undefined
                  }
                  style={
                    media.data?.width && media.data.height
                      ? ({
                          "--ws-media-aspect":
                            media.data.width / media.data.height,
                        } as CSSProperties)
                      : undefined
                  }
                >
                  {media.data ? (
                    <MediaPreview
                      key={take.id}
                      media={media.data}
                      path={mediaPath}
                      range={take.range}
                    />
                  ) : (
                    <Loader aria-label="正在读取候选预览" />
                  )}
                </div>
                {revision.data &&
                  !revision.error &&
                  revision.data.spec.references.length > 0 && (
                    <FixedTakeReferences
                      key={take.id}
                      path={mediaPath}
                      revision={revision.data}
                    />
                  )}
              </div>
              <Group justify="space-between" className={classes.previewCaption}>
                <div>
                  <Text fw={600}>{media.data?.displayName ?? "当前候选"}</Text>
                  <Text size="sm">
                    {sourceSeconds(take.range.inUs)}–
                    {sourceSeconds(take.range.outUs)} 秒 · 连续区间{" "}
                    {sourceSeconds(take.range.outUs - take.range.inUs)} 秒
                  </Text>
                </div>
                <Badge variant="light">
                  {take.id === shot.currentTakeId ? "当前采用" : "未采用此候选"}
                </Badge>
              </Group>
              <Group className={classes.previewActions}>
                <Button
                  variant="filled"
                  disabled={
                    !active ||
                    media.data?.status !== "ready" ||
                    !revision.data ||
                    revision.isError ||
                    (!obsolete && shot.currentTakeId === take.id)
                  }
                  onClick={() =>
                    obsolete
                      ? setEditor({ mediaId: take.mediaId, source: take })
                      : setDecision({ take })
                  }
                >
                  {obsolete ? "核对并沿用到当前要求" : "采用此候选"}
                </Button>
                <Button
                  disabled={!active || media.data?.status !== "ready"}
                  onClick={() =>
                    setEditor({ mediaId: take.mediaId, source: take })
                  }
                >
                  基于此候选另选区间
                </Button>
                <Button
                  disabled={!active || !shot.currentTakeId}
                  onClick={() => setDecision({})}
                >
                  清除当前采用
                </Button>
              </Group>
            </div>
          ) : takes.isPending ? (
            <Loader aria-label="正在读取候选" />
          ) : (
            <div className={classes.empty}>
              <FilmStrip size={40} />
              <Text fw={600}>为这一镜选择一个视频区间</Text>
              <Text c="dimmed">
                已导入的视频可直接成为候选，归档后再明确采用。
              </Text>
              <Button
                variant="filled"
                disabled={!active}
                onClick={() => openDock("media")}
              >
                浏览可用视频
              </Button>
            </div>
          )}
        </section>
        <aside
          className={classes.dock}
          aria-label="制作辅助面板"
          hidden={!dock}
        >
          <Group justify="space-between">
            <Text fw={600}>
              {dock === "media"
                ? "素材浏览"
                : dock === "feedback"
                  ? "候选意见"
                  : "候选与历史"}
            </Text>
            <Button size="xs" variant="subtle" onClick={() => openDock(null)}>
              收起制作面板
            </Button>
          </Group>
          <Group grow>
            <Button
              variant={dock === "candidates" ? "filled" : "default"}
              onClick={() => openDock("candidates")}
            >
              候选与历史
            </Button>
            <Button
              variant={dock === "media" ? "filled" : "default"}
              onClick={() => openDock("media")}
            >
              素材浏览
            </Button>
          </Group>
          <div hidden={dock !== "feedback"}>
            {take && (
              <>
                <details>
                  <summary>
                    候选要求、说明与来源
                    {obsolete ? " · 旧要求，需核对沿用" : " · 当前要求"}
                  </summary>
                  <Stack mt="md">
                    <Text size="xs" c="dimmed">
                      代理播放用于核对；候选保留原视频区间。
                    </Text>
                    <ErrorNotice
                      error={revision.error}
                      retry={() => void revision.refetch()}
                    />
                    <Text size="sm">
                      固定要求{" "}
                      {revision.data
                        ? `v${revision.data.number}：${revision.data.spec.intent}`
                        : "读取中…"}
                    </Text>
                    {take.note && (
                      <Text className={classes.prose}>{take.note}</Text>
                    )}
                    {take.sourceTakeId && (
                      <SourceTake
                        path={path}
                        mediaPath={mediaPath}
                        sourceId={take.sourceTakeId}
                      />
                    )}
                    {obsolete && (
                      <Alert title="这份候选对应旧镜头要求">
                        当前要求：{shot.spec.intent}
                        。确认仍适用后，可新建沿用关系再采用。
                      </Alert>
                    )}
                  </Stack>
                </details>
                {revision.data && !revision.isError && (
                  <TakeFeedback
                    tenantId={tenantId}
                    projectId={projectId}
                    take={take}
                    shot={shot}
                    revision={revision.data}
                    active={active}
                  />
                )}
              </>
            )}
          </div>
          {dock === "feedback" ? null : dock === "media" ? (
            <VideoBrowser
              path={mediaPath}
              projectId={projectId}
              disabled={!active}
              onChoose={(selected) => setEditor({ mediaId: selected.id })}
            />
          ) : (
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                查看候选不会改变采用。
              </Text>
              {takes.data?.map((item) => (
                <UnstyledButton
                  key={item.id}
                  component="a"
                  href={`${href}&take=${item.id}`}
                  onClick={() => setEditor(undefined)}
                  className={classes.candidate}
                  data-selected={(take?.id === item.id && !editor) || undefined}
                  aria-label={`查看候选 ${item.id.slice(0, 8)}`}
                  aria-pressed={take?.id === item.id && !editor}
                >
                  <Text fw={500}>
                    {item.id.slice(0, 8)}{" "}
                    {item.id === shot.currentTakeId ? "· 当前采用" : ""}
                  </Text>
                  <Text size="sm">
                    {sourceSeconds(item.range.inUs)}–
                    {sourceSeconds(item.range.outUs)} 秒 ·{" "}
                    {item.shotRevisionId === shot.specRevisionId
                      ? "当前要求"
                      : "旧要求"}
                  </Text>
                  {item.note && (
                    <Text size="sm" lineClamp={2}>
                      {item.note}
                    </Text>
                  )}
                </UnstyledButton>
              ))}
              {takes.data?.length === 0 && <Text>还没有候选。</Text>}
              <details>
                <summary>
                  采用与清除历史（{history.data?.length ?? "…"}）
                </summary>
                <Stack mt="md" gap="sm">
                  <ErrorNotice
                    error={history.error}
                    retry={() => void history.refetch()}
                  />
                  {history.data
                    ?.slice()
                    .reverse()
                    .map((item) => (
                      <div key={item.id}>
                        <Text size="sm">
                          第 {item.number} 次 ·{" "}
                          {item.takeId
                            ? `采用 ${item.takeId.slice(0, 8)}`
                            : "清除采用"}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {members.data?.find(
                            (m) => m.userId === item.selectedBy,
                          )?.email ??
                            `成员 ${item.selectedBy.slice(0, 8)}`}{" "}
                          ·{" "}
                          {item.createdAt
                            ? new Date(item.createdAt).toLocaleString()
                            : ""}
                        </Text>
                        {item.reason && <Text size="sm">{item.reason}</Text>}
                        {item.takeId && (
                          <Button
                            size="xs"
                            variant="subtle"
                            component="a"
                            href={`${href}&take=${item.takeId}`}
                            onClick={() => setEditor(undefined)}
                          >
                            查看本次候选
                          </Button>
                        )}
                      </div>
                    ))}
                </Stack>
              </details>
            </Stack>
          )}
        </aside>
      </div>
      <Modal
        opened={!!decision}
        onClose={() => setDecision(undefined)}
        title={`${decision?.take ? "确认采用" : "清除当前采用"} · ${shot.label}`}
      >
        {decision && (
          <SelectionEditor
            path={path}
            shot={shot}
            take={decision.take}
            active={active}
            onClose={() => setDecision(undefined)}
          />
        )}
      </Modal>
    </div>
  );
}
function SourceTake({
  path,
  mediaPath,
  sourceId,
}: {
  path: string;
  mediaPath: string;
  sourceId: string;
}) {
  const source = useResource<Take>(`${path}/takes/${sourceId}`);
  const [open, setOpen] = useState(false);
  const media = useResource<Schema<"Media">>(
    `${mediaPath}/media/${source.data?.mediaId ?? ""}`,
    open && !!source.data,
  );
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>来源候选 {sourceId.slice(0, 8)}</summary>
      <ErrorNotice error={source.error ?? media.error} />
      {source.data && (
        <Text size="sm">
          固定区间 {sourceSeconds(source.data.range.inUs)}–
          {sourceSeconds(source.data.range.outUs)} 秒 · {source.data.note}
        </Text>
      )}
      {open && media.data && source.data && (
        <MediaPreview
          media={media.data}
          path={mediaPath}
          range={source.data.range}
        />
      )}
    </details>
  );
}
function VideoBrowser({
  path,
  projectId,
  onChoose,
  disabled,
}: {
  path: string;
  projectId: string;
  onChoose: (media: Schema<"Media">) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState(""),
    [scope, setScope] = useState("project");
  const [search] = useDebouncedValue(query, 250);
  const filters = new URLSearchParams({
    kind: "video",
    status: "ready",
    scope,
    ...(scope === "project" ? { projectId } : {}),
    ...(search ? { q: search } : {}),
  });
  const list = useAssetPages<Schema<"Media">>(`${path}/media?${filters}`);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Stack gap="md">
      <Select
        label="素材范围"
        value={scope}
        onChange={(value) => setScope(value ?? "project")}
        data={[
          { value: "project", label: "本项目视频" },
          { value: "shared", label: "工作室共享视频" },
        ]}
        allowDeselect={false}
      />
      <TextInput
        label="搜索视频"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <ErrorNotice error={list.error} retry={() => void list.refetch()} />
      {list.isPending && <Loader size="sm" aria-label="正在读取视频" />}
      {!list.isPending && !list.isError && !items.length && (
        <Text>此范围暂无可用视频。可从页首进入导入与管理视频。</Text>
      )}
      {items.map((media) => (
        <div key={media.id} className={classes.mediaChoice}>
          <MediaPreview thumbnail media={media} path={path} />
          <Text fw={500}>{media.displayName}</Text>
          <Text size="xs" c="dimmed">
            {sourceSeconds(media.durationUs ?? 0)} 秒
          </Text>
          <Button disabled={disabled} onClick={() => onChoose(media)}>
            选择此视频
          </Button>
        </div>
      ))}
      {list.hasNextPage && (
        <Button
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          加载更多视频
        </Button>
      )}
    </Stack>
  );
}

function ShotThumbnail({
  path,
  mediaPath,
  takeId,
}: {
  path: string;
  mediaPath: string;
  takeId?: string | null | undefined;
}) {
  const take = useResource<Take>(`${path}/takes/${takeId ?? ""}`, !!takeId);
  const media = useResource<Schema<"Media">>(
    `${mediaPath}/media/${take.data?.mediaId ?? ""}`,
    !!take.data,
  );
  return (
    <span className={classes.shotThumbnail}>
      {media.data ? (
        <MediaPreview media={media.data} path={mediaPath} thumbnail />
      ) : (
        <FilmStrip size={18} aria-hidden />
      )}
    </span>
  );
}

/** Preview exactly the references fixed by this Take, never the latest shot. */
function FixedTakeReferences({
  path,
  revision,
}: {
  path: string;
  revision: Schema<"ShotRevision">;
}) {
  const [index, setIndex] = useState(0),
    [open, setOpen] = useState(true);
  const reference =
    revision.spec.references[index] ?? revision.spec.references[0]!;
  const media = useResource<Schema<"Media">>(
    `${path}/media/${reference.mediaId}`,
  );
  return (
    <aside
      className={classes.nearReference}
      data-open={open || undefined}
      aria-label="候选固定参考"
    >
      <Button size="xs" variant="subtle" onClick={() => setOpen(!open)}>
        {open ? "收起参考" : `固定参考 · ${revision.spec.references.length}`}
      </Button>
      <div hidden={!open}>
        <Text size="xs" c="dimmed">
          固定要求 v{revision.number} · {referencePurposes[reference.purpose]}
        </Text>
        <div className={classes.referenceMedia}>
          {media.data && !media.error ? (
            <MediaPreview
              key={reference.mediaId}
              media={media.data}
              path={path}
              thumbnail
            />
          ) : (
            <ErrorNotice
              error={media.error}
              retry={() => void media.refetch()}
            />
          )}
        </div>
        <Text size="xs" lineClamp={2}>
          {reference.note || media.data?.displayName}
        </Text>
        {revision.spec.references.length > 1 && (
          <Group gap={4} mt="xs">
            {revision.spec.references.map((item, i) => (
              <Button
                key={`${item.mediaId}:${i}`}
                size="compact-xs"
                variant={index === i ? "light" : "subtle"}
                aria-pressed={index === i}
                onClick={() => setIndex(i)}
              >
                {referencePurposes[item.purpose]} {i + 1}
              </Button>
            ))}
          </Group>
        )}
      </div>
    </aside>
  );
}
