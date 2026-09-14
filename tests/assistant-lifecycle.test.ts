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
  retryProjectAssistantRetention(scope: Scope): Promise<void>;
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
async function fixture(load = true) {
  type Draft = { prompt: string };
  let stored: AssistantRecord<Draft> | undefined;
  let writes = 0;
  let reads = 0;
  let gate: Promise<void> | undefined;
  let failure = false;
  let accessFailure: Error | undefined;
  let accessGate: Promise<void> | undefined;
  let calls = 0;
  const unexpected = async (): Promise<never> => {
    calls++;
    throw new Error("unexpected business or model operation");
  };
  const transport: AssistantTransport = {
    checkAccess: async () => {
      calls++;
      if (accessGate) await accessGate;
      if (accessFailure) throw accessFailure;
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
  if (load) await controller.load({ prompt: "initial" });
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
    recoverStorage: () => {
      failure = false;
    },
    failAccess: (error?: Error) => {
      accessFailure = error;
    },
    waitForAccess: (promise?: Promise<void>) => {
      accessGate = promise;
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

test("an already retained editor unmounted during navigation does not become an access blocker", async () => {
  const closed = await fixture(),
    editing = await fixture(),
    owner = scope(),
    gate = deferred();
  const close = lifecycle.registerAssistant({
    ...owner,
    controller: closed.controller,
  });
  const removeEditing = lifecycle.registerAssistant({
    ...owner,
    controller: editing.controller,
  });
  try {
    closed.controller.updateDraft({
      prompt: "already retained before closing",
    });
    await closed.controller.settle();
    editing.waitFor(gate.promise);
    editing.controller.updateDraft({ prompt: "last visible input" });
    const navigation = lifecycle.retainProjectAssistantDrafts(owner);
    // Closing an auxiliary editor suspends its view, not the remaining editor's authority.
    close();
    gate.resolve();
    await navigation;
    assert.equal(
      closed.saved()?.draft.prompt,
      "already retained before closing",
    );
    assert.equal(editing.saved()?.draft.prompt, "last visible input");
    assert.equal(closed.counts().calls + editing.counts().calls, 0);
  } finally {
    gate.resolve();
    removeEditing();
    await Promise.all([
      closed.controller.settle(),
      editing.controller.settle(),
    ]);
  }
});

test("unmount cannot authorize navigation when its accepted draft was not retained", async () => {
  const closed = await fixture(),
    owner = scope();
  const close = lifecycle.registerAssistant({
    ...owner,
    controller: closed.controller,
  });
  closed.controller.updateDraft({ prompt: "accepted but not yet retained" });
  const navigation = lifecycle.retainProjectAssistantDrafts(owner);
  close();
  await assert.rejects(navigation, /核对|本机/);
  assert.equal(closed.controller.getSnapshot().draftSaved, false);
  assert.notEqual(
    closed.saved()?.draft.prompt,
    "accepted but not yet retained",
  );
  assert.equal(closed.counts().calls, 0);
});

test("a replacement editor must finish its own access check even when the previous view was safely closed", async () => {
  const first = await fixture(),
    pending = await fixture(),
    replacement = await fixture(),
    owner = scope(),
    gate = deferred();
  const close = lifecycle.registerAssistant({
    ...owner,
    controller: first.controller,
  });
  const removePending = lifecycle.registerAssistant({
    ...owner,
    controller: pending.controller,
  });
  let removeReplacement: (() => void) | undefined;
  try {
    pending.waitFor(gate.promise);
    pending.controller.updateDraft({ prompt: "navigation waits here" });
    const navigation = lifecycle.retainProjectAssistantDrafts(owner);
    close();
    replacement.controller.suspend();
    removeReplacement = lifecycle.registerAssistant({
      ...owner,
      controller: replacement.controller,
    });
    gate.resolve();
    await assert.rejects(navigation, /核对/);
    await replacement.controller.verify();
    await lifecycle.retainProjectAssistantDrafts(owner);
  } finally {
    gate.resolve();
    removePending();
    removeReplacement?.();
    await Promise.all([
      first.controller.settle(),
      pending.controller.settle(),
      replacement.controller.settle(),
    ]);
  }
});

test("a failed draft remains a navigation barrier after its editor has finished unregistering", async () => {
  const f = await fixture(),
    owner = scope();
  const close = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  f.fail();
  f.controller.updateDraft({ prompt: "recover this draft after reopening" });
  await f.controller.settle();
  close();
  await f.controller.settle();
  await assert.rejects(
    lifecycle.retainProjectAssistantDrafts(owner),
    /核对|本机/,
  );
  assert.notEqual(
    f.saved()?.draft.prompt,
    "recover this draft after reopening",
  );
  const reopen = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  try {
    await assert.rejects(
      lifecycle.retainProjectAssistantDrafts(owner),
      /核对|本机/,
    );
    f.recoverStorage();
    await f.controller.verify();
    await lifecycle.retainProjectAssistantDrafts(owner);
    assert.equal(f.saved()?.draft.prompt, "recover this draft after reopening");
    close(); // A stale cleanup is idempotent and cannot suspend this new owner.
    assert.equal(f.controller.getSnapshot().access, "ready");
  } finally {
    reopen();
    await f.controller.settle();
  }
  await lifecycle.retainProjectAssistantDrafts(owner);
});

test("explicit navigation retry retains a detached failed draft without remounting its editor", async () => {
  const f = await fixture(),
    owner = scope();
  const close = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  f.fail();
  f.controller.updateDraft({
    prompt: "recover without opening the hidden editor",
  });
  await f.controller.settle();
  close();
  await f.controller.settle();
  await assert.rejects(
    lifecycle.retainProjectAssistantDrafts(owner),
    /核对|本机/,
  );
  f.recoverStorage();
  await lifecycle.retryProjectAssistantRetention(owner);
  assert.equal(
    f.saved()?.draft.prompt,
    "recover without opening the hidden editor",
  );
  assert.equal(f.counts().calls, 1); // Current access only, no business or model command.
  await lifecycle.retainProjectAssistantDrafts(owner);
});

test("explicit navigation retry keeps the latest visible input and leaves other projects alone", async () => {
  const f = await fixture(),
    foreign = await fixture(),
    owner = scope();
  const close = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  const removeForeign = lifecycle.registerAssistant({
    ...scope(),
    controller: foreign.controller,
  });
  try {
    f.fail();
    foreign.fail();
    f.controller.updateDraft({
      prompt: "latest visible draft, not the older stored input",
    });
    foreign.controller.updateDraft({ prompt: "untouched other project" });
    await Promise.all([f.controller.settle(), foreign.controller.settle()]);
    f.recoverStorage();
    await lifecycle.retryProjectAssistantRetention(owner);
    assert.equal(
      f.saved()?.draft.prompt,
      "latest visible draft, not the older stored input",
    );
    assert.equal(f.counts().calls, 1);
    assert.equal(foreign.counts().calls, 0);
    assert.equal(foreign.controller.getSnapshot().draftSaved, false);
  } finally {
    close();
    removeForeign();
    await Promise.all([f.controller.settle(), foreign.controller.settle()]);
  }
});

test("explicit navigation retry does not interrupt an in-flight business operation", async () => {
  const f = await fixture(),
    owner = scope(),
    gate = deferred(),
    started = deferred();
  const close = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  try {
    const operation = f.controller.commitDraft(
      { prompt: "initial" },
      { prompt: "original pending action" },
      async (draft) => {
        started.resolve();
        await gate.promise;
        return draft;
      },
    );
    await started.promise;
    await assert.rejects(
      lifecycle.retryProjectAssistantRetention(owner),
      /操作尚未结束/,
    );
    assert.equal(f.controller.getSnapshot().busy, true);
    assert.equal(f.controller.getSnapshot().access, "ready");
    assert.equal(f.counts().calls, 0);
    gate.resolve();
    await operation;
    await lifecycle.retainProjectAssistantDrafts(owner);
  } finally {
    gate.resolve();
    close();
    await f.controller.settle();
  }
});

test("an editor closed before accepting any local input does not leave a permanent barrier", async () => {
  const f = await fixture(false),
    owner = scope();
  const close = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  const navigation = lifecycle.retainProjectAssistantDrafts(owner);
  close();
  await navigation;
  await f.controller.settle();
  await lifecycle.retainProjectAssistantDrafts(owner);
  assert.equal(f.counts().calls, 0);
});

test("a failed authority read cannot release a hidden unsaved draft during explicit navigation retry", async () => {
  const f = await fixture(),
    owner = scope();
  const close = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  f.fail();
  f.controller.updateDraft({
    prompt: "preserve through an unavailable authority check",
  });
  await f.controller.settle();
  close();
  await f.controller.settle();
  f.recoverStorage();
  f.failAccess(new Error("authority GET unavailable"));
  await assert.rejects(lifecycle.retryProjectAssistantRetention(owner), /核对/);
  assert.equal(f.controller.getSnapshot().access, "error");
  assert.equal(f.controller.hasUnretainedDraft(), true);
  assert.notEqual(
    f.saved()?.draft.prompt,
    "preserve through an unavailable authority check",
  );
  f.failAccess();
  await lifecycle.retryProjectAssistantRetention(owner);
  assert.equal(
    f.saved()?.draft.prompt,
    "preserve through an unavailable authority check",
  );
  assert.equal(f.counts().calls, 2);
});

test("a current mounted editor remains forbidden after an authoritative rejection on navigation retry", async () => {
  const f = await fixture(),
    owner = scope();
  const close = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  try {
    f.controller.suspend();
    f.failAccess(
      Object.assign(new Error("current project permission revoked"), {
        status: 403,
      }),
    );
    await assert.rejects(
      lifecycle.retryProjectAssistantRetention(owner),
      /核对/,
    );
    assert.equal(f.controller.getSnapshot().access, "forbidden");
    assert.equal(f.controller.getSnapshot().record, undefined);
    await assert.rejects(lifecycle.retainProjectAssistantDrafts(owner), /核对/);
    assert.equal(f.counts().calls, 1);
  } finally {
    close();
    await f.controller.settle();
  }
  await lifecycle.retainProjectAssistantDrafts(owner);
});

test("navigation waits for an already running initial access check without starting a new request", async () => {
  const f = await fixture(false),
    owner = scope(),
    gate = deferred();
  const close = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  f.waitForAccess(gate.promise);
  const load = f.controller.load({ prompt: "initial storyboard editor" });
  let outcome = "pending",
    error: unknown;
  const navigation = lifecycle.retainProjectAssistantDrafts(owner).then(
    () => {
      outcome = "retained";
    },
    (failure: unknown) => {
      outcome = "rejected";
      error = failure;
    },
  );
  try {
    await new Promise<void>(setImmediate);
    assert.equal(
      outcome,
      "pending",
      "the current access GET has not answered yet",
    );
    assert.equal(f.counts().calls, 1);
    gate.resolve();
    await Promise.all([load, navigation]);
    assert.equal(error, undefined);
    assert.equal(outcome, "retained");
    assert.equal(
      f.controller.getSnapshot().record?.draft.prompt,
      "initial storyboard editor",
    );
    assert.equal(f.counts().calls, 1);
  } finally {
    gate.resolve();
    await load;
    close();
    await f.controller.settle();
  }
});

test("navigation access waiting has a deadline without cancelling or restarting the existing request", async (t) => {
  const f = await fixture(false),
    owner = scope(),
    gate = deferred();
  const close = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  f.waitForAccess(gate.promise);
  const load = f.controller.load({ prompt: "keep waiting input" });
  const navigation = lifecycle.retainProjectAssistantDrafts(owner);
  try {
    await new Promise<void>(setImmediate);
    t.mock.timers.tick(15000);
    await assert.rejects(navigation, /仍在核对/);
    assert.equal(f.controller.getSnapshot().busy, true);
    assert.equal(f.counts().calls, 1);
    gate.resolve();
    await load;
    await lifecycle.retainProjectAssistantDrafts(owner);
    assert.equal(
      f.controller.getSnapshot().record?.draft.prompt,
      "keep waiting input",
    );
  } finally {
    gate.resolve();
    await load;
    close();
    await f.controller.settle();
  }
});

test("a superseded access response cannot complete navigation while the replacement check is still running", async () => {
  const f = await fixture(false),
    owner = scope(),
    first = deferred(),
    current = deferred();
  const close = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  f.waitForAccess(first.promise);
  const load = f.controller.load({
    prompt: "same editor across access refresh",
  });
  let completed = false;
  const navigation = lifecycle.retainProjectAssistantDrafts(owner).then(() => {
    completed = true;
  });
  let refresh: Promise<void> | undefined;
  try {
    await new Promise<void>(setImmediate);
    f.controller.suspend();
    f.waitForAccess(current.promise);
    refresh = f.controller.verify();
    first.resolve();
    await load;
    await new Promise<void>(setImmediate);
    assert.equal(completed, false);
    assert.equal(f.counts().calls, 2);
    current.resolve();
    await Promise.all([refresh, navigation]);
    assert.equal(completed, true);
    assert.equal(f.controller.getSnapshot().access, "ready");
  } finally {
    first.resolve();
    current.resolve();
    await Promise.all([load, refresh]);
    close();
    await f.controller.settle();
  }
});

for (const failure of [
  {
    name: "unavailable",
    error: new Error("authority GET unavailable"),
    state: "error",
  },
  {
    name: "forbidden",
    error: Object.assign(new Error("authority rejected"), { status: 403 }),
    state: "forbidden",
  },
])
  test(`navigation still refuses an in-flight access check that finishes ${failure.name}`, async () => {
    const f = await fixture(false),
      owner = scope(),
      gate = deferred();
    const close = lifecycle.registerAssistant({
      ...owner,
      controller: f.controller,
    });
    f.waitForAccess(gate.promise);
    f.failAccess(failure.error);
    const load = f.controller.load({ prompt: "not authorized for use yet" });
    const navigation = lifecycle.retainProjectAssistantDrafts(owner);
    try {
      await new Promise<void>(setImmediate);
      gate.resolve();
      await assert.rejects(navigation, /核对/);
      await load;
      assert.equal(f.controller.getSnapshot().access, failure.state);
      assert.equal(f.counts().calls, 1);
    } finally {
      gate.resolve();
      await load;
      close();
      await f.controller.settle();
    }
  });

test("closing an empty editor releases its obsolete access wait without requiring the old GET to return", async () => {
  const f = await fixture(false),
    owner = scope(),
    gate = deferred();
  const close = lifecycle.registerAssistant({
    ...owner,
    controller: f.controller,
  });
  f.waitForAccess(gate.promise);
  const load = f.controller.load({ prompt: "never edited" });
  const navigation = lifecycle.retainProjectAssistantDrafts(owner);
  try {
    await new Promise<void>(setImmediate);
    close();
    await navigation;
    assert.equal(f.controller.getSnapshot().record, undefined);
    assert.equal(f.counts().calls, 1);
  } finally {
    gate.resolve();
    await load;
    close();
    await f.controller.settle();
  }
});

test("candidate opinion navigation waits for its already-running read and does not submit the opinion", async () => {
  const owner = scope(),
    gate = deferred();
  let reads = 0,
    sends = 0;
  const controller = new TakeFeedbackSession(
    {
      read: async () => undefined,
      write: async () => {},
      clear: async () => {},
    },
    {
      read: async () => {
        reads++;
        await gate.promise;
        return { reviews: [], comments: [] };
      },
      send: async () => {
        sends++;
        throw new Error("no opinion submission");
      },
    },
    owner.projectId,
    crypto.randomUUID(),
    owner.userId,
  );
  const close = lifecycle.registerAssistant({ ...owner, controller });
  const initial = controller.verify();
  let completed = false;
  const navigation = lifecycle.retainProjectAssistantDrafts(owner).then(() => {
    completed = true;
  });
  try {
    await new Promise<void>(setImmediate);
    assert.equal(completed, false);
    gate.resolve();
    await Promise.all([initial, navigation]);
    assert.equal(completed, true);
    assert.equal(reads, 1);
    assert.equal(sends, 0);
  } finally {
    gate.resolve();
    await initial;
    close();
    await controller.settle();
  }
});

test("an editor registered while navigation waits joins the current access barrier", async () => {
  const first = await fixture(false),
    next = await fixture(false),
    owner = scope();
  const firstGate = deferred(),
    nextGate = deferred();
  const closeFirst = lifecycle.registerAssistant({
    ...owner,
    controller: first.controller,
  });
  first.waitForAccess(firstGate.promise);
  const firstLoad = first.controller.load({ prompt: "already mounting" });
  let outcome = "pending",
    failure: unknown;
  const navigation = lifecycle.retainProjectAssistantDrafts(owner).then(
    () => {
      outcome = "retained";
    },
    (error: unknown) => {
      outcome = "rejected";
      failure = error;
    },
  );
  let closeNext: (() => void) | undefined, nextLoad: Promise<void> | undefined;
  try {
    await new Promise<void>(setImmediate);
    closeNext = lifecycle.registerAssistant({
      ...owner,
      controller: next.controller,
    });
    next.waitForAccess(nextGate.promise);
    nextLoad = next.controller.load({
      prompt: "newly mounted candidate editor",
    });
    firstGate.resolve();
    await firstLoad;
    await new Promise<void>(setImmediate);
    assert.equal(
      outcome,
      "pending",
      "the newly registered editor is still performing its existing access GET",
    );
    assert.equal(first.counts().calls + next.counts().calls, 2);
    nextGate.resolve();
    await Promise.all([nextLoad, navigation]);
    assert.equal(failure, undefined);
    assert.equal(outcome, "retained");
    assert.equal(first.counts().calls + next.counts().calls, 2);
  } finally {
    firstGate.resolve();
    nextGate.resolve();
    await Promise.all([firstLoad, nextLoad]);
    closeFirst();
    closeNext?.();
    await Promise.all([first.controller.settle(), next.controller.settle()]);
  }
});

test("an editor added during access waiting shares the original fifteen-second deadline", async (t) => {
  const first = await fixture(false),
    next = await fixture(false),
    owner = scope();
  const firstGate = deferred(),
    nextGate = deferred();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const closeFirst = lifecycle.registerAssistant({
    ...owner,
    controller: first.controller,
  });
  first.waitForAccess(firstGate.promise);
  const firstLoad = first.controller.load({ prompt: "initial editor" });
  const navigation = lifecycle.retainProjectAssistantDrafts(owner);
  let closeNext: (() => void) | undefined, nextLoad: Promise<void> | undefined;
  try {
    await new Promise<void>(setImmediate);
    t.mock.timers.tick(10000);
    closeNext = lifecycle.registerAssistant({
      ...owner,
      controller: next.controller,
    });
    next.waitForAccess(nextGate.promise);
    nextLoad = next.controller.load({
      prompt: "late editor does not extend the deadline",
    });
    firstGate.resolve();
    await firstLoad;
    await new Promise<void>(setImmediate);
    const rejection = assert.rejects(navigation, /仍在核对/);
    t.mock.timers.tick(5000);
    await rejection;
    assert.equal(next.controller.getSnapshot().busy, true);
    assert.equal(first.counts().calls + next.counts().calls, 2);
    nextGate.resolve();
    await nextLoad;
    await lifecycle.retainProjectAssistantDrafts(owner);
  } finally {
    firstGate.resolve();
    nextGate.resolve();
    await Promise.all([firstLoad, nextLoad]);
    closeFirst();
    closeNext?.();
    await Promise.all([first.controller.settle(), next.controller.settle()]);
  }
});

for (const reason of ["permission", "local retention"] as const)
  test(`an editor added during navigation still blocks after failed ${reason}`, async () => {
    const first = await fixture(false),
      next = await fixture(),
      owner = scope();
    const firstGate = deferred(),
      nextGate = deferred();
    const closeFirst = lifecycle.registerAssistant({
      ...owner,
      controller: first.controller,
    });
    first.waitForAccess(firstGate.promise);
    const firstLoad = first.controller.load({ prompt: "first editor" });
    const navigation = lifecycle.retainProjectAssistantDrafts(owner);
    let closeNext: (() => void) | undefined,
      nextLoad: Promise<void> | undefined;
    try {
      await new Promise<void>(setImmediate);
      if (reason === "permission")
        next.failAccess(
          Object.assign(new Error("current permission revoked"), {
            status: 403,
          }),
        );
      else {
        next.fail();
        next.controller.updateDraft({
          prompt: "new editor input must be retained",
        });
        await next.controller.settle();
      }
      next.controller.suspend();
      next.waitForAccess(nextGate.promise);
      closeNext = lifecycle.registerAssistant({
        ...owner,
        controller: next.controller,
      });
      nextLoad = next.controller.verify();
      firstGate.resolve();
      await firstLoad;
      await new Promise<void>(setImmediate);
      const rejection = assert.rejects(
        navigation,
        reason === "permission" ? /核对/ : /本机/,
      );
      nextGate.resolve();
      await Promise.all([nextLoad, rejection]);
      assert.equal(first.counts().calls + next.counts().calls, 2);
      if (reason === "permission")
        assert.equal(next.controller.getSnapshot().access, "forbidden");
      else {
        assert.equal(next.controller.getSnapshot().draftSaved, false);
        assert.equal(
          next.controller.getSnapshot().record?.draft.prompt,
          "new editor input must be retained",
        );
      }
    } finally {
      firstGate.resolve();
      nextGate.resolve();
      await Promise.all([firstLoad, nextLoad]);
      closeFirst();
      closeNext?.();
      await Promise.all([first.controller.settle(), next.controller.settle()]);
    }
  });
