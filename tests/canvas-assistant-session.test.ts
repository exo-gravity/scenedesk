import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureCanvasSources,
  canvasAssistancePlan,
  canvasAssistantReply,
  beginCanvasAssistantTopic,
  beginCanvasAssistantPrompt,
  retainCanvasAssistantReply,
  sendCanvasAssistantMessage,
  type CanvasAssistanceInput,
  applicationPrompt,
  assertCanvasApplication,
  canvasApplicationError,
  canvasApplicationWasRefused,
  verifyCanvasAssistantSources,
  type CanvasApplication,
  type CanvasApplicationResult,
  type CanvasAssistantDraft,
} from "../apps/web/src/business/canvas-assistant.js";
import {
  CanvasPlanDelivery,
  canvasPlanError,
  returnRejectedCanvasPlan,
  type CanvasPlanDeliveries,
} from "../apps/web/src/business/canvas-plan-delivery.js";
import { generationSessionPath } from "../apps/web/src/business/generation-session-key.js";
import {
  AssistantSession,
  type AssistantRecord,
  type AssistantStorage,
  type AssistantTransport,
} from "../apps/web/src/business/assistant-session.js";
import type { components } from "@drama/contracts";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
const canvas: Schema<"Canvas"> = {
  id: "canvas-a",
  projectId: "project",
  schemaVersion: 1,
  documentHash: "1".repeat(64),
  updatedAt: "2026-09-14T00:00:00Z",
  revision: 4,
  document: {
    nodes: [
      {
        id: "text-a",
        kind: "text",
        title: "动作",
        position: { x: 0, y: 0 },
        width: 320,
        content: { type: "text", text: "保留手部😀。" },
      },
      {
        id: "video-a",
        kind: "video",
        title: "原视频",
        position: { x: 400, y: 0 },
        width: 320,
        content: {
          type: "media",
          mediaId: "media-fixed",
          assetRevisionId: "asset-r1",
        },
      },
      {
        id: "draft-b",
        kind: "video",
        title: "新的尝试",
        position: { x: 800, y: 0 },
        width: 320,
        content: {
          type: "draft",
          prompt: "慢慢拿起",
          capabilityId: "video-cap",
          output: { durationSeconds: 5 },
        },
      },
    ],
    edges: [],
    groups: [],
  },
};
const assistant = {
  id: "assistant-cap",
  revision: 1,
  purpose: "creative_assistance",
  enabled: true,
  connectionId: "fixture-connection",
} as Schema<"Capability">;
const target = {
  id: "video-cap",
  revision: 3,
  purpose: "video",
  enabled: true,
} as Schema<"Capability">;
const draft: CanvasAssistantDraft = {
  sources: captureCanvasSources(canvas, ["video-a", "text-a"]),
  instruction: "固定这两份来源",
  capabilityId: assistant.id,
  targetCapabilityId: target.id,
  targetCapabilityRevision: target.revision,
};
const input = canvasAssistancePlan(draft, "project", assistant, target);
const fixedPlan = {
  id: "plan-a",
  revision: 1,
  input,
  status: "ready",
  expiresAt: "2099-01-01T00:00:00Z",
  blockingReasons: [],
  resolvedInput: {
    prompt: "固定提示",
    shots: [],
    references: [],
    dependencies: [],
  },
} as unknown as Schema<"GenerationPlan">;
const intent: CanvasApplication = {
  phase: "unknown",
  key: "original-key",
  revision: 4,
  body: {
    applicationId: "apply-a",
    artifactId: "artifact-a",
    artifactRevision: 2,
    nodeId: "draft-b",
    mode: "append",
  },
  targetTitle: "新的尝试",
  beforePrompt: "慢慢拿起",
  afterPrompt: "慢慢拿起\n\n先触碰再拿起",
};
const result: CanvasApplicationResult = {
  canvas: { ...canvas, revision: 7 },
  application: {
    id: "apply-a",
    canvasId: canvas.id,
    nodeId: "draft-b",
    artifactId: "artifact-a",
    artifactRevision: 2,
    mode: "append",
    baseCanvasRevision: 4,
    resultCanvasRevision: 5,
    beforePrompt: intent.beforePrompt,
    afterPrompt: intent.afterPrompt,
    appliedAt: "2026-09-14T00:00:00Z",
  },
};
test("canvas assistant pins only explicit ordered node bodies, with zero shot sources", () => {
  assert.deepEqual(input.shotSources, []);
  assert.deepEqual(
    input.canvasSources.map((s) => s.nodeId),
    ["video-a", "text-a"],
  );
  assert.equal(input.canvasSources[0]?.purpose, "composition");
  assert.equal(input.canvasSources[1]?.purpose, undefined);
  const changed = structuredClone(canvas);
  changed.document.nodes[0]!.title = "新名称";
  if (changed.document.nodes[0]!.content.type === "text")
    changed.document.nodes[0]!.content.text = "新正文";
  assert.equal(draft.sources[1]?.content.type, "text");
  assert.equal(
    (draft.sources[1]?.content as { text: string }).text,
    "保留手部😀。",
  );
  assert.equal(draft.sources[1]?.source.canvasRevision, 4);
  assert.throws(() => captureCanvasSources(canvas, ["removed"]), /移除/);
  assert.throws(
    () =>
      canvasAssistancePlan(draft, "project", assistant, {
        ...target,
        revision: 4,
      }),
    /版本/,
  );
});
test("application recovery accepts a later canvas but requires the exact immutable receipt", () => {
  assert.doesNotThrow(() => assertCanvasApplication(intent, result, canvas.id));
  for (const change of [
    { id: "different" },
    { nodeId: "text-a" },
    { artifactRevision: 3 },
    { baseCanvasRevision: 5 },
    { afterPrompt: "改写" },
  ])
    assert.throws(
      () =>
        assertCanvasApplication(
          intent,
          { ...result, application: { ...result.application, ...change } },
          canvas.id,
        ),
      /回执/,
    );
  assert.equal(applicationPrompt("A", "B", "append"), "A\n\nB");
  assert.equal(applicationPrompt("A", "B", "replace"), "B");
});
test("partial or proxy failures cannot authorize changing an unknown application", () => {
  const partial = canvasApplicationError(404, {
    code: "CANVAS_ASSISTANCE_APPLICATION_NOT_FOUND",
    message: "missing",
  });
  assert.equal(partial.verified, false);
  const proxy = canvasApplicationError(412, "upstream unavailable");
  assert.equal(proxy.verified, false);
  const known = canvasApplicationError(404, {
    code: "CANVAS_ASSISTANCE_APPLICATION_NOT_FOUND",
    message: "missing",
    requestId: "request-1",
  });
  assert.equal(known.verified, true);
  assert.equal(known.code, "CANVAS_ASSISTANCE_APPLICATION_NOT_FOUND");
});

test("the server's structured VERSION_CONFLICT remains a known refusal, not an unknown POST", () => {
  const conflict = canvasApplicationError(412, {
    code: "VERSION_CONFLICT",
    message: "stale canvas",
    requestId: "real-api-request",
  });
  assert.equal(conflict.verified, true);
  assert.equal(conflict.status, 412);
  assert.equal(conflict.code, "VERSION_CONFLICT");
});

test("only verified first input refusals release review; identity conflicts and uncertain resends retain the original application", () => {
  const review: CanvasApplication = { ...intent, phase: "review" };
  for (const [status, code] of [
    [412, "VERSION_CONFLICT"],
    [409, "PLAN_INPUT_CHANGED"],
    [409, "TARGET_CAPABILITY_CHANGED"],
    [422, "CANVAS_ASSISTANCE_TARGET_MISMATCH"],
    [422, "CANVAS_CONTEXT_UNAVAILABLE"],
    [422, "GENERATION_CONTEXT_TOO_LARGE"],
  ] as const) {
    const failure = canvasApplicationError(status, {
      code,
      message: "declined",
      requestId: "api-request",
    });
    assert.equal(canvasApplicationWasRefused(review, failure), true, code);
    assert.equal(
      canvasApplicationWasRefused(intent, failure),
      false,
      `${code}:unknown`,
    );
    assert.equal(
      canvasApplicationWasRefused({ ...intent, phase: "missing" }, failure),
      false,
      `${code}:resend`,
    );
    assert.equal(
      canvasApplicationWasRefused(
        review,
        canvasApplicationError(status, { code, message: "proxy" }),
      ),
      false,
    );
  }
  for (const [status, code] of [
    [409, "CANVAS_ASSISTANCE_CONFLICT"],
    [409, "IDEMPOTENCY_CONFLICT"],
    [409, "CANVAS_ASSISTANCE_UNAVAILABLE"],
    [422, "ASSISTANCE_REFERENCE_UNAVAILABLE"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [500, "INTERNAL_ERROR"],
  ] as const) {
    assert.equal(
      canvasApplicationWasRefused(
        review,
        canvasApplicationError(status, {
          code,
          message: "denied",
          requestId: "api-request",
        }),
      ),
      false,
      code,
    );
  }
});
test("restoring an unsent assistant draft checks exact media and asset access before showing its snapshot", async () => {
  const reads: string[] = [];
  await assert.rejects(
    verifyCanvasAssistantSources(draft, canvas.id, async (kind, id) => {
      reads.push(`${kind}/${id}`);
      if (kind === "asset-revisions")
        throw Object.assign(Error("revoked"), { status: 403 });
    }),
    /revoked/,
  );
  assert.deepEqual(reads, ["media/media-fixed", "asset-revisions/asset-r1"]);
  await assert.rejects(
    verifyCanvasAssistantSources(draft, "another-canvas", async () => {}),
    /不属于/,
  );
});
function storage<T, Request = Schema<"PlanInput">>(
  records: Map<string, AssistantRecord<T, Request>>,
  path: string,
): AssistantStorage<T, Request> {
  return {
    read: async () => structuredClone(records.get(path)),
    write: async (record) => {
      records.set(path, structuredClone(record));
    },
    clear: async () => {
      records.delete(path);
    },
  };
}
function transport(): AssistantTransport {
  return {
    checkAccess: async () => {},
    createPlan: async () => fixedPlan,
    getPlan: async () => fixedPlan,
    execute: async () => {
      throw Error("no paid execution in this fixture");
    },
    cancelJob: async () => {
      throw Error("not called");
    },
    getJob: async () => {
      throw Error("not called");
    },
    findJob: async () => undefined,
  };
}
function discussionJob(
  changes: Pick<Schema<"GenerationJob">, "id" | "planId" | "status"> &
    Partial<Schema<"GenerationJob">>,
): Schema<"GenerationJob"> {
  return {
    revision: 1,
    scope: "project",
    projectId: "project",
    mediaIds: [],
    reservationStatus: "held",
    inputOutdated: false,
    connectionVersionId: "fixture-version",
    costStatus: "unavailable",
    confirmedCost: { amountMicros: "0", currency: "CNY" },
    reservationRemaining: { amountMicros: "0", currency: "CNY" },
    recoveryEpoch: 0,
    executionMode: "test_fixture",
    ...changes,
  };
}
test("opening the same node's fixed attempt preserves the unsent editing draft and its recovery record", async () => {
  const subject = {
    kind: "canvas" as const,
    canvasId: canvas.id,
    nodeId: "draft-b",
    sceneId: "scene",
  };
  const editKey = generationSessionPath(subject),
    attemptKey = generationSessionPath(subject, "plan-a");
  assert.equal(editKey, "canvases/canvas-a/nodes/draft-b");
  assert.notEqual(editKey, attemptKey);
  const records = new Map<string, AssistantRecord<{ prompt: string }>>();
  const edit = new AssistantSession(storage(records, editKey), transport());
  await edit.load({ prompt: "未提交的新输入" });
  edit.updateDraft({ prompt: "末尾中文编辑" });
  await edit.settle();
  const inspect = new AssistantSession(
    storage(records, attemptKey),
    transport(),
  );
  await inspect.load({ prompt: "" });
  await inspect.openExisting("plan-a", () => {});
  assert.equal(inspect.getSnapshot().plan?.id, "plan-a");
  assert.equal(edit.getSnapshot().record?.draft.prompt, "末尾中文编辑");
  assert.equal(records.get(editKey)?.planId, undefined);
  const reopened = new AssistantSession(storage(records, editKey), transport());
  await reopened.load({ prompt: "" });
  assert.equal(reopened.getSnapshot().record?.draft.prompt, "末尾中文编辑");
});
test("failed durable application intent prevents its POST; a lost response retains the same key and base", async () => {
  let written: AssistantRecord<CanvasAssistantDraft> | undefined;
  let fail = true,
    posts = 0;
  const local: AssistantStorage<CanvasAssistantDraft> = {
    read: async () => written,
    clear: async () => {},
    write: async (record) => {
      if (fail) throw Error("IDB full");
      written = structuredClone(record);
    },
  };
  const session = new AssistantSession(local, transport());
  fail = false;
  await session.load(draft);
  fail = true;
  await session.commitDraft(
    draft,
    { ...draft, application: intent },
    async (current) => {
      posts++;
      return current;
    },
  );
  assert.equal(posts, 0);
  assert.equal(written?.draft.application, undefined);
  assert.match(session.getSnapshot().error ?? "", /IDB full/);
  fail = false;
  const current = session.getSnapshot().record!.draft;
  await session.commitDraft(
    current,
    { ...current, application: intent },
    async () => {
      posts++;
      throw Error("response lost");
    },
  );
  assert.equal(posts, 1);
  const recovered = await local.read();
  assert.equal(recovered?.draft.application?.key, "original-key");
  assert.equal(recovered?.draft.application?.revision, 4);
  const reopened = new AssistantSession(local, transport());
  await reopened.load(draft);
  assert.equal(posts, 1);
  assert.equal(
    reopened.getSnapshot().record?.draft.application?.phase,
    "unknown",
  );
});

test("conversation keeps the fixed round while a durable next message and attachments survive reopening", async () => {
  let saved:
    AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput> | undefined;
  const requests: { input: CanvasAssistanceInput; key: string }[] = [];
  const plans = new Map<string, Schema<"GenerationPlan">>();
  const local: AssistantStorage<CanvasAssistantDraft, CanvasAssistanceInput> = {
    read: async () => structuredClone(saved),
    write: async (record) => {
      saved = structuredClone(record);
    },
    clear: async () => {},
  };
  const remote: AssistantTransport<CanvasAssistanceInput> = {
    ...transport(),
    createPlan: async (input, key) => {
      requests.push({ input: structuredClone(input), key });
      const plan = { ...fixedPlan, id: `plan-${requests.length}`, input };
      plans.set(plan.id, plan);
      return plan;
    },
    getPlan: async (id) => plans.get(id)!,
  };
  const chat = new AssistantSession<
    CanvasAssistantDraft,
    CanvasAssistanceInput
  >(local, remote);
  await chat.load({ ...draft, nextInstruction: "第一条消息" });
  await sendCanvasAssistantMessage(chat, "project", assistant, target);
  assert.equal(requests.length, 1);
  const current = chat.getSnapshot().record!.draft;
  const nextSources = captureCanvasSources(canvas, ["text-a"]);
  chat.updateDraft(
    {
      ...current,
      nextInstruction: "继续保持节奏😀",
      nextSources,
      replyTo: { artifactId: "artifact-fixed", revision: 2 },
    },
    true,
  );
  await chat.settle();
  assert.equal(chat.getSnapshot().plan?.input.prompt, "第一条消息");
  assert.deepEqual(
    chat.getSnapshot().plan?.input.canvasSources,
    input.canvasSources,
  );
  const reopened = new AssistantSession<
    CanvasAssistantDraft,
    CanvasAssistanceInput
  >(local, remote);
  await reopened.load(draft);
  assert.equal(requests.length, 1, "opening only reads the original plan");
  assert.equal(
    reopened.getSnapshot().record?.draft.nextInstruction,
    "继续保持节奏😀",
  );
  assert.deepEqual(
    reopened.getSnapshot().record?.draft.nextSources,
    nextSources,
  );
  await sendCanvasAssistantMessage(reopened, "project", assistant, target);
  assert.equal(requests.length, 2);
  assert.equal(requests[1]!.input.prompt, "继续保持节奏😀");
  assert.deepEqual(requests[1]!.input.assistanceSource, {
    artifactId: "artifact-fixed",
    revision: 2,
  });
  assert.deepEqual(
    requests[1]!.input.canvasSources,
    nextSources.map((item) => item.source),
  );
  assert.deepEqual(saved?.previous, [{ planId: "plan-1" }]);
  assert.equal(plans.get("plan-1")?.input.prompt, "第一条消息");
  assert.equal(saved?.draft.nextInstruction, "");
});

test("a conversation with an unknown plan keeps the original request and the next message without a second POST", async () => {
  let saved:
    AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput> | undefined;
  const requests: string[] = [];
  const local: AssistantStorage<CanvasAssistantDraft, CanvasAssistanceInput> = {
    read: async () => structuredClone(saved),
    write: async (record) => {
      saved = structuredClone(record);
    },
    clear: async () => {},
  };
  const chat = new AssistantSession<
    CanvasAssistantDraft,
    CanvasAssistanceInput
  >(local, {
    ...transport(),
    createPlan: async (_input: CanvasAssistanceInput, key: string) => {
      requests.push(key);
      throw Error("lost response");
    },
  });
  await chat.load({ ...draft, nextInstruction: "原消息" });
  await sendCanvasAssistantMessage(chat, "project", assistant, target);
  const original = structuredClone(saved!.planRequest);
  chat.updateDraft(
    {
      ...chat.getSnapshot().record!.draft,
      nextInstruction: "不要丢掉这条后续输入",
    },
    true,
  );
  await chat.settle();
  await assert.rejects(
    sendCanvasAssistantMessage(chat, "project", assistant, target),
    /计划结果待核对/,
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(saved?.planRequest, original);
  assert.equal(saved?.draft.nextInstruction, "不要丢掉这条后续输入");
});

test("new messages cannot bypass an unresolved job or application, and failed local retention prevents plan creation", async () => {
  for (const phase of ["review", "unknown", "missing"] as const) {
    const records = new Map<
      string,
      AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput>
    >();
    let posts = 0;
    const chat = new AssistantSession<
      CanvasAssistantDraft,
      CanvasAssistanceInput
    >(storage(records, "chat"), {
      ...transport(),
      createPlan: async () => {
        posts++;
        return fixedPlan;
      },
    });
    await chat.load({
      ...draft,
      nextInstruction: "下一条",
      application: { ...intent, phase },
    });
    await assert.rejects(
      sendCanvasAssistantMessage(chat, "project", assistant, target),
      /建议应用/,
    );
    assert.equal(posts, 0);
    assert.equal(
      chat.getSnapshot().record?.draft.application?.key,
      "original-key",
    );
  }
  let saved:
      AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput> | undefined,
    fail = false,
    posts = 0;
  const local: AssistantStorage<CanvasAssistantDraft, CanvasAssistanceInput> = {
    read: async () => structuredClone(saved),
    write: async (record) => {
      if (fail) throw Error("IDB full");
      saved = structuredClone(record);
    },
    clear: async () => {},
  };
  const chat = new AssistantSession<
    CanvasAssistantDraft,
    CanvasAssistanceInput
  >(local, {
    ...transport(),
    createPlan: async () => {
      posts++;
      return fixedPlan;
    },
  });
  await chat.load(draft);
  chat.updateDraft({ ...draft, nextInstruction: "不能丢的消息" });
  await chat.settle();
  fail = true;
  await assert.rejects(
    sendCanvasAssistantMessage(chat, "project", assistant, target),
    /IDB full/,
  );
  assert.equal(posts, 0);
  assert.equal(saved?.draft.nextInstruction, "不能丢的消息");
  fail = false;
  saved = {
    schemaVersion: 1,
    draft: { ...draft, nextInstruction: "任务未完成时输入" },
    planId: fixedPlan.id,
    execution: {
      key: "original-execution",
      planId: fixedPlan.id,
      jobId: "job-unknown",
    },
    previous: [],
  };
  const unknownJob = {
    id: "job-unknown",
    planId: fixedPlan.id,
    status: "submission_unknown",
    mediaIds: [],
  } as unknown as Schema<"GenerationJob">;
  const reopened = new AssistantSession<
    CanvasAssistantDraft,
    CanvasAssistanceInput
  >(local, {
    ...transport(),
    getJob: async () => unknownJob,
  });
  await reopened.load(draft);
  await assert.rejects(
    sendCanvasAssistantMessage(reopened, "project", assistant, target),
    /上一轮任务/,
  );
  assert.equal(saved?.execution?.key, "original-execution");
});

test("restoring the conversation checks next attachments and the exact replied artifact before displaying them", async () => {
  const reads: string[] = [];
  await assert.rejects(
    verifyCanvasAssistantSources(
      {
        ...draft,
        sources: [],
        nextSources: draft.sources,
        replyTo: { artifactId: "prior-advice", revision: 7 },
      },
      canvas.id,
      async (kind, id, revision) => {
        reads.push(
          `${kind}/${id}${revision === undefined ? "" : `/r${revision}`}`,
        );
        if (kind === "assistance-artifacts")
          throw Error("advice access revoked");
      },
    ),
    /revoked/,
  );
  assert.deepEqual(reads, [
    "media/media-fixed",
    "asset-revisions/asset-r1",
    "assistance-artifacts/prior-advice/r7",
  ]);
});

test("fresh attachment refusal happens before any plan intent or POST and keeps the next message", async () => {
  const records = new Map<
    string,
    AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput>
  >();
  let posts = 0;
  const chat = new AssistantSession<
    CanvasAssistantDraft,
    CanvasAssistanceInput
  >(storage(records, "fresh"), {
    ...transport(),
    createPlan: async () => {
      posts++;
      return fixedPlan;
    },
  });
  await chat.load({ ...draft, nextInstruction: "应用后继续" });
  await assert.rejects(
    sendCanvasAssistantMessage(chat, "project", assistant, target, async () => {
      throw Error("附件r4与当前r5不一致");
    }),
    /r4/,
  );
  assert.equal(posts, 0);
  assert.equal(chat.getSnapshot().record?.planRequest, undefined);
  assert.equal(chat.getSnapshot().record?.draft.nextInstruction, "应用后继续");
});

function deliveryFixture(initial?: CanvasPlanDeliveries) {
  let saved = structuredClone(initial),
    fail = false;
  const store = {
    read: async () => structuredClone(saved),
    write: async (value: CanvasPlanDeliveries) => {
      if (fail) throw Error("delivery IDB full");
      saved = structuredClone(value);
    },
  };
  return {
    delivery: new CanvasPlanDelivery(store),
    store,
    read: () => structuredClone(saved),
    fail: () => {
      fail = true;
    },
  };
}

test("a verified first plan refusal survives reopen and explicit edit return preserves the original receipt", async () => {
  const records = new Map<
    string,
    AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput>
  >();
  const fixture = deliveryFixture();
  const keys: string[] = [];
  let reject = true;
  const plans = new Map<string, Schema<"GenerationPlan">>();
  const remote: AssistantTransport<CanvasAssistanceInput> = {
    ...transport(),
    createPlan: (body, key) =>
      fixture.delivery.submit(
        body,
        key,
        async () => {
          keys.push(key);
          assert.equal(
            fixture.read()?.receipts.find((item) => item.key === key)?.phase,
            "unknown",
            "receipt durable before POST",
          );
          if (reject)
            throw canvasPlanError(422, {
              code: "ASSISTANCE_REFERENCE_UNSUPPORTED",
              message: "reference unsupported",
              requestId: "api-1",
            });
          const plan = { ...fixedPlan, id: "plan-new", input: body };
          plans.set(plan.id, plan);
          return plan;
        },
        async (id) => plans.get(id)!,
      ),
  };
  const local = storage(records, "rejected");
  const chat = new AssistantSession(local, remote);
  await chat.load({ ...draft, nextInstruction: "原消息" });
  const prepareNew = (
    body: CanvasAssistanceInput,
    next: CanvasAssistantDraft,
  ) =>
    fixture.delivery.newMessage(body, () =>
      chat.prepareFrom(next, async () => body),
    );
  await sendCanvasAssistantMessage(
    chat,
    "project",
    assistant,
    target,
    undefined,
    prepareNew,
  );
  const original = structuredClone(chat.getSnapshot().record!.planRequest!);
  assert.equal(fixture.read()?.receipts[0]?.phase, "rejected");
  const reopened = new AssistantSession(local, remote);
  await reopened.load(draft);
  assert.equal(keys.length, 1);
  reopened.updateDraft(
    {
      ...reopened.getSnapshot().record!.draft,
      nextInstruction: "修正后的新消息",
    },
    true,
  );
  await reopened.settle();
  await returnRejectedCanvasPlan(fixture.delivery, reopened);
  assert.equal(reopened.getSnapshot().record?.planRequest, undefined);
  assert.deepEqual(fixture.read()?.receipts[0]?.input, original.input);
  assert.equal(fixture.read()?.receipts[0]?.key, original.key);
  reject = false;
  await sendCanvasAssistantMessage(
    reopened,
    "project",
    assistant,
    target,
    undefined,
    (body, next) =>
      fixture.delivery.newMessage(body, () =>
        reopened.prepareFrom(next, async () => body),
      ),
  );
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.equal(reopened.getSnapshot().plan?.input.prompt, "修正后的新消息");
});

test("legacy or uncertain plan retries never become rejected, and unverified/proxy errors do not release identity", async () => {
  const complete = () =>
    canvasPlanError(412, {
      code: "VERSION_CONFLICT",
      message: "stale",
      requestId: "api",
    });
  for (const legacy of [true, false]) {
    const fixture = deliveryFixture();
    let posts = 0;
    if (!legacy)
      await assert.rejects(
        fixture.delivery.newMessage(input, async () => {
          await fixture.delivery.submit(
            input,
            "original",
            async () => {
              posts++;
              throw Error("lost response");
            },
            async () => fixedPlan,
          );
        }),
      );
    await assert.rejects(
      fixture.delivery.submit(
        input,
        "original",
        async () => {
          posts++;
          throw complete();
        },
        async () => fixedPlan,
      ),
    );
    assert.equal(fixture.read()?.receipts[0]?.phase, "unknown");
    assert.equal(posts, legacy ? 1 : 2);
  }
  for (const error of [
    canvasPlanError(422, { code: "INVALID_REQUEST", message: "proxy" }),
    canvasPlanError(403, {
      code: "FORBIDDEN",
      message: "denied",
      requestId: "proxy",
    }),
    canvasPlanError(409, {
      code: "IDEMPOTENCY_CONFLICT",
      message: "different",
      requestId: "api",
    }),
  ]) {
    const fixture = deliveryFixture();
    await assert.rejects(
      fixture.delivery.newMessage(input, async () => {
        await fixture.delivery.submit(
          input,
          "key",
          async () => {
            throw error;
          },
          async () => fixedPlan,
        );
      }),
    );
    assert.equal(fixture.read()?.receipts[0]?.phase, "unknown");
  }
});

test("delivery failure prevents POST, mismatched responses stay unknown, and accepted recovery only reads its exact original plan", async () => {
  const failed = deliveryFixture();
  failed.fail();
  let posts = 0;
  await assert.rejects(
    failed.delivery.newMessage(input, async () => {
      await failed.delivery.submit(
        input,
        "no-post",
        async () => {
          posts++;
          return fixedPlan;
        },
        async () => fixedPlan,
      );
    }),
    /IDB full/,
  );
  assert.equal(posts, 0);
  const invalid = deliveryFixture();
  await assert.rejects(
    invalid.delivery.newMessage(input, async () => {
      await invalid.delivery.submit(
        input,
        "bad-response",
        async () => ({
          ...fixedPlan,
          input: { ...input, prompt: "wrong body" },
        }),
        async () => fixedPlan,
      );
    }),
    /不一致/,
  );
  assert.equal(invalid.read()?.receipts[0]?.phase, "unknown");
  const accepted = deliveryFixture();
  await accepted.delivery.newMessage(input, async () => {
    await accepted.delivery.submit(
      input,
      "accepted",
      async () => {
        posts++;
        return fixedPlan;
      },
      async () => fixedPlan,
    );
  });
  const restored = new CanvasPlanDelivery(accepted.store);
  const reads: string[] = [];
  await restored.submit(
    input,
    "accepted",
    async () => {
      posts++;
      return fixedPlan;
    },
    async (id) => {
      reads.push(id);
      return fixedPlan;
    },
  );
  assert.equal(posts, 1);
  assert.deepEqual(reads, [fixedPlan.id]);
  await assert.rejects(
    restored.submit(
      input,
      "accepted",
      async () => fixedPlan,
      async () => ({ ...fixedPlan, id: "other-plan" }),
    ),
    /不一致/,
  );
  assert.equal(accepted.read()?.receipts[0]?.planId, fixedPlan.id);
});

test("a mismatched local refusal cannot release another original plan request", async () => {
  const records = new Map<
    string,
    AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput>
  >();
  records.set("mismatch", {
    schemaVersion: 1,
    draft: { ...draft, nextInstruction: "保留" },
    planRequest: { key: "key", input },
    previous: [],
  });
  const chat = new AssistantSession<
    CanvasAssistantDraft,
    CanvasAssistanceInput
  >(storage(records, "mismatch"), transport());
  await chat.load(draft);
  const fixture = deliveryFixture({
    receipts: [
      {
        key: "key",
        input: { ...input, prompt: "different" },
        phase: "rejected",
        refusal: { status: 422, code: "INVALID_REQUEST", message: "invalid" },
      },
    ],
  });
  await assert.rejects(
    returnRejectedCanvasPlan(fixture.delivery, chat),
    /待核对/,
  );
  assert.equal(chat.getSnapshot().record?.planRequest?.key, "key");
});

test("free discussion fixes its canvas scope without media target or node attachments and validates the actual reply", () => {
  const discussion: CanvasAssistantDraft = {
    ...draft,
    kind: "discuss",
    sources: [],
    instruction: "想拍一段雨夜重逢",
    targetCapabilityId: "",
  };
  const request = canvasAssistancePlan(
    discussion,
    "project",
    assistant,
    undefined,
    canvas.id,
  );
  assert.deepEqual(request.assistance, {
    kind: "discuss",
    canvasId: canvas.id,
  });
  assert.deepEqual(request.canvasSources, []);
  assert.deepEqual(request.shotSources, []);
  assert.throws(
    () => canvasAssistancePlan(discussion, "project", assistant),
    /当前画布/,
  );
  assert.throws(
    () =>
      canvasAssistancePlan(
        { ...discussion, sources: draft.sources },
        "project",
        assistant,
        undefined,
        "other-canvas",
      ),
    /不属于/,
  );
  const reply = {
    request: request.assistance,
    body: {
      message: "先明确雨夜重逢的人物关系。",
      prompt: "",
      retain: [],
      change: [],
      notes: "",
      referenceSuggestions: [],
    },
  } as unknown as Schema<"AssistanceArtifact">;
  assert.equal(canvasAssistantReply(reply), "先明确雨夜重逢的人物关系。");
  assert.throws(
    () =>
      canvasAssistantReply({ ...reply, body: { ...reply.body, message: "" } }),
    /正文/,
  );
  assert.equal(
    canvasAssistancePlan(draft, "project", assistant, target).assistance?.kind,
    "prepare_prompt",
    "legacy unsent inputs keep their original kind",
  );
});

test("one discussion send fixes and executes only one request while rapid repeated sends await the same source check", async () => {
  const records = new Map<
    string,
    AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput>
  >();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let plans = 0,
    executions = 0;
  let prepared: Schema<"GenerationPlan">;
  const remote: AssistantTransport<CanvasAssistanceInput> = {
    ...transport(),
    createPlan: async (request) => {
      plans++;
      return (prepared = { ...fixedPlan, input: request });
    },
    getPlan: async () => prepared,
    execute: async (planId) => {
      executions++;
      return {
        id: "discussion-job",
        planId,
        status: "queued",
        mediaIds: [],
      } as unknown as Schema<"GenerationJob">;
    },
  };
  const chat = new AssistantSession(storage(records, "discussion"), remote);
  await chat.load({
    ...draft,
    kind: "discuss",
    sources: [],
    instruction: "",
    nextInstruction: "只讨论雨夜的色调",
    targetCapabilityId: "",
  });
  const sending = sendCanvasAssistantMessage(
    chat,
    "project",
    assistant,
    undefined,
    async () => gate,
    undefined,
    canvas.id,
  );
  await assert.rejects(
    sendCanvasAssistantMessage(
      chat,
      "project",
      assistant,
      undefined,
      undefined,
      undefined,
      canvas.id,
    ),
    /正在发送/,
  );
  release();
  await sending;
  assert.equal(plans, 1);
  assert.equal(executions, 1);
  assert.equal(chat.getSnapshot().record?.execution?.jobId, "discussion-job");
  assert.equal(chat.getSnapshot().record?.draft.kind, "discuss");
});

test("a lost discussion plan response survives refresh without executing or replacing the original message", async () => {
  const records = new Map<
    string,
    AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput>
  >();
  let plans = 0,
    executions = 0;
  const remote: AssistantTransport<CanvasAssistanceInput> = {
    ...transport(),
    createPlan: async () => {
      plans++;
      throw Error("plan committed, response lost");
    },
    execute: async () => {
      executions++;
      throw Error("must not execute");
    },
  };
  const local = storage(records, "discussion-unknown");
  const chat = new AssistantSession(local, remote);
  await chat.load({
    ...draft,
    kind: "discuss",
    sources: [],
    instruction: "",
    nextInstruction: "讨论人物动机",
  });
  await assert.rejects(
    sendCanvasAssistantMessage(
      chat,
      "project",
      assistant,
      undefined,
      undefined,
      undefined,
      canvas.id,
    ),
    /response lost/,
  );
  const original = structuredClone(chat.getSnapshot().record?.planRequest);
  const reopened = new AssistantSession(local, remote);
  await reopened.load(draft);
  await reopened.refresh();
  assert.equal(plans, 1);
  assert.equal(executions, 0);
  assert.deepEqual(reopened.getSnapshot().record?.planRequest, original);
  await assert.rejects(
    sendCanvasAssistantMessage(
      reopened,
      "project",
      assistant,
      undefined,
      undefined,
      undefined,
      canvas.id,
    ),
    /上一条/,
  );
  assert.equal(plans, 1);
});

test("a discussion execute with a lost accepted response restores the original job by GET with no automatic second execution", async () => {
  const records = new Map<
    string,
    AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput>
  >();
  let executions = 0;
  let prepared: Schema<"GenerationPlan">;
  let accepted: Schema<"GenerationJob"> | undefined;
  const remote: AssistantTransport<CanvasAssistanceInput> = {
    ...transport(),
    createPlan: async (request) =>
      (prepared = { ...fixedPlan, input: request }),
    getPlan: async () => prepared,
    execute: async (planId) => {
      executions++;
      accepted = {
        id: "accepted-discussion",
        planId,
        status: "queued",
        mediaIds: [],
      } as unknown as Schema<"GenerationJob">;
      throw Error("accepted response lost");
    },
    findJob: async () => accepted,
    getJob: async () => accepted!,
  };
  const local = storage(records, "discussion-execute");
  const chat = new AssistantSession(local, remote);
  await chat.load({
    ...draft,
    kind: "discuss",
    sources: [],
    instruction: "",
    nextInstruction: "讨论镜头节奏",
  });
  await sendCanvasAssistantMessage(
    chat,
    "project",
    assistant,
    undefined,
    undefined,
    undefined,
    canvas.id,
  );
  const key = chat.getSnapshot().record?.execution?.key;
  assert.ok(key);
  const reopened = new AssistantSession(local, remote);
  await reopened.load(draft);
  await reopened.refresh();
  assert.equal(executions, 1);
  assert.equal(reopened.getSnapshot().record?.execution?.key, key);
  assert.equal(
    reopened.getSnapshot().record?.execution?.jobId,
    "accepted-discussion",
  );
});

test("three ordinary discussion sends follow the latest durably verified reply without manually selecting history", async () => {
  const records = new Map<
    string,
    AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput>
  >();
  const inputs: CanvasAssistanceInput[] = [];
  const plans = new Map<string, Schema<"GenerationPlan">>();
  const remote: AssistantTransport<CanvasAssistanceInput> = {
    ...transport(),
    createPlan: async (input) => {
      inputs.push(structuredClone(input));
      const plan = {
        ...fixedPlan,
        id: `discussion-plan-${inputs.length}`,
        input,
      };
      plans.set(plan.id, plan);
      return plan;
    },
    getPlan: async (id) => plans.get(id)!,
    execute: async (planId) =>
      discussionJob({
        id: `job-${inputs.length}`,
        planId,
        status: "succeeded",
        mediaIds: [],
        assistanceArtifactId: `reply-${inputs.length}`,
      }),
  };
  const chat = new AssistantSession(storage(records, "continuous"), remote);
  await chat.load({
    ...draft,
    kind: "discuss",
    sources: [],
    instruction: "",
    nextInstruction: "建立两个人的关系",
  });
  for (let round = 1; round <= 3; round++) {
    if (round > 1) {
      chat.updateDraft(
        {
          ...chat.getSnapshot().record!.draft,
          nextInstruction: `继续第${round}轮`,
        },
        true,
      );
      await chat.settle();
    }
    await sendCanvasAssistantMessage(
      chat,
      "project",
      assistant,
      undefined,
      undefined,
      undefined,
      canvas.id,
    );
    assert.deepEqual(
      inputs[round - 1]?.assistanceSource,
      round === 1
        ? undefined
        : { artifactId: `reply-${round - 1}`, revision: 1 },
    );
    const fixedReply = {
      id: `reply-${round}`,
      revision: 1,
      projectId: "project",
      generationJobId: `job-${round}`,
      request: { kind: "discuss", canvasId: canvas.id },
      body: {
        message: `第${round}轮实际固定回复`,
        prompt: "",
        notes: "",
        retain: [],
        change: [],
        referenceSuggestions: [],
      },
    } as unknown as Schema<"AssistanceArtifact">;
    const current = chat.getSnapshot().record!.draft;
    await chat.commitDraft(current, current, async (captured) =>
      retainCanvasAssistantReply(captured, fixedReply),
    );
    assert.deepEqual(records.get("continuous")?.draft.replyTo, {
      artifactId: `reply-${round}`,
      revision: 1,
    });
  }
  assert.equal(inputs.length, 3);
  assert.deepEqual(
    plans.get("discussion-plan-2")?.input.assistanceSource,
    { artifactId: "reply-1", revision: 1 },
    "a later reply never changes an earlier fixed request",
  );
});

test("a late reply preserves explicit history and explicit removal for the next message", () => {
  const latest = {
    id: "latest",
    revision: 2,
    request: { kind: "discuss", canvasId: canvas.id },
    body: { message: "核对后的新回复" },
  } as unknown as Schema<"AssistanceArtifact">;
  const selected = {
    ...draft,
    kind: "discuss" as const,
    replyChoice: "explicit" as const,
    replyTo: { artifactId: "chosen-old", revision: 3 },
  };
  assert.deepEqual(
    retainCanvasAssistantReply(selected, latest).replyTo,
    selected.replyTo,
  );
  const removed = retainCanvasAssistantReply(
    { ...selected, replyChoice: "none", replyTo: undefined },
    latest,
  );
  assert.equal(removed.replyTo, undefined);
  assert.equal(removed.replyChoice, "none");
  assert.equal(
    canvasAssistancePlan(removed, "project", assistant, undefined, canvas.id)
      .assistanceSource,
    undefined,
  );
});

test("failure to retain the latest discussion reply prevents a next plan even when the user keeps typing", async () => {
  const records = new Map<
    string,
    AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput>
  >();
  const local = storage(records, "reply-write-failure");
  let planCount = 0;
  let prepared: Schema<"GenerationPlan">;
  const remote: AssistantTransport<CanvasAssistanceInput> = {
    ...transport(),
    createPlan: async (input) => {
      planCount++;
      return (prepared = { ...fixedPlan, input });
    },
    getPlan: async () => prepared,
    execute: async (planId) =>
      discussionJob({
        id: "reply-job",
        planId,
        status: "succeeded",
        mediaIds: [],
        assistanceArtifactId: "reply-failed-write",
      }),
  };
  const chat = new AssistantSession(
    {
      ...local,
      write: async (record) => {
        if (record.draft.artifact?.id === "reply-failed-write")
          throw Error("local disk write failed");
        await local.write(record);
      },
    },
    remote,
  );
  await chat.load({
    ...draft,
    kind: "discuss",
    sources: [],
    instruction: "",
    nextInstruction: "先讨论人物",
  });
  await sendCanvasAssistantMessage(
    chat,
    "project",
    assistant,
    undefined,
    undefined,
    undefined,
    canvas.id,
  );
  const current = chat.getSnapshot().record!.draft;
  const reply = {
    id: "reply-failed-write",
    revision: 1,
    request: { kind: "discuss", canvasId: canvas.id },
    body: { message: "已完成但本机未保留的回复" },
  } as unknown as Schema<"AssistanceArtifact">;
  await chat.commitDraft(current, current, async (captured) =>
    retainCanvasAssistantReply(captured, reply),
  );
  chat.updateDraft(
    { ...chat.getSnapshot().record!.draft, nextInstruction: "后续文字仍保留" },
    true,
  );
  await chat.settle();
  await assert.rejects(
    sendCanvasAssistantMessage(
      chat,
      "project",
      assistant,
      undefined,
      undefined,
      undefined,
      canvas.id,
    ),
    /最新回复/,
  );
  assert.equal(planCount, 1);
  assert.equal(
    records.get("reply-write-failure")?.draft.nextInstruction,
    "后续文字仍保留",
  );
  assert.equal(records.get("reply-write-failure")?.draft.artifact, undefined);
});

test("a verified first discussion limit refusal retains the message and only an explicitly detached new topic executes", async () => {
  for (const code of ["ASSISTANCE_HISTORY_LIMIT", "ASSISTANCE_INPUT_LIMIT"]) {
    const records = new Map<
      string,
      AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput>
    >();
    let receipts: CanvasPlanDeliveries | undefined;
    const delivery = new CanvasPlanDelivery({
      read: async () => structuredClone(receipts),
      write: async (next) => {
        receipts = structuredClone(next);
      },
    });
    const inputs: CanvasAssistanceInput[] = [];
    let executions = 0;
    let prepared: Schema<"GenerationPlan">;
    const remote: AssistantTransport<CanvasAssistanceInput> = {
      ...transport(),
      createPlan: (input, key) =>
        delivery.submit(
          input,
          key,
          async () => {
            inputs.push(structuredClone(input));
            if (input.assistanceSource)
              throw canvasPlanError(422, {
                code,
                message: "对话已达到上限，请明确开启新话题。",
                requestId: "verified-refusal",
              });
            return (prepared = { ...fixedPlan, id: "new-topic-plan", input });
          },
          async () => prepared,
        ),
      getPlan: async () => prepared,
      execute: async (planId) => {
        executions++;
        return discussionJob({
          id: "new-topic-job",
          planId,
          status: "queued",
          mediaIds: [],
        });
      },
    };
    const chat = new AssistantSession(storage(records, code), remote);
    const originalText = "我写好的新问题不能丢失";
    await chat.load({
      ...draft,
      kind: "discuss",
      sources: [],
      instruction: "",
      nextInstruction: originalText,
      replyTo: { artifactId: "bounded-discussion", revision: 1 },
      replyChoice: "explicit",
    });
    const send = () =>
      sendCanvasAssistantMessage(
        chat,
        "project",
        assistant,
        undefined,
        undefined,
        (input, next) =>
          delivery.newMessage(input, () =>
            chat.prepareFrom(next, async () => input),
          ),
        canvas.id,
      );
    await assert.rejects(send(), /达到上限/);
    assert.equal(executions, 0);
    assert.equal(receipts?.receipts[0]?.phase, "rejected");
    assert.equal(
      chat.getSnapshot().record?.planRequest?.input.prompt,
      originalText,
    );
    const rejected = structuredClone(receipts!.receipts[0]);
    await returnRejectedCanvasPlan(delivery, chat);
    const editable = chat.getSnapshot().record!.draft;
    assert.equal(editable.nextInstruction, originalText);
    assert.deepEqual(editable.replyTo, {
      artifactId: "bounded-discussion",
      revision: 1,
    });
    chat.updateDraft(
      { ...editable, replyTo: undefined, replyChoice: "none" },
      true,
    );
    await chat.settle();
    assert.equal(inputs.length, 1, "removing context alone never submits");
    await send();
    assert.equal(inputs.length, 2);
    assert.equal(inputs[1]?.prompt, originalText);
    assert.equal(inputs[1]?.assistanceSource, undefined);
    assert.equal(executions, 1);
    assert.deepEqual(receipts?.receipts[0], rejected);
  }
});

test("starting a new topic preserves the unsent message and model while the next send is independent of the old reply", async () => {
  const oldReply = {
    id: "old-topic-reply",
    revision: 1,
    generationJobId: "old-topic-job",
    projectId: "project",
    request: { kind: "discuss", canvasId: canvas.id },
    body: { message: "旧话题固定回复" },
  } as unknown as Schema<"AssistanceArtifact">;
  const oldInput = canvasAssistancePlan(
    { ...draft, kind: "discuss", sources: [], instruction: "旧问题" },
    "project",
    assistant,
    undefined,
    canvas.id,
  );
  const oldPlan = { ...fixedPlan, id: "old-topic-plan", input: oldInput };
  const records = new Map<
    string,
    AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput>
  >();
  records.set("topic", {
    schemaVersion: 1,
    previous: [],
    planId: oldPlan.id,
    execution: { key: "old-key", planId: oldPlan.id, jobId: "old-topic-job" },
    draft: {
      ...draft,
      kind: "discuss",
      instruction: "旧问题",
      nextInstruction: "请讨论这个新的手部动作",
      nextSources: captureCanvasSources(canvas, ["text-a"]),
      artifact: oldReply,
      replyTo: { artifactId: oldReply.id, revision: 1 },
      replyChoice: "automatic",
    },
  });
  const inputs: CanvasAssistanceInput[] = [];
  let executions = 0;
  const remote: AssistantTransport<CanvasAssistanceInput> = {
    ...transport(),
    getPlan: async () => oldPlan,
    getJob: async () =>
      discussionJob({
        id: "old-topic-job",
        planId: oldPlan.id,
        status: "succeeded",
        assistanceArtifactId: oldReply.id,
      }),
    createPlan: async (input) => {
      inputs.push(structuredClone(input));
      return { ...fixedPlan, id: "new-topic-plan", input };
    },
    execute: async (planId) => {
      executions++;
      return discussionJob({ id: "new-topic-job", planId, status: "queued" });
    },
  };
  const chat = new AssistantSession(storage(records, "topic"), remote);
  await chat.load(draft);
  await beginCanvasAssistantTopic(chat, ["older-list-reply"]);
  assert.equal(inputs.length, 0);
  assert.equal(executions, 0);
  const newTopicDraft = chat.getSnapshot().record!.draft;
  await chat.commitDraft(newTopicDraft, newTopicDraft, async (current) =>
    retainCanvasAssistantReply(current, oldReply),
  );
  assert.equal(
    chat.getSnapshot().record?.draft.artifact,
    undefined,
    "a late old reply cannot reopen the prior topic",
  );
  await beginCanvasAssistantTopic(chat, ["another-list-reply"]);
  assert.deepEqual(
    chat.getSnapshot().record?.draft.conversationBoundary?.artifactIds,
    ["older-list-reply", oldReply.id, "another-list-reply"],
  );
  assert.deepEqual(
    chat.getSnapshot().record?.draft.conversationBoundary?.planIds,
    [oldPlan.id],
  );
  const reopened = new AssistantSession(storage(records, "topic"), remote);
  await reopened.load(draft);
  assert.equal(
    reopened.getSnapshot().record?.draft.artifact,
    undefined,
    "a new topic has no current old response",
  );
  await sendCanvasAssistantMessage(
    reopened,
    "project",
    assistant,
    undefined,
    undefined,
    undefined,
    canvas.id,
  );
  assert.equal(inputs[0]?.prompt, "请讨论这个新的手部动作");
  assert.equal(inputs[0]?.capabilityId, assistant.id);
  assert.equal(inputs[0]?.assistanceSource, undefined);
  assert.deepEqual(
    inputs[0]?.canvasSources,
    captureCanvasSources(canvas, ["text-a"]).map((s) => s.source),
  );
  assert.deepEqual(records.get("topic")?.previous, [
    { planId: oldPlan.id, jobId: "old-topic-job" },
  ]);
  assert.equal(oldPlan.input.prompt, "旧问题");
  assert.equal(executions, 1);
});

async function conversationTransitionFixture(
  adjust?: (
    record: AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput>,
  ) => void,
  status: Schema<"GenerationJob">["status"] = "succeeded",
) {
  const reply = {
    id: "transition-reply",
    revision: 1,
    projectId: "project",
    generationJobId: "transition-job",
    request: { kind: "discuss", canvasId: canvas.id },
    body: { message: "实际固定的旧轮次回复" },
  } as unknown as Schema<"AssistanceArtifact">;
  const record: AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput> = {
    schemaVersion: 1,
    previous: [],
    planId: "transition-plan",
    execution: {
      planId: "transition-plan",
      jobId: "transition-job",
      key: "original-execution-key",
    },
    draft: {
      ...draft,
      kind: "discuss",
      instruction: "旧讨论输入",
      nextInstruction: "保留这个尚未发出的新想法",
      nextSources: captureCanvasSources(canvas, ["text-a"]),
      artifact: reply,
      replyTo: { artifactId: reply.id, revision: 1 },
      replyChoice: "automatic",
    },
  };
  adjust?.(record);
  const records = new Map<
    string,
    AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput>
  >([["transition", structuredClone(record)]]);
  const originalPlan = {
    ...fixedPlan,
    id: "transition-plan",
    input: canvasAssistancePlan(
      record.draft,
      "project",
      assistant,
      target,
      canvas.id,
    ),
  };
  const plans = new Map([[originalPlan.id, originalPlan]]);
  const inputs: CanvasAssistanceInput[] = [];
  let failWrite = false,
    executions = 0;
  const local = storage(records, "transition");
  const remote: AssistantTransport<CanvasAssistanceInput> = {
    ...transport(),
    getPlan: async (id) => plans.get(id)!,
    getJob: async () =>
      discussionJob({
        id: "transition-job",
        planId: originalPlan.id,
        status,
        assistanceArtifactId: reply.id,
      }),
    createPlan: async (input) => {
      inputs.push(structuredClone(input));
      const plan = { ...fixedPlan, id: `next-plan-${inputs.length}`, input };
      plans.set(plan.id, plan);
      return plan;
    },
    execute: async (planId) => {
      executions++;
      return discussionJob({ id: "next-job", planId, status: "queued" });
    },
  };
  const chat = new AssistantSession(
    {
      ...local,
      write: async (next) => {
        if (failWrite) throw Error("local topic write failed");
        await local.write(next);
      },
    },
    remote,
  );
  await chat.load(draft);
  return {
    chat,
    inputs,
    originalPlan,
    reply,
    executions: () => executions,
    saved: () => structuredClone(records.get("transition")!),
    failWrite: (fail: boolean) => {
      failWrite = fail;
    },
    reopen: async () => {
      const next = new AssistantSession(local, remote);
      await next.load(draft);
      return next;
    },
  };
}

for (const transition of [
  beginCanvasAssistantTopic,
  beginCanvasAssistantPrompt,
])
  test(`${transition.name} cannot report a switch when the local write fails`, async () => {
    const f = await conversationTransitionFixture(),
      original = f.saved();
    f.failWrite(true);
    await assert.rejects(transition(f.chat), /local topic write failed/);
    assert.deepEqual(f.saved(), original);
    assert.deepEqual(f.chat.getSnapshot().record, original);
    assert.equal(f.inputs.length, 0);
    assert.equal(f.executions(), 0);
    f.failWrite(false);
    await transition(f.chat);
    const reopened = await f.reopen();
    assert.equal(
      reopened.getSnapshot().record?.draft.nextInstruction,
      original.draft.nextInstruction,
    );
  });

test("new topics and prompt mode cannot replace unknown requests, unfinished jobs or unresolved applications", async () => {
  const cases = [
    {
      change: (
        r: AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput>,
      ) => {
        delete r.planId;
        delete r.execution;
        r.planRequest = { key: "unknown-plan-key", input };
      },
      match: /原计划/,
    },
    { status: "submission_unknown" as const, match: /当前任务/ },
    { status: "queued" as const, match: /当前任务/ },
    ...(["review", "unknown", "missing"] as const).map((phase) => ({
      change: (
        r: AssistantRecord<CanvasAssistantDraft, CanvasAssistanceInput>,
      ) => {
        r.draft.application = { ...intent, phase };
      },
      match: /建议应用/,
    })),
  ];
  for (const scenario of cases) {
    const f = await conversationTransitionFixture(
        scenario.change,
        scenario.status,
      ),
      original = f.saved();
    for (const transition of [
      beginCanvasAssistantTopic,
      beginCanvasAssistantPrompt,
    ]) {
      await assert.rejects(transition(f.chat), scenario.match);
      assert.deepEqual(f.saved(), original);
      assert.deepEqual(f.chat.getSnapshot().record, original);
      assert.equal(f.inputs.length, 0);
      assert.equal(f.executions(), 0);
    }
  }
});

test("topic switching cannot interrupt an active draft operation or an unverified session", async () => {
  const f = await conversationTransitionFixture(),
    current = f.chat.getSnapshot().record!.draft;
  let resolve!: () => void;
  const gate = new Promise<void>((done) => {
    resolve = done;
  });
  const saving = f.chat.commitDraft(current, current, async (draft) => {
    await gate;
    return draft;
  });
  try {
    await assert.rejects(beginCanvasAssistantTopic(f.chat), /核对完成/);
    assert.equal(f.chat.getSnapshot().busy, true);
  } finally {
    resolve();
    await saving;
  }
  const saved = f.saved();
  f.chat.suspend();
  await assert.rejects(beginCanvasAssistantTopic(f.chat), /核对完成/);
  assert.deepEqual(f.saved(), saved);
  assert.equal(f.inputs.length, 0);
  assert.equal(f.executions(), 0);
});

test("switching discussion to prompt preparation keeps the fixed old discussion and requires a separate confirmed execution", async () => {
  const f = await conversationTransitionFixture();
  await beginCanvasAssistantPrompt(f.chat);
  assert.equal(f.inputs.length, 0);
  assert.equal(f.executions(), 0);
  assert.equal(f.chat.getSnapshot().plan?.input.assistance?.kind, "discuss");
  const selected = f.chat.getSnapshot().record!.draft;
  await f.chat.commitDraft(selected, selected, async (current) =>
    retainCanvasAssistantReply(current, f.reply),
  );
  await sendCanvasAssistantMessage(
    f.chat,
    "project",
    assistant,
    target,
    undefined,
    undefined,
    canvas.id,
  );
  assert.equal(f.inputs[0]?.assistance?.kind, "prepare_prompt");
  assert.equal(f.inputs[0]?.assistance?.targetCapabilityId, target.id);
  assert.equal(
    f.inputs[0]?.assistanceSource,
    undefined,
    "discussion replies are not valid prompt-preparation parents",
  );
  assert.equal(f.inputs[0]?.prompt, "保留这个尚未发出的新想法");
  assert.deepEqual(
    f.inputs[0]?.canvasSources,
    captureCanvasSources(canvas, ["text-a"]).map((s) => s.source),
  );
  assert.equal(f.executions(), 0);
  assert.equal(f.originalPlan.input.assistance?.kind, "discuss");
});

test("an explicitly referenced prompt retains its fixed target and visible reference through preparing the next prompt", async () => {
  const f = await conversationTransitionFixture((record) => {
    record.draft.kind = "prepare_prompt";
    record.draft.replyTo = { artifactId: "explicit-prompt", revision: 4 };
    record.draft.replyChoice = "explicit";
  });
  await beginCanvasAssistantPrompt(f.chat);
  await sendCanvasAssistantMessage(
    f.chat,
    "project",
    assistant,
    target,
    undefined,
    undefined,
    canvas.id,
  );
  assert.deepEqual(f.inputs[0]?.assistanceSource, {
    artifactId: "explicit-prompt",
    revision: 4,
  });
  assert.equal(
    f.inputs[0]?.assistance?.targetCapabilityRevision,
    target.revision,
  );
  assert.equal(
    f.chat.getSnapshot().record?.draft.replyChoice,
    "explicit",
    "the composer must not hide a still-explicit fixed prompt reference as automatic dialogue",
  );
  assert.equal(f.executions(), 0);
});

test("changing topic cannot overtake a message while its explicit sources are being checked", async () => {
  const f = await conversationTransitionFixture((record) => {
    record.draft.kind = "prepare_prompt";
    record.draft.replyChoice = "explicit";
  });
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const checking = new Promise<void>((done) => {
    started = done;
  });
  const sending = sendCanvasAssistantMessage(
    f.chat,
    "project",
    assistant,
    target,
    async () => {
      started();
      await gate;
    },
    undefined,
    canvas.id,
  );
  try {
    await checking;
    const original = f.saved();
    await assert.rejects(beginCanvasAssistantTopic(f.chat), /核对完成/);
    await assert.rejects(beginCanvasAssistantPrompt(f.chat), /核对完成/);
    assert.deepEqual(f.saved(), original);
    assert.equal(f.inputs.length, 0);
  } finally {
    release();
    await sending;
  }
  assert.equal(f.inputs.length, 1);
  assert.equal(f.executions(), 0);
});
