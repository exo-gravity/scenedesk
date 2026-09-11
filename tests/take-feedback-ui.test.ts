import assert from "node:assert/strict";
import { test } from "node:test";
import type { components } from "@drama/contracts";
import {
  TakeFeedbackSession,
  feedbackRetryAllowed,
  trustedFeedbackRejection,
  type FeedbackDraft,
  type FeedbackIntent,
  type FeedbackTransport,
} from "../apps/web/src/business/take-feedback.js";
import {
  applyPrompt,
  promptPlan,
  nextPromptInput,
  reworkScope,
  validateArtifact,
  type PromptDraft,
  type IdentifiedArtifact,
} from "../apps/web/src/business/prompt-draft.js";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
const id = (n: number) =>
  `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const projectId = id(1),
  takeId = id(2),
  actorId = id(3);
const review: Schema<"Review"> = {
  id: id(4),
  revision: 1,
  projectId,
  subject: { takeId },
  number: 1,
  status: "open",
  sourceReviewIds: [],
  reworkItems: [],
};
const comment: Schema<"Comment"> = {
  id: id(5),
  reviewId: review.id,
  revision: 1,
  authorId: actorId,
  body: "手指接触不自然",
  resolved: false,
};
function fixture() {
  let stored: FeedbackDraft | undefined,
    failWrite = false,
    drop = false,
    blocked = 0;
  const requests: FeedbackIntent[] = [],
    reviews: Schema<"Review">[] = [],
    comments: Schema<"Comment">[] = [];
  const receipts = new Map<string, unknown>();
  const storage = {
    read: async () => structuredClone(stored),
    write: async (d: FeedbackDraft) => {
      if (failWrite) throw Error("disk");
      stored = structuredClone(d);
    },
    clear: async () => {
      stored = undefined;
    },
  };
  const transport: FeedbackTransport = {
    read: async () => {
      if (blocked)
        throw Object.assign(Error("read unavailable"), { status: blocked });
      return structuredClone({ reviews, comments });
    },
    send: async (intent) => {
      requests.push(structuredClone(intent));
      let value = receipts.get(intent.key);
      if (!value) {
        if (intent.kind === "review") {
          reviews.push(structuredClone(review));
          value = review;
        } else if (intent.kind === "comment") {
          const c = {
            ...comment,
            body: (intent.body as Schema<"CommentInput">).body,
          };
          comments.push(c);
          value = c;
        } else {
          const c = comments.find((c) => c.id === intent.commentId)!;
          if (c.revision !== intent.revision)
            throw Object.assign(Error("version"), { status: 412 });
          const body = intent.body as Schema<"CommentChange">;
          const changed = Object.entries(body).some(
            ([k, v]) => c[k as keyof typeof c] !== v,
          );
          Object.assign(c, body, { revision: c.revision + (changed ? 1 : 0) });
          value = structuredClone(c);
        }
        receipts.set(intent.key, structuredClone(value));
      }
      if (drop) {
        drop = false;
        throw Error("response lost after commit");
      }
      return structuredClone(value);
    },
  };
  const create = () =>
    new TakeFeedbackSession(storage, transport, projectId, takeId, actorId);
  return {
    create,
    storage,
    transport,
    requests,
    reviews,
    comments,
    stored: () => stored,
    setDrop: () => {
      drop = true;
    },
    setWrite: (b: boolean) => {
      failWrite = b;
    },
    setBlocked: (n: number) => {
      blocked = n;
    },
  };
}
test("Take review and comment each require an explicit fixed request; response loss refresh never writes", async () => {
  const f = fixture(),
    c = f.create();
  await c.verify();
  c.edit({ started: true, body: comment.body });
  await c.settle();
  assert.equal(f.requests.length, 0);
  f.setDrop();
  await c.submit("review");
  assert.equal(f.reviews.length, 1);
  assert.equal(f.comments.length, 0);
  const restored = f.create();
  await restored.verify();
  assert.equal(f.requests.length, 1);
  assert.equal(restored.getSnapshot().draft?.body, comment.body);
  await restored.submit();
  assert.deepEqual(f.requests[1], f.requests[0]);
  assert.equal(f.reviews.length, 1);
  assert.equal(f.comments.length, 0);
  f.setDrop();
  await restored.submit("comment");
  const again = f.create();
  await again.verify();
  assert.equal(f.requests.length, 3);
  assert.equal(f.comments.length, 1);
  await again.submit();
  assert.deepEqual(f.requests[3], f.requests[2]);
  assert.equal(f.comments.length, 1);
  assert.equal(f.stored()?.intent, undefined);
  assert.equal(f.stored()?.body, "");
});
test("expired create is read-only, same-text lists do not confirm it or release its identity", async () => {
  const f = fixture();
  f.reviews.push(review);
  const c = f.create();
  await c.verify();
  c.edit({ body: comment.body, started: true });
  await c.settle();
  f.setDrop();
  await c.submit("comment");
  const record = structuredClone(f.stored()!);
  record.intent!.attemptedAt = Date.now() - 86400_001;
  await f.storage.write(record);
  const restored = f.create();
  await restored.verify();
  await restored.submit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.stored()?.intent?.key, record.intent!.key);
  assert.equal(f.stored()?.body, comment.body);
  assert.equal(feedbackRetryAllowed(record.intent!), false);
});
test("storage failure before send prevents mutation; confirmed local cleanup failure only retries cleanup", async () => {
  const f = fixture(),
    c = f.create();
  await c.verify();
  c.edit({ body: comment.body, started: true });
  await c.settle();
  f.setWrite(true);
  await c.submit("review");
  assert.equal(f.requests.length, 0);
  f.setWrite(false);
  const send = f.transport.send;
  f.transport.send = async (r) => {
    const result = await send(r);
    f.setWrite(true);
    return result;
  };
  await c.submit("review");
  assert.ok(c.getSnapshot().draft?.receipt);
  assert.equal(f.requests.length, 1);
  f.setWrite(false);
  await c.submit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.stored()?.body, comment.body);
});
test("malformed/proxy rejection is unknown; only full first business rejection permits editing", async () => {
  assert.equal(
    trustedFeedbackRejection(422, {
      code: "INVALID_REQUEST",
      message: "proxy",
    }),
    false,
  );
  assert.equal(
    trustedFeedbackRejection(422, {
      code: "INVALID_REQUEST",
      message: "bad",
      requestId: "r",
      proxy: true,
    }),
    false,
  );
  const f = fixture(),
    c = f.create();
  f.reviews.push(review);
  await c.verify();
  c.edit({ body: comment.body, started: true });
  await c.settle();
  f.transport.send = async () => {
    throw Object.assign(Error("proxy"), {
      status: 422,
      code: "INVALID_REQUEST",
    });
  };
  await c.submit("comment");
  await c.returnToEditing();
  assert.ok(f.stored()?.intent);
  const fresh = fixture(),
    d = fresh.create();
  fresh.reviews.push(review);
  await d.verify();
  d.edit({ body: comment.body, started: true });
  await d.settle();
  fresh.transport.send = async () => {
    throw Object.assign(Error("invalid"), {
      status: 422,
      trustedBusinessRejection: true,
    });
  };
  await d.submit("comment");
  await d.returnToEditing();
  assert.equal(fresh.stored()?.intent, undefined);
  assert.equal(fresh.stored()?.body, comment.body);
});
test("comment receipt must be by original actor; no-op changes accept original revision and preserve unrelated input", async () => {
  const f = fixture();
  f.reviews.push(review);
  const c = f.create();
  await c.verify();
  c.edit({ body: comment.body, started: true });
  await c.settle();
  f.transport.send = async () => ({ ...comment, authorId: id(9) });
  await c.submit("comment");
  assert.ok(f.stored()?.intent);
  assert.equal(f.stored()?.body, comment.body);
  const g = fixture();
  g.reviews.push(review);
  g.comments.push(structuredClone(comment));
  const d = g.create();
  await d.verify();
  await d.openEditor(comment);
  await d.submit("change");
  assert.equal(g.stored()?.intent, undefined);
  assert.equal(g.comments[0]!.revision, 1);
  d.edit({ body: "未保存的新意见", started: true });
  await d.settle();
  await d.submit("change", comment, true);
  assert.equal(g.stored()?.body, "未保存的新意见");
  assert.equal(g.comments[0]!.resolved, true);
});
test("comment CAS response loss reconciles via read only; conflict retains original input before explicit current-head editing", async () => {
  const f = fixture();
  f.reviews.push(review);
  f.comments.push(structuredClone(comment));
  const c = f.create();
  await c.verify();
  await c.openEditor(comment);
  c.edit({ body: "新正文" });
  await c.settle();
  f.setDrop();
  await c.submit("change");
  assert.equal(f.comments[0]!.revision, 2);
  const d = f.create();
  await d.verify();
  await d.reconcileChange();
  assert.equal(f.requests.length, 1);
  assert.equal(f.stored()?.intent, undefined);
  await d.openEditor({ ...f.comments[0]! });
  d.edit({ body: "保留本机修改" });
  await d.settle();
  Object.assign(f.comments[0]!, { revision: 3, body: "其他成员修改" });
  await d.submit("change");
  assert.equal(f.stored()?.intent?.revision, 2);
  await d.reconcileChange(true);
  assert.equal(f.stored()?.body, "其他成员修改");
  assert.equal(f.stored()?.retained?.[0]?.body, "保留本机修改");
});
test("fixed opinion confirmation rejects later head/resolution; previous selection remains readable", async () => {
  const f = fixture();
  f.reviews.push(review);
  f.comments.push(structuredClone(comment));
  const c = f.create();
  await c.verify();
  const source = { takeId, reviewId: review.id, comment };
  await c.select(source);
  assert.equal(f.requests.length, 0);
  const later = { ...comment, revision: 2, body: "新意见" };
  f.comments[0] = later;
  await c.select({ ...source, comment });
  assert.equal(f.stored()?.selected?.comment.revision, 1);
  await c.select({ ...source, comment: later });
  await c.openPrevious(source);
  assert.equal(f.stored()?.selected?.comment.revision, 1);
  assert.equal(f.stored()?.selections?.length, 2);
});
test("temporary access failure hides recovery; confirmed denial clears it and late command cannot revive it", async () => {
  const f = fixture(),
    c = f.create();
  await c.verify();
  c.edit({ body: "private", started: true });
  await c.settle();
  f.setBlocked(503);
  c.suspend();
  await c.verify();
  assert.equal(c.getSnapshot().draft, undefined);
  assert.equal(f.stored()?.body, "private");
  f.setBlocked(0);
  await c.verify();
  let release!: (value: unknown) => void;
  f.transport.send = () =>
    new Promise((r) => {
      release = r;
    });
  const running = c.submit("review");
  while (!release) await new Promise((r) => setTimeout(r, 0));
  f.setBlocked(403);
  c.suspend();
  await c.verify();
  release(review);
  await running;
  assert.equal(f.stored(), undefined);
  assert.equal(c.getSnapshot().draft, undefined);
});
test("accepted last text drains through view close; failed initial read cannot overwrite an unread draft", async () => {
  const f = fixture(),
    c = f.create();
  await c.verify();
  let unblock!: () => void;
  const oldWrite = f.storage.write;
  f.storage.write = async (d) => {
    await new Promise<void>((r) => {
      unblock = r;
    });
    await oldWrite(d);
  };
  c.edit({ body: "最后几个字", started: true });
  c.suspend();
  while (!unblock) await new Promise((r) => setTimeout(r, 0));
  unblock();
  await c.settle();
  assert.equal(f.stored()?.body, "最后几个字");
  f.storage.write = oldWrite;
  f.storage.read = async () => {
    throw Error("disk read");
  };
  const next = f.create();
  await next.verify();
  next.edit({ body: "replacement" });
  await next.settle();
  assert.equal(f.stored()?.body, "最后几个字");
  assert.equal(next.getSnapshot().access, "error");
});
test("rework plan and next input preserve old Take shot and opinion revision; normal draft/media scope stays distinct", () => {
  const source = { takeId, reviewId: review.id, comment };
  const draft: PromptDraft = {
    source: { shotId: id(6), shotRevisionId: id(7) },
    rework: source,
    label: "旧候选",
    intent: "旧要求",
    prompt: "手工原文",
    references: [],
    instruction: "手指自然",
    capabilityId: id(8),
    targetCapabilityId: id(9),
    targetCapabilityRevision: 1,
  };
  const assistant = {
      id: id(8),
      connectionId: id(10),
      enabled: true,
      purpose: "creative_assistance",
    } as Schema<"Capability">,
    target = {
      id: id(9),
      enabled: true,
      purpose: "video",
      revision: 1,
    } as Schema<"Capability">;
  const plan = promptPlan(draft, projectId, assistant, target);
  assert.equal(plan.assistance?.kind, "prepare_rework");
  assert.deepEqual(plan.assistance?.feedback, {
    reviewId: review.id,
    commentId: comment.id,
    commentRevision: 1,
  });
  assert.deepEqual(plan.shotSources, [draft.source]);
  const next = nextPromptInput(draft, {
    id: id(6),
    specRevisionId: id(11),
    label: "新镜头",
    spec: { intent: "新要求" },
  } as Schema<"Shot">);
  assert.deepEqual(next.source, draft.source);
  assert.deepEqual(next.rework, source);
  assert.equal(next.previousInputs?.[0]?.prompt, "手工原文");
  assert.notEqual(reworkScope(source), reworkScope());
  assert.notEqual(
    reworkScope(source),
    reworkScope({ ...source, comment: { ...comment, revision: 2 } }),
  );
  const body = {
    prompt: "建议",
    referenceSuggestions: [],
    retain: [],
    change: [],
    notes: "受控测试",
  };
  const artifact = {
    projectId,
    generationJobId: id(13),
    resolvedInput: {
      resolverVersion: "test",
      prompt: "",
      references: [],
      shots: [],
      dependencies: [],
    },
    id: id(12),
    revision: 1,
    request: plan.assistance!,
    shotSources: [draft.source],
    body,
    inputOutdated: false,
  } as IdentifiedArtifact;
  assert.equal(
    applyPrompt({ ...draft, editBody: body }, artifact).prompt,
    "手工原文\n\n建议",
  );
  assert.throws(() =>
    validateArtifact(draft, {
      ...artifact,
      request: {
        ...artifact.request,
        feedback: { ...plan.assistance!.feedback!, commentRevision: 2 },
      },
    }),
  );
});

test("a slow durable write cannot extend the original 24-hour create retry window", async () => {
  const f = fixture(),
    c = f.create();
  f.reviews.push(review);
  await c.verify();
  c.edit({ body: comment.body, started: true });
  await c.settle();
  f.setDrop();
  await c.submit("comment");
  const attempt = f.stored()!.intent!.attemptedAt,
    originalNow = Date.now;
  Date.now = () => attempt + 86400_000 - 1;
  const originalWrite = f.storage.write;
  f.storage.write = async (d) => {
    await originalWrite(d);
    Date.now = () => attempt + 86400_000;
  };
  try {
    await c.submit();
    assert.equal(f.requests.length, 1);
    assert.ok(f.stored()?.intent);
  } finally {
    Date.now = originalNow;
  }
});

test("altered 201 creation facts never clear the original Take opinion request", async () => {
  for (const patch of [
    { revision: 9 },
    { resolved: true },
    { startUs: 0 },
    { endUs: 2 },
    { parentCommentId: id(99) },
  ]) {
    const f = fixture();
    f.reviews.push(review);
    const c = f.create();
    await c.verify();
    c.edit({ body: comment.body, started: true });
    await c.settle();
    f.transport.send = async () => ({ ...comment, ...patch });
    await c.submit("comment");
    assert.ok(f.stored()?.intent);
    assert.equal(f.stored()?.body, comment.body);
  }
});
