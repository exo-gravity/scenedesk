import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { ArrowSquareOut, Play, Stop, MusicNotes } from "@phosphor-icons/react";
import { useResource, type Schema } from "./api";
import { ErrorNotice, tenantPath } from "./common";
import { MediaPreview } from "./MediaPreview";
import type { GeneratedMediaResultProps } from "./GeneratedMediaResult";
import classes from "./image-generation.module.css";
/** Generation results stay independent media; playing or downloading never creates a Take. */
export function GeneratedTimedMediaResult({
  kind,
  tenantId,
  projectId,
  jobId,
  mediaId,
}: GeneratedMediaResultProps & { kind: "video" | "audio" }) {
  const label = kind === "video" ? "视频" : "音频";
  const original = kind === "video" ? "原片" : "原音频";
  const path = tenantPath(tenantId);
  const media = useResource<Schema<"Media">>(`${path}/media/${mediaId}`);
  const valid =
    media.data?.kind === kind &&
    media.data.sourceJobId === jobId &&
    ["ready", "archived"].includes(media.data.status);
  const [playing, setPlaying] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!playing) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0] && !entries[0].isIntersecting) setPlaying(false);
    });
    if (container.current) observer.observe(container.current);
    const visibility = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [playing]);
  if (media.error)
    return (
      <ErrorNotice error={media.error} retry={() => void media.refetch()} />
    );
  if (!media.data)
    return <Loader size="sm" aria-label={`正在读取${label}结果`} />;
  if (!valid)
    return (
      <Alert>
        {label}结果尚不可用。原任务与素材身份已保留，可稍后重新读取。
      </Alert>
    );
  return (
    <Stack
      ref={container}
      gap="sm"
      className={classes.result}
      aria-label={`独立${label}结果`}
    >
      <Group justify="space-between">
        <Text fw={600}>{media.data.displayName}</Text>
        <Badge variant="light">独立{label}结果</Badge>
      </Group>
      <Text size="xs" c="dimmed">
        {media.data.durationUs === undefined
          ? "时长待核对"
          : `${media.data.durationUs / 1000000} 秒`}{" "}
        ·{" "}
        {media.data.hasAudio === undefined
          ? "声音信息待核对"
          : media.data.hasAudio
            ? "包含声音"
            : "无声音"}
        。预览和取回不会绑定对白或改变采用。
      </Text>
      {kind === "audio" && !playing ? (
        <Group gap="sm">
          <MusicNotes size={24} aria-hidden />
          <Text size="sm" c="dimmed">
            点击预览后试听原声音。
          </Text>
        </Group>
      ) : (
        <MediaPreview
          key={playing ? "playback" : "thumbnail"}
          media={media.data}
          path={path}
          thumbnail={!playing}
        />
      )}
      {playing ? (
        <Button
          variant="subtle"
          leftSection={<Stop size={16} />}
          onClick={() => setPlaying(false)}
        >
          关闭{label}预览
        </Button>
      ) : (
        <Button
          variant="default"
          leftSection={<Play size={16} />}
          onClick={() => setPlaying(true)}
        >
          预览{label}
        </Button>
      )}
      <Button
        component="a"
        variant="default"
        leftSection={<ArrowSquareOut size={16} />}
        href={`#/app/t/${tenantId}/p/${projectId}/media?media=${mediaId}`}
      >
        在素材中取回{original}
      </Button>
    </Stack>
  );
}
