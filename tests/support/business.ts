import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
type HTTPMethods = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
import { buildApp, type BusinessOptions } from "../../apps/api/src/app.js";
import { Secrets } from "../../apps/api/src/kernel/crypto.js";
import { issueSession } from "../../apps/api/src/modules/identity/sessions.js";
import { databaseFixture } from "./database.js";

export async function businessFixture(
  t: TestContext,
  configure?: (
    database: Awaited<ReturnType<typeof databaseFixture>>,
  ) => Promise<Pick<BusinessOptions, "media" | "feishu">>,
) {
  const db = await databaseFixture(t);
  const secret = randomBytes(32).toString("base64url"),
    secrets = new Secrets(secret);
  const origin = "http://127.0.0.1:4311";
  const extra = await configure?.(db);
  const app = buildApp(db.runtime, {
    schema: db.schema,
    secret,
    origin,
    ...extra,
  });
  t.after(() => app.close());
  await app.ready();
  const identity = (name: string) =>
    issueSession(
      db.auth,
      {
        issuer: "urn:scenedesk:test",
        subject: name,
        email: `${name}@example.test`,
        emailVerified: true,
        displayName: name,
      },
      { schema: db.schema },
    );
  const owner = await identity("owner");
  const request = (
    method: HTTPMethods,
    url: string,
    payload?: unknown,
    version?: number,
    key = randomUUID(),
    who = owner,
  ) =>
    app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
      headers: {
        cookie: `session=${who.token}`,
        origin,
        "x-csrf-token": secrets.csrf(who.token),
        "idempotency-key": key,
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(version === undefined ? {} : { "if-match": `"${version}"` }),
      },
    });
  async function ok(
    method: HTTPMethods,
    url: string,
    payload?: unknown,
    version?: number,
  ) {
    const response = await request(method, url, payload, version);
    assert.equal(
      response.statusCode,
      method === "POST" ? 201 : method === "DELETE" ? 204 : 200,
      response.body,
    );
    return response.statusCode === 204 ? undefined : response.json();
  }
  const tenant = await ok("POST", "/v1/tenants", {
    name: "业务验收",
    currency: "CNY",
  });
  const membership = (await ok("GET", `/v1/tenants/${tenant.id}/members`))
    .items[0];
  const createProject = (name: string) =>
    ok("POST", `/v1/tenants/${tenant.id}/projects`, {
      name,
      leadMembershipId: membership.id,
      spec: {
        width: 1080,
        height: 1920,
        fpsNum: 24,
        fpsDen: 1,
        language: "zh-CN",
      },
    });
  const project = await createProject("旧钥匙");
  const path = `/v1/tenants/${tenant.id}/projects/${project.id}`;
  const tree = () => ok("GET", `${path}/content`);
  const next = async () => (await tree()).revision as number;
  return {
    ...db,
    app,
    owner,
    identity,
    request,
    ok,
    tenant,
    membership,
    project,
    path,
    tree,
    next,
    createProject,
  };
}
