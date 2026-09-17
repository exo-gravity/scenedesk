import { lazy, Suspense, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Loader, Stack, Text } from "@mantine/core";
import {
  ImageSquare,
  FilmStrip,
  MusicNotes,
  FileText,
} from "@phosphor-icons/react";
import { useSession, type Schema } from "./api";
import { mediaPost } from "./media-imports";
import { ErrorNotice } from "./common";
import classes from "./media.module.css";
const Player = lazy(() => import("../components/workspace/MediaPlayer"));
export const mediaKind = {
  image: "图片",
  video: "视频",
  audio: "音频",
  document: "文档",
};
export const mediaStatus = {
  processing: "正在验收",
  ready: "原文件可用",
  rejected: "验收未通过",
  archived: "已归档",
};
export function MediaSymbol({ kind }: { kind: Schema<"Media">["kind"] }) {
  const Symbol = {
    image: ImageSquare,
    video: FilmStrip,
    audio: MusicNotes,
    document: FileText,
  }[kind];
  return <Symbol size={32} aria-hidden />;
}
export function MediaPreview({
  media,
  path,
  thumbnail = false,
  range,
  fit = false,
}: {
  media: Schema<"Media">;
  path: string;
  thumbnail?: boolean;
  range?: Schema<"Range"> | undefined;
  fit?: boolean;
}) {
  const session = useSession(),
    [playbackError, setPlaybackError] = useState(false),
    [reloadKey, setReloadKey] = useState(0);
  const time = useRef(0),
    renewedUrl = useRef("");
  const preferredVariant =
    media.kind === "image" || (thumbnail && media.kind === "video")
      ? "poster"
      : "proxy";
  const derivative = media.derivatives.find(
    (item) => item.kind === preferredVariant,
  );
  const variant =
    (media.kind === "image" ||
      (["video", "audio"].includes(media.kind) && !thumbnail)) &&
    derivative?.status !== "ready"
      ? "original"
      : preferredVariant;
  const previewClass = thumbnail
    ? classes.thumbnail
    : `${classes.viewport}${media.kind === "audio" ? ` ${classes.audioViewport}` : ""}${fit ? ` ${classes.fittedViewport}` : ""}`;
  const enabled =
    ["ready", "archived"].includes(media.status) &&
    (variant === "original" || derivative?.status === "ready") &&
    media.kind !== "document" &&
    !(thumbnail && media.kind === "audio");
  const access = useQuery({
    queryKey: [
      "media-access",
      session.userId,
      path,
      media.id,
      variant,
      derivative?.id,
      derivative?.profileRevision,
    ],
    queryFn: ({ signal }) =>
      mediaPost<Schema<"AccessGrant">>(
        session,
        `${path}/media/${media.id}/access`,
        { variant, disposition: "inline" },
        signal,
      ),
    enabled,
    staleTime: 4 * 60_000,
    gcTime: 5 * 60_000,
    retry: false,
  });
  function failed() {
    const expired =
      access.data &&
      new Date(access.data.expiresAt).getTime() <= Date.now() + 5000;
    if (expired && access.data && renewedUrl.current !== access.data.url) {
      renewedUrl.current = access.data.url;
      void access.refetch().then((result) => {
        if (!result.error) setReloadKey((value) => value + 1);
      });
      return;
    }
    setPlaybackError(true);
  }
  if (!enabled)
    return (
      <div className={previewClass}>
        <Stack align="center" gap="xs">
          <MediaSymbol kind={media.kind} />
          {!thumbnail && (
            <Text>
              {media.kind === "document"
                ? "文档可下载原文件查看"
                : media.status === "processing"
                  ? "正在验收原文件"
                  : derivative?.status === "failed"
                    ? "预览处理失败，可在下方恢复"
                    : derivative
                      ? "预览正在处理"
                      : "暂无预览"}
            </Text>
          )}
        </Stack>
      </div>
    );
  if (access.isError || playbackError)
    return (
      <div className={previewClass}>
        <Stack align="center" gap="xs">
          <MediaSymbol kind={media.kind} />
          {!thumbnail && (
            <>
              <Text>预览暂时无法读取</Text>
              <ErrorNotice error={access.error} />
              <Button
                onClick={() => {
                  renewedUrl.current = "";
                  void access.refetch().then((result) => {
                    if (!result.error) {
                      setReloadKey((value) => value + 1);
                      setPlaybackError(false);
                    }
                  });
                }}
              >
                重新加载预览
              </Button>
            </>
          )}
        </Stack>
      </div>
    );
  if (!access.data)
    return (
      <div className={previewClass}>
        <Loader aria-label="正在读取预览" size="sm" />
      </div>
    );
  return (
    <div className={previewClass}>
      {media.kind === "image" || variant === "poster" ? (
        <img
          key={reloadKey}
          src={access.data.url}
          alt={thumbnail ? "" : media.displayName}
          loading={thumbnail ? "lazy" : "eager"}
          onError={failed}
        />
      ) : (
        <Suspense fallback={<Loader aria-label="正在加载播放器" />}>
          <Player
            key={`${access.data.url}:${reloadKey}:${range?.inUs}:${range?.outUs}`}
            src={access.data.url}
            title={`${media.displayName} · ${variant === "original" ? (media.kind === "audio" ? "原音频预览" : "原片预览") : "代理预览"}`}
            audio={media.kind === "audio"}
            fit={fit}
            range={range}
            onError={failed}
            resumeAt={time.current}
            onTime={(value) => {
              time.current = value;
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
