import assert from "node:assert/strict";
import test from "node:test";
import { validateContract } from "@drama/contracts/validation";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const input = {
  scope: "project",
  projectId: id,
  purpose: "creative_assistance",
  connectionId: id,
  capabilityId: id,
  prompt: "讨论一下镜头节奏",
  promptPolicy: "replace",
  output: {},
  shotSources: [],
  canvasSources: [],
  contextSources: [],
  additionalReferences: [],
  referenceOverrides: [],
  assistance: { kind: "discuss", canvasId: id },
};
test("discussion fixes a real canvas with optional nodes and never requires a media target", () => {
  assert.equal(validateContract("PlanInput", input).valid, true);
  assert.equal(
    validateContract("PlanInput", {
      ...input,
      assistanceSource: { artifactId: id, revision: 1 },
    }).valid,
    true,
  );
  for (const change of [
    { prompt: "" },
    { assistance: { kind: "discuss" } },
    {
      assistance: {
        ...input.assistance,
        targetCapabilityId: id,
        targetCapabilityRevision: 1,
      },
    },
    { shotSources: [{ shotId: id, shotRevisionId: id }] },
    { contextSources: [{ kind: "scene", objectId: id, revision: 1 }] },
    { output: { resolution: "32x32" } },
    { additionalReferences: [{ mediaId: id, purpose: "composition" }] },
    {
      canvasSources: Array.from({ length: 21 }, () => ({
        canvasId: id,
        canvasRevision: 1,
        nodeId: id,
      })),
    },
  ])
    assert.equal(
      validateContract("PlanInput", { ...input, ...change }).valid,
      false,
      JSON.stringify(change),
    );
});
