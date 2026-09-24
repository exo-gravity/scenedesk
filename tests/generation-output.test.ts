import assert from "node:assert/strict";
import { test } from "node:test";
import { PROFILES, capabilityDefinition } from "@drama/provider";
import {
  aspectRatioOptions,
  qualityOptions,
} from "../apps/web/src/business/generation-specification.js";
import {
  imageOutput,
  type ImageCapability,
} from "../apps/web/src/business/image-generation.js";
import { videoOutput } from "../apps/web/src/business/video-generation.js";

test("every offered profile specification can become a generation request in each input mode", () => {
  for (const profile of PROFILES) {
    for (const mode of profile.modes) {
      const capability: ImageCapability = {
        ...capabilityDefinition(profile, mode, {}),
        id: "capability",
        connectionId: "connection",
        revision: 1,
        enabled: true,
      };
      const validate = profile.purpose === "image" ? imageOutput : videoOutput;
      for (const aspectRatio of aspectRatioOptions(capability)) {
        for (const { resolution } of qualityOptions(capability, aspectRatio)) {
          const output = {
            resolution,
            aspectRatio,
            ...(profile.duration
              ? { durationSeconds: profile.duration.min }
              : {}),
          };
          assert.doesNotThrow(
            () => assert.equal(validate(capability, output).resolution, resolution),
            `${profile.id}/${mode}/${aspectRatio}/${resolution}`,
          );
        }
      }
    }
  }
});

const paired = {
  allowedResolutions: ["1424x800", "800x1424", "1024x1024"],
  allowedAspectRatios: ["16:9", "9:16", "1:1"],
  outputs: [
    { resolution: "1424x800", aspectRatio: "16:9", quality: "1K" },
    { resolution: "800x1424", aspectRatio: "9:16", quality: "1K" },
  ],
} as ImageCapability;

test("paired output rejects unrelated allowed sizes and ratios without requiring an optional ratio", () => {
  assert.deepEqual(imageOutput(paired, { resolution: "1424x800" }), {
    resolution: "1424x800",
  });
  assert.throws(
    () => imageOutput(paired, { resolution: "1424x800", aspectRatio: "9:16" }),
    /不匹配/,
  );
  // A flat allowlist cannot broaden an explicit output table.
  assert.throws(
    () => imageOutput(paired, { resolution: "1024x1024", aspectRatio: "1:1" }),
    /不匹配/,
  );
  assert.throws(() => imageOutput(paired, { resolution: "1024x1024" }), /不匹配/);
});

test("legacy capabilities retain exact geometry and optional-ratio behavior", () => {
  const { outputs: _outputs, ...withoutPairs } = paired;
  const legacy = {
    ...withoutPairs,
    allowedResolutions: ["1280x720", "864x496"],
  };
  assert.equal(
    imageOutput(legacy, { resolution: "1280x720", aspectRatio: "16:9" }).resolution,
    "1280x720",
  );
  assert.deepEqual(imageOutput(legacy, { resolution: "864x496" }), {
    resolution: "864x496",
  });
  assert.throws(
    () => imageOutput(legacy, { resolution: "864x496", aspectRatio: "16:9" }),
    /不匹配/,
  );
});
