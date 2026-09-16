import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { ListNumbers, Plus } from "@phosphor-icons/react";
import { useResource, type Schema } from "./api";
import { ErrorNotice, projectPath, tenantPath } from "./common";
import { ContentDraftRetention } from "./content-drafts";
import { StructureEditor } from "./ContentEditors";
import { SceneShotOrder } from "./SceneShotOrder";
import { ShotResultFocus } from "./ShotResultFocus";
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
        size="calc(100vw - 48px)"
        classNames={{ body: classes.modalBody }}
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
    [shotId, setShotId] = useState(initialShotId ?? ""),
    [creating, setCreating] = useState(false);
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
  const shot = shots.find((s) => s.id === shotId) ?? shots[0];
  useEffect(() => {
    if (shot && shotId !== shot.id) setShotId(shot.id);
  }, [shot?.id, shotId]);
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
    <Stack gap="md">
      <Group justify="space-between" align="end">
        <Select
          label="所属场次"
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
              setShotId("");
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
        </Group>
      </Group>
      {!scene ? (
        <Alert title="先确定镜头所属场次">
          画布可以独立创作。整理镜头时，请在项目场次管理中建立所属场次，然后回到这里。
        </Alert>
      ) : (
        <>
          {!active && (
            <Alert>
              此项目或场次已归档，可查看固定候选及下载已选用原片；恢复后再整理。
            </Alert>
          )}
          {creating && active ? (
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
          ) : (
            <div className={classes.workspace}>
              <SceneShotOrder
                key={scene.id}
                path={path}
                tree={tree}
                sceneId={scene.id}
                shots={shots}
                selectedId={shot?.id}
                active={!!active}
                onSelect={(id) => void transition(() => setShotId(id))}
              />
              <section className={classes.focus} aria-label="镜头专注预览">
                {shot ? (
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
          )}
        </>
      )}
    </Stack>
  );
}
