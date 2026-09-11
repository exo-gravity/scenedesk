import type { components } from "@drama/contracts";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];

// The generated contract keeps cancellation facts optional for persisted older jobs.
export type AsyncGenerationJob = Schema<"GenerationJob">;
export type CancellationRequest = {
  jobId: string;
  planId: string;
  key: string;
};
export type CancellationTarget = Pick<CancellationRequest, "jobId" | "planId">;
export function canRequestCancellation(job: AsyncGenerationJob) {
  return (
    (!job.cancelStatus || job.cancelStatus === "not_requested") &&
    [
      "queued",
      "dispatching",
      "submission_unknown",
      "provider_pending",
      "provider_running",
    ].includes(job.status)
  );
}
export function cancellationDescription(
  job: AsyncGenerationJob,
  local?: CancellationRequest,
) {
  const outcomes: Partial<Record<AsyncGenerationJob["status"], string>> = {
    succeeded: "任务已完成，结果仍可取回。",
    failed: "任务已结束，未产生可用结果。",
    cancelled: "原任务已取消。",
    archiving: "生成已结束，正在保存结果。",
    archive_failed: "生成已结束，结果保存尚未完成，可恢复归档。",
  };
  const outcome = outcomes[job.status];
  switch (job.cancelStatus) {
    case "requested":
      return outcome
        ? `取消请求记录已保留；${outcome}`
        : "取消请求已记录，尚未确认取消。原任务仍会继续核对。";
    case "unsupported":
      return outcome
        ? `模型未支持本次取消；${outcome}`
        : "当前模型不支持取消。原任务继续处理，完成后可取回结果。";
    case "unknown":
      return outcome
        ? `本次取消的回执仍未确定；${outcome}`
        : "模型是否取消仍待核对，不会再次发送模型取消请求。";
    case "confirmed":
      return job.status === "cancelled"
        ? "原任务已确认取消。"
        : outcome
          ? `取消确认已保留；${outcome}`
          : "已收到取消确认；如结果已先完成，仍会保留并归档。";
    default:
      return local && !["succeeded", "failed", "cancelled"].includes(job.status)
        ? "取消回执待核对。本机保留原请求，刷新只读取原任务。"
        : undefined;
  }
}
export function assertCancellationJob(
  value: AsyncGenerationJob,
  target: CancellationTarget,
) {
  if (
    !value ||
    value.id !== target.jobId ||
    value.planId !== target.planId ||
    ![
      "queued",
      "dispatching",
      "submission_unknown",
      "provider_pending",
      "provider_running",
      "archiving",
      "archive_failed",
      "succeeded",
      "failed",
      "cancel_requested",
      "cancelled",
      "reconciliation_required",
    ].includes(value.status) ||
    (value.cancelStatus !== undefined &&
      ![
        "not_requested",
        "requested",
        "unsupported",
        "unknown",
        "confirmed",
      ].includes(value.cancelStatus)) ||
    (value.cancelRequestedAt !== undefined &&
      (typeof value.cancelRequestedAt !== "string" ||
        !Number.isFinite(Date.parse(value.cancelRequestedAt))))
  )
    throw new Error("取消回执与原任务不匹配，请保留请求并重新核对。");
}
