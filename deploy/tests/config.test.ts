import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apiConfiguration,
  workerConfiguration,
  DeploymentError,
} from "../runtime/config.js";
const connection = (role: string) =>
  `postgresql://${role}:random-password@database/private?sslmode=verify-full`;
const media = {
  endpoint: "https://objects.internal",
  region: "test-region",
  bucket: "private-media",
  accessKeyId: "key",
  secretAccessKey: "secret",
};
const api = () => ({
  origin: "https://workspace.internal",
  databaseUrl: connection("api"),
  authDatabaseUrl: connection("auth"),
  appSecret: Buffer.alloc(32, 7).toString("base64url"),
  oidc: { issuer: "https://identity.internal", clientId: "private-client" },
  media,
});
const worker = () => ({
  databaseUrl: connection("media"),
  schedulerDatabaseUrl: connection("scheduler"),
  media,
  exclusiveImportQueue: true,
  dedicatedDecoderHost: true,
});
test("private runtime configuration permits isolated roles, TLS services and explicit media credentials", () => {
  assert.equal(apiConfiguration(api()).oidc.localIssuer, false);
  assert.equal(workerConfiguration(worker()).media.local, false);
});
test("deployment rejects developer identity and insecure identity, origin, storage and database transports", () => {
  for (const value of [
    { ...api(), origin: "http://127.0.0.1:4311" },
    { ...api(), oidc: { issuer: "http://127.0.0.1:4320", clientId: "local" } },
    {
      ...api(),
      oidc: { issuer: "https://identity.internal", clientId: "fixture-client" },
    },
    { ...api(), media: { ...media, endpoint: "http://127.0.0.1:55440" } },
    {
      ...api(),
      databaseUrl: connection("api").replace("verify-full", "require"),
    },
    { ...api(), databaseUrl: `${connection("api")}&sslmode=disable` },
    { ...api(), authDatabaseUrl: connection("api") },
    { ...api(), authDatabaseUrl: connection("%61pi") },
    { ...api(), databaseUrl: connection("api").replace("/private?", "?") },
    {
      ...api(),
      authDatabaseUrl: connection("auth").replace("/private?", "/other?"),
    },
    { ...api(), appSecret: "short" },
    { ...api(), localIdentity: true },
  ])
    assert.throws(() => apiConfiguration(value), DeploymentError);
});
test("media worker requires an exclusive supported queue and a dedicated decoder host", () => {
  for (const value of [
    { ...worker(), exclusiveImportQueue: false },
    { ...worker(), dedicatedDecoderHost: false },
    { ...worker(), appSecret: "api-secret-must-not-enter-worker" },
    { ...worker(), schedulerDatabaseUrl: connection("media") },
  ])
    assert.throws(() => workerConfiguration(value), DeploymentError);
});
test("invalid configuration diagnostics do not echo supplied credentials", () => {
  const secret = "do-not-log-this-secret";
  try {
    apiConfiguration({
      ...api(),
      databaseUrl: `postgresql://api:${secret}@database/private`,
    });
    assert.fail("expected rejection");
  } catch (error) {
    assert.ok(error instanceof DeploymentError);
    assert.ok(!error.message.includes(secret));
  }
});
