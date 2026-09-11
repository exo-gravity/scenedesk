import assert from "node:assert/strict";
import { test } from "node:test";
import { validateContract } from "@drama/contracts/validation";

test("asynchronous and cancellation facts preserve old GenerationJob responses", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const zero = { currency: "CNY", amountMicros: "0" };
  const job = { id, revision: 1, scope: "project", projectId: id, planId: id, status: "submission_unknown", mediaIds: [], reservationStatus: "held", inputOutdated: false, connectionVersionId: id, costStatus: "final", confirmedCost: zero, reservationRemaining: zero, finalCost: zero, recoveryEpoch: 1 };
  assert.equal(validateContract("GenerationJob", job).valid, true);
  for (const cancelStatus of ["not_requested", "requested", "unsupported", "unknown", "confirmed"])
    assert.equal(validateContract("GenerationJob", { ...job, cancelStatus, cancelRequestedAt: "2026-09-12T00:00:00Z" }).valid, true);
  for (const status of ["provider_pending", "provider_running", "cancel_requested"])
    assert.equal(validateContract("GenerationJob", { ...job, status, providerJobId: "original-provider-task" }).valid, true);
  assert.equal(validateContract("GenerationJob", { ...job, cancelStatus: "cancelled" }).valid, false);
  assert.equal(validateContract("GenerationJob", { ...job, cancelRequestedAt: "yesterday" }).valid, false);
});
