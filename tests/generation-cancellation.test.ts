import assert from "node:assert/strict";
import { test } from "node:test";
import type { components } from "@drama/contracts";
import {
  AssistantSession,
  jobStatusLabel,
  jobFinished,
  type AssistantRecord,
  type AssistantTransport,
} from "../apps/web/src/business/assistant-session.js";
import {
  cancellationDescription,
  canRequestCancellation,
  type AsyncGenerationJob,
} from "../apps/web/src/business/generation-lifecycle.js";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
const plan = { id: "plan-a", status: "consumed" } as Schema<"GenerationPlan">;
const target = { jobId: "job-a", planId: "plan-a" };
function fixture() {
  let saved: AssistantRecord<string> | undefined = {
    schemaVersion: 1,
    draft: "original manual input",
    planId: plan.id,
    execution: {
      planId: plan.id,
      jobId: target.jobId,
      key: "original-execution",
    },
    previous: [],
  };
  let job = {
    id: target.jobId,
    planId: plan.id,
    status: "provider_pending",
    providerJobId: "remote-a",
    cancelStatus: "not_requested",
  } as AsyncGenerationJob;
  const calls: { jobId: string; key: string }[] = [];
  const storage = {
    read: async () => structuredClone(saved),
    write: async (record: AssistantRecord<string>) => {
      saved = structuredClone(record);
    },
    clear: async () => {
      saved = undefined;
    },
  };
  const transport: AssistantTransport = {
    checkAccess: async () => {},
    createPlan: async () => {
      throw Error("unexpected plan POST");
    },
    getPlan: async () => plan,
    execute: async () => {
      throw Error("unexpected execute POST");
    },
    getJob: async () => structuredClone(job),
    findJob: async () => structuredClone(job),
    cancelJob: async (jobId, key) => {
      assert.deepEqual(
        saved?.cancellation,
        { ...target, key },
        "fixed request must be durable before POST",
      );
      calls.push({ jobId, key });
      job = { ...job, status: "cancel_requested", cancelStatus: "requested" };
      return structuredClone(job);
    },
  };
  return {
    storage,
    transport,
    calls,
    saved: () => saved,
    job: () => job,
    setJob: (next: Partial<AsyncGenerationJob>) => {
      job = { ...job, ...next };
    },
    session: () => new AssistantSession<string>(storage, transport),
  };
}
test("accepted and running jobs advance by GET; success after cancellation still preserves results and manual input", async () => {
  const f = fixture(),
    session = f.session();
  await session.load("unused");
  assert.equal(session.getSnapshot().job?.status, "provider_pending");
  f.setJob({ status: "provider_running" });
  await session.refresh();
  assert.equal(session.getSnapshot().job?.status, "provider_running");
  await session.requestCancellation(target);
  f.setJob({
    status: "succeeded",
    mediaIds: ["ready-media"],
    cancelStatus: "unknown",
  });
  await session.refresh();
  assert.deepEqual(session.getSnapshot().job?.mediaIds, ["ready-media"]);
  assert.equal(f.saved()?.draft, "original manual input");
  assert.equal(f.calls.length, 1);
  assert.match(
    cancellationDescription(f.job(), f.saved()?.cancellation)!,
    /本次取消的回执仍未确定/,
  );
});
test("lost cancellation receipt survives reload and known cancellation facts never repeat POST", async () => {
  const f = fixture(),
    send = f.transport.cancelJob;
  f.transport.cancelJob = async (id, key) => {
    await send(id, key);
    throw Error("lost 202");
  };
  const session = f.session();
  await session.load("unused");
  await session.requestCancellation(target);
  const original = structuredClone(f.saved());
  const reopened = f.session();
  await reopened.load("unused");
  await reopened.refresh();
  for (const cancelStatus of [
    "requested",
    "unknown",
    "unsupported",
    "confirmed",
  ] as const) {
    f.setJob({ cancelStatus });
    await reopened.refresh();
    await reopened.requestCancellation(target);
  }
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.saved(), original);
});
test("not-delivered cancellation waits for explicit recovery of the same job and key after reload", async () => {
  const f = fixture();
  f.transport.cancelJob = async (jobId, key) => {
    f.calls.push({ jobId, key });
    throw Error("offline");
  };
  const session = f.session();
  await session.load("unused");
  await session.requestCancellation(target);
  const key = f.saved()?.cancellation?.key;
  assert.ok(key);
  const reopened = f.session();
  await reopened.load("unused");
  await reopened.refresh();
  assert.equal(f.calls.length, 1);
  await reopened.requestCancellation(target);
  assert.deepEqual(f.calls, [
    { jobId: target.jobId, key },
    { jobId: target.jobId, key },
  ]);
});
test("cancel storage failure prevents POST and preserves the original input", async () => {
  const f = fixture(),
    session = f.session();
  await session.load("unused");
  f.storage.write = async () => {
    throw Error("disk unavailable");
  };
  await session.requestCancellation(target);
  assert.equal(f.calls.length, 0);
  assert.equal(f.saved()?.cancellation, undefined);
  assert.equal(f.saved()?.draft, "original manual input");
  assert.match(session.getSnapshot().error!, /disk unavailable/);
});
test("opened cancellation cannot retarget another job and a completed job is only read", async () => {
  const f = fixture(),
    session = f.session();
  await session.load("unused");
  await session.requestCancellation({ ...target, jobId: "different-job" });
  assert.equal(f.calls.length, 0);
  assert.equal(f.saved()?.cancellation, undefined);
  f.setJob({ status: "succeeded", mediaIds: ["completed-first"] });
  await session.requestCancellation(target);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(session.getSnapshot().job?.mediaIds, ["completed-first"]);
});
test("malformed or wrong-target cancellation replies retain an unresolved fixed intent", async () => {
  for (const changes of [
    { id: "other-job" },
    { planId: "other-plan" },
    { cancelStatus: "invented" },
    { cancelRequestedAt: 7 },
    { cancelStatus: "not_requested" },
  ]) {
    const f = fixture(),
      session = f.session();
    await session.load("unused");
    f.transport.cancelJob = async () =>
      ({ ...f.job(), ...changes }) as AsyncGenerationJob;
    await session.requestCancellation(target);
    assert.ok(f.saved()?.cancellation);
    assert.ok(session.getSnapshot().error);
    assert.equal(session.getSnapshot().job?.status, "provider_pending");
  }
});
test("permission recheck precedes cancellation; confirmed revocation hides and clears local recovery", async () => {
  const f = fixture(),
    session = f.session();
  await session.load("unused");
  f.transport.checkAccess = async () => {
    throw Object.assign(Error("denied"), { status: 403 });
  };
  await session.requestCancellation(target);
  assert.equal(f.calls.length, 0);
  assert.equal(f.saved(), undefined);
  assert.equal(session.getSnapshot().record, undefined);
  assert.equal(session.getSnapshot().access, "forbidden");
});
test("late cancellation reply cannot revive a retired session or its durable intent", async () => {
  const f = fixture(),
    session = f.session();
  await session.load("unused");
  let finish!: (job: AsyncGenerationJob) => void, started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.transport.cancelJob = async () => {
    started();
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const cancelling = session.requestCancellation(target);
  await waiting;
  assert.ok(f.saved()?.cancellation);
  await session.retire();
  finish({ ...f.job(), status: "cancelled", cancelStatus: "confirmed" });
  await cancelling;
  assert.equal(f.saved(), undefined);
  assert.equal(session.getSnapshot().job, undefined);
});

test("SQL cancel_requested with unsupported or unknown continues reads; terminal results supersede processing text", async () => {
  for (const cancelStatus of ["requested", "unsupported", "unknown"] as const) {
    const f = fixture(),
      session = f.session();
    await session.load("unused");
    await session.requestCancellation(target);
    f.setJob({ status: "cancel_requested", cancelStatus });
    await session.refresh();
    assert.equal(
      jobFinished(session.getSnapshot().job),
      false,
      "cancellation facts do not stop job reads",
    );
    assert.equal(
      canRequestCancellation(f.job()),
      false,
      "known cancellation fact must not offer another POST",
    );
    assert.match(jobStatusLabel[f.job().status], /原任务.*核对/);
    assert.doesNotMatch(jobStatusLabel[f.job().status], /正在请求取消/);
    for (const status of [
      "succeeded",
      "failed",
      "archiving",
      "archive_failed",
    ] as const) {
      f.setJob({
        status,
        mediaIds: status === "succeeded" ? ["ready-result"] : [],
      });
      await session.refresh();
      const description = cancellationDescription(
        f.job(),
        f.saved()?.cancellation,
      )!;
      assert.doesNotMatch(
        description,
        /原任务继续处理|原任务仍会继续核对|完成后可取回|模型是否取消仍待核对/,
      );
      if (status === "succeeded") {
        assert.match(description, /已完成.*结果仍可取回/);
        assert.deepEqual(session.getSnapshot().job?.mediaIds, ["ready-result"]);
      } else if (status === "failed")
        assert.match(description, /已结束.*未产生可用结果/);
      else assert.match(description, /生成已结束.*保存/);
    }
    assert.equal(f.calls.length, 1);
    assert.equal(f.saved()?.draft, "original manual input");
  }
});
