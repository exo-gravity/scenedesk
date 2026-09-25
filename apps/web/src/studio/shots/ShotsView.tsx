import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Loader, Modal, Select, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { ArrowLeft, ArrowsDownUp, FilmStrip, Plus } from "@phosphor-icons/react";
import { useList, useResource, type Schema } from "../../business/api";
import { ErrorNotice, projectPath, tenantPath } from "../../business/common";
import { ContentDraftRetention } from "../../business/content-drafts";
import { StructureEditor } from "../../business/ContentEditors";
import { SceneShotOrder } from "../../business/SceneShotOrder";
import { ShotResultFocus } from "../../business/ShotResultFocus";
import { SelectedDelivery } from "../../business/SelectedDelivery";
import { MediaPreview } from "../../business/MediaPreview";
import { emptySelection, type ListSelection } from "../../business/list-selection";
import { CandidateSource } from "./CandidateSource";
import classes from "./shots.module.css";

export function ShotsView({
  tenantId,
  projectId,
  projectActive,
  base,
  sceneParam,
  shotParam,
  mediaParam,
}: {
  tenantId: string;
  projectId: string;
  projectActive: boolean;
  base: string;
  sceneParam: string | undefined;
  shotParam: string | undefined;
  /** A board video brought here to be registered as a candidate. */
  mediaParam: string | undefined;
}) {
  const path = projectPath(tenantId, projectId),
    mediaPath = tenantPath(tenantId);
  const content = useResource<Schema<"ContentTree">>(`${path}/content`);
  const scripts = useList<Schema<"ScriptRevision">>(`${path}/scripts`);
  const tree = content.data;
  const narrow = useMediaQuery("(max-width: 700px)");
  const listRef = useRef<HTMLOListElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef(shotParam);
  const pendingScene = useRef<string | null>(null);
  const focusRoute = useRef<{ sceneId: string; shotId: string | undefined } | null>(null);

  const [selection, setSelection] = useState<ListSelection>(() =>
    shotParam ? { focused: shotParam } : emptySelection,
  );
  const [detailOpen, setDetailOpen] = useState(!!shotParam);
  useEffect(() => {
    if (!narrow) return;
    if (detailOpen) backRef.current?.focus();
    else if (lastFocused.current) listRef.current?.querySelector<HTMLButtonElement>(`[data-shot-id="${lastFocused.current}"]`)?.focus({ preventScroll: true });
  }, [detailOpen, narrow]);
  const [creating, setCreating] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Retain inputs before changing the focused shot, scene or dialog.
  const retainers = useRef(new Set<() => Promise<void>>());
  const register = useCallback((retain: () => Promise<void>) => {
    retainers.current.add(retain);
    return () => {
      retainers.current.delete(retain);
    };
  }, []);
  const lock = useRef(false);
  const navigationVersion = useRef(0);
  const transition = async (next: () => void) => {
    if (lock.current) return;
    lock.current = true;
    navigationVersion.current++;
    setError(null);
    try {
      for (const retain of retainers.current) await retain();
      next();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("输入尚未保留。"));
    } finally {
      lock.current = false;
    }
  };
  const scenes = [...(tree?.scenes ?? [])].sort((a, b) => {
    const ea = tree?.episodes.find((e) => e.id === a.episodeId),
      eb = tree?.episodes.find((e) => e.id === b.episodeId);
    return (ea?.position ?? 0) - (eb?.position ?? 0) || a.position - b.position;
  });
  const scene = scenes.find((s) => s.id === sceneParam) ??
    scenes.find((s) => tree?.shots.some((shot) => shot.id === shotParam && shot.sceneId === s.id)) ?? scenes[0];
  const episode = tree?.episodes.find((e) => e.id === scene?.episodeId);
  const shots = (tree?.shots ?? []).filter((s) => s.sceneId === scene?.id).sort((a, b) => a.position - b.position);
  const firstShotId = shots[0]?.id;
  useEffect(() => {
    if (!scene || (pendingScene.current && pendingScene.current !== scene.id)) return;
    pendingScene.current = null;
    if (focusRoute.current?.sceneId !== scene.id || focusRoute.current?.shotId !== shotParam) {
      focusRoute.current = { sceneId: scene.id, shotId: shotParam };
      setSelection({ focused: shotParam ?? firstShotId });
      setDetailOpen(!!shotParam);
      lastFocused.current = shotParam ?? firstShotId;
    } else if (!selection.focused && firstShotId) setSelection({ focused: firstShotId });
  }, [selection.focused, firstShotId, scene?.id, shotParam]);
  const focused = shots.find((s) => s.id === selection.focused);
  const active = projectActive && scene?.status === "active" && episode?.status === "active";
  const selectedCount = shots.filter((s) => s.status === "active" && s.currentTakeId).length;
  const focusShot = (id: string) => {
    lastFocused.current = id;
    setDetailOpen(true);
    setSelection({ focused: id });
    const query = new URLSearchParams(location.hash.split("?")[1]);
    query.set("shot", id);
    const owner = tree?.shots.find((shot) => shot.id === id)?.sceneId;
    if (owner) query.set("scene", owner);
    history.replaceState(null, "", `${base}/shots?${query}`);
  };
  const showList = () => {
    setDetailOpen(false);
    const query = new URLSearchParams(location.hash.split("?")[1]);
    query.delete("shot");
    history.replaceState(null, "", `${base}/shots${query.size ? `?${query}` : ""}`);
  };
  const goToScene = (id: string | null) => {
    if (scene && focused && (!narrow || detailOpen)) {
      const previous = new URLSearchParams(location.hash.split("?")[1]);
      previous.set("scene", scene.id);
      previous.set("shot", focused.id);
      history.replaceState(null, "", `${base}/shots?${previous}`);
    }
    pendingScene.current = id;
    setCreating(false);
    setOrdering(false);
    setSelection(emptySelection);
    setDetailOpen(false);
    lastFocused.current = undefined;
    location.hash = `${base}/shots${id ? `?scene=${id}` : ""}`;
  };
  if (content.isError)
    return (
      <div className={classes.center}>
        <ErrorNotice error={content.error} retry={() => void content.refetch()} />
      </div>
    );
  if (!tree)
    return (
      <div className={classes.center}>
        <Loader aria-label="正在读取镜头列表" />
      </div>
    );
  return (
    <ContentDraftRetention.Provider value={register}>
      <div className={classes.view}>
        <header className={classes.toolbar}>
          <div className={classes.left}>
            <Select
              aria-label="查看场次"
              variant="unstyled"
              classNames={{ input: classes.scene!, root: classes.sceneRoot! }}
              value={scene?.id ?? null}
              placeholder="先建立所属场次"
              allowDeselect={false}
              data={scenes.map((s) => ({
                value: s.id,
                label: `${tree.episodes.find((e) => e.id === s.episodeId)?.title ?? ""} · ${s.title}${s.status === "archived" ? "（已归档）" : ""}`,
              }))}
              onChange={(id) => void transition(() => goToScene(id))}
            />
            <span className={classes.count}>
              {shots.length} 镜头 · {selectedCount} 已选用
            </span>
          </div>
          <div className={classes.right}>
            {scene && (
              <>
                <Tooltip label={!active ? "恢复项目或场次后可调整顺序" : "至少两个镜头才能调整顺序"} disabled={!!active && shots.length >= 2} events={{ hover: true, focus: true, touch: true }}>
                  <span tabIndex={!active || shots.length < 2 ? 0 : undefined}>
                    <Button size="sm" variant="subtle" leftSection={<ArrowsDownUp size={16} aria-hidden />} disabled={!active || shots.length < 2} onClick={() => void transition(() => setOrdering(true))}>调整顺序</Button>
                  </span>
                </Tooltip>
                <Button size="sm" leftSection={<Plus size={16} aria-hidden />} disabled={!active} onClick={() => void transition(() => setCreating(true))}>新增镜头</Button>
                <SelectedDelivery key={scene.id} path={path} sceneId={scene.id} selectedCount={selectedCount} active={!!active} transition={transition} />
              </>
            )}
          </div>
        </header>
        <ErrorNotice error={error} />
        {mediaParam && (
          <Text size="sm" className={classes.hint}>
            从创作台带来的视频已就绪：打开一个镜头，即可登记为它的候选。
          </Text>
        )}
        {!scene ? (
          <Text c="dimmed">先在剧本或场次目录建立所属场次，再回到这里整理镜头。</Text>
        ) : !shots.length && !selection.focused ? (
          <div className={classes.empty} role="region" aria-label="本场还没有镜头">
            <FilmStrip size={28} aria-hidden />
            <Text component="h2" size="lg" fw={600} c="var(--ws-text)">本场还没有镜头</Text>
            <Text size="sm" c="dimmed">{active ? "从第一个镜头开始，再比较候选、确定选用。" : "恢复项目或场次后，即可添加镜头。"}</Text>
            {active && <Button mt="sm" size="sm" variant="filled" leftSection={<Plus size={16} aria-hidden />} onClick={() => void transition(() => setCreating(true))}>新增镜头</Button>}
          </div>
        ) : (
          <>
            {!active && <Text size="sm" c="dimmed">此项目或场次已归档，可查看固定候选及下载已选用原片；恢复后再整理。</Text>}
            <div className={classes.workspace} data-detail={detailOpen || undefined}>
              <ol ref={listRef} className={classes.list} aria-label="镜头列表">
                {shots.map((shot, index) => (
                  <ShotRow
                    key={shot.id}
                    index={index + 1}
                    shot={shot}
                    path={path}
                    mediaPath={mediaPath}
                    focused={shot.id === focused?.id}
                    open={() => void transition(() => focusShot(shot.id))}
                  />
                ))}
              </ol>
              <section className={classes.detail} aria-label={focused ? `镜头 ${focused.label}` : "镜头详情"}>
                <UnstyledButton ref={backRef} className={classes.back} onClick={() => void transition(showList)}>
                  <ArrowLeft size={16} aria-hidden /> 返回镜头列表
                </UnstyledButton>
                <div className={classes.focus} aria-label="镜头专注预览" role="region">
                  {focused && (!narrow || detailOpen) ? (
                    <ShotResultFocus
                      key={focused.id}
                      shot={focused}
                      path={path}
                      mediaPath={mediaPath}
                      active={!!active && focused.status === "active"}
                      sourceMediaId={mediaParam}
                      transition={transition}
                      emptyAction={<Button size="sm" variant="default" onClick={() => void transition(() => { location.hash = `${base}?scene=${focused.sceneId}`; })}>前往本场创作台</Button>}
                      renderSource={(take) => <CandidateSource key={take.id} path={path} base={base} sceneId={focused.sceneId} mediaId={take.mediaId} transition={transition} getNavigationVersion={() => lock.current ? null : navigationVersion.current} />}
                    />
                  ) : (
                    <div className={classes.empty}>
                      {content.isFetching && <Loader aria-label="正在读取镜头" />}
                      <Text c="dimmed">{content.isFetching ? "正在读取镜头…" : "未找到指定镜头，请从列表重新选择。"}</Text>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </>
        )}
        <Modal opened={ordering && !!scene} onClose={() => void transition(() => setOrdering(false))} title="调整镜头顺序">
          {scene && (
            <SceneShotOrder
              key={scene.id}
              path={path}
              tree={tree}
              sceneId={scene.id}
              shots={shots}
              selection={selection}
              active={!!active}
              onSelect={(id) => void transition(() => { setOrdering(false); focusShot(id); })}
            />
          )}
        </Modal>
        <Modal opened={creating && !!scene} onClose={() => void transition(() => setCreating(false))} title="新增镜头">
          {creating && scene && (
            <StructureEditor
              key={scene.id}
              editing={{ kind: "shot", parentId: scene.id }}
              tree={tree}
              path={path}
              scripts={scripts.data ?? []}
              done={(created) => void transition(() => {
                setCreating(false);
                if (created && "sceneId" in created) {
                  if (created.sceneId !== scene.id) goToScene(created.sceneId);
                  focusShot(created.id);
                }
                void content.refetch();
              })}
            />
          )}
        </Modal>
      </div>
    </ContentDraftRetention.Provider>
  );
}

function seconds(range: Schema<"Range">) {
  return `${((range.outUs - range.inUs) / 1e6).toFixed(1)} s`;
}

function ShotRow({ index, shot, path, mediaPath, focused, open }: {
  index: number;
  shot: Schema<"Shot">;
  path: string;
  mediaPath: string;
  focused: boolean;
  open: () => void;
}) {
  const takes = useList<Schema<"Take">>(`${path}/takes?shotId=${shot.id}`);
  const selected = takes.data?.find((item) => item.id === shot.currentTakeId);
  const preview = selected ?? takes.data?.[0];
  const media = useResource<Schema<"Media">>(`${mediaPath}/media/${preview?.mediaId ?? ""}`, !!preview);
  const outdated = !!selected && selected.shotRevisionId !== shot.specRevisionId;
  return (
    <li className={classes.item}>
      <UnstyledButton className={classes.row} data-shot-id={shot.id} aria-label={`查看镜头 ${shot.label}`} aria-current={focused ? "true" : undefined} onClick={open}>
        <span className={classes.ordinal}>{String(index).padStart(2, "0")}</span>
        <span className={classes.thumb}>
          {media.data && !media.isError && !takes.isError ? <MediaPreview media={media.data} path={mediaPath} thumbnail range={preview?.range} /> : <FilmStrip size={24} aria-hidden />}
        </span>
        <span className={classes.rowContent}>
          <span className={classes.shotLabel}>{shot.label}</span>
          <span className={classes.description}>{shot.spec.intent || "暂无镜头说明"}</span>
          <span className={classes.metadata}>
            {takes.isError ? "候选读取失败" : !takes.data ? "正在读取候选…" : (
              <>{selected ? `已选用${outdated ? " · 旧要求" : ""}` : shot.currentTakeId ? "选用信息待确认" : takes.data.length ? "待选用" : "无候选"} · {takes.data.length} 候选{selected ? ` · ${seconds(selected.range)}` : ""}</>
            )}
            {shot.status === "archived" && " · 已归档"}
          </span>
        </span>
      </UnstyledButton>
    </li>
  );
}
