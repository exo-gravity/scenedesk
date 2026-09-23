import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apiConfiguration,
  workerConfiguration,
  generationConfiguration,
  configuration,
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
test("the API declares its generation executor explicitly and refuses anything but a boolean", () => {
  assert.equal(apiConfiguration(api()).generationExecutor, false);
  assert.equal(apiConfiguration({ ...api(), generationExecutor: true }).generationExecutor, true);
  assert.equal(apiConfiguration({ ...api(), generationExecutor: false }).generationExecutor, false);
  assert.throws(() => apiConfiguration({ ...api(), generationExecutor: "yes" }), DeploymentError);
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
test("Feishu is optional and accepts only explicit tenant/project source bindings without logging secrets", () => {
  const feishu = {
    tenantId: "11111111-1111-4111-8111-111111111111",
    appId: "cli_synthetic",
    appSecret: "synthetic-secret",
    sources: [
      {
        projectId: "22222222-2222-4222-8222-222222222222",
        url: "https://team.feishu.cn/docx/SyntheticDocument001",
      },
    ],
  };
  assert.equal(
    apiConfiguration({ ...api(), feishu }).feishu?.sources.length,
    1,
  );
  for (const invalid of [
    { ...feishu, endpoint: "https://attacker.test" },
    {
      ...feishu,
      sources: [{ projectId: feishu.tenantId, url: "http://127.0.0.1/secret" }],
    },
    { ...feishu, tenantId: "bad" },
  ]) {
    assert.throws(
      () => apiConfiguration({ ...api(), feishu: invalid }),
      (error) =>
        error instanceof DeploymentError &&
        error.code === "CONFIG_FEISHU_INVALID" &&
        !error.message.includes(feishu.appSecret),
    );
  }
});
const generationExample = {
  databaseUrl:
    "postgresql://scenedesk_generation:secret@db.example.invalid/scenedesk?sslmode=verify-full",
  media: { region: "cn", bucket: "b", accessKeyId: "k", secretAccessKey: "s" },
  vendors: {
    volcengine: {
      apiKey: "a",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      accountTier: "personal",
    },
  },
  connections: [
    {
      vendor: "volcengine",
      connectionId: "33333333-3333-4333-8333-333333333333",
      connectionVersionId: "44444444-4444-4444-8444-444444444444",
      accountIdentityLabel: "ark",
    },
  ],
};
test("generation configuration accepts the documented shape and rejects unknown keys and http vendors", () => {
  const parsed = generationConfiguration(generationExample);
  assert.equal(parsed.vendors.connections.length, 1);
  assert.throws(
    () => generationConfiguration({ ...generationExample, extra: 1 }),
    /CONFIG_UNKNOWN_FIELD/,
  );
  assert.throws(
    () =>
      generationConfiguration({
        ...generationExample,
        vendors: {
          volcengine: {
            apiKey: "a",
            baseUrl: "http://ark.cn-beijing.volces.com",
          },
        },
      }),
    /GENERATION_BASE_URL_HTTPS_REQUIRED/,
  );
});
test("PROVIDER_MODE=verified is accepted and other values still fail", async () => {
  const previousMode = process.env.PROVIDER_MODE;
  const previousConfigFile = process.env.SCENEDESK_CONFIG_FILE;
  try {
    process.env.PROVIDER_MODE = "verified";
    process.env.SCENEDESK_CONFIG_FILE = "/nonexistent.json";
    await assert.rejects(
      configuration(),
      /CONFIG_FILE_UNREADABLE_OR_INVALID_JSON/,
    );
    process.env.PROVIDER_MODE = "real";
    await assert.rejects(configuration(), /PROVIDER_MODE_INVALID/);
  } finally {
    if (previousMode === undefined) delete process.env.PROVIDER_MODE;
    else process.env.PROVIDER_MODE = previousMode;
    if (previousConfigFile === undefined)
      delete process.env.SCENEDESK_CONFIG_FILE;
    else process.env.SCENEDESK_CONFIG_FILE = previousConfigFile;
  }
});
