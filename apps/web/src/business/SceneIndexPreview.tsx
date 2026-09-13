import { Anchor, Text } from "@mantine/core";
import { FilmSlate } from "@phosphor-icons/react";
import { useResource, type Schema } from "./api";
import { MediaPreview } from "./MediaPreview";
import layout from "./content.module.css";

/** The directory shows a real adopted frame, never an arbitrary candidate. */
export function SceneIndexPreview({
  path,
  href,
  shot,
  title,
}: {
  path: string;
  href: string;
  shot: Schema<"Shot"> | undefined;
  title: string;
}) {
  const take = useResource<Schema<"Take">>(
    `${path}/takes/${shot?.currentTakeId ?? ""}`,
    !!shot?.currentTakeId,
  );
  const mediaPath = path.split("/projects/")[0]!;
  const media = useResource<Schema<"Media">>(
    `${mediaPath}/media/${take.data?.mediaId ?? ""}`,
    !!take.data?.mediaId && !take.isError,
  );
  return (
    <Anchor
      href={href}
      className={layout.scenePreview}
      aria-label={`进入${title}制作`}
    >
      {media.data && !media.isError && !take.isError ? (
        <MediaPreview thumbnail media={media.data} path={mediaPath} />
      ) : (
        <div className={layout.scenePlaceholder}>
          <FilmSlate size={28} />
          <Text size="xs">
            {take.isError || media.isError
              ? "预览暂不可用"
              : shot?.currentTakeId
                ? "正在读取画面"
                : "等待第一帧"}
          </Text>
        </div>
      )}
    </Anchor>
  );
}
