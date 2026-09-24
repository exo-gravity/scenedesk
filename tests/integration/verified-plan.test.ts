import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PROFILES, capabilityDefinition, findProfile } from "@drama/provider";
import { aspectRatioOptions, qualityOptions } from "../../apps/web/src/business/generation-specification.js";
import { imageGenerationFixture } from "../support/image-generation.js";

test("every offered verified output pair prepares a fixed plan; mixing two allowed ratios and sizes is rejected", async (t) => {
  const f = await imageGenerationFixture(t);
  for (const profile of PROFILES) for (const mode of profile.modes) {
    const id = randomUUID();
    const definition = capabilityDefinition(profile, mode, { verifiedAt: new Date().toISOString() });
    await f.admin.query(
      `INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'verified_provider',true,2,200)`,
      [id, f.tenant.id, f.input.connectionId, randomUUID(), definition],
    );
    const prepare = (output: Record<string, unknown>) => f.request("POST", `${f.base}/generation-plans`, {
      ...f.input, purpose: profile.purpose, capabilityId: id, output,
    });
    for (const aspectRatio of aspectRatioOptions(definition)) {
      for (const { resolution } of qualityOptions(definition, aspectRatio)) {
        const output = { resolution, aspectRatio, ...(profile.duration ? { durationSeconds: profile.duration.min } : {}) };
        const response = await prepare(output);
        assert.equal(response.statusCode, 201, `${profile.id}/${mode}: ${response.body}`);
        const plan = response.json();
        assert.equal(plan.status, "ready");
        assert.equal(plan.resolvedInput.output.resolution, resolution);
        assert.equal(plan.resolvedInput.output.aspectRatio, aspectRatio);
        assert.deepEqual(plan.resolvedInput.capabilitySnapshot.outputs, definition.outputs);
      }
    }
    const first = definition.outputs![0]!;
    const wrongRatio = definition.allowedAspectRatios!.find((ratio) => ratio !== first.aspectRatio)!;
    const duration = profile.duration ? { durationSeconds: profile.duration.min } : {};
    const rejected = await prepare({ resolution: first.resolution, aspectRatio: wrongRatio, ...duration });
    assert.equal(rejected.statusCode, 422, rejected.body);
    assert.equal(rejected.json().code, "IMAGE_OUTPUT_UNSUPPORTED");
    const omitted = await prepare({ resolution: first.resolution, ...duration });
    assert.equal(omitted.statusCode, 201, omitted.body);
    assert.equal(omitted.json().resolvedInput.output.aspectRatio, undefined);
  }
  assert.equal(f.calls(), 0);
});

test("verified capability: blocked until verifiedAt, then ready with a real Seedance estimate", async (t) => {
  const f = await imageGenerationFixture(t, undefined, { purpose: "video", generationExecutor: true });
  const profile = findProfile("volcengine/doubao-seedance-2-0-260128")!;
  const insert = (id: string, definition: unknown) =>
    f.admin.query(
      `INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'verified_provider',true,3,200)`,
      [id, f.tenant.id, f.input.connectionId, randomUUID(), definition],
    );
  const unverified = randomUUID(), verified = randomUUID();
  await insert(unverified, capabilityDefinition(profile, "frames_v1", {}));
  await insert(verified, capabilityDefinition(profile, "frames_v1", { verifiedAt: new Date().toISOString() }));
  const body = { ...f.input, output: { resolution: "1280x720", aspectRatio: "16:9", durationSeconds: 5, withAudio: true } };
  const blocked = await f.ok("POST", `${f.base}/generation-plans`, { ...body, capabilityId: unverified });
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.blockingReasons.includes("REAL_PROVIDER_ACCEPTANCE_REQUIRED"));
  const ready = await f.ok("POST", `${f.base}/generation-plans`, { ...body, capabilityId: verified });
  assert.equal(ready.status, "ready");
  assert.equal(ready.costEstimate.pricingRevision, "ark-cn-2026-09-22");
  assert.equal(ready.costEstimate.totalReservation.amountMicros, "5961600");
  assert.equal(ready.resolvedInput.capabilitySnapshot.mode, "frames_v1");
  const rejected = await f.request("POST", `${f.base}/generation-plans`, { ...body, capabilityId: verified, output: { resolution: "1234x567", durationSeconds: 5 } });
  assert.equal(rejected.statusCode, 422);
  const job = await f.request("POST", `${f.base}/generation-jobs`, { planId: ready.id });
  assert.equal(job.statusCode, 202, job.body);
  assert.equal(job.json().costStatus, "pending");
});
test("without a declared executor the API refuses a verified-provider job with 503 and keeps the plan ready", async (t) => {
  const f = await imageGenerationFixture(t, undefined, { purpose: "video" });
  const profile = findProfile("volcengine/doubao-seedance-2-0-mini-260615")!;
  const verified = randomUUID();
  await f.admin.query(
    `INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'verified_provider',true,2,20)`,
    [verified, f.tenant.id, f.input.connectionId, randomUUID(), capabilityDefinition(profile, "frames_v1", { verifiedAt: new Date().toISOString() })],
  );
  const ready = await f.ok("POST", `${f.base}/generation-plans`, { ...f.input, capabilityId: verified, output: { resolution: "1280x720", aspectRatio: "16:9", durationSeconds: 4, withAudio: true } });
  assert.equal(ready.status, "ready");
  const refused = await f.request("POST", `${f.base}/generation-jobs`, { planId: ready.id });
  assert.equal(refused.statusCode, 503, refused.body);
  assert.equal(refused.json().code, "GENERATION_EXECUTOR_UNAVAILABLE");
  const again = await f.ok("GET", `${f.base}/generation-plans/${ready.id}`);
  assert.equal(again.status, "ready");
  assert.deepEqual((await f.ok("GET", `${f.base}/generation-jobs?scope=project&projectId=${f.project.id}&planId=${ready.id}`)).items, []);
});
