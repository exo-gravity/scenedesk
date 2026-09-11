import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AssistantSession,
  planForDraft,
  selectedRange,
  type AssistantDraft,
  type AssistantRecord,
  type AssistantTransport,
} from "../apps/web/src/business/assistant-session.js";
import type { components } from "@drama/contracts";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
const draft: AssistantDraft = {
  scriptId: "script-1",
  quote: "她😀抬头。",
  range: { startOffset: 0, endOffset: 5 },
  prompt: "保留对白",
  capabilityId: "cap-1",
  modelLabel: "受控测试能力",
  context: [],
  target: {
    mode: "append_to_scene",
    sceneId: "scene-1",
    sceneRevision: 2,
    episodeId: "episode-1",
  },
};
const capability = {
  id: "cap-1",
  connectionId: "connection-1",
  enabled: true,
  purpose: "script_analysis",
} as Schema<"Capability">;
const input = planForDraft(draft, "project-1", capability);
const plan: Schema<"GenerationPlan"> = {
  id: "plan-1",
  revision: 1,
  input,
  capabilityRevision: 3,
  inputHash: "fixed",
  expiresAt: "2099-01-01T00:00:00Z",
  status: "ready",
  blockingReasons: [],
  resolvedInput: {
    resolverVersion: "1",
    prompt: "保留对白",
    references: [],
    shots: [],
    dependencies: [],
  },
  connectionVersionId: "connection-version-1",
};
const job = {
  id: "job-1",
  planId: plan.id,
  status: "submission_unknown",
} as Schema<"GenerationJob">;
function fixture() {
  let saved: AssistantRecord | undefined;
  const calls: { kind: string; key?: string; input?: Schema<"PlanInput"> }[] =
    [];
  const storage = {
    clear: async () => {
      saved = undefined;
    },
    read: async () => structuredClone(saved),
    write: async (record: AssistantRecord) => {
      saved = structuredClone(record);
    },
  };
  const transport: AssistantTransport = {
    checkAccess: async () => {},
    cancelJob: async () => {
      throw Error("cancel not expected");
    },
    createPlan: async (input, key) => {
      calls.push({ kind: "plan", key, input });
      return plan;
    },
    getPlan: async () => plan,
    execute: async (_id, key) => {
      assert.equal(
        saved?.execution?.key,
        key,
        "intent must be durable before execution",
      );
      calls.push({ kind: "execute", key });
      return job;
    },
    getJob: async () => job,
    findJob: async () => job,
  };
  return {
    storage,
    transport,
    calls,
    current: () => saved,
    session: () => new AssistantSession(storage, transport),
  };
}
test("script selections convert UTF-16 boundaries to exact Unicode code point ranges", () => {
  assert.deepEqual(selectedRange("前😀后", 1, 3), {
    range: { startOffset: 1, endOffset: 2 },
    quote: "😀",
  });
  assert.throws(() => selectedRange("前😀后", 2, 3), /完整/);
  assert.throws(() => selectedRange("前😀后", 1, 1), /完整/);
  assert.equal(input.contextSources?.length, 0);
  assert.deepEqual(input.scriptRange, draft.range);
});
test("execution is stored before submission and refresh never executes an unknown job again", async () => {
  const f = fixture(),
    session = f.session();
  await session.load(draft);
  await session.prepare(input);
  await session.execute();
  await session.execute();
  await session.refresh();
  await session.revise();
  const reopened = f.session();
  await reopened.load(draft);
  await reopened.refresh();
  assert.equal(f.calls.filter((c) => c.kind === "execute").length, 1);
  assert.equal(reopened.getSnapshot().job?.status, "submission_unknown");
  assert.equal(reopened.getSnapshot().record?.draft.quote, draft.quote);
  assert.equal(reopened.getSnapshot().record?.execution?.jobId, job.id);
});
test("lost execution receipt recovers the original job by fixed plan without another POST", async () => {
  const f = fixture();
  f.transport.execute = async () => {
    f.calls.push({ kind: "execute" });
    throw new Error("lost receipt");
  };
  const session = f.session();
  await session.load(draft);
  await session.prepare(input);
  await session.execute();
  assert.ok(f.current()?.execution);
  assert.equal(f.current()?.execution?.jobId, undefined);
  const reopened = f.session();
  await reopened.load(draft);
  assert.equal(reopened.getSnapshot().job?.id, job.id);
  assert.equal(f.calls.filter((c) => c.kind === "execute").length, 1);
});
test("no matching job is unresolved evidence, not permission to submit or discard intent", async () => {
  const f = fixture();
  f.transport.findJob = async () => undefined;
  f.transport.execute = async () => {
    f.calls.push({ kind: "execute" });
    throw new Error("offline");
  };
  const session = f.session();
  await session.load(draft);
  await session.prepare(input);
  await session.execute();
  const reopened = f.session();
  await reopened.load(draft);
  await reopened.refresh();
  await reopened.execute();
  await reopened.revise();
  assert.ok(f.current()?.execution);
  assert.equal(reopened.getSnapshot().job, undefined);
  assert.equal(f.calls.filter((c) => c.kind === "execute").length, 1);
});
test("storage failure blocks paid execution before any request", async () => {
  const f = fixture(),
    session = f.session();
  await session.load(draft);
  await session.prepare(input);
  f.storage.write = async () => {
    throw new Error("storage unavailable");
  };
  await session.execute();
  assert.equal(f.calls.filter((c) => c.kind === "execute").length, 0);
  assert.match(session.getSnapshot().error!, /storage unavailable/);
});
test("lost plan receipt reuses its exact input and request key across reload", async () => {
  const f = fixture();
  let first = true;
  f.transport.createPlan = async (input, key) => {
    f.calls.push({ kind: "plan", key, input });
    if (first) {
      first = false;
      throw new Error("lost plan receipt");
    }
    return plan;
  };
  const session = f.session();
  await session.load(draft);
  await session.prepare(input);
  const reopened = f.session();
  await reopened.load(draft);
  await reopened.prepare({
    ...input,
    prompt: "should not replace fixed input",
  });
  assert.deepEqual(f.calls[0], f.calls[1]);
  assert.equal(reopened.getSnapshot().plan?.id, plan.id);
  assert.equal(f.calls.filter((c) => c.kind === "execute").length, 0);
});

test("failed initial storage read is retryable without creating a plan or job", async () => {
  const f = fixture();
  let failed = true;
  f.storage.read = async () => {
    if (failed) throw new Error("temporary storage read");
    return undefined;
  };
  const session = f.session();
  await session.load(draft);
  assert.equal(session.getSnapshot().record, undefined);
  failed = false;
  await session.load(draft);
  assert.equal(session.getSnapshot().record?.draft.scriptId, draft.scriptId);
  assert.deepEqual(f.calls, []);
});
test("explicit continuation uses the original execution intent after checking the plan and job", async () => {
  const f = fixture();
  f.transport.findJob = async () => undefined;
  let fail = true;
  f.transport.execute = async (_id, key) => {
    f.calls.push({ kind: "execute", key });
    if (fail) {
      fail = false;
      throw new Error("request never reached server");
    }
    return job;
  };
  const session = f.session();
  await session.load(draft);
  await session.prepare(input);
  await session.execute();
  const originalKey = f.current()?.execution?.key;
  const reopened = f.session();
  await reopened.load(draft);
  await reopened.resumeSubmission();
  const calls = f.calls.filter((c) => c.kind === "execute");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.key, originalKey);
  assert.equal(calls[1]?.key, originalKey);
  assert.equal(reopened.getSnapshot().record?.execution?.jobId, job.id);
});

test("revocation hides content immediately and a late execution result cannot recreate the cleared record", async () => {
  const f = fixture();
  let finish!: (value: Schema<"GenerationJob">) => void, started!: () => void;
  const submitted = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.transport.execute = async () => {
    started();
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const session = f.session();
  await session.load(draft);
  await session.prepare(input);
  const pending = session.execute();
  await submitted;
  session.suspend();
  assert.equal(session.getSnapshot().record, undefined);
  f.transport.checkAccess = async () => {
    throw Object.assign(new Error("gone"), { status: 404 });
  };
  await session.verify();
  assert.equal(session.getSnapshot().access, "forbidden");
  assert.equal(f.current(), undefined);
  finish(job);
  await pending;
  assert.equal(session.getSnapshot().job, undefined);
  assert.equal(f.current(), undefined);
});
test("retirement waits for an in-flight storage write and removes its late data", async () => {
  const f = fixture(),
    session = f.session();
  await session.load(draft);
  const original = f.storage.write;
  let finish!: () => void, started!: () => void;
  const writing = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.storage.write = async (record) => {
    started();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    await original(record);
  };
  session.updateDraft({ ...draft, prompt: "late private input" });
  await writing;
  const retiring = session.retire();
  finish();
  await retiring;
  assert.equal(f.current(), undefined);
  assert.equal(session.getSnapshot().record, undefined);
});
test("network uncertainty hides the recovered draft, retains it, and restores it only after current authorization", async () => {
  const f = fixture(),
    session = f.session();
  await session.load(draft);
  session.updateDraft({ ...draft, prompt: "kept through offline" });
  session.suspend();
  f.transport.checkAccess = async () => {
    throw new Error("offline");
  };
  await session.verify();
  assert.equal(session.getSnapshot().access, "error");
  assert.equal(session.getSnapshot().record, undefined);
  f.transport.checkAccess = async () => {};
  await session.verify();
  assert.equal(
    session.getSnapshot().record?.draft.prompt,
    "kept through offline",
  );
  assert.equal(f.current()?.draft.prompt, "kept through offline");
});
test("revocation cleanup failure keeps content hidden and can retry cleanup", async () => {
  const f = fixture(),
    session = f.session();
  await session.load(draft);
  await session.prepare(input);
  const clear = f.storage.clear;
  let fail = true;
  f.storage.clear = async () => {
    if (fail) throw new Error("delete unavailable");
    await clear();
  };
  f.transport.checkAccess = async () => {
    throw Object.assign(new Error("gone"), { status: 403 });
  };
  session.suspend();
  await session.verify();
  assert.equal(session.getSnapshot().access, "forbidden");
  assert.equal(session.getSnapshot().record, undefined);
  assert.ok(f.current());
  fail = false;
  await session.verify();
  assert.equal(f.current(), undefined);
  assert.equal(session.getSnapshot().record, undefined);
});
