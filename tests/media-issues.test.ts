import { test } from "node:test";
import assert from "node:assert/strict";
import { processingIssue, MediaFailure } from "@drama/media";

test("processingIssue: a database check violation is a final archive refusal, other unknown errors stay retryable", () => {
  const check = Object.assign(new Error("Video duration, audio or frame evidence differs from fixed request"), { code: "23514" });
  assert.deepEqual(processingIssue(check), {
    code: "ARCHIVE_EVIDENCE_REJECTED",
    message: "归档校验拒绝了这份结果，请核对固定请求与产物是否一致。",
    retryable: false,
  });
  assert.equal(processingIssue(new Error("socket hang up")).code, "MEDIA_SERVICE_UNAVAILABLE");
  assert.equal(processingIssue(new Error("socket hang up")).retryable, true);
  assert.equal(processingIssue(new MediaFailure("VIDEO_OUTPUT_MISMATCH", "x")).retryable, false);
  assert.equal(processingIssue(new MediaFailure("MEDIA_SANDBOX_UNAVAILABLE", "x")).retryable, true);
});
