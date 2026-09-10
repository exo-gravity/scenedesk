import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../apps/api/src/app.js";
test("health distinguishes a runnable process from business or database readiness", async () => {
  const app = buildApp();
  try {
    const live = await app.inject("/health/live");
    assert.equal(live.statusCode, 200);
    assert.equal(live.json().productionReady, false);
    const ready = await app.inject("/health/ready");
    assert.equal(ready.statusCode, 503);
    const business = await app.inject("/v1/tenants");
    assert.equal(business.statusCode, 501);
    assert.equal(business.json().code, "BUSINESS_API_NOT_IMPLEMENTED");
  } finally {
    await app.close();
  }
});
