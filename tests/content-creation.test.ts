import assert from "node:assert/strict";
import { test } from "node:test";
import {
  submitCreation,
  type CreationIntent,
} from "../apps/web/src/business/content-creation.js";

const path = "/v1/tenants/t/projects/p/scenes";
const original: CreationIntent = {
  command: {
    path,
    method: "POST",
    version: 3,
    idempotencyKey: "fixed-request",
    body: {
      episodeId: "episode",
      title: "原场次",
      position: 0,
      status: "active",
      summary: "保留原文",
      state: {},
      defaultAssetRevisionIds: [],
    },
  },
};
const current = () => true;

test("lost creation response and reload replay the durable original request exactly once despite newer content", async () => {
  let saved: CreationIntent | undefined,
    creations = 0,
    attempts = 0;
  const receipts = new Map<string, unknown>();
  const store = async (intent: CreationIntent) => {
    saved = structuredClone(intent);
    return true;
  };
  const send = async (command: CreationIntent["command"]) => {
    assert.deepEqual(
      saved?.command,
      command,
      "request must be durable before any effect",
    );
    assert.deepEqual(command, original.command);
    attempts++;
    if (receipts.has(command.idempotencyKey))
      return receipts.get(command.idempotencyKey);
    const object = { id: "created-scene", ...(command.body as object) };
    receipts.set(command.idempotencyKey, object);
    creations++;
    throw Error("response lost after commit");
  };
  await assert.rejects(
    submitCreation(original, path, store, send, {
      initialSend: true,
      isCurrent: current,
    }),
    /lost/,
  );
  const restored = JSON.parse(JSON.stringify(saved)) as CreationIntent;
  // Current content now contains the first scene at position 0 and has revision 4.
  await submitCreation(restored, path, store, send, {
    initialSend: false,
    isCurrent: current,
  });
  assert.equal(creations, 1);
  assert.equal(attempts, 2);
  assert.equal(saved?.command.version, 3);
  assert.equal(saved?.rejected, undefined);
});

test("failed local persistence or a departed editor never sends a creation request", async () => {
  let sends = 0;
  await submitCreation(
    original,
    path,
    async () => false,
    async () => {
      sends++;
    },
    { initialSend: true, isCurrent: current },
  );
  await submitCreation(
    original,
    path,
    async () => true,
    async () => {
      sends++;
    },
    { initialSend: true, isCurrent: () => false },
  );
  assert.equal(sends, 0);
});

test("only a known first-send rejection permits editing; an unknown replay 412 preserves its original identity", async () => {
  for (const initialSend of [true, false]) {
    let saved: CreationIntent | undefined;
    await assert.rejects(
      submitCreation(
        original,
        path,
        async (value) => {
          saved = value;
          return true;
        },
        async () => {
          throw { status: 412, code: "REVISION_MISMATCH", message: "changed" };
        },
        { initialSend, isCurrent: current },
      ),
    );
    assert.equal(!!saved?.rejected, initialSend);
    assert.deepEqual(saved?.command, original.command);
  }
});

test("recovery keeps permission checks and cannot change the request target", async () => {
  let checks = 0,
    saved: CreationIntent | undefined;
  await assert.rejects(
    submitCreation(
      original,
      path,
      async (value) => {
        saved = value;
        return true;
      },
      async () => {
        checks++;
        throw { status: 403, message: "denied" };
      },
      { initialSend: false, isCurrent: current },
    ),
  );
  assert.equal(checks, 1);
  assert.equal(saved?.rejected, undefined);
  await assert.rejects(
    submitCreation(
      original,
      path + "/other",
      async () => true,
      async () => {
        checks++;
      },
      { initialSend: false, isCurrent: current },
    ),
    /不匹配/,
  );
  assert.equal(checks, 1);
});
