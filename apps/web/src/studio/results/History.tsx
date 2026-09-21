import { useState } from "react";
import { Loader, Modal, Text, UnstyledButton } from "@mantine/core";
import { ArrowLeft, FilmStrip, ImageSquare, MusicNotes } from "@phosphor-icons/react";
import { useResource, type Schema } from "../../business/api";
import { tenantPath } from "../../business/common";
import { MediaPreview } from "../../business/MediaPreview";
import { jobStatusLabel } from "../../business/assistant-session";
import { ErrorNotice } from "../../business/common";
import classes from "./results.module.css";

type Entry = Schema<"CanvasPlanEntry">;
const icons = { image: ImageSquare, video: FilmStrip, audio: MusicNotes };
const kindLabel = { image: "图片", video: "视频", audio: "音频" };

/**
 * A card's fixed attempts, newest first, and one attempt's fixed inputs and
 * result, read-only. It reads plans, jobs and media directly: browsing never
 * opens a session, edits a draft or places anything.
 */
export function History({
  tenantId,
  title,
  attempts,
  opened,
  onClose,
}: {
  tenantId: string;
  title: string;
  attempts: readonly Entry[];
  opened: boolean;
  onClose: () => void;
}) {
  const [planId, setPlanId] = useState<string>();
  return (
    <Modal
      opened={opened}
      onClose={() => {
        setPlanId(undefined);
        onClose();
      }}
      title={planId ? `固定尝试 · ${title}` : `尝试与结果 · ${title}`}
      size="md"
    >
      <AttemptBrowser tenantId={tenantId} attempts={attempts} planId={planId} onPlan={setPlanId} />
    </Modal>
  );
}

/** The list of attempts and one attempt's inputs and result; the caller owns which one is open. */
export function AttemptBrowser({
  tenantId,
  attempts,
  titles,
  planId,
  onPlan,
}: {
  tenantId: string;
  attempts: readonly Entry[];
  /** Card titles by node id, shown when attempts of many cards are listed. */
  titles?: Record<string, string> | undefined;
  planId: string | undefined;
  onPlan: (planId: string | undefined) => void;
}) {
  const sorted = [...attempts].sort((a, b) =>
    (b.plan.createdAt ?? "").localeCompare(a.plan.createdAt ?? ""),
  );
  const entry = sorted.find((item) => item.plan.id === planId);
  if (entry) return <Attempt tenantId={tenantId} entry={entry} back={() => onPlan(undefined)} />;
  return (
    <div className={classes.list}>
      {sorted.map((item) => (
        <AttemptRow
          key={item.plan.id}
          tenantId={tenantId}
          entry={item}
          title={titles ? (titles[item.origin.nodeId] ?? "已删除的草稿") : undefined}
          open={() => onPlan(item.plan.id)}
        />
      ))}
      {!sorted.length && (
        <Text size="sm" c="dimmed">
          还没有固定尝试。提交一次生成后可从这里找回输入、任务与结果。
        </Text>
      )}
    </div>
  );
}

function useAttemptMedia(tenantId: string, entry: Entry) {
  const tenant = tenantPath(tenantId);
  const job = useResource<Schema<"GenerationJob">>(
    `${tenant}/generation-jobs/${entry.jobId ?? ""}`,
    !!entry.jobId,
  );
  const mediaId = job.data?.mediaIds[0];
  const media = useResource<Schema<"Media">>(`${tenant}/media/${mediaId ?? ""}`, !!mediaId);
  const valid =
    media.data && media.data.id === mediaId && media.data.sourceJobId === entry.jobId && !media.error
      ? media.data
      : undefined;
  return { job, media: valid };
}

function AttemptRow({ tenantId, entry, title, open }: { tenantId: string; entry: Entry; title?: string | undefined; open: () => void }) {
  const kind = entry.plan.input.purpose as keyof typeof icons;
  const Icon = icons[kind] ?? ImageSquare;
  const { job, media } = useAttemptMedia(tenantId, entry);
  const status = job.error
    ? "任务暂不可读"
    : job.data
      ? jobStatusLabel[job.data.status]
      : entry.jobStatus
        ? jobStatusLabel[entry.jobStatus]
        : entry.jobId
          ? "待核对任务"
          : "固定计划";
  return (
    <UnstyledButton className={classes.row} onClick={open} aria-label={`查看固定尝试 ${entry.plan.id.slice(0, 8)}`}>
      <span className={classes.thumb}>
        {media ? <MediaPreview media={media} path={tenantPath(tenantId)} thumbnail /> : <Icon size={20} aria-hidden />}
      </span>
      <span className={classes.rowText}>
        <Text component="span" size="sm">
          {title ? `${title} · ` : ""}{kindLabel[kind] ?? "结果"} · {status}
        </Text>
        <Text component="span" size="xs" c="dimmed">
          {entry.plan.createdAt ? new Date(entry.plan.createdAt).toLocaleString("zh-CN", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : `计划 ${entry.plan.id.slice(0, 8)}`}
        </Text>
      </span>
    </UnstyledButton>
  );
}

function Attempt({ tenantId, entry, back }: { tenantId: string; entry: Entry; back: () => void }) {
  const tenant = tenantPath(tenantId);
  const plan = useResource<Schema<"GenerationPlan">>(`${tenant}/generation-plans/${entry.plan.id}`);
  const { job, media } = useAttemptMedia(tenantId, entry);
  const resolved = plan.data?.resolvedInput as
    | (Schema<"ResolvedInput"> & { capabilitySnapshot?: { modelVersion?: string }; output?: Schema<"OutputOptions"> })
    | undefined;
  const output = resolved?.output ?? plan.data?.input.output;
  return (
    <div className={classes.attempt}>
      <UnstyledButton className={classes.back} onClick={back}>
        <ArrowLeft size={14} aria-hidden /> 返回尝试列表
      </UnstyledButton>
      <ErrorNotice error={plan.error} retry={() => void plan.refetch()} />
      {!plan.data && !plan.error && <Loader size="sm" aria-label="正在读取固定尝试" />}
      {plan.data && (
        <>
          {plan.data.executionMode === "test_fixture" && (
            <Text size="xs" c="dimmed">
              受控测试 · 不代表真实模型效果
            </Text>
          )}
          <Text size="sm" className={classes.prose} aria-label="固定提示词">
            {resolved?.prompt ?? plan.data.input.prompt}
          </Text>
          <Text size="xs" c="dimmed">
            {[
              resolved?.capabilitySnapshot?.modelVersion ?? "固定模型",
              output?.resolution,
              output?.aspectRatio,
              output?.durationSeconds !== undefined ? `${output.durationSeconds} 秒` : undefined,
              output?.withAudio ? "有声" : undefined,
              `${resolved?.references.length ?? 0} 参考 / ${resolved?.shots.length ?? 0} 镜头`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <Text size="xs" c="dimmed">
            {job.data ? jobStatusLabel[job.data.status] : entry.jobStatus ? jobStatusLabel[entry.jobStatus] : "固定计划"}
            {job.data?.errorCode ? ` · ${job.data.errorCode}` : ""}
            {plan.data.status !== "ready" && plan.data.status !== "consumed" ? ` · ${plan.data.blockingReasons[0] ?? plan.data.status}` : ""}
          </Text>
        </>
      )}
      {media && (
        <div className={classes.result}>
          <MediaPreview media={media} path={tenant} thumbnail />
        </div>
      )}
    </div>
  );
}
