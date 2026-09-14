import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import { ArrowsOut, Columns } from "@phosphor-icons/react";
import { useResource, type Schema } from "./api";
import { ErrorNotice, tenantPath } from "./common";
import { MediaPreview } from "./MediaPreview";
import {
  GeneratedMediaComparison,
  type ComparedMedia,
} from "./GeneratedMediaResult";
import classes from "./node-generation.module.css";

/** Exact archived outputs, presented beside their draft. This creates no canvas nodes. */
export function NodeGenerationResults({
  kind,
  tenantId,
  projectId,
  job,
  previous,
  placed,
}: {
  kind: "image" | "video" | "audio";
  tenantId: string;
  projectId: string;
  job: Schema<"GenerationJob">;
  previous: readonly { planId: string; jobId?: string }[];
  placed: boolean;
}) {
  const [selected, setSelected] = useState<string>();
  const [preview, setPreview] = useState(false);
  const [compare, setCompare] = useState(false);
  const mediaId = job.mediaIds.find((id) => id === selected) ?? job.mediaIds[0];
  const prior = [...previous]
    .reverse()
    .find((item) => item.jobId && item.jobId !== job.id);
  if (!mediaId) return <Text size="sm">结果身份尚未读取，请核对原任务。</Text>;
  const current: ComparedMedia = {
    kind,
    tenantId,
    projectId,
    jobId: job.id,
    mediaId,
    planId: job.planId,
    label: `本次结果 ${job.mediaIds.indexOf(mediaId) + 1}`,
  };
  const other = job.mediaIds.find((id) => id !== mediaId);
  return (
    <section className={classes.result} aria-label="本次生成结果">
      <Group justify="space-between" gap="xs">
        <Text size="xs" fw={600}>
          本次结果
          {job.mediaIds.length > 1
            ? ` · ${job.mediaIds.indexOf(mediaId) + 1}/${job.mediaIds.length}`
            : ""}
        </Text>
        <Text size="xs" c="dimmed">
          {placed ? "已放入画布" : "尚未放入画布"}
        </Text>
      </Group>
      <ExactNodePreview key={mediaId} item={current} />
      {job.mediaIds.length > 1 && (
        <Group gap="xs">
          {job.mediaIds.map((id, index) => (
            <Button
              key={id}
              size="compact-xs"
              variant={id === mediaId ? "filled" : "subtle"}
              onClick={() => setSelected(id)}
            >
              结果 {index + 1}
            </Button>
          ))}
        </Group>
      )}
      <Group gap="xs" grow>
        <Button
          size="xs"
          variant="default"
          leftSection={<ArrowsOut size={14} />}
          onClick={() => setPreview(true)}
        >
          预览结果
        </Button>
        {(other || prior) && (
          <Button
            size="xs"
            variant="default"
            leftSection={<Columns size={14} />}
            onClick={() => setCompare(true)}
          >
            {other ? "比较结果" : "与上次比较"}
          </Button>
        )}
      </Group>
      {preview && (
        <Modal
          opened
          onClose={() => setPreview(false)}
          title="预览固定结果"
          size="lg"
          centered
        >
          <ExactNodePreview item={current} full />
          <Button
            component="a"
            variant="subtle"
            mt="sm"
            href={`#/app/t/${tenantId}/p/${projectId}/media?media=${mediaId}`}
          >
            在素材中查看原文件
          </Button>
        </Modal>
      )}
      {compare &&
        (other ? (
          <GeneratedMediaComparison
            items={[
              current,
              {
                ...current,
                mediaId: other,
                label: `本次结果 ${job.mediaIds.indexOf(other) + 1}`,
              },
            ]}
            close={() => setCompare(false)}
          />
        ) : prior?.jobId ? (
          <PreviousComparison
            current={current}
            previous={{ planId: prior.planId, jobId: prior.jobId }}
            close={() => setCompare(false)}
          />
        ) : null)}
    </section>
  );
}

function ExactNodePreview({
  item,
  full = false,
}: {
  item: ComparedMedia;
  full?: boolean;
}) {
  const path = tenantPath(item.tenantId);
  const media = useResource<Schema<"Media">>(`${path}/media/${item.mediaId}`);
  if (media.error)
    return (
      <ErrorNotice error={media.error} retry={() => void media.refetch()} />
    );
  if (!media.data) return <Loader size="sm" aria-label="正在核对结果文件" />;
  if (
    media.data.id !== item.mediaId ||
    media.data.projectId !== item.projectId ||
    media.data.sourceJobId !== item.jobId ||
    media.data.kind !== item.kind ||
    !["ready", "archived"].includes(media.data.status)
  )
    return <Alert>这份固定结果当前不可用，请从任务中重新核对。</Alert>;
  return (
    <div className={full ? classes.fullPreview : classes.preview}>
      <MediaPreview media={media.data} path={path} thumbnail={!full} />
    </div>
  );
}

function PreviousComparison({
  current,
  previous,
  close,
}: {
  current: ComparedMedia;
  previous: { planId: string; jobId: string };
  close: () => void;
}) {
  const job = useResource<Schema<"GenerationJob">>(
    `${tenantPath(current.tenantId)}/generation-jobs/${previous.jobId}`,
  );
  const valid =
    !job.error &&
    job.data?.id === previous.jobId &&
    job.data.planId === previous.planId &&
    job.data.projectId === current.projectId &&
    job.data.status === "succeeded";
  const mediaId = valid ? job.data?.mediaIds[0] : undefined;
  if (mediaId)
    return (
      <GeneratedMediaComparison
        items={[
          {
            ...current,
            jobId: previous.jobId,
            planId: previous.planId,
            mediaId,
            label: "上一次固定结果",
          },
          current,
        ]}
        close={close}
      />
    );
  return (
    <Modal opened onClose={close} title="核对上次结果" centered>
      <Stack>
        <ErrorNotice error={job.error} retry={() => void job.refetch()} />
        {!job.data && !job.error ? (
          <Loader size="sm" />
        ) : (
          !job.error && (
            <Text size="sm">
              上一次尝试尚无可比较的归档结果。可在任务记录中选择其他尝试。
            </Text>
          )
        )}
      </Stack>
    </Modal>
  );
}
