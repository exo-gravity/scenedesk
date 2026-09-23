import { MediaFailure } from "./policy.js";
export type Issue = { code: string; message: string; retryable: boolean };
export function processingIssue(error: unknown): Issue {
  if (
    error instanceof Error &&
    ["NoSuchVersion", "NoSuchKey"].includes(error.name)
  )
    return {
      code: "MEDIA_SOURCE_MISSING",
      message: "已固定的源文件版本不存在，请重新导入。",
      retryable: false,
    };
  if (error instanceof MediaFailure) {
    const transient = new Set([
      "STORAGE_VERSION_REQUIRED",
      "STORAGE_INTEGRITY_MISMATCH",
      "MEDIA_SANDBOX_UNAVAILABLE",
      "MEDIA_SANDBOX_CLEANUP_FAILED",
      "MEDIA_CANCELLED",
      "MEDIA_BUILD_MISMATCH",
    ]);
    return {
      code: error.code,
      message: error.message,
      retryable: transient.has(error.code),
    };
  }
  // A database check violation (ERRCODE 23514) is the archive protocol refusing the evidence,
  // not an outage: retrying would loop forever, as the demo box did on 2026-09-23.
  if (
    error instanceof Error &&
    (error as { code?: unknown }).code === "23514"
  )
    return {
      code: "ARCHIVE_EVIDENCE_REJECTED",
      message: "归档校验拒绝了这份结果，请核对固定请求与产物是否一致。",
      retryable: false,
    };
  return {
    code: "MEDIA_SERVICE_UNAVAILABLE",
    message: "处理服务暂未完成，请稍后重试。",
    retryable: true,
  };
}
