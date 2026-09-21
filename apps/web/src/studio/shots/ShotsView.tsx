import { useCallback, useRef, useState } from "react";
import { Drawer, Loader, Modal, Select, Text, UnstyledButton } from "@mantine/core";
import { ArrowsDownUp, Crosshair, Plus } from "@phosphor-icons/react";
import { api, useList, useResource, type Schema } from "../../business/api";
import { ErrorNotice, projectPath, tenantPath } from "../../business/common";
import { ContentDraftRetention } from "../../business/content-drafts";
import { StructureEditor } from "../../business/ContentEditors";
import { SceneShotOrder } from "../../business/SceneShotOrder";
import { ShotResultFocus } from "../../business/ShotResultFocus";
import { SelectedDelivery } from "../../business/SelectedDelivery";
import { MediaPreview } from "../../business/MediaPreview";
import { applyClick, emptySelection, type ListSelection } from "../../business/list-selection";
import classes from "./shots.module.css";

/**
 * The shot organiser: one scene's shots as a table (number, duration,
 * description, source, candidates, selection), each opening its candidates
 * and selection in a drawer. Selection and handoff stay explicit actions on
 * the existing components; the table only changes how the facts look.
 */
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
  const tree = content.data;
  const [selection, setSelection] = useState<ListSelection>(() =>
    shotParam ? { focused: shotParam } : emptySelection,
  );
  const [creating, setCreating] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Unsaved inputs in the drawer or the order dialog are retained before anything closes.
  const retainers = useRef(new Set<() => Promise<void>>());
  const register = useCallback((retain: () => Promise<void>) => {
    retainers.current.add(retain);
    return () => {
      retainers.current.delete(retain);
    };
  }, []);
  const lock = useRef(false);
  const transition = async (next: () => void) => {
    if (lock.current) return;
    lock.current = true;
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
  const scene = scenes.find((s) => s.id === sceneParam) ?? scenes[0];
  const episode = tree?.episodes.find((e) => e.id === scene?.episodeId);
  const shots = (tree?.shots ?? []).filter((s) => s.sceneId === scene?.id).sort((a, b) => a.position - b.position);
  const focused = shots.find((s) => s.id === selection.focused);
  const active = projectActive && scene?.status === "active" && episode?.status === "active";
  const goToScene = (id: string | null) => {
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
              {shots.length} 镜头 · {shots.filter((s) => s.currentTakeId).length} 已选用
            </span>
          </div>
          <div className={classes.right}>
            {scene && (
              <>
                <UnstyledButton className={classes.pill} disabled={!active || shots.length < 2} onClick={() => void transition(() => setOrdering(true))}>
                  <ArrowsDownUp size={14} aria-hidden /> 调整顺序
                </UnstyledButton>
                <UnstyledButton className={classes.pill} disabled={!active} onClick={() => void transition(() => setCreating(true))}>
                  <Plus size={14} aria-hidden /> 新增镜头
                </UnstyledButton>
                <SelectedDelivery key={scene.id} path={path} sceneId={scene.id} active={!!active} transition={transition} />
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
        ) : (
          <>
            {!active && <Text size="sm" c="dimmed">此项目或场次已归档，可查看固定候选及下载已选用原片；恢复后再整理。</Text>}
            <table className={classes.table} aria-label="镜头列表">
              <thead>
                <tr>
                  <th className={classes.number}>镜号</th>
                  <th className={classes.duration}>时长</th>
                  <th>画面描述</th>
                  <th>来源</th>
                  <th className={classes.candidates}>候选</th>
                  <th className={classes.selected}>选用</th>
                  <th className={classes.actions}>操作</th>
                </tr>
              </thead>
              <tbody>
                {shots.map((shot, index) => (
                  <ShotRow
                    key={shot.id}
                    index={index + 1}
                    shot={shot}
                    path={path}
                    mediaPath={mediaPath}
                    base={base}
                    open={() => void transition(() => setSelection(applyClick(selection, shot.id)))}
                    onError={setError}
                  />
                ))}
              </tbody>
            </table>
            {!shots.length && (
              <Text c="dimmed" size="sm">
                本场暂无镜头。可以先新增镜头，再把创作台上的视频登记为候选。
              </Text>
            )}
          </>
        )}
        <Drawer
          opened={!!focused}
          onClose={() => void transition(() => setSelection(emptySelection))}
          position="right"
          size="min(720px, 100%)"
          title={focused ? `镜头 ${focused.label}` : ""}
        >
          {focused && scene && (
            <section aria-label="镜头专注预览">
              <ShotResultFocus
                key={focused.id}
                shot={focused}
                path={path}
                mediaPath={mediaPath}
                active={!!active && focused.status === "active"}
                sourceMediaId={mediaParam}
                transition={transition}
              />
            </section>
          )}
        </Drawer>
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
              onSelect={(id) => void transition(() => { setOrdering(false); setSelection(applyClick(selection, id)); })}
            />
          )}
        </Modal>
        <Modal opened={creating && !!scene} onClose={() => void transition(() => setCreating(false))} title="新增镜头">
          {scene && (
            <StructureEditor
              key={scene.id}
              editing={{ kind: "shot", parentId: scene.id }}
              tree={tree}
              path={path}
              scripts={[]}
              done={() => void transition(() => { setCreating(false); void content.refetch(); })}
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

function ShotRow({
  index,
  shot,
  path,
  mediaPath,
  base,
  open,
  onError,
}: {
  index: number;
  shot: Schema<"Shot">;
  path: string;
  mediaPath: string;
  base: string;
  open: () => void;
  onError: (error: Error | null) => void;
}) {
  const takes = useList<Schema<"Take">>(`${path}/takes?shotId=${shot.id}`);
  const selection = useResource<Schema<"SelectionState">>(`${path}/shots/${shot.id}/selection`);
  const current = selection.data?.currentSelection;
  const take = takes.data?.find((item) => item.id === current?.takeId);
  const media = useResource<Schema<"Media">>(`${mediaPath}/media/${take?.mediaId ?? ""}`, !!take);
  const outdated = !!take && take.shotRevisionId !== shot.specRevisionId;
  const [locating, setLocating] = useState(false);
  // Candidate → board: the selected take's media is looked for on the project board.
  const locate = async () => {
    if (!take) return;
    setLocating(true);
    onError(null);
    try {
      const canvas = await api<Schema<"ProjectCanvas">>(`${path}/canvas`, { signal: AbortSignal.timeout(15000) });
      const node = canvas.canvas.document.nodes.find(
        (item) => item.content.type === "media" && item.content.mediaId === take.mediaId,
      );
      if (!node) throw new Error("这段素材现在不在项目创作台上。");
      location.hash = `${base}?node=${node.id}`;
    } catch (cause) {
      onError(cause instanceof Error ? cause : new Error("暂时无法定位到创作台。"));
    } finally {
      setLocating(false);
    }
  };
  return (
    <tr className={classes.row} data-archived={shot.status === "archived" || undefined}>
      <td className={classes.number}>
        <span className={classes.label}>{index}</span>
        <span className={classes.shotLabel}>{shot.label}</span>
        {shot.status === "archived" && <span className={classes.tag}>已归档</span>}
      </td>
      <td className={classes.duration}>{take ? seconds(take.range) : "—"}</td>
      <td className={classes.description}>{shot.spec.intent || <span className={classes.muted}>—</span>}</td>
      <td className={classes.source}>{media.data ? media.data.displayName : take ? "…" : <span className={classes.muted}>—</span>}</td>
      <td className={classes.candidates}>{takes.data ? takes.data.length : "…"}</td>
      <td className={classes.selected}>
        {take ? (
          <span className={classes.selection}>
            <span className={classes.thumb}>
              {media.data && media.data.id === take.mediaId ? <MediaPreview media={media.data} path={mediaPath} thumbnail /> : null}
            </span>
            <span>已选用{outdated ? " · 旧要求" : ""}</span>
          </span>
        ) : (
          <span className={classes.muted}>未选用</span>
        )}
      </td>
      <td className={classes.actions}>
        <UnstyledButton className={classes.action} aria-label={`打开镜头 ${shot.label}`} onClick={open}>
          打开
        </UnstyledButton>
        {take && (
          <UnstyledButton
            className={classes.action}
            aria-label={`在创作台定位 ${shot.label} 的选用来源`}
            disabled={locating}
            onClick={() => void locate()}
          >
            <Crosshair size={14} aria-hidden /> 定位
          </UnstyledButton>
        )}
      </td>
    </tr>
  );
}
