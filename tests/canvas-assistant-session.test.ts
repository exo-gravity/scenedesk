import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureCanvasSources,
  canvasAssistancePlan,
  applicationPrompt,
  assertCanvasApplication,
  canvasApplicationError,
  verifyCanvasAssistantSources,
  type CanvasApplication,
  type CanvasApplicationResult,
  type CanvasAssistantDraft,
} from "../apps/web/src/business/canvas-assistant.js";
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
function storage<T>(
  records: Map<string, AssistantRecord<T>>,
  path: string,
): AssistantStorage<T> {
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
