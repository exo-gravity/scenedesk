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
export type AssistanceReceipt =
  | {
      kind: "completed";
      output: unknown;
      correlation: string;
      usage?: Record<string, number>;
    }
  | { kind: "rejected"; correlation: string; code: string }
  | { kind: "unknown"; correlation: string };

/** Fixed-plan transport boundary; synchronous responses have no fabricated providerJobId.
 * Submission is never retried here. Text prepares durable proposals or assistance artifacts;
 * image returns an exact private output locator for the separate verified media archive step.
 * prepare_rework remains unavailable until real review/comment sources exist.
 */
export interface AssistanceAdapter {
  readonly executionMode: "test_fixture" | "verified_provider";
  readonly connectionVersionId: string;
  submitOnce(
    submission: AssistanceSubmission,
    signal: AbortSignal,
  ): Promise<AssistanceReceipt>;
  recoverSubmission(
    submission: AssistanceSubmission,
    signal: AbortSignal,
  ): Promise<AssistanceReceipt | null>;
}

/** Explicit dependency injection for integration tests; never registered by application startup. */
export function createAssistanceFixture(
  connectionVersionId: string,
  execute: (
    submission: AssistanceSubmission,
    signal: AbortSignal,
  ) => Promise<AssistanceReceipt>,
  recover: AssistanceAdapter["recoverSubmission"] = async () => null,
): AssistanceAdapter {
  return {
    executionMode: "test_fixture",
    connectionVersionId,
    submitOnce: execute,
    recoverSubmission: recover,
  };
}
