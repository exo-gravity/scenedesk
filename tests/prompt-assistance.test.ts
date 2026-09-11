import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AssistantSession,
  type AssistantRecord,
  type AssistantTransport,
} from "../apps/web/src/business/assistant-session.js";
import {
  applyPrompt,
  promptPlan,
  nextPromptInput,
  recoverArtifactSave,
  type PromptDraft,
  type IdentifiedArtifact,
} from "../apps/web/src/business/prompt-draft.js";
import type { components } from "@drama/contracts";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
const text = {
  id: "text",
  connectionId: "connection",
  purpose: "creative_assistance",
  revision: 2,
  enabled: true,
} as Schema<"Capability">;
const target = {
  id: "video",
  purpose: "video",
  revision: 3,
  enabled: true,
} as Schema<"Capability">;
const body = {
  prompt: "建议：缓慢推进。",
  referenceSuggestions: [{ mediaId: "reference", purpose: "style" as const }],
  retain: ["服装"],
  change: ["运镜"],
  notes: "受控测试",
};
const draft: PromptDraft = {
  source: { shotId: "shot-a", shotRevisionId: "fixed-a" },
  label: "A",
  intent: "抬头",
  prompt: "手工原文",
  references: [],
  instruction: "明确动作",
  capabilityId: "text",
  targetCapabilityId: "video",
  targetCapabilityRevision: 3,
};
const artifact = {
  id: "artifact",
  revision: 2,
  request: {
    kind: "prepare_prompt",
    targetCapabilityId: "video",
    targetCapabilityRevision: 3,
  },
  shotSources: [draft.source],
  body,
  inputOutdated: false,
  executionMode: "test_fixture",
} as IdentifiedArtifact;
function fixture(initial = draft) {
  let saved: AssistantRecord<PromptDraft> | undefined;
  const plan = {
    id: "plan",
    input: promptPlan(initial, "project", text, target),
    status: "ready",
    expiresAt: "2099-01-01T00:00:00Z",
  } as Schema<"GenerationPlan">;
  const transport: AssistantTransport = {
    checkAccess: async () => {},
    createPlan: async () => plan,
    getPlan: async () => plan,
    execute: async () => {
      throw Error("no execution in local draft fixture");
    },
    getJob: async () => {
      throw Error("no task");
    },
    findJob: async () => undefined,
  };
  const storage = {
    read: async () => structuredClone(saved),
    write: async (record: AssistantRecord<PromptDraft>) => {
      saved = structuredClone(record);
    },
    clear: async () => {
      saved = undefined;
    },
  };
  const controller = new AssistantSession(storage, transport);
  return { controller, storage, transport, current: () => saved };
}
test("prepare prompt fixes shot and target capability revision without implicit scene context", () => {
  const input = promptPlan(draft, "project", text, target);
  assert.deepEqual(input.shotSources, [draft.source]);
  assert.deepEqual(input.contextSources, []);
  assert.equal(input.assistance?.targetCapabilityRevision, 3);
  assert.throws(
    () => promptPlan(draft, "project", text, { ...target, revision: 4 }),
    /已改变/,
  );
  assert.throws(
    () => promptPlan(draft, "project", { ...text, enabled: false }, target),
    /可用/,
  );
});
test("explicit apply preserves manual text, fixed references and artifact revision; repeat cannot duplicate", () => {
  const prepared = { ...draft, artifact, editBody: body };
  const applied = applyPrompt(prepared, artifact);
  assert.equal(applied.prompt, "手工原文\n\n建议：缓慢推进。");
  assert.deepEqual(applied.assistanceSource, {
    artifactId: "artifact",
    revision: 2,
  });
  assert.deepEqual(applied.references, body.referenceSuggestions);
  assert.equal(draft.prompt, "手工原文");
  assert.throws(() => applyPrompt(applied, artifact), /已应用/);
  assert.throws(
    () =>
      applyPrompt(
        { ...prepared, source: { ...draft.source, shotRevisionId: "new" } },
        artifact,
      ),
    /固定镜头/,
  );
  assert.throws(
    () =>
      applyPrompt(
        { ...prepared, editBody: { ...body, prompt: "unsaved" } },
        artifact,
      ),
    /先保存/,
  );
});
test("unknown edit recovery confirms matching new revision with reordered body keys; unchanged base only permits explicit retry", () => {
  const pending = {
    ...draft,
    artifact,
    editBody: body,
    saveIntent: { revision: 1, body },
  };
  const reordered = {
    ...artifact,
    body: {
      notes: body.notes,
      change: body.change,
      retain: body.retain,
      referenceSuggestions: body.referenceSuggestions,
      prompt: body.prompt,
    },
  };
  assert.equal(recoverArtifactSave(pending, reordered).saveIntent, undefined);
  assert.equal(
    recoverArtifactSave(pending, { ...artifact, revision: 1 }).saveIntent
      ?.checked,
    true,
  );
  assert.throws(
    () => recoverArtifactSave(pending, { ...artifact, revision: 3 }),
    /其他修订/,
  );
});
test("manual draft editing after a fixed plan does not change prepared model input", async () => {
  const f = fixture();
  await f.controller.load(draft);
  await f.controller.prepare(promptPlan(draft, "project", text, target));
  f.controller.updateDraft({ ...draft, prompt: "手工追加后的原文" }, true);
  await f.controller.settle();
  assert.equal(f.current()?.draft.prompt, "手工追加后的原文");
  assert.equal(f.controller.getSnapshot().plan?.input.prompt, "明确动作");
  assert.equal(f.current()?.planId, "plan");
});
test("confirmation against older manual input rejects before application or remote read", async () => {
  const f = fixture();
  await f.controller.load(draft);
  f.controller.updateDraft({ ...draft, prompt: "new manual" }, true);
  await f.controller.settle();
  let applied = 0;
  await f.controller.commitDraft(draft, draft, async (current) => {
    applied++;
    return current;
  });
  assert.equal(applied, 0);
  assert.equal(f.current()?.draft.prompt, "new manual");
  assert.match(f.controller.getSnapshot().error ?? "", /输入已改变/);
});
test("save intent is durable before request; losing response preserves exact edit for refresh", async () => {
  const f = fixture({ ...draft, artifact, editBody: body });
  await f.controller.load({ ...draft, artifact, editBody: body });
  const current = f.controller.getSnapshot().record!.draft;
  const next = {
    ...current,
    saveIntent: { revision: artifact.revision, body },
  };
  await f.controller.commitDraft(current, next, async () => {
    assert.deepEqual(f.current()?.draft.saveIntent, next.saveIntent);
    throw Error("response lost");
  });
  const restored = new AssistantSession(f.storage, f.transport);
  await restored.load(draft);
  assert.deepEqual(
    restored.getSnapshot().record?.draft.saveIntent,
    next.saveIntent,
  );
});
test("late artifact result cannot repopulate draft or storage after session retirement", async () => {
  const f = fixture();
  await f.controller.load(draft);
  let release!: () => void, started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = f.controller.commitDraft(draft, draft, async (current) => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { ...current, artifact, editBody: body };
  });
  await startedPromise;
  await f.controller.retire();
  release();
  await pending;
  await f.controller.settle();
  assert.equal(f.current(), undefined);
  assert.equal(f.controller.getSnapshot().record, undefined);
});

test("new creation input retains the previous manual prompt and fixed artifact source", () => {
  const applied = applyPrompt({ ...draft, artifact, editBody: body }, artifact);
  const next = nextPromptInput(applied, {
    id: "shot-a",
    specRevisionId: "fixed-new",
    label: "A2",
    spec: { intent: "new intent" },
  } as Schema<"Shot">);
  assert.equal(next.prompt, "");
  assert.equal(next.assistanceSource, undefined);
  assert.equal(next.previousInputs?.[0]?.prompt, applied.prompt);
  assert.deepEqual(
    next.previousInputs?.[0]?.assistanceSource,
    applied.assistanceSource,
  );
  assert.equal(next.source.shotRevisionId, "fixed-new");
});

test("reading a concurrently changed artifact never silently rebases dirty manual edits", () => {
  const dirty = {
    ...draft,
    artifact,
    editBody: { ...body, prompt: "my dirty edit" },
  };
  assert.throws(
    () =>
      recoverArtifactSave(dirty, {
        ...artifact,
        revision: 3,
        body: { ...body, prompt: "other editor" },
      }),
    /其他修订/,
  );
  assert.equal(dirty.artifact.revision, 2);
  assert.equal(dirty.editBody.prompt, "my dirty edit");
});
