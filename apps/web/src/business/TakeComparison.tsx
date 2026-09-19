import { useEffect, useState } from "react";
import { Alert, Button, Group, Loader, Modal, Stack, Text } from "@mantine/core";
import { useResource, type Schema } from "./api";
import { ErrorNotice } from "./common";
import { MediaPreview } from "./MediaPreview";
import { sourceSeconds } from "./candidate-time";
import classes from "./shot-list.module.css";

type Take = Schema<"Take">;
const LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * Several candidates of one shot side by side. A candidate is a media plus a
 * range, so each column plays exactly its own fixed interval — the generated
 * result comparison cannot do this because it is bound to a job output.
 *
 * Only one timed preview is mounted at a time; the rest stay on their poster.
 */
export function TakeComparison({
  path,
  mediaPath,
  shotLabel,
  takes,
  close,
}: {
  path: string;
  mediaPath: string;
  shotLabel: string;
  takes: readonly Take[];
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
    <Modal
      opened
      onClose={close}
      title={`比较 ${takes.length} 份候选 · ${shotLabel}`}
      size="90vw"
      centered
    >
      <Stack>
        <Text size="sm" c="dimmed">
          只比较已固定的候选文件与区间，不改变镜头采用。视频／声音逐份播放，切换时暂停上一份；不作同步对齐播放。
        </Text>
        <div className={classes.takeComparisonGrid}>
          {takes.map((take, index) => (
            <TakeColumn
              key={take.id}
              take={take}
              label={LETTERS[index] ?? String(index + 1)}
              mediaPath={mediaPath}
              playing={playing === take.id}
              play={() =>
                setPlaying((old) => (old === take.id ? undefined : take.id))
              }
            />
          ))}
        </div>
      </Stack>
    </Modal>
  );
}

function TakeColumn({
  take,
  label,
  mediaPath,
  playing,
  play,
}: {
  take: Take;
  label: string;
  mediaPath: string;
  playing: boolean;
  play: () => void;
}) {
  const media = useResource<Schema<"Media">>(
    `${mediaPath}/media/${take.mediaId}`,
  );
  const timed = media.data?.kind === "video" || media.data?.kind === "audio";
  // The take fixes a media identity and an interval; a substitute would be a
  // different candidate, so anything else is reported rather than displayed.
  const valid =
    !media.error && media.data?.id === take.mediaId && media.data.status === "ready";
  return (
    <Stack gap="sm" className={classes.takeColumn}>
      <Text fw={600}>
        {label} · 候选 {sourceSeconds(take.range.inUs)}–
        {sourceSeconds(take.range.outUs)} 秒
      </Text>
      <Text size="xs" c="dimmed">
        {valid ? media.data!.displayName : "等待权限与文件核对"}
      </Text>
      <ErrorNotice error={media.error} retry={() => void media.refetch()} />
      {!media.data && !media.error ? (
        <Loader aria-label="正在读取候选媒体" />
      ) : valid && media.data ? (
        <div className={classes.takeComparisonPreview}>
          <MediaPreview
            key={`${take.mediaId}:${playing}`}
            media={media.data}
            path={mediaPath}
            thumbnail={!!timed && !playing}
            {...(playing ? { range: take.range } : {})}
          />
        </div>
      ) : (
        !media.error && (
          <Alert>这份候选当前不可用。原身份保留，请重新读取。</Alert>
        )
      )}
      {valid && timed && (
        <Button variant="default" onClick={play}>
          {playing ? "暂停并关闭预览" : "播放这一份"}
        </Button>
      )}
      {take.note && (
        <Text size="sm" lineClamp={3}>
          {take.note}
        </Text>
      )}
      <Text size="xs" c="dimmed">
        采用状态属于具体镜头；本次比较不建立或变更采用。
      </Text>
    </Stack>
  );
}
