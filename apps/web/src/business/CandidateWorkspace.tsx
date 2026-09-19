import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  Alert,
  ActionIcon,
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
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CaretLeft,
  CaretRight,
  Check,
  DotsThree,
  FilmStrip,
  Images,
  Plus,
  SquaresFour,
  X,
} from "@phosphor-icons/react";
import { useList, useResource, useSession, type Schema } from "./api";
import { Empty, ErrorNotice, projectPath, tenantPath } from "./common";
import { MediaPreview } from "./MediaPreview";
import { CandidateEditor, SelectionEditor } from "./CandidateEditor";
import { TakeComparison } from "./TakeComparison";
import {
  applyClick,
  batchTargets,
  clearSelection,
  hasBatch,
  isSelected,
  type ListSelection,
} from "./list-selection";
import {
  readSelection,
  subscribeSelections,
  writeSelection,
} from "./list-selection-store";
import { sourceSeconds } from "./candidate-time";
import { useAssetPages } from "./asset-queries";
import classes from "./candidates.module.css";
import { referencePurposes } from "./asset-queries";
import { TakeFeedback } from "./TakeFeedback";
import { ShotPromptComposer } from "./ShotPromptComposer";
import { retainProjectAssistantDrafts } from "./assistant-lifecycle";
type Take = Schema<"Take">;

export default function CandidateWorkspace({
  tenantId,
  projectId,
  embedded = false,
  externalDockOpen = false,
  closeExternalDock,
  selectedShotId,
  onSelectShot,
  onNavigate,
}: {
  tenantId: string;
  projectId: string;
  embedded?: boolean;
  externalDockOpen?: boolean;
  closeExternalDock?: () => void;
  selectedShotId?: string | null;
  onSelectShot?: (id: string) => void;
  onNavigate?: (destination: string) => Promise<void>;
}) {
  const [overview, setOverview] = useState(false);
  const focusRef = useRef<HTMLDivElement>(null),
    stripRef = useRef<HTMLElement>(null),
    overviewToggle = useRef<HTMLButtonElement>(null),
    overviewClose = useRef<HTMLButtonElement>(null);
  const cache = useQueryClient(),
    session = useSession();
  const navigationLock = useRef(false);
  const [browseRevision, setBrowseRevision] = useState(0);
  const [navigationError, setNavigationError] = useState<Error | null>(null);
  const navigate = async (destination: string) => {
    if (navigationLock.current) return;
    navigationLock.current = true;
    setNavigationError(null);
    try {
      if (onNavigate) await onNavigate(destination);
      else {
        await retainProjectAssistantDrafts({
          sessionId: session.id,
          userId: session.userId,
          tenantId,
          projectId,
        });
        location.hash = destination;
      }
      setOverview(false);
      setBrowseRevision((revision) => revision + 1);
      if (overview) overviewToggle.current?.focus();
    } catch (cause) {
      setNavigationError(
        cause instanceof Error ? cause : new Error("输入尚未保留，请重试。"),
      );
    } finally {
      navigationLock.current = false;
    }
  };
  const path = projectPath(tenantId, projectId),
    mediaPath = tenantPath(tenantId);
  const project = useResource<Schema<"Project">>(path),
    content = useResource<Schema<"ContentTree">>(`${path}/content`);
  const query = new URLSearchParams(location.hash.split("?")[1]),
    sceneId = query.get("scene"),
    shotId = query.get("shot") ?? selectedShotId,
    takeId = query.get("take");
  const scene = content.data?.scenes.find((s) => s.id === sceneId),
    episode = content.data?.episodes.find((e) => e.id === scene?.episodeId);
  const shots =
    content.data?.shots
      .filter((s) => s.sceneId === sceneId)
      .sort((a, b) => a.position - b.position) ?? [];
  const shot = shotId
    ? shots.find((s) => s.id === shotId)
    : (shots.find((s) => s.status === "active") ?? shots[0]);
  useEffect(() => {
    if (shot && shot.id !== selectedShotId) onSelectShot?.(shot.id);
  }, [shot?.id, selectedShotId, onSelectShot]);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const reveal = () =>
      strip
        .querySelector<HTMLElement>('[aria-current="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [shot?.id]);
  useEffect(() => {
    if (overview) {
      focusRef.current
        ?.querySelectorAll<HTMLMediaElement>("video, audio")
        .forEach((media) => media.pause());
      overviewClose.current?.focus();
    }
  }, [overview]);
  const closeOverview = () => {
    setOverview(false);
    overviewToggle.current?.focus();
  };
  const shotIndex = shots.findIndex((s) => s.id === shot?.id);
  const base = `#/app/t/${tenantId}/p/${projectId}`,
    contentHref = `${base}/content?scene=${sceneId ?? ""}`;
  useEffect(() => {
    document.title = `${scene?.title ?? "场次"} · 镜头制作 · SceneDesk`;
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
    <div
      className={classes.production}
      onClickCapture={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
          'a[href^="#/app/"]',
        );
        if (!link || link.target === "_blank") return;
        event.preventDefault();
        event.stopPropagation();
        void navigate(link.getAttribute("href")!);
      }}
    >
      <ErrorNotice error={navigationError} />
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
                分镜台
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
      <div ref={focusRef} className={classes.shotFocus} hidden={overview}>
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
            browseRevision={browseRevision}
            externalDockOpen={externalDockOpen}
            closeExternalDock={closeExternalDock}
            href={`${base}/production?scene=${scene.id}&mode=storyboard&shot=${shot.id}`}
            contentHref={`${base}/content?shot=${shot.id}`}
            canvasHref={`${base}/production?scene=${scene.id}&mode=canvas`}
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
      </div>
      {overview && (
        <section
          className={classes.overview}
          aria-label="全场分镜总览"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closeOverview();
            }
          }}
        >
          <Group justify="space-between">
            <div>
              <Text component="h1" className={classes.title}>
                全场总览
              </Text>
              <Text size="sm" c="dimmed">
                {shots.length} 个镜头 ·{" "}
                {shots.filter((s) => s.currentTakeId).length} 个已采用
              </Text>
            </div>
            <Button
              ref={overviewClose}
              size="xs"
              variant="subtle"
              onClick={closeOverview}
            >
              返回当前镜头
            </Button>
          </Group>
          <div className={classes.overviewGrid}>
            {shots.map((s) => (
              <UnstyledButton
                key={s.id}
                component="a"
                href={`${base}/production?scene=${sceneId}&mode=storyboard&shot=${s.id}`}
                onClick={closeOverview}
                className={classes.overviewShot}
                data-selected={s.id === shot?.id || undefined}
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
                <Text size="xs" c="dimmed">
                  {s.status === "archived" ? "已归档 · " : ""}
                  {s.currentTakeId ? "已采用" : "待选候选"}
                </Text>
              </UnstyledButton>
            ))}
          </div>
        </section>
      )}
      <div className={classes.storyboardRail}>
        <Group
          justify="space-between"
          className={classes.railHeader}
          wrap="nowrap"
        >
          <Group gap="xs" wrap="nowrap">
            <Text size="xs" fw={600}>
              本场镜头
            </Text>
            <Text size="xs" c="dimmed" aria-live="polite">
              {shotIndex < 0 ? 0 : shotIndex + 1} / {shots.length}
            </Text>
            <ActionIcon
              variant="subtle"
              aria-label="上一个镜头"
              disabled={shotIndex <= 0}
              onClick={() => {
                const previous = shots[shotIndex - 1];
                if (previous)
                  void navigate(
                    `${base}/production?scene=${sceneId}&mode=storyboard&shot=${previous.id}`,
                  );
              }}
            >
              <CaretLeft size={16} />
            </ActionIcon>
            <ActionIcon
              variant="subtle"
              aria-label="下一个镜头"
              disabled={shotIndex < 0 || shotIndex >= shots.length - 1}
              onClick={() => {
                const next = shots[shotIndex + 1];
                if (next)
                  void navigate(
                    `${base}/production?scene=${sceneId}&mode=storyboard&shot=${next.id}`,
                  );
              }}
            >
              <CaretRight size={16} />
            </ActionIcon>
          </Group>
          <Button
            ref={overviewToggle}
            size="compact-xs"
            variant="subtle"
            leftSection={<SquaresFour size={15} />}
            aria-expanded={overview}
            onClick={() => (overview ? closeOverview() : setOverview(true))}
          >
            {overview ? "返回当前镜头" : "全场总览"}
          </Button>
        </Group>
        <nav
          ref={stripRef}
          className={classes.strip}
          aria-label="本场分镜顺序"
          onKeyDown={(event) => {
            const links = Array.from(
              event.currentTarget.querySelectorAll<HTMLAnchorElement>("a"),
            );
            const index = links.indexOf(event.target as HTMLAnchorElement);
            if (index < 0) return;
            const next =
              event.key === "ArrowRight"
                ? index + 1
                : event.key === "ArrowLeft"
                  ? index - 1
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? links.length - 1
                      : undefined;
            if (next === undefined) return;
            event.preventDefault();
            const link = links[Math.max(0, Math.min(links.length - 1, next))];
            link?.focus();
            link?.click();
          }}
        >
          {shots.map((s) => (
            <UnstyledButton
              key={s.id}
              component="a"
              href={`${base}/production?scene=${sceneId}&mode=storyboard&shot=${s.id}`}
              className={classes.shot}
              data-selected={s.id === shot?.id || undefined}
              aria-current={s.id === shot?.id ? "true" : undefined}
              onClick={() => setOverview(false)}
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
                {!s.currentTakeId && (
                  <Text size="xs" c="dimmed">
                    待选候选
                  </Text>
                )}
              </span>
            </UnstyledButton>
          ))}
        </nav>
      </div>
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
  browseRevision,
  href,
  contentHref,
  canvasHref,
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
  browseRevision: number;
  href: string;
  contentHref: string;
  /** The scene canvas, so a candidate can point back at the node it came from. */
  canvasHref: string;
  externalDockOpen: boolean;
  closeExternalDock?: (() => void) | undefined;
}) {
  const session = useSession();
  const takes = useList<Take>(`${path}/takes?shotId=${shot.id}`),
    history = useList<Schema<"Selection">>(
      `${path}/shots/${shot.id}/selections`,
    );
  const members = useList<Schema<"Membership">>(`${mediaPath}/members`);
  // The store is the state: opening a candidate navigates to its own URL and
  // replaces this surface, so a selection held here would not survive it.
  const selectionKey = `${session.userId}:${path}:${shot.id}:candidates`;
  const candidateSelection = useSyncExternalStore(
    subscribeSelections,
    () => readSelection(selectionKey),
  );
  const [comparingTakes, setComparingTakes] = useState(false);
  const changeSelection = (
    update: (old: ListSelection) => ListSelection,
  ): void => writeSelection(selectionKey, update(readSelection(selectionKey)));
  const [dock, setDock] = useState<
      "candidates" | "media" | "feedback" | "references" | null
    >(null),
    [editor, setEditor] = useState<{ mediaId: string; source?: Take }>(),
    [decision, setDecision] = useState<{ take?: Take }>();
  // Which candidate is on screen. It follows the URL when the URL says so, but a
  // plain click sets it here instead of navigating: navigating replaces this
  // surface, which would drop the batch selection being built beside it.
  const [viewedTakeId, setViewedTakeId] = useState<string | null>(takeId);
  useEffect(() => setViewedTakeId(takeId), [takeId]);
  useEffect(() => setEditor(undefined), [viewedTakeId, browseRevision]);
  useEffect(() => {
    if (externalDockOpen) setDock(null);
  }, [externalDockOpen]);
  const dockOpener = useRef<HTMLElement | null>(null);
  const dockClose = useRef<HTMLButtonElement>(null);
  const openDock = (next: typeof dock) => {
    if (next && !dock)
      dockOpener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    if (next && externalDockOpen) closeExternalDock?.();
    setDock(next);
    requestAnimationFrame(() =>
      next ? dockClose.current?.focus() : dockOpener.current?.focus(),
    );
  };
  const take = viewedTakeId
    ? takes.data?.find((t) => t.id === viewedTakeId)
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
  const adopted = !!take && take.id === shot.currentTakeId;
  const candidateNumber = (id: string) =>
    (takes.data?.findIndex((item) => item.id === id) ?? -1) + 1;
  const takeIds = (takes.data ?? []).map((item) => item.id);
  // Optional cross-reference: a scene without a canvas simply has no source node,
  // and the canvas surface reports its own access problems.
  const sceneCanvas = useResource<Schema<"SceneCanvas">>(
    `${path}/scenes/${shot.sceneId}/canvas`,
  );
  const sourceNode = (takeId: string) =>
    sceneCanvas.data?.bindings.find(
      (binding) => binding.role === "candidate" && binding.takeId === takeId,
    )?.nodeId;
  const selectedTakes = batchTargets(candidateSelection, takeIds).flatMap(
    (id) => {
      const found = takes.data?.find((item) => item.id === id);
      return found ? [found] : [];
    },
  );
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
        </Group>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="查看此候选固定的参考">
            <ActionIcon
              variant="subtle"
              aria-label="固定参考"
              aria-pressed={dock === "references"}
              disabled={
                revision.isError || !revision.data?.spec.references.length
              }
              onClick={() =>
                openDock(dock === "references" ? null : "references")
              }
            >
              <Images size={18} />
            </ActionIcon>
          </Tooltip>
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
                更多
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
              <Menu.Divider />
              <Menu.Item
                disabled={!active || !shot.currentTakeId}
                onClick={() => setDecision({})}
              >
                清除当前采用
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
            新建候选
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
          ) : viewedTakeId && !take && takes.data ? (
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
              </div>
              <Group
                justify="space-between"
                className={classes.previewCaption}
                wrap="nowrap"
              >
                <div className={classes.captionIdentity}>
                  <Text
                    size="sm"
                    fw={500}
                    truncate
                    title={media.data?.displayName}
                  >
                    {media.data?.displayName ?? "正在读取候选"}
                  </Text>
                  <Group gap="xs" wrap="wrap">
                    <Text size="xs" c="dimmed">
                      候选 {candidateNumber(take.id)} ·{" "}
                      {sourceSeconds(take.range.outUs - take.range.inUs)} 秒
                    </Text>
                    <Text size="xs" c="dimmed">
                      区间 {sourceSeconds(take.range.inUs)}–
                      {sourceSeconds(take.range.outUs)} 秒
                    </Text>
                    {revision.data && !revision.isError && (
                      <Text size="xs" c="dimmed">
                        {obsolete ? "旧要求" : "要求"} v{revision.data.number}
                      </Text>
                    )}
                  </Group>
                </div>
                <Group
                  gap="xs"
                  className={classes.previewActions}
                  wrap="nowrap"
                >
                  {adopted && !obsolete ? (
                    <Badge variant="light" leftSection={<Check size={12} />}>
                      当前采用
                    </Badge>
                  ) : (
                    <>
                      <Text size="xs" c="dimmed">
                        {shot.currentTakeId
                          ? `当前采用：候选 ${candidateNumber(shot.currentTakeId)}`
                          : "尚未采用"}
                      </Text>
                      <Button
                        size="xs"
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
                        {obsolete ? "核对并沿用" : "采用此候选"}
                      </Button>
                    </>
                  )}
                  <Menu position="top-end">
                    <Menu.Target>
                      <ActionIcon variant="subtle" aria-label="当前候选操作">
                        <DotsThree size={20} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        disabled={!active || media.data?.status !== "ready"}
                        onClick={() =>
                          setEditor({ mediaId: take.mediaId, source: take })
                        }
                      >
                        基于此候选另选区间
                      </Menu.Item>
                      <Menu.Item onClick={() => openDock("feedback")}>
                        候选意见与来源
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </Group>
            </div>
          ) : takes.isPending ? (
            <Loader aria-label="正在读取候选" />
          ) : (
            <div className={classes.empty}>
              <FilmStrip size={40} />
              <Text fw={600}>为这一镜选择一个视频区间</Text>
              <Text c="dimmed">从素材中选择视频，固定区间后再明确采用。</Text>
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
          className={`${classes.dock} ${classes.productionDock}`}
          aria-label="制作辅助面板"
          hidden={!dock}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // Inner pickers and dialogs consume the first Escape themselves.
              if (
                event.defaultPrevented ||
                (event.target as HTMLElement).closest(
                  '[role="combobox"][aria-expanded="true"], [role="listbox"], [role="dialog"], [role="menu"]',
                )
              )
                return;
              event.stopPropagation();
              openDock(null);
            }
          }}
        >
          <Group justify="space-between">
            <Text fw={600}>
              {dock === "media"
                ? "素材浏览"
                : dock === "feedback"
                  ? "候选意见"
                  : dock === "references"
                    ? "固定参考"
                    : "候选与历史"}
            </Text>
            <ActionIcon
              ref={dockClose}
              variant="subtle"
              aria-label="收起制作面板"
              onClick={() => openDock(null)}
            >
              <X size={18} />
            </ActionIcon>
          </Group>
          <Group gap={4}>
            <Button
              size="xs"
              variant={dock === "candidates" ? "light" : "subtle"}
              onClick={() => openDock("candidates")}
            >
              候选
            </Button>
            <Button
              size="xs"
              variant={dock === "media" ? "light" : "subtle"}
              onClick={() => openDock("media")}
            >
              素材
            </Button>
            <Button
              size="xs"
              variant={dock === "references" ? "light" : "subtle"}
              disabled={
                revision.isError || !revision.data?.spec.references.length
              }
              onClick={() => openDock("references")}
            >
              参考
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
          {dock === "feedback" ? null : dock === "references" ? (
            revision.isError ? (
              <ErrorNotice
                error={revision.error}
                retry={() => void revision.refetch()}
              />
            ) : revision.data && !!revision.data.spec.references.length ? (
              <FixedTakeReferences
                key={take?.id}
                path={mediaPath}
                revision={revision.data}
              />
            ) : (
              <Text size="sm" c="dimmed">
                此候选没有固定参考。
              </Text>
            )
          ) : dock === "media" ? (
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
              <Text size="xs" c="dimmed">
                按住 Shift 或 Command 点击可多选，用于并列比较。
              </Text>
              {hasBatch(candidateSelection, takeIds) && (
                <Group
                  justify="space-between"
                  className={classes.candidateSelection}
                >
                  <Text size="xs">
                    已选 {batchTargets(candidateSelection, takeIds).length} 份候选
                  </Text>
                  <Group gap="xs">
                    <Button size="xs" onClick={() => setComparingTakes(true)}>
                      比较所选候选
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => changeSelection(clearSelection)}
                    >
                      清除选择
                    </Button>
                  </Group>
                </Group>
              )}
              {takes.data?.map((item, index) => (
                <UnstyledButton
                  key={item.id}
                  component="a"
                  href={`${href}&take=${item.id}`}
                  onClick={(event) => {
                    const extend =
                      event.shiftKey || event.metaKey || event.ctrlKey;
                    // Neither click navigates: the viewed candidate is component
                    // state, and the URL is kept in step without a navigation so a
                    // browsed link stays shareable.
                    event.preventDefault();
                    setEditor(undefined);
                    if (!extend) {
                      setViewedTakeId(item.id);
                      window.history.replaceState(
                        null,
                        "",
                        `${href}&take=${item.id}`,
                      );
                    }
                    changeSelection((old) =>
                      applyClick(old, item.id, { extend }),
                    );
                  }}
                  className={classes.candidate}
                  data-selected={(take?.id === item.id && !editor) || undefined}
                  data-batch={isSelected(candidateSelection, item.id) ? "true" : undefined}
                  aria-label={`查看候选 ${index + 1}`}
                  title="按住 Shift 或 Command 点击可多选"
                  aria-pressed={take?.id === item.id && !editor}
                >
                  <CandidateSummary
                    mediaPath={mediaPath}
                    take={item}
                    number={index + 1}
                    adopted={item.id === shot.currentTakeId}
                  />
                  <Text size="xs" c="dimmed">
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
                  {sourceNode(item.id) && (
                    <Text
                      size="xs"
                      component="a"
                      href={`${canvasHref}&node=${sourceNode(item.id)}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      在画布上查看来源节点
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
                            ? `采用候选 ${candidateNumber(item.takeId) || "（不可用）"}`
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
      {comparingTakes && selectedTakes.length > 1 && (
        <TakeComparison
          path={path}
          mediaPath={mediaPath}
          shotLabel={shot.label}
          takes={selectedTakes}
          close={() => setComparingTakes(false)}
        />
      )}
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
function CandidateSummary({
  mediaPath,
  take,
  number,
  adopted,
}: {
  mediaPath: string;
  take: Take;
  number: number;
  adopted: boolean;
}) {
  const media = useResource<Schema<"Media">>(
    `${mediaPath}/media/${take.mediaId}`,
  );
  return (
    <div className={classes.candidateSummary}>
      <div className={classes.candidateThumbnail}>
        {media.data ? (
          <MediaPreview media={media.data} path={mediaPath} thumbnail />
        ) : (
          <FilmStrip size={20} aria-hidden />
        )}
      </div>
      <div className={classes.candidateIdentity}>
        <Group gap="xs">
          <Text size="sm" fw={600}>
            候选 {number}
          </Text>
          {adopted && (
            <Badge size="xs" variant="light">
              当前采用
            </Badge>
          )}
        </Group>
        <Text size="xs" lineClamp={2}>
          {media.data?.displayName ??
            (media.error ? "素材暂不可用" : "正在读取素材…")}
        </Text>
      </div>
    </div>
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
        <Text>此范围暂无可用视频。可从顶部「素材」导入视频。</Text>
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
  const [index, setIndex] = useState(0);
  const reference =
    revision.spec.references[index] ?? revision.spec.references[0]!;
  const media = useResource<Schema<"Media">>(
    `${path}/media/${reference.mediaId}`,
  );
  return (
    <aside className={classes.nearReference} aria-label="候选固定参考">
      <Text size="xs" c="dimmed">
        保留此候选建立时的参考 · 要求 v{revision.number}
      </Text>
      <div>
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
