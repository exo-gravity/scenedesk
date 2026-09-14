import assert from "node:assert/strict";
import { test } from "node:test";
import { retainCanvasEditing } from "../apps/web/src/business/canvas-edit-handoff.js";

function fixture() {
  const state = {
    local: {
      document: { prompt: "未提交的新文字" },
      pending: {
        id: "original-request",
        document: { prompt: "已发出的原文字" },
      },
    },
    localSaved: false,
    storageError: null as Error | null,
    accessChecking: false,
    phase: "error",
    recovery: null,
    recoveryBlocked: false,
  };
  let saved: typeof state.local | undefined;
  return {
    state,
    get saved() {
      return saved;
    },
    controller: {
      async retryLocal() {
        saved = structuredClone(state.local);
        state.localSaved = true;
      },
      getSnapshot: () => state,
    },
  };
}
test("offline editing handoff preserves original unknown request and current input without issuing a network save", async () => {
  const f = fixture();
  let generationRetained = false;
  await retainCanvasEditing(
    f.controller,
    async () => {
      generationRetained = true;
      return true;
    },
    () => true,
  );
  assert.deepEqual(f.saved, f.state.local);
  assert.equal(f.saved?.pending.id, "original-request");
  assert.equal(f.saved?.document.prompt, "未提交的新文字");
  assert.equal(generationRetained, true);
});
test("local storage failure and generation retention failure keep the old editing target", async () => {
  const f = fixture();
  let generationCalls = 0;
  f.controller.retryLocal = async () => {
    f.state.storageError = new Error("storage unavailable");
  };
  await assert.rejects(
    retainCanvasEditing(
      f.controller,
      async () => {
        generationCalls++;
        return true;
      },
      () => true,
    ),
    /本机输入/,
  );
  assert.equal(generationCalls, 0);
  const good = fixture();
  await assert.rejects(
    retainCanvasEditing(
      good.controller,
      async () => false,
      () => true,
    ),
    /创作参数/,
  );
});
test("late local completion after scope change cannot hand off into the next editor", async () => {
  const f = fixture();
  let release!: () => void,
    current = true,
    generationCalls = 0;
  const original = f.controller.retryLocal;
  f.controller.retryLocal = async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await original();
  };
  const pending = retainCanvasEditing(
    f.controller,
    async () => {
      generationCalls++;
      return true;
    },
    () => current,
  );
  current = false;
  release();
  await assert.rejects(pending, /页面已切换/);
  assert.equal(generationCalls, 0);
});
test("authority loss while independent generation inputs are being retained prevents the handoff", async () => {
  const f = fixture();
  await assert.rejects(
    retainCanvasEditing(
      f.controller,
      async () => {
        f.state.accessChecking = true;
        return true;
      },
      () => true,
    ),
    /本机输入/,
  );
});
