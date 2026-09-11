import test from "node:test";
import assert from "node:assert/strict";
import { waitForStorageApi } from "./support/storage-ready.js";
const startup = () =>
  Object.assign(new Error("Server not initialized yet, please try again."), {
    $metadata: { httpStatusCode: 503 },
  });
test("storage fixture waits through explicit S3 startup after health is available", async () => {
  let calls = 0;
  await waitForStorageApi(async () => {
    calls++;
    if (calls === 1) throw startup();
  }, 1000);
  assert.equal(calls, 2);
});
test("storage fixture startup wait has a finite deadline", async () => {
  const before = performance.now();
  await assert.rejects(
    waitForStorageApi(async () => {
      throw startup();
    }, 25),
    /S3 initialization did not become ready/,
  );
  assert.ok(performance.now() - before < 1000);
});
test("storage fixture never retries authorization, network or unrelated service failures", async () => {
  for (const error of [
    new Error("socket closed"),
    Object.assign(new Error("AccessDenied"), {
      $metadata: { httpStatusCode: 403 },
    }),
    Object.assign(new Error("ServiceUnavailable"), {
      $metadata: { httpStatusCode: 503 },
    }),
  ]) {
    let calls = 0;
    await assert.rejects(
      waitForStorageApi(async () => {
        calls++;
        throw error;
      }),
      error,
    );
    assert.equal(calls, 1);
  }
});
