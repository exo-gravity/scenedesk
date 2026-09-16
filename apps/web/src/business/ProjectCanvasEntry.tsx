import { useEffect } from "react";
import { Button, Group, Loader, Stack, Text } from "@mantine/core";
import { ArrowRight, FilmSlate } from "@phosphor-icons/react";
import { useResource, type Schema } from "./api";
import { Empty, ErrorNotice, projectPath, SectionHeading } from "./common";
import classes from "./workbench.module.css";

/** Existing canvases remain reachable while project-scoped creation is added. */
export default function ProjectCanvasEntry({
  tenantId,
  projectId,
}: {
  tenantId: string;
  projectId: string;
}) {
  const path = projectPath(tenantId, projectId);
  const project = useResource<Schema<"Project">>(path);
  const content = useResource<Schema<"ContentTree">>(`${path}/content`);
  const base = `#/app/t/${tenantId}/p/${projectId}`;
  useEffect(() => {
    document.title = "画布 · SceneDesk";
  }, []);
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
    return <Loader aria-label="正在读取画布入口" />;
  const episodes = [...content.data.episodes].sort(
    (a, b) => a.position - b.position,
  );
  const scenes = content.data.scenes;
  return (
    <>
      <SectionHeading
        title="画布"
        description="从已有场次继续画面与视频创作。"
        action={
          <Button component="a" href={`${base}/content`} variant="default">
            管理场次
          </Button>
        }
      />
      {!scenes.length ? (
        <Empty>
          <Stack align="flex-start">
            <Text fw={600}>还没有可用画布</Text>
            <Text>先查看剧本，或从场次开始创作。</Text>
            <Group>
              <Button component="a" href={`${base}/script`}>
                查看剧本
              </Button>
              <Button component="a" href={`${base}/content`} variant="default">
                管理场次
              </Button>
            </Group>
          </Stack>
        </Empty>
      ) : (
        <Stack gap="xl">
          {episodes
            .filter((episode) =>
              scenes.some((scene) => scene.episodeId === episode.id),
            )
            .map((episode) => (
              <section key={episode.id}>
                <Text fw={600} mb="sm">
                  {episode.title}
                  {episode.status === "archived" ? " · 已归档" : ""}
                </Text>
                <div className={classes.rows}>
                  {scenes
                    .filter((scene) => scene.episodeId === episode.id)
                    .sort((a, b) => a.position - b.position)
                    .map((scene) => (
                      <article className={classes.row} key={scene.id}>
                        <Group>
                          <FilmSlate size={22} />
                          <div>
                            <Text fw={500}>{scene.title}</Text>
                            <Text size="xs" c="dimmed">
                              {scene.status === "archived" ||
                              episode.status === "archived" ||
                              project.data?.status === "archived"
                                ? "已归档 · 只读"
                                : "场次画布"}
                            </Text>
                          </div>
                        </Group>
                        <Button
                          component="a"
                          href={`${base}/production?scene=${encodeURIComponent(scene.id)}&mode=canvas`}
                          variant="default"
                          rightSection={<ArrowRight size={16} />}
                        >
                          打开画布
                        </Button>
                      </article>
                    ))}
                </div>
              </section>
            ))}
        </Stack>
      )}
    </>
  );
}
