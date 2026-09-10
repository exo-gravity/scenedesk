import type { components } from "@drama/contracts";
type Status = components["schemas"]["GenerationJob"]["status"];
export type Scenario = "accepted" | "rejected" | "lost_reply";
// In-memory fault lab only. No credentials, HTTP, persistence, media, or billing.
export class MockDispatchLab {
  status: Status = "queued";
  submitCount = 0;
  providerJobId?: string;
  readonly evidence = new Set<string>();
  constructor(readonly scenario: Scenario) {}
  dispatch() {
    if (this.status !== "queued") return this.snapshot();
    // A production worker MUST persist dispatching + attempt before any network call.
    this.status = "dispatching";
    this.submitCount++;
    if (this.scenario === "lost_reply") this.status = "submission_unknown";
    else if (this.scenario === "rejected") this.status = "failed";
    else this.receive("mock-provider-job-1");
    return this.snapshot();
  }
  receive(providerJobId: string) {
    if (!providerJobId || this.submitCount !== 1 || this.status === "failed")
      throw new Error("No submitted intent for this receipt");
    if (this.evidence.has(providerJobId)) return this.snapshot();
    this.evidence.add(providerJobId);
    if (this.providerJobId && this.providerJobId !== providerJobId)
      this.status = "reconciliation_required";
    else {
      this.providerJobId = providerJobId;
      this.status = "provider_pending";
    }
    return this.snapshot();
  }
  snapshot() {
    return {
      status: this.status,
      submitCount: this.submitCount,
      providerJobId: this.providerJobId,
      evidenceCount: this.evidence.size,
    };
  }
}
