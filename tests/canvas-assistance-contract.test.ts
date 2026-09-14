import assert from "node:assert/strict";
import test from "node:test";
import { validateContract } from "@drama/contracts/validation";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const source = { canvasId: id, canvasRevision: 2, nodeId: id };
const input = {
  scope: "project", projectId: id, purpose: "creative_assistance",
  connectionId: id, capabilityId: id, prompt: "只使用明确选中的内容", promptPolicy: "replace",
  output: {}, shotSources: [], contextSources: [], additionalReferences: [], referenceOverrides: [],
  canvasSources: [source],
  assistance: { kind: "prepare_prompt", targetCapabilityId: id, targetCapabilityRevision: 1 },
};

test("zero-shot prompt assistance requires explicit bounded canvas sources", () => {
  assert.equal(validateContract("PlanInput", input).valid, true);
  const { canvasSources: _sources, ...withoutCanvas } = input;
  assert.equal(validateContract("PlanInput", withoutCanvas).valid, false);
  for (const canvasSources of [[], Array.from({ length: 21 }, () => source)])
    assert.equal(validateContract("PlanInput", { ...input, canvasSources }).valid, false);
  assert.equal(validateContract("PlanInput", {
    ...withoutCanvas, shotSources: [{ shotId: id, shotRevisionId: id }],
  }).valid, true);
  for (const change of [
    { purpose: "image" },
    { contextSources: [{ kind: "script", objectId: id, revision: 1 }] },
    { additionalReferences: [{ mediaId: id, purpose: "composition" }] },
    { assistance: { ...input.assistance, kind: "prepare_rework", sourceTakeId: id,
      feedback: { reviewId: id, commentId: id, commentRevision: 1 } } },
  ]) assert.equal(validateContract("PlanInput", { ...input, ...change }).valid, false);
});

test("canvas snapshots preserve the actual content type and exact media purpose", () => {
  const text = { source, kind: "text", content: { type: "text", text: "固定正文" }, contentHash: "a".repeat(64) };
  const image = { source: { ...source, purpose: "composition" }, kind: "image",
    content: { type: "media", mediaId: id }, contentHash: "b".repeat(64) };
  assert.equal(validateContract("CanvasAssistanceSnapshot", text).valid, true);
  assert.equal(validateContract("CanvasAssistanceSnapshot", image).valid, true);
  for (const invalid of [
    { ...image, source }, { ...image, kind: "text" },
    { ...text, content: { type: "text", text: "固定正文", mediaId: id } },
    { ...text, source: { ...source, canvasRevision: 0 } },
  ]) assert.equal(validateContract("CanvasAssistanceSnapshot", invalid).valid, false);
});

test("applying advice fixes its application identity, artifact revision and explicit target", () => {
  const body = { applicationId: id, artifactId: id, artifactRevision: 2, nodeId: id, mode: "append" };
  assert.equal(validateContract("ApplyCanvasAssistance", body).valid, true);
  for (const change of [{ artifactRevision: 0 }, { mode: "generate" }, { prompt: "替换固定建议" }, { nodeId: "" }])
    assert.equal(validateContract("ApplyCanvasAssistance", { ...body, ...change }).valid, false);
  const { applicationId: _application, ...unidentified } = body;
  assert.equal(validateContract("ApplyCanvasAssistance", unidentified).valid, false);
});
