import { GeneratedImageResult } from "./GeneratedImageResult";
import { GeneratedAudioResult } from "./GeneratedAudioResult";
import { GeneratedVideoResult } from "./GeneratedVideoResult";
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import { useResource, type Schema } from "./api";
import { ErrorNotice, tenantPath } from "./common";
import { MediaPreview } from "./MediaPreview";
import classes from "./image-generation.module.css";
export type GeneratedMediaResultProps = {
  tenantId: string;
  projectId: string;
  jobId: string;
  mediaId: string;
};
export function GeneratedMediaResult({
  kind,
  ...props
}: GeneratedMediaResultProps & { kind: "image" | "video" | "audio" }) {
  return kind === "image" ? (
    <GeneratedImageResult {...props} />
  ) : kind === "audio" ? (
    <GeneratedAudioResult {...props} />
  ) : (
    <GeneratedVideoResult {...props} />
  );
}

export type ComparedMedia = GeneratedMediaResultProps & {
  kind: "image" | "video" | "audio";
  label: string;
  planId: string;
};

/** Comparison reads exact outputs. Only one timed preview can be mounted at a time. */
export function GeneratedMediaComparison({
  items,
  close,
}: {
  items: readonly ComparedMedia[];
  close: () => void;
}) {
  const [playing, setPlaying] = useState<string>();
  useEffect(() => {
    document
      .querySelectorAll<HTMLMediaElement>("video,audio")
      .forEach((media) => media.pause());
    const pause = () => {
      if (document.hidden) setPlaying(undefined);
    };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  return (
    <Modal opened onClose={close} title="比较固定成果" size="90vw" centered>
      <Stack>
        <Text size="sm" c="dimmed">
          仅比较固定文件，不改变镜头采用。视频／声音逐份播放，切换时暂停上一份；不作同步对齐播放。
        </Text>
        <div className={classes.comparisonGrid}>
          {items.slice(0, 2).map((item, index) => (
            <ComparedOutput
              key={`${item.jobId}:${item.mediaId}`}
              item={item}
              index={index}
              playing={playing === item.mediaId}
              play={() =>
                setPlaying((old) =>
                  old === item.mediaId ? undefined : item.mediaId,
                )
              }
            />
          ))}
        </div>
      </Stack>
    </Modal>
  );
}
function ComparedOutput({
  item,
  index,
  playing,
  play,
}: {
  item: ComparedMedia;
  index: number;
  playing: boolean;
  play: () => void;
}) {
  const path = tenantPath(item.tenantId);
  const media = useResource<Schema<"Media">>(`${path}/media/${item.mediaId}`);
  const valid =
    media.data?.id === item.mediaId &&
    media.data.sourceJobId === item.jobId &&
    media.data.kind === item.kind &&
    ["ready", "archived"].includes(media.data.status);
  return (
    <Stack gap="sm" className={classes.comparedOutput}>
      <Group>
        <Text fw={600}>
          {index === 0 ? "A" : "B"} · {item.label}
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        固定尝试 {item.planId.slice(0, 8)} ·{" "}
        {media.data?.displayName ?? "正在读取"}
      </Text>
      <ErrorNotice error={media.error} retry={() => void media.refetch()} />
      {!media.data && !media.error ? (
        <Loader />
      ) : valid && media.data ? (
        <div className={classes.comparisonPreview}>
          <MediaPreview
            key={`${item.mediaId}:${playing}`}
            media={media.data}
            path={path}
            thumbnail={item.kind !== "image" && !playing}
          />
        </div>
      ) : (
        !media.error && (
          <Alert>这份固定结果当前不可用。原身份保留，请重新读取。</Alert>
        )
      )}
      {valid && item.kind !== "image" && (
        <Button variant="default" onClick={play}>
          {playing ? "暂停并关闭预览" : "播放这一份"}
        </Button>
      )}
      <Text size="xs" c="dimmed">
        采用状态属于具体镜头；本次比较不建立或变更采用。
      </Text>
    </Stack>
  );
}
