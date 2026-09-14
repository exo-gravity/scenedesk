import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AssistantSession,
  type AssistantRecord,
  type AssistantTransport,
} from "../apps/web/src/business/assistant-session.js";
import {
  TakeFeedbackSession,
  type FeedbackDraft,
} from "../apps/web/src/business/take-feedback.js";

type Scope = {
  sessionId: string;
  userId: string;
  tenantId: string;
  projectId: string;
};
type Controller = Pick<
  AssistantSession<unknown>,
  "suspend" | "verify" | "retire" | "settle"
> & {
  getSnapshot(): Pick<
    ReturnType<AssistantSession<unknown>["getSnapshot"]>,
    "access" | "busy"
  > &
    (
      | { record?: unknown; draftSaved: boolean }
      | { draft?: unknown; saved: boolean }
    );
};
// This browser registry also imports the existing React/IndexedDB cleanup path.
// Load the real module at runtime without asking the NodeNext build to compile JSX.
const lifecycle: {
  registerAssistant(entry: Scope & { controller: Controller }): () => void;
  retainProjectAssistantDrafts(scope: Scope): Promise<void>;
} = await import(
  new URL("../apps/web/src/business/assistant-lifecycle.ts", import.meta.url)
    .href
);
const scope = (): Scope => ({
  userId: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  tenantId: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  type Draft = { prompt: string };
  let stored: AssistantRecord<Draft> | undefined;
  let writes = 0;
  let reads = 0;
  let gate: Promise<void> | undefined;
  let failure = false;
  let calls = 0;
  const unexpected = async (): Promise<never> => {
    calls++;
    throw new Error("unexpected business or model operation");
  };
  const transport: AssistantTransport = {
    checkAccess: async () => {
      calls++;
    },
    createPlan: unexpected,
    getPlan: unexpected,
    execute: unexpected,
    getJob: unexpected,
    findJob: unexpected,
    cancelJob: unexpected,
  };
  const controller = new AssistantSession<Draft>(
    {
      read: async () => {
        reads++;
        return structuredClone(stored);
      },
      clear: async () => {
        stored = undefined;
      },
      write: async (record) => {
        writes++;
        const waiting = gate;
        if (waiting) await waiting;
        if (failure) throw new Error("local disk failed");
        stored = structuredClone(record);
      },
    },
    transport,
  );
  await controller.load({ prompt: "initial" });
  calls = 0;
  reads = 0;
  return {
    controller,
    saved: () => structuredClone(stored),
    counts: () => ({ writes, reads, calls }),
    waitFor: (promise?: Promise<void>) => {
      gate = promise;
    },
    fail: () => {
      failure = true;
    },
  };
}

test("navigation waits for all accepted local edits and never calls the assistant transport", async () => {
  const f = await fixture(),
    owner = scope(),
    gate = deferred();
  const unregister = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  try {
    f.waitFor(gate.promise);
    f.controller.updateDraft({ prompt: "first edit" });
    f.controller.updateDraft({ prompt: "last accepted edit" });
    let completed = false;
    const retention = lifecycle.retainProjectAssistantDrafts(owner).then(() => {
      completed = true;
    });
    await Promise.resolve();
    assert.equal(completed, false);
    gate.resolve();
    await retention;
    assert.equal(f.saved()?.draft.prompt, "last accepted edit");
    assert.deepEqual(f.counts(), { writes: 2, reads: 0, calls: 0 });
    assert.equal(f.controller.getSnapshot().access, "ready");
  } finally {
    gate.resolve();
    unregister();
    await f.controller.settle();
  }
});

test("a swallowed local write error blocks navigation without retrying or discarding input", async () => {
  const f = await fixture(),
    owner = scope();
  const unregister = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  try {
    f.fail();
    f.controller.updateDraft({ prompt: "must remain visible" });
    await assert.rejects(lifecycle.retainProjectAssistantDrafts(owner), /本机/);
    await assert.rejects(lifecycle.retainProjectAssistantDrafts(owner), /本机/);
    assert.equal(
      f.controller.getSnapshot().record?.draft.prompt,
      "must remain visible",
    );
    assert.equal(f.controller.getSnapshot().draftSaved, false);
    assert.deepEqual(f.counts(), { writes: 1, reads: 0, calls: 0 });
  } finally {
    unregister();
    await f.controller.settle();
  }
});

test("retention matches session, actor, tenant and project exactly", async () => {
  const f = await fixture(),
    owner = scope();
  const unregister = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  let foreignWaits = 0;
  const foreign = (Object.keys(owner) as (keyof Scope)[]).map((field) =>
    lifecycle.registerAssistant({
      ...owner,
      [field]: crypto.randomUUID(),
      controller: {
        getSnapshot: f.controller.getSnapshot,
        suspend: () => {},
        verify: async () => {},
        retire: async () => {},
        settle: async () => {
          foreignWaits++;
        },
      },
    }),
  );
  try {
    await lifecycle.retainProjectAssistantDrafts(owner);
    assert.equal(foreignWaits, 0);
    assert.deepEqual(f.counts(), { writes: 0, reads: 0, calls: 0 });
  } finally {
    foreign.forEach((remove) => remove());
    unregister();
    await f.controller.settle();
  }
});

test("an edit added while another editor settles cannot use the earlier saved snapshot", async () => {
  const first = await fixture(),
    second = await fixture(),
    owner = scope();
  const slow = deferred(),
    late = deferred();
  const remove = [first, second].map((f) =>
    lifecycle.registerAssistant({ ...owner, controller: f.controller }),
  );
  try {
    second.waitFor(slow.promise);
    second.controller.updateDraft({ prompt: "second editor" });
    const retention = lifecycle.retainProjectAssistantDrafts(owner);
    first.waitFor(late.promise);
    first.controller.updateDraft({ prompt: "edit after navigation began" });
    slow.resolve();
    await assert.rejects(retention, /本机/);
    assert.equal(
      first.controller.getSnapshot().record?.draft.prompt,
      "edit after navigation began",
    );
    late.resolve();
    await lifecycle.retainProjectAssistantDrafts(owner);
    assert.equal(first.saved()?.draft.prompt, "edit after navigation began");
  } finally {
    slow.resolve();
    late.resolve();
    await Promise.all([first.controller.settle(), second.controller.settle()]);
    remove.forEach((unregister) => unregister());
  }
});

test("access changes or a newly registered unsaved editor block the final project check", async () => {
  const first = await fixture(),
    next = await fixture(),
    owner = scope(),
    gate = deferred();
  const remove = [
    lifecycle.registerAssistant({ ...owner, controller: first.controller }),
  ];
  try {
    first.waitFor(gate.promise);
    first.controller.updateDraft({ prompt: "queued" });
    const retention = lifecycle.retainProjectAssistantDrafts(owner);
    next.fail();
    next.controller.updateDraft({ prompt: "newly opened editor" });
    remove.push(
      lifecycle.registerAssistant({ ...owner, controller: next.controller }),
    );
    gate.resolve();
    await assert.rejects(retention, /本机/);
    first.controller.suspend();
    await assert.rejects(lifecycle.retainProjectAssistantDrafts(owner), /核对/);
    assert.equal(first.counts().calls + next.counts().calls, 0);
  } finally {
    gate.resolve();
    remove.forEach((unregister) => unregister());
    await Promise.all([first.controller.settle(), next.controller.settle()]);
  }
});

test("navigation does not wait for or retry an in-flight business operation", async () => {
  const f = await fixture(),
    owner = scope(),
    gate = deferred(),
    started = deferred();
  const unregister = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  try {
    const operation = f.controller.commitDraft(
      { prompt: "initial" },
      { prompt: "fixed pending action" },
      async (draft) => {
        started.resolve();
        await gate.promise;
        return draft;
      },
    );
    await started.promise;
    await assert.rejects(
      lifecycle.retainProjectAssistantDrafts(owner),
      /操作尚未结束/,
    );
    assert.equal(f.saved()?.draft.prompt, "fixed pending action");
    gate.resolve();
    await operation;
    await lifecycle.retainProjectAssistantDrafts(owner);
    assert.equal(f.counts().calls, 0);
  } finally {
    gate.resolve();
    unregister();
    await f.controller.settle();
  }
});

test("the existing candidate-feedback saved field is also checked without sending the opinion", async () => {
  const owner = scope(),
    gate = deferred();
  let stored: FeedbackDraft | undefined;
  let failure = false;
  let sends = 0;
  const controller = new TakeFeedbackSession(
    {
      read: async () => structuredClone(stored),
      write: async (draft) => {
        await gate.promise;
        if (failure) throw Error("feedback disk failed");
        stored = structuredClone(draft);
      },
      clear: async () => {
        stored = undefined;
      },
    },
    {
      read: async () => ({ reviews: [], comments: [] }),
      send: async () => {
        sends++;
        throw Error("must not send feedback");
      },
    },
    owner.projectId,
    crypto.randomUUID(),
    owner.userId,
  );
  await controller.verify();
  const unregister = lifecycle.registerAssistant({ ...owner, controller });
  try {
    controller.edit({ body: "unsubmitted candidate opinion" });
    const retention = lifecycle.retainProjectAssistantDrafts(owner);
    gate.resolve();
    await retention;
    assert.equal(stored?.body, "unsubmitted candidate opinion");
    failure = true;
    controller.edit({ body: "keep the last opinion on failure" });
    await assert.rejects(lifecycle.retainProjectAssistantDrafts(owner), /本机/);
    assert.equal(
      controller.getSnapshot().draft?.body,
      "keep the last opinion on failure",
    );
    assert.equal(sends, 0);
  } finally {
    gate.resolve();
    unregister();
    await controller.settle();
  }
});
