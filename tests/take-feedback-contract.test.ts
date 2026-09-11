import assert from "node:assert/strict";
import test from "node:test";
import { validateContract } from "@drama/contracts/validation";

test("only rework assistance requires the exact opened comment revision", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const feedback = { reviewId: id, commentId: id };
  assert.equal(validateContract("ReworkLink", feedback).valid, true);
  const input = {
    kind: "prepare_rework",
    targetCapabilityId: id,
    targetCapabilityRevision: 1,
    sourceTakeId: id,
    feedback,
  };
  assert.equal(validateContract("AssistanceRequest", input).valid, false);
  for (const commentRevision of [0, -1, 1.5, "1"])
    assert.equal(
      validateContract("AssistanceRequest", {
        ...input,
        feedback: { ...feedback, commentRevision },
      }).valid,
      false,
    );
  assert.equal(
    validateContract("AssistanceRequest", {
      ...input,
      feedback: { ...feedback, commentRevision: 1 },
    }).valid,
    true,
  );
  assert.equal(
    validateContract("AssistanceRequest", {
      kind: "prepare_prompt",
      targetCapabilityId: id,
      targetCapabilityRevision: 1,
    }).valid,
    true,
  );
});
