import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Text,
} from "@mantine/core";
import { ListNumbers, Plus } from "@phosphor-icons/react";
import { useResource, type Schema } from "./api";
import { ErrorNotice, projectPath, tenantPath } from "./common";
import { ContentDraftRetention } from "./content-drafts";
import { StructureEditor } from "./ContentEditors";
import { SceneShotOrder } from "./SceneShotOrder";
import { ShotCandidatesOverview } from "./ShotCandidatesOverview";
import {
  applyClick,
  batchTargets,
  emptySelection,
  hasBatch,
  type ClickModifiers,
  type ListSelection,
} from "./list-selection";
import { ShotResultFocus } from "./ShotResultFocus";
import { SelectedDelivery } from "./SelectedDelivery";
import classes from "./shot-list.module.css";

/** Optional organization surface; the canvas and its drafts remain mounted. */
export function ShotListLauncher({
  tenantId,
  projectId,
  sceneId,
  sourceMediaId,
  initialShotId,
  label = "镜头列表",
  onBeforeOpen,
}: {
  tenantId: string;
  projectId: string;
  sceneId?: string | undefined;
  sourceMediaId?: string | undefined;
  initialShotId?: string | undefined;
  label?: string | undefined;
  onBeforeOpen: () => Promise<void>;
}) {
  const [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState<string>(),
    [error, setError] = useState<Error | null>(null);
  const transitionLock = useRef(false);
  const retainers = useRef(new Set<() => Promise<void>>());
  const register = useCallback((retain: () => Promise<void>) => {
    retainers.current.add(retain);
    return () => {
      retainers.current.delete(retain);
    };
  }, []);
  const transition = async (next: () => void) => {
    if (transitionLock.current) return;
    transitionLock.current = true;
    setBusy(true);
    setError(null);
    try {
      for (const retain of retainers.current) await retain();
      next();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("输入尚未保留。"));
    } finally {
      transitionLock.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        size="xs"
        variant="subtle"
        leftSection={<ListNumbers size={16} />}
        loading={busy}
        onClick={async () => {
          if (transitionLock.current) return;
          transitionLock.current = true;
          setBusy(true);
          setError(null);
          try {
            await onBeforeOpen();
            setSource(sourceMediaId);
            setOpened(true);
          } catch (cause) {
            setError(
              cause instanceof Error ? cause : new Error("画布输入尚未保留。"),
            );
          } finally {
            transitionLock.current = false;
            setBusy(false);
          }
        }}
      >
        {label}
      </Button>
      {error && (
        <Text role="alert" size="xs">
          {error.message}
        </Text>
      )}
      <Modal
        opened={opened}
        onClose={() => void transition(() => setOpened(false))}
        title="镜头列表"
        size="min(1320px, calc(100vw - 48px))"
        centered
        classNames={{
          content: classes.modalContent,
          header: classes.modalHeader,
          body: classes.modalBody,
        }}
      >
        {error && <Text role="alert">{error.message}</Text>}
        <ContentDraftRetention.Provider value={register}>
          {opened && (
            <ShotListWorkspace
              tenantId={tenantId}
              projectId={projectId}
              initialSceneId={sceneId}
              initialShotId={initialShotId}
              sourceMediaId={source}
              transition={transition}
            />
          )}
        </ContentDraftRetention.Provider>
      </Modal>
    </>
  );
}

function ShotListWorkspace({
  tenantId,
  projectId,
  initialSceneId,
  initialShotId,
  sourceMediaId,
  transition,
}: {
  tenantId: string;
  projectId: string;
  initialSceneId?: string | undefined;
  initialShotId?: string | undefined;
  sourceMediaId?: string | undefined;
  transition: (next: () => void) => Promise<void>;
}) {
  const path = projectPath(tenantId, projectId),
    mediaPath = tenantPath(tenantId);
  const project = useResource<Schema<"Project">>(path),
    content = useResource<Schema<"ContentTree">>(`${path}/content`);
  const [sceneId, setSceneId] = useState(initialSceneId ?? ""),
    [selection, setSelection] = useState<ListSelection>(() =>
      initialShotId ? { focused: initialShotId, selected: [initialShotId] } : emptySelection,
    ),
    [creating, setCreating] = useState(false),
    [bulkOpen, setBulkOpen] = useState(false);
  const tree = content.data;
  const scenes = [...(tree?.scenes ?? [])].sort((a, b) => {
    const ea = tree?.episodes.find((e) => e.id === a.episodeId),
      eb = tree?.episodes.find((e) => e.id === b.episodeId);
    return (ea?.position ?? 0) - (eb?.position ?? 0) || a.position - b.position;
  });
  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0];
  const episode = tree?.episodes.find((e) => e.id === scene?.episodeId);
  const shots = (tree?.shots ?? [])
    .filter((s) => s.sceneId === scene?.id)
    .sort((a, b) => a.position - b.position);
  const shot = shots.find((s) => s.id === selection.focused) ?? shots[0];
  // Keep focus pointing at something the list still contains, without touching the
  // batch set: the pane needs a subject, the batch set is the user's own choice.
  useEffect(() => {
    if (shot && selection.focused !== shot.id)
      setSelection((old) => ({ ...old, focused: shot.id }));
  }, [shot?.id, selection.focused]);
  const orderedShots = shots.map((s) => s.id);
  const batch = batchTargets(selection, orderedShots);
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
  if (!project.data || !tree) return <Loader aria-label="正在读取镜头列表" />;
  const active =
    project.data.status === "active" &&
    scene?.status === "active" &&
    episode?.status === "active";
  return (
    <div className={classes.panel}>
      <Group justify="space-between" align="end" className={classes.toolbar}>
        <Select
          label="查看场次"
          value={scene?.id ?? null}
          className={classes.sceneSelect}
          placeholder="先建立所属场次"
          data={scenes.map((s) => ({
            value: s.id,
            label: `${tree.episodes.find((e) => e.id === s.episodeId)?.title ?? ""} · ${s.title}${s.status === "archived" ? "（已归档）" : ""}`,
          }))}
          onChange={(id) =>
            void transition(() => {
              setSceneId(id ?? "");
              setSelection(emptySelection);
              setCreating(false);
            })
          }
        />
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            {shots.length} 镜头 · {shots.filter((s) => s.currentTakeId).length}{" "}
            已选用
          </Text>
          <Button
            size="xs"
            variant="default"
            onClick={() => void content.refetch()}
          >
            刷新列表
          </Button>
          <Button
            size="xs"
            leftSection={<Plus size={14} />}
            disabled={!active}
            onClick={() => void transition(() => setCreating(!creating))}
          >
            新增镜头
          </Button>
          {hasBatch(selection, orderedShots) && (
            <Button
              size="xs"
              variant="default"
              // Navigation only: reviewing several shots' candidates adopts nothing.
              onClick={() => setBulkOpen(true)}
            >
              查看 {batch.length} 个镜头的候选
            </Button>
          )}
        </Group>
      </Group>
      {!scene ? (
        <Alert title="先确定镜头所属场次">
          画布可以独立创作。整理镜头时，可关闭列表，在左上角的画布切换菜单中新增场次，再回到这里。
        </Alert>
      ) : (
        <>
          {!active && (
            <Alert>
              此项目或场次已归档，可查看固定候选及下载已选用原片；恢复后再整理。
            </Alert>
          )}
          <div className={classes.workspace}>
            <aside className={classes.sidebar} aria-label="本场镜头">
              <SceneShotOrder
                key={scene.id}
                path={path}
                tree={tree}
                sceneId={scene.id}
                shots={shots}
                selection={selection}
                active={!!active}
                onSelect={(id: string, modifiers: ClickModifiers) => {
                  const next = applyClick(selection, id, modifiers);
                  // A click that does not move focus leaves the pane exactly as it
                  // is, editor included: nothing is unmounted, so nothing has to be
                  // retained and nothing may be closed.
                  if (next.focused === selection.focused) {
                    setSelection(next);
                    return;
                  }
                  void transition(() => {
                    setSelection(next);
                    setCreating(false);
                  });
                }}
              />
              <div className={classes.delivery}>
                <SelectedDelivery
                  key={scene.id}
                  path={path}
                  sceneId={scene.id}
                  active={!!active}
                  transition={transition}
                />
              </div>
            </aside>
            <section className={classes.focus} aria-label="镜头专注预览">
              {creating && active ? (
                <div className={classes.editorScroll}>
                  <StructureEditor
                    key={scene.id}
                    editing={{ kind: "shot", parentId: scene.id }}
                    tree={tree}
                    path={path}
                    scripts={[]}
                    done={() =>
                      void transition(() => {
                        setCreating(false);
                        void content.refetch();
                      })
                    }
                  />
                </div>
              ) : shot ? (
                <ShotResultFocus
                  key={shot.id}
                  shot={shot}
                  path={path}
                  mediaPath={mediaPath}
                  active={!!active && shot.status === "active"}
                  sourceMediaId={sourceMediaId}
                  transition={transition}
                />
              ) : (
                <Text c="dimmed">
                  本场暂无镜头。可以先创建镜头，再把画布中的视频登记为候选。
                </Text>
              )}
            </section>
          </div>
          <ShotCandidatesOverview
            opened={bulkOpen}
            close={() => setBulkOpen(false)}
            path={path}
            mediaPath={mediaPath}
            shots={shots.filter((s) => batch.includes(s.id))}
            focusedShotId={shot?.id}
            focusShot={(id) => {
              setBulkOpen(false);
              void transition(() =>
                setSelection((old) => applyClick(old, id)),
              );
            }}
          />
        </>
      )}
    </div>
  );
}
