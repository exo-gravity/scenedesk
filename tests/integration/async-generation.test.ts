import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { imageGenerationFixture } from "../support/image-generation.js";
import { Database } from "../../apps/api/src/kernel/database.js";
import { localAssistanceFixtureOutput, createAssistanceFixture, type AssistanceSubmission, type AssistanceReceipt } from "@drama/provider";
import { createAssistanceWorker } from "../../apps/api/src/modules/generation/worker.js";

test("asynchronous provider identity, observation and cancellation remain durable and isolated", async (t) => {
  const f = await imageGenerationFixture(t);
  const db = new Database(f.runtime, f.schema);
  const cap = async (maxInflight = 2, media = false) => {
    const capabilityId = randomUUID(), connectionId = randomUUID(), connectionVersionId = randomUUID();
    await f.admin.query(`INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,$6,100)`, [capabilityId, f.tenant.id, connectionId, connectionVersionId, media ? f.definition : { purpose: "creative_assistance", mode: "structured_text_fixture", modelVersion: "明确本地协议验证", supportedPurposes: [] }, maxInflight]);
    return { capabilityId, connectionId, connectionVersionId, media };
  };
  const make = async (selected?: Awaited<ReturnType<typeof cap>>) => {
    const c = selected ?? await cap();
    const plan = await f.plan({ capabilityId: c.capabilityId, connectionId: c.connectionId,
      ...(c.media ? {} : { purpose: "creative_assistance", output: {}, assistance: { kind: "prepare_prompt", targetCapabilityId: f.input.capabilityId, targetCapabilityRevision: 1 } }) });
    assert.equal(plan.status, "ready", JSON.stringify(plan.blockingReasons));
    return { job: await f.execute(plan.id), plan, cap: c };
  };
  const claim = async (id: string) => (await f.generationDb.query(`SELECT ${f.scope}.claim_generation_job($1,$2) AS data`, [id, randomUUID()])).rows[0].data as AssistanceSubmission | null;
  const read = async (id: string) => (await f.generationDb.query(`SELECT ${f.scope}.read_generation_evidence($1) AS data`, [id])).rows[0].data;
  const observe = async (id: string, token = randomUUID()) => (await f.generationDb.query(`SELECT ${f.scope}.claim_generation_observation($1,$2) AS data`, [id, token])).rows[0].data;
  const release = async (id: string, token: string, failed = false, delay = 5) => (await f.generationDb.query(`SELECT ${f.scope}.release_generation_observation($1,$2,$3,$4) AS data`, [id, token, delay, failed])).rows[0].data;
  const due = (id: string) => f.admin.query(`UPDATE ${f.scope}.generation_observation_control SET next_observation_at=now(),lease_until=CASE WHEN lease_until IS NULL THEN NULL ELSE now()-interval '1 second' END WHERE job_id=$1`, [id]);
  const persist = async (s: AssistanceSubmission, receipt: AssistanceReceipt) => {
    const id = (await f.generationDb.query(`SELECT ${f.scope}.record_generation_evidence($1,$2,$3) AS id`, [s.attemptId, randomUUID(), receipt])).rows[0].id;
    await f.generationDb.query(`SELECT ${f.scope}.finish_generation_job($1,$2,$3,NULL)`, [s.jobId, id, receipt.kind === "completed" ? JSON.stringify(receipt.output) : null]);
    return id as string;
  };
  const accept = async (s: AssistanceSubmission, providerJobId = randomUUID()) => {
    await persist(s, { kind: "accepted", correlation: s.attemptId, providerJobId });
    return providerJobId;
  };
  const cancel = async (id: string, key = randomUUID(), actor = f.owner) => {
    const r = await f.request("POST", `${f.base}/generation-jobs/${id}/cancel`, undefined, undefined, key, actor);
    assert.equal(r.statusCode, 202, r.body);
    return r.json();
  };

  await t.test("accepted identity survives restart, concurrent query leases and monotone pending/running observations", async () => {
    const { job } = await make(), s = (await claim(job.id))!, id = await accept(s);
    assert.equal((await f.job(job.id)).providerJobId, id);
    const leases = await Promise.all([observe(job.id), observe(job.id)]);
    assert.equal(leases.filter(Boolean).length, 1);
    const lease = leases.find(Boolean);
    assert.equal(lease.action, "query");
    assert.equal(lease.providerJobId, id);
    assert.equal(lease.observationFailures, 0);
    assert.equal((await read(job.id)).observationFailures, 1);
    assert.equal(await release(job.id, randomUUID()), false);
    await persist(s, { kind: "running", correlation: s.attemptId, providerJobId: id });
    const version = (await f.job(job.id)).revision;
    await persist(s, { kind: "pending", correlation: s.attemptId, providerJobId: id });
    assert.equal((await f.job(job.id)).status, "provider_running");
    assert.equal((await f.job(job.id)).revision, version);
    assert.equal(await release(job.id, lease.leaseToken, true), true);
    assert.equal(await observe(job.id), null);
    await due(job.id);
    const restarted = await observe(job.id);
    assert.equal(restarted.observationFailures, 1);
    assert.equal(restarted.action, "query");
    await release(job.id, restarted.leaseToken, false);
    assert.equal((await read(job.id)).observationFailures, 0);
    assert.equal(await claim(job.id), null);
    const completed = { kind: "completed" as const, correlation: s.attemptId, providerJobId: id, output: localAssistanceFixtureOutput(s) };
    const evidence = await persist(s, completed);
    assert.equal((await f.job(job.id)).status, "succeeded");
    const resultVersion = (await f.job(job.id)).revision;
    assert.equal(await persist(s, completed), evidence);
    await persist(s, { kind: "accepted", correlation: s.attemptId, providerJobId: id });
    assert.equal((await f.job(job.id)).revision, resultVersion);
    assert.equal((await f.admin.query(`SELECT count(*) FROM ${f.scope}.assistance_artifacts WHERE generation_job_id=$1`, [job.id])).rows[0].count, "1");
  });

  await t.test("queued cancellation never creates an attempt and dispatched unknown cancellation preserves both facts", async () => {
    const queued = await make();
    const q = await cancel(queued.job.id);
    assert.equal(q.status, "cancelled");
    assert.equal(q.cancelStatus, "confirmed");
    assert.equal(await claim(q.id), null);
    const { job } = await make(), s = (await claim(job.id))!;
    const before = await cancel(job.id);
    assert.equal(before.status, "dispatching");
    assert.equal(before.cancelStatus, "requested");
    await persist(s, { kind: "unknown", correlation: s.attemptId });
    const unknown = await f.job(job.id);
    assert.equal(unknown.status, "submission_unknown");
    assert.equal(unknown.cancelStatus, "requested");
    assert.equal((await observe(job.id)).action, "recover");
    await due(job.id);
    const id = await accept(s);
    assert.equal((await f.job(job.id)).status, "cancel_requested");
    const intent = await observe(job.id);
    assert.equal(intent.action, "cancel");
    // Crash after the committed cancel claim: even without a response it cannot be sent twice.
    await due(job.id);
    const next = await observe(job.id);
    assert.equal(next.action, "query");
    assert.equal((await f.job(job.id)).cancelStatus, "unknown");
    assert.equal(await release(job.id, intent.leaseToken), false);
    const output = localAssistanceFixtureOutput(s);
    await persist(s, { kind: "completed", correlation: s.attemptId, providerJobId: id, output });
    assert.equal((await f.job(job.id)).status, "succeeded");
    assert.equal((await f.job(job.id)).cancelStatus, "unknown");
  });

  await t.test("cancellation request replay is one durable intent and known cancellation is a distinct terminal observation", async () => {
    const { job } = await make(), s = (await claim(job.id))!, id = await accept(s);
    const key = randomUUID(), first = await cancel(job.id, key);
    await cancel(job.id, key);
    const again = await cancel(job.id);
    assert.equal(first.cancelRequestedAt, again.cancelRequestedAt);
    assert.equal(first.revision, again.revision);
    const lease = await observe(job.id);
    assert.equal(lease.action, "cancel");
    await persist(s, { kind: "cancel_requested", correlation: s.attemptId, providerJobId: id });
    assert.equal((await f.job(job.id)).status, "cancel_requested");
    await release(job.id, lease.leaseToken);
    await due(job.id);
    assert.equal((await observe(job.id)).action, "query");
    await persist(s, { kind: "cancelled", correlation: s.attemptId, providerJobId: id });
    const ended = await f.job(job.id);
    assert.equal(ended.status, "cancelled");
    assert.equal(ended.cancelStatus, "confirmed");
    await persist(s, { kind: "pending", correlation: s.attemptId, providerJobId: id });
    assert.equal((await f.job(job.id)).revision, ended.revision);
  });

  await t.test("conflicting provider IDs are immutable evidence and cannot be rebound or queried", async () => {
    const { job } = await make(), s = (await claim(job.id))!, id = await accept(s);
    await accept(s, randomUUID());
    const conflict = await f.job(job.id);
    assert.equal(conflict.status, "reconciliation_required");
    assert.equal(conflict.errorCode, "CONFLICTING_SUBMISSION_EVIDENCE");
    assert.equal(conflict.providerJobId, id);
    assert.equal(await observe(job.id), null);
    const c = await cap(), a = await make(c), b = await make(c);
    const sa = (await claim(a.job.id))!, sb = (await claim(b.job.id))!, sharedId = await accept(sa);
    await accept(sb, sharedId);
    assert.equal((await f.job(b.job.id)).errorCode, "CONFLICTING_PROVIDER_ID");
    assert.equal((await f.job(b.job.id)).providerJobId, undefined);
    assert.equal((await f.admin.query(`SELECT count(*) FROM ${f.scope}.generation_provider_bindings WHERE connection_version_id=$1`, [c.connectionVersionId])).rows[0].count, "1");
  });

  await t.test("accepted and cancelled-but-unconfirmed jobs still occupy the shared capability limit", async () => {
    const c = await cap(1), a = await make(c), b = await make(c);
    const s = (await claim(a.job.id))!, id = await accept(s);
    assert.equal(await claim(b.job.id), null);
    await cancel(a.job.id);
    assert.equal(await claim(b.job.id), null);
    await persist(s, { kind: "failed", correlation: s.attemptId, providerJobId: id, code: "PROVIDER_TEST_FAILURE" });
    assert.ok(await claim(b.job.id));
  });

  await t.test("public cached cancellation is checked against current membership and private worker state stays inaccessible", async () => {
    const { job } = await make();
    const actor = await f.identity("async-collaborator"), membershipId = randomUUID();
    await f.admin.query(`INSERT INTO ${f.scope}.memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')`, [membershipId, f.tenant.id, actor.userId]);
    await f.admin.query(`INSERT INTO ${f.scope}.project_memberships(id,tenant_id,project_id,membership_id,role) VALUES($1,$2,$3,$4,'collaborator')`, [randomUUID(), f.tenant.id, f.project.id, membershipId]);
    const key = randomUUID();
    await cancel(job.id, key, actor);
    await f.admin.query(`DELETE FROM ${f.scope}.project_memberships WHERE membership_id=$1`, [membershipId]);
    const replay = await f.request("POST", `${f.base}/generation-jobs/${job.id}/cancel`, undefined, undefined, key, actor);
    assert.equal(replay.statusCode, 404);
    await assert.rejects(f.runtime.query(`SELECT ${f.scope}.claim_generation_observation($1,$2)`, [job.id, randomUUID()]), /permission denied/);
    await assert.rejects(f.generationDb.query(`SELECT * FROM ${f.scope}.generation_provider_bindings`), /permission denied/);
    await assert.rejects(f.generationDb.query(`SELECT ${f.scope}.finish_generation_output($1,$2,NULL,NULL)`, [job.id, randomUUID()]), /permission denied/);
    await assert.rejects(db.transaction(f.owner.token, { tenantId: f.tenant.id, projectId: f.project.id, write: true }, tx => tx.sql.query("UPDATE generation_jobs SET status='provider_running' WHERE id=$1", [job.id])), /permission denied/);
    await assert.rejects(db.transaction(f.owner.token, { tenantId: f.tenant.id, projectId: f.project.id, write: true }, tx => tx.sql.query("INSERT INTO generation_observation_control(job_id) VALUES($1)", [job.id])), /permission denied/);
  });

  await t.test("accepted original identity remains recoverable after capability disable and missing query transport", async () => {
    const c = await cap(), { job } = await make(c);
    let submits = 0;
    const adapter = createAssistanceFixture(c.connectionVersionId, async s => { submits++; return { kind: "accepted", correlation: s.attemptId, providerJobId: "local-task-no-query" }; });
    const worker = await createAssistanceWorker({ pool: f.generationDb, schema: f.schema, adapters: [adapter] });
    await worker.process(job.id);
    await f.admin.query(`UPDATE ${f.scope}.generation_capabilities SET enabled=false WHERE id=$1`, [c.capabilityId]);
    await worker.reconcile(job.id);
    const state = await read(job.id);
    assert.equal(state.providerJobId, "local-task-no-query");
    assert.equal(state.status, "provider_pending");
    assert.equal(state.observationFailures, 1);
    assert.ok(state.evidence.some((e: any) => e.body.kind === "unavailable" && e.body.code === "QUERY_ADAPTER_NOT_CONFIGURED"));
    await worker.process(job.id);
    assert.equal(submits, 1);
  });

  await t.test("completed asynchronous media enters existing archive transaction without manufacturing ready media", async () => {
    const { job } = await make(await cap(2, true)), s = (await claim(job.id))!, id = await accept(s);
    const output = { images: [{ kind: "fixture_object", object: { key: `originals/${randomUUID()}`, versionId: "db-fixture", bytes: 100 }, sha256: "b".repeat(64), mime: "image/png" }] };
    await persist(s, { kind: "completed", correlation: s.attemptId, providerJobId: id, output });
    assert.equal((await f.job(job.id)).status, "archiving");
    const media = (await f.admin.query(`SELECT status,source_job_id FROM ${f.scope}.media WHERE source_job_id=$1`, [job.id])).rows;
    assert.deepEqual(media, [{ status: "processing", source_job_id: job.id }]);
    assert.equal((await f.envelope(job.id)).taskKind, "media_generation");
    assert.equal((await f.admin.query(`SELECT count(*) FROM ${f.scope}.takes WHERE media_id=$1`, [job.id])).rows[0].count, "0");
  });
});
