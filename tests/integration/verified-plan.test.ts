import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { capabilityDefinition, findProfile } from "@drama/provider";
import { imageGenerationFixture } from "../support/image-generation.js";

test("verified capability: blocked until verifiedAt, then ready with a real Seedance estimate", async (t) => {
  const f = await imageGenerationFixture(t, undefined, { purpose: "video" });
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
