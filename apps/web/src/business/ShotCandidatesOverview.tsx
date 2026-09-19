import {
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import { Check, FilmStrip } from "@phosphor-icons/react";
import { useList, useResource, type Schema } from "./api";
import { ErrorNotice } from "./common";
import { MediaPreview } from "./MediaPreview";
import { sourceSeconds } from "./candidate-time";
import classes from "./shot-list.module.css";

type Take = Schema<"Take">;

/**
 * The candidates of several shots side by side. This is the horizontal view the
 * batch path exists for: a scene's continuity is not decidable from one shot, so
 * the shots of one scene have to be readable at the same time.
 *
 * It is deliberately read-only. Adoption stays a per-shot, explicit act in the
 * single-shot flow, so nothing here can pick a candidate for a shot.
 */
export function ShotCandidatesOverview({
  opened,
  close,
  path,
  mediaPath,
  shots,
  focusedShotId,
  focusShot,
}: {
  opened: boolean;
  close: () => void;
  path: string;
  mediaPath: string;
  shots: readonly Schema<"Shot">[];
  focusedShotId?: string | undefined;
  focusShot?: ((id: string) => void) | undefined;
}) {
  return (
    <Modal
      opened={opened}
      onClose={close}
      title={`${shots.length} 个镜头的候选`}
      size="min(1400px, calc(100vw - 48px))"
      centered
      classNames={{
        content: classes.modalContent,
        header: classes.modalHeader,
        body: classes.modalBody,
      }}
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          只读取候选，不改变任何镜头的采用。采用仍在单镜头流程里逐条进行。
        </Text>
        <div className={classes.overviewGrid}>
          {shots.map((shot) => (
            <ShotCandidatesColumn
              key={shot.id}
              path={path}
              mediaPath={mediaPath}
              shot={shot}
              focused={shot.id === focusedShotId}
              {...(focusShot ? { focusShot } : {})}
            />
          ))}
        </div>
      </Stack>
    </Modal>
  );
}

function ShotCandidatesColumn({
  path,
  mediaPath,
  shot,
  focused,
  focusShot,
}: {
  path: string;
  mediaPath: string;
  shot: Schema<"Shot">;
  focused: boolean;
  focusShot?: ((id: string) => void) | undefined;
}) {
  const takes = useList<Take>(`${path}/takes?shotId=${shot.id}`);
  return (
    <section
      className={classes.overviewColumn}
      aria-label={`${shot.label} 的候选`}
      data-focused={focused || undefined}
    >
      <Group justify="space-between" align="start" wrap="nowrap">
        <div>
          <Text fw={600}>{shot.label}</Text>
          <Text size="xs" c="dimmed" lineClamp={2}>
            {shot.spec.intent}
          </Text>
        </div>
        {focusShot && !focused && (
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => focusShot(shot.id)}
          >
            定位此镜头
          </Button>
        )}
      </Group>
      {takes.isPending && (
        <Loader size="sm" aria-label={`正在读取 ${shot.label} 的候选`} />
      )}
      <ErrorNotice error={takes.error} retry={() => void takes.refetch()} />
      {takes.data?.map((take, index) => (
        <TakeInOverview
          key={take.id}
          take={take}
          index={index}
          path={path}
          mediaPath={mediaPath}
          adopted={take.id === shot.currentTakeId}
          current={take.shotRevisionId === shot.specRevisionId}
        />
      ))}
      {takes.data?.length === 0 && (
        <Text size="xs" c="dimmed">
          还没有候选。
        </Text>
      )}
    </section>
  );
}

function TakeInOverview({
  take,
  index,
  path,
  mediaPath,
  adopted,
  current,
}: {
  take: Take;
  index: number;
  path: string;
  mediaPath: string;
  adopted: boolean;
  current: boolean;
}) {
  const media = useResource<Schema<"Media">>(
    `${mediaPath}/media/${take.mediaId}`,
  );
  return (
    <div className={classes.overviewTake} data-adopted={adopted || undefined}>
      <span className={classes.overviewThumb}>
        {media.data ? (
          <MediaPreview media={media.data} path={mediaPath} thumbnail />
        ) : (
          <FilmStrip size={18} aria-hidden />
        )}
      </span>
      <div>
        <Group gap={4} wrap="nowrap">
          <Text size="sm">候选 {index + 1}</Text>
          {adopted && (
            <Badge size="xs" variant="light" leftSection={<Check size={10} />}>
              当前采用
            </Badge>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {sourceSeconds(take.range.inUs)}–{sourceSeconds(take.range.outUs)} 秒 ·{" "}
          {current ? "当前要求" : "旧要求"}
        </Text>
        {take.note && (
          <Text size="xs" lineClamp={2}>
            {take.note}
          </Text>
        )}
      </div>
    </div>
  );
}
