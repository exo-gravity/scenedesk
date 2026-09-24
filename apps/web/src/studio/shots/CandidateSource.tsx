import { useEffect, useRef, useState } from "react";
import { Text, UnstyledButton } from "@mantine/core";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { ApiError, useResource, type Schema } from "../../business/api";
import { ErrorNotice } from "../../business/common";
import classes from "./shots.module.css";

export function CandidateSource({ path, base, sceneId, mediaId, transition, getNavigationVersion }: {
  path: string;
  base: string;
  sceneId: string;
  mediaId: string;
  getNavigationVersion: () => number | null;
  transition: (next: () => void) => Promise<void>;
}) {
  const project = useResource<Schema<"ProjectCanvas">>(`${path}/canvas`);
  const scene = useResource<Schema<"SceneCanvas">>(`${path}/scenes/${sceneId}/canvas`);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const missing = (error: unknown) => error instanceof ApiError &&
    ["PROJECT_CANVAS_NOT_CREATED", "SCENE_CANVAS_NOT_CREATED"].includes(error.code);
  const error = [scene.error, project.error].find((value) => value && !missing(value));
  const findNode = (canvas?: Schema<"Canvas">) => canvas?.document.nodes.find(
    (node) => node.content.type === "media" && node.content.mediaId === mediaId,
  );
  const node = !error && (findNode(scene.error ? undefined : scene.data?.canvas) ?? findNode(project.error ? undefined : project.data?.canvas));
  const locate = async () => {
    const version = getNavigationVersion();
    if (busy || version === null) return;
    setBusy(true);
    // Verify the current nodes before leaving: a cached source may have moved.
    const [currentScene, currentProject] = await Promise.all([scene.refetch(), project.refetch()]);
    if (!mounted.current) return;
    setBusy(false);
    if (getNavigationVersion() !== version) return;
    if ([currentScene.error, currentProject.error].some((value) => value && !missing(value))) return;
    const sceneNode = findNode(currentScene.error ? undefined : currentScene.data?.canvas);
    const projectNode = findNode(currentProject.error ? undefined : currentProject.data?.canvas);
    const target = sceneNode ?? projectNode;
    if (target) await transition(() => {
      if (mounted.current) location.hash = `${base}?${sceneNode ? `scene=${sceneId}&` : ""}node=${target.id}`;
    });
  };
  if (error) return <ErrorNotice error={error} retry={() => { void scene.refetch(); void project.refetch(); }} />;
  if (scene.isPending || project.isPending) return <Text size="xs" c="dimmed">正在查找创作台来源…</Text>;
  if (!node) return <Text size="xs" c="dimmed">素材不在本场或项目创作台上</Text>;
  return (
    <UnstyledButton className={classes.sourceLink} disabled={busy} onClick={() => void locate()}>
      <ArrowSquareOut size={14} aria-hidden />{busy ? "正在定位…" : "在创作台查看此素材"}
    </UnstyledButton>
  );
}
