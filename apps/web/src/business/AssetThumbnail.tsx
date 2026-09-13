import { useEffect, useRef, useState } from "react";
import { ImageSquare } from "@phosphor-icons/react";
import { Skeleton, Text } from "@mantine/core";
import { useResource, type Schema } from "./api";
import { assetKinds } from "./asset-queries";
import { MediaPreview } from "./MediaPreview";
import classes from "./assets.module.css";

function useVisiblePreview() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, visible };
}

export function AssetMediaThumbnail({
  path,
  mediaId,
}: {
  path: string;
  mediaId: string;
}) {
  const { ref, visible } = useVisiblePreview();
  const media = useResource<Schema<"Media">>(
    `${path}/media/${mediaId}`,
    visible,
  );
  return (
    <div ref={ref} className={classes.thumbnailSurface}>
      {media.data && !media.isError ? (
        <MediaPreview key={mediaId} path={path} media={media.data} thumbnail />
      ) : media.isError ? (
        <span className={classes.previewPlaceholder}>
          <ImageSquare size={28} aria-hidden />
          <span>参考暂不可读</span>
        </span>
      ) : (
        <Skeleton
          height="100%"
          width="100%"
          radius={0}
          aria-label="正在读取参考预览"
        />
      )}
    </div>
  );
}

export function AssetGalleryItem({
  asset,
  path,
  href,
}: {
  asset: Schema<"Asset">;
  path: string;
  href: string;
}) {
  const { ref, visible } = useVisiblePreview();
  const revision = useResource<Schema<"AssetRevision">>(
    `${path}/asset-revisions/${asset.currentRevisionId ?? ""}`,
    visible && !!asset.currentRevisionId,
  );
  const fixed =
    !revision.isError &&
    revision.data?.assetId === asset.id &&
    revision.data.id === asset.currentRevisionId
      ? revision.data
      : undefined;
  const mediaId = fixed?.definition.references[0]?.mediaId;
  return (
    <a
      className={classes.galleryItem}
      href={href}
      aria-label={`查看资产 ${asset.name}`}
    >
      <div ref={ref} className={classes.galleryPreview}>
        {mediaId ? (
          <AssetMediaThumbnail path={path} mediaId={mediaId} />
        ) : (
          <span className={classes.previewPlaceholder}>
            <ImageSquare size={36} aria-hidden />
            <span>
              {revision.isError
                ? "参考暂不可读"
                : !asset.currentRevisionId
                  ? "待建立首版"
                  : fixed
                    ? "文字设定"
                    : "正在读取设定"}
            </span>
          </span>
        )}
      </div>
      <div className={classes.galleryCaption}>
        <Text component="span" fw={600} className={classes.galleryTitle}>
          {asset.name}
        </Text>
        <Text component="span" size="xs" c="dimmed">
          {assetKinds[asset.kind]}
          {fixed ? ` · v${fixed.number}` : ""}
          {asset.status === "archived" ? " · 已归档" : ""}
        </Text>
        <Text component="span" size="sm" c="dimmed" lineClamp={2}>
          {asset.description ||
            fixed?.definition.description ||
            "打开查看设定与参考"}
        </Text>
      </div>
    </a>
  );
}
