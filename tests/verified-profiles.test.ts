import { test } from "node:test";
import assert from "node:assert/strict";
import { validateContract } from "@drama/contracts/validation";
import {
  PROFILES, findProfile, resolveOutput, capabilityDefinition, estimateCost, VerifiedProfileError,
} from "@drama/provider";

test("every profile derives a contract-valid capability definition per mode", () => {
  for (const profile of PROFILES) {
    if (Object.keys(profile.outputs).length === 0) continue; // H3 until measured
    for (const mode of profile.modes) {
      const definition = capabilityDefinition(profile, mode, {});
      const result = validateContract("Capability", {
        ...definition, id: "00000000-0000-4000-8000-000000000000",
        connectionId: "00000000-0000-4000-8000-000000000001", revision: 1, enabled: false,
      });
      assert.ok(result.valid, `${profile.id}/${mode}: ${JSON.stringify(result.errors)}`);
      assert.equal(definition.modelVersion, profile.id);
      assert.equal(definition.mode, mode);
      assert.equal(definition.executionMode, "verified_provider");
    }
  }
});
test("H3 exposes only its measured 768P outputs in both modes and still refuses an unmeasured size", () => {
  const h3 = findProfile("minimax/MiniMax-H3")!;
  const definition = capabilityDefinition(h3, "frames_v1", {});
  assert.deepEqual(definition.allowedResolutions, ["1344x768", "768x1344"]);
  assert.deepEqual(definition.allowedAspectRatios, ["16:9", "9:16"]);
  assert.deepEqual(resolveOutput(h3, "1344x768"), { resolution: "768P", ratio: "16:9" });
  assert.deepEqual(resolveOutput(h3, "768x1344"), { resolution: "768P", ratio: "9:16" });
  assert.deepEqual(capabilityDefinition(h3, "reference_v1", {}).supportedPurposes, ["identity", "look", "style", "location", "prop", "composition"]);
  assert.throws(() => resolveOutput(h3, "1366x768"), (e: VerifiedProfileError) => e.code === "OUTPUT_NOT_IN_PROFILE");
  assert.throws(() => capabilityDefinition({ ...h3, outputs: {} }, "frames_v1", {}), (e: VerifiedProfileError) => e.code === "OUTPUTS_UNMEASURED");
});
test("frames_v1 exposes start/end frame purposes; reference_v1 exposes reference purposes", () => {
  const seedance = findProfile("volcengine/doubao-seedance-2-0-260128")!;
  assert.deepEqual(capabilityDefinition(seedance, "frames_v1", {}).supportedPurposes, ["start_frame", "end_frame"]);
  assert.deepEqual(capabilityDefinition(seedance, "reference_v1", {}).supportedPurposes,
    ["identity", "look", "style", "location", "prop", "composition"]);
  assert.deepEqual(capabilityDefinition(seedance, "frames_v1", {}).inputRules!.map((r) => r.maxCount), [1, 1]);
});
test("resolveOutput maps pixel sizes to vendor tiers and rejects unknown sizes", () => {
  const seedance = findProfile("volcengine/doubao-seedance-2-0-mini-260615")!;
  assert.deepEqual(resolveOutput(seedance, "720x1280"), { resolution: "720p", ratio: "9:16" });
  assert.throws(() => resolveOutput(seedance, "1920x1080"), (e: VerifiedProfileError) => e.code === "OUTPUT_NOT_IN_PROFILE");
});
test("estimateCost: Seedance 720p 5s no video input = 4.968 CNY base + 20% hold", () => {
  const seedance = findProfile("volcengine/doubao-seedance-2-0-260128")!;
  const estimate = estimateCost(seedance, { references: [], output: { resolution: "1280x720", durationSeconds: 5, withAudio: true } } as any);
  assert.equal(estimate.baseCost.amountMicros, "4968000");
  assert.equal(estimate.holdMargin.amountMicros, "993600");
  assert.equal(estimate.totalReservation.amountMicros, "5961600");
  assert.equal(estimate.pricingRevision, seedance.pricing.revision);
});
test("estimateCost: Seedream pro 2K single image with 3 references = 0.60 + 2×0.02", () => {
  const pro = findProfile("volcengine/doubao-seedream-5-0-pro-260628")!;
  const refs = [1, 2, 3].map(() => ({ reference: { mediaId: "x", purpose: "identity" }, sourceLevel: "shot" }));
  const estimate = estimateCost(pro, { references: refs, output: { resolution: "2048x2048" } } as any);
  assert.equal(estimate.baseCost.amountMicros, "640000");
});
test("estimateCost: MiniMax per-second with 7 reference images charges 2 extra", () => {
  const h3 = findProfile("minimax/MiniMax-H3")!;
  const refs = Array.from({ length: 7 }, () => ({ reference: { mediaId: "x", purpose: "identity" }, sourceLevel: "shot" }));
  const estimate = estimateCost(h3, { references: refs, output: { resolution: "768P", durationSeconds: 6, withAudio: true } } as any);
  assert.equal(estimate.baseCost.amountMicros, String(6 * 500000 + 2 * 200000));
});
