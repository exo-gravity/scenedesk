import type { components } from "@drama/contracts";
type Schema<K extends keyof components["schemas"]> = components["schemas"][K];

/** Fixed business input only. Secrets, staging URLs and transport state are not creative input. */
export type AssistanceSubmission = {
  attemptId: string;
  jobId: string;
  connectionVersionId: string;
  requestHash: string;
  input: Schema<"PlanInput">;
  resolvedInput: Schema<"ResolvedInput">;
  executionMode: "test_fixture" | "verified_provider";
};
export type AssistanceSubmissionReceipt =
  | {
      kind: "completed";
      output: unknown;
      correlation: string;
      providerJobId?: string;
      usage?: Record<string, number>;
    }
  | { kind: "rejected"; correlation: string; code: string }
  | { kind: "unknown"; correlation: string }
  | { kind: "accepted"; correlation: string; providerJobId: string };

/** A known provider task belongs to the original attempt and connection forever. */
export type AssistanceProviderTask = AssistanceSubmission & {
  providerJobId: string;
};
export type AssistanceQueryReceipt =
  | {
      kind: "pending" | "running" | "cancelled";
      correlation: string;
      providerJobId: string;
    }
  | {
      kind: "completed";
      correlation: string;
      providerJobId: string;
      output: unknown;
      usage?: Record<string, number>;
    }
  | {
      kind: "failed" | "unavailable";
      correlation: string;
      providerJobId: string;
      code: string;
    };
export type AssistanceCancelReceipt = {
  kind:
    "cancel_requested" | "cancel_unsupported" | "cancel_unknown" | "cancelled";
  correlation: string;
  providerJobId: string;
};
export type AssistanceReceipt =
  | AssistanceSubmissionReceipt
  | AssistanceQueryReceipt
  | AssistanceCancelReceipt;

/** Fixed-plan transport boundary; synchronous responses have no fabricated providerJobId.
 * Submission is never retried here. Text prepares durable proposals or assistance artifacts;
 * image returns an exact private output locator for the separate verified media archive step.
 * prepare_rework includes the original Take and immutable comment snapshot; it cannot resolve comments or adopt results.
 */
export interface AssistanceAdapter {
  readonly executionMode: "test_fixture" | "verified_provider";
  readonly connectionVersionId: string;
  submitOnce(
    submission: AssistanceSubmission,
    signal: AbortSignal,
  ): Promise<AssistanceSubmissionReceipt>;
  recoverSubmission(
    submission: AssistanceSubmission,
    signal: AbortSignal,
  ): Promise<AssistanceSubmissionReceipt | null>;
  /** Read the saved provider ID. A failed query never permits another submit. */
  query?(
    task: AssistanceProviderTask,
    signal: AbortSignal,
  ): Promise<AssistanceQueryReceipt>;
  /** The worker durably claims this action before calling it, including unknown replies. */
  requestCancel?(
    task: AssistanceProviderTask,
    signal: AbortSignal,
  ): Promise<AssistanceCancelReceipt>;
}

/** Explicit dependency injection for integration tests; never registered by application startup. */
export function createAssistanceFixture(
  connectionVersionId: string,
  execute: (
    submission: AssistanceSubmission,
    signal: AbortSignal,
  ) => Promise<AssistanceSubmissionReceipt>,
  recover: AssistanceAdapter["recoverSubmission"] = async () => null,
  lifecycle: Pick<AssistanceAdapter, "query" | "requestCancel"> = {},
): AssistanceAdapter {
  return {
    executionMode: "test_fixture",
    connectionVersionId,
    submitOnce: execute,
    recoverSubmission: recover,
    ...lifecycle,
  };
}

/** Deterministic local test output, never a claim about model quality. */
export function localAssistanceFixtureOutput(submission: AssistanceSubmission) {
  if (submission.input.purpose !== "creative_assistance")
    return {
      shots: [
        {
          label: "测试建议 01",
          intent: `显式测试 fixture：根据选区准备镜头。${submission.resolvedInput.sourceExcerpt?.quote ?? ""}`,
        },
      ],
    };
  const feedback = submission.resolvedInput.feedbackSnapshot;
  const rework = submission.input.assistance?.kind === "prepare_rework";
  if (rework && !feedback) throw new Error("Fixed Take feedback is required");
  return {
    prompt: `显式测试 fixture：${submission.resolvedInput.prompt}${rework ? `\n固定意见 r${feedback!.commentRevision}：${feedback!.body}` : ""}`,
    referenceSuggestions: submission.resolvedInput.references.map(
      (item) => item.reference,
    ),
    retain: [
      rework
        ? "保留原候选对应的固定镜头版本及明确参考；具体保留项由制作人员核对"
        : "保留明确选定的镜头与参考版本",
    ],
    change: [
      rework
        ? `按固定意见 r${feedback!.commentRevision} 核对修改：${feedback!.body}`
        : "由制作人员核对后再应用到创作输入",
    ],
    notes:
      "无真实模型调用。此建议仅验证固定输入、耐久执行与人工修订；不会解决评论、采用候选或替换画布内容。",
  };
}
