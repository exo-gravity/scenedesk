import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { databaseFixture } from "../support/database.js";
import { docxFixture } from "../support/docx.js";
import { buildApp } from "../../apps/api/src/app.js";
import { issueSession } from "../../apps/api/src/modules/identity/sessions.js";
import { Secrets } from "../../apps/api/src/kernel/crypto.js";
import { sqlIdentifier } from "@drama/database";

test("Word preview/import/download preserves fixed revisions, recovery and current project authority", async (t) => {
  const { schema, runtime, auth, admin } = await databaseFixture(t),
    secret = randomBytes(32).toString("base64url"),
    secrets = new Secrets(secret),
    origin = "http://127.0.0.1:4311";
  const app = buildApp(runtime, { schema, secret, origin });
  t.after(() => app.close());
  await app.ready();
  const identity = (name: string) =>
    issueSession(
      auth,
      {
        issuer: "urn:scenedesk:test",
        subject: name,
        email: `${name}@example.test`,
        emailVerified: true,
        displayName: name,
      },
      { schema },
    );
  const owner = await identity("word-owner"),
    collaborator = await identity("word-collaborator"),
    outsider = await identity("word-outsider");
  const request = (
    method: "GET" | "POST" | "DELETE",
    url: string,
    payload?: unknown,
    version?: number,
    who = owner,
    key = randomUUID(),
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
    method: "GET" | "POST" | "DELETE",
    url: string,
    payload?: unknown,
    version?: number,
    who = owner,
  ) {
    const r = await request(method, url, payload, version, who);
    assert.equal(
      r.statusCode,
      method === "POST" ? 201 : method === "DELETE" ? 204 : 200,
      r.body,
    );
    return r.statusCode === 204 ? undefined : r.json();
  }
  const tenant = await ok("POST", "/v1/tenants", {
      name: "Word fixture",
      currency: "CNY",
    }),
    tenantPath = `/v1/tenants/${tenant.id}`;
  const membership = (await ok("GET", `${tenantPath}/members`)).items[0];
  const project = await ok("POST", `${tenantPath}/projects`, {
      name: "Word 独立测试",
      leadMembershipId: membership.id,
      spec: {
        width: 1080,
        height: 1920,
        fpsNum: 24,
        fpsDen: 1,
        language: "zh-CN",
      },
    }),
    path = `${tenantPath}/projects/${project.id}`;
  const invitation = await ok("POST", `${tenantPath}/invitations`, {
    email: "word-collaborator@example.test",
    role: "member",
  });
  const member = await ok(
    "POST",
    "/v1/invitations/accept",
    {
      token: new URLSearchParams(
        new URL(invitation.invitationUrl).hash.split("?")[1],
      ).get("token"),
    },
    undefined,
    collaborator,
  );
  const projectMember = await ok("POST", `${path}/members`, {
    membershipId: member.id,
  });
  const file = {
    fileName: "初稿.docx",
    data: docxFixture().toString("base64"),
  };
  const preview = await ok("POST", `${path}/scripts/preview-docx`, file);
  assert.equal((await ok("GET", `${path}/scripts`)).items.length, 0);
  assert.equal((await ok("GET", `${path}/content`)).revision, 1);
  const input = {
    ...file,
    previewSha256: preview.sha256,
    importRequestId: randomUUID(),
  };
  const results = await Promise.all([
    request("POST", `${path}/scripts/import-docx`, input, 1),
    request("POST", `${path}/scripts/import-docx`, input, 1),
  ]);
  results.forEach((r) => assert.equal(r.statusCode, 201, r.body));
  const saved = results[0]!.json();
  assert.equal(results[1]!.json().id, saved.id);
  assert.equal(saved.sourceFormat, "docx");
  assert.equal(saved.number, 1);
  assert.equal(saved.document.blocks[0].kind, "heading");
  assert.equal((await ok("GET", `${path}/content`)).revision, 2);
  const original = await ok(
    "GET",
    `${path}/scripts/${saved.id}/original`,
    undefined,
    undefined,
    collaborator,
  );
  assert.equal(original.data, file.data);
  assert.equal(original.sha256, preview.sha256);
  assert.equal(
    (
      await request(
        "GET",
        `${path}/scripts/${saved.id}/original`,
        undefined,
        undefined,
        outsider,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await request(
        "POST",
        `${path}/scripts/import-docx`,
        { ...input, importRequestId: randomUUID() },
        1,
      )
    ).statusCode,
    412,
  );
  assert.equal(
    (await request("POST", `${path}/scripts/import-docx`, input, 2)).statusCode,
    409,
  );
  assert.equal(
    (
      await request(
        "POST",
        `${path}/scripts/import-docx`,
        {
          ...input,
          previewSha256: "0".repeat(64),
          importRequestId: randomUUID(),
        },
        2,
      )
    ).statusCode,
    409,
  );
  const next = await ok(
    "POST",
    `${path}/scripts`,
    { text: "更新后的纯文本剧本", parentRevisionId: saved.id },
    2,
  );
  assert.equal(next.number, 2);
  assert.equal(
    (await ok("GET", `${path}/scripts/${saved.id}/original`)).data,
    file.data,
  );
  // Domain receipt survives generic HTTP cache expiry and newer content revisions.
  await admin.query(`DELETE FROM ${sqlIdentifier(schema)}.idempotency_records`);
  const receipt = await ok(
    "GET",
    `${path}/script-imports/${input.importRequestId}`,
  );
  assert.equal(receipt.found, true);
  assert.equal(receipt.baseVersion, 1);
  assert.equal(receipt.script.id, saved.id);
  assert.equal(
    (
      await ok(
        "GET",
        `${path}/script-imports/${input.importRequestId}`,
        undefined,
        undefined,
        collaborator,
      )
    ).found,
    false,
  );
  assert.equal(
    (await ok("GET", `${path}/scripts/${saved.id}`)).text,
    preview.text,
  );
  const recovered = await ok("POST", `${path}/scripts/import-docx`, input, 1);
  assert.equal(recovered.id, saved.id);
  assert.equal((await ok("GET", `${path}/scripts`)).items.length, 2);
  const other = await ok("POST", `${tenantPath}/projects`, {
    name: "不可混用",
    leadMembershipId: membership.id,
    spec: project.spec,
  });
  assert.equal(
    (
      await request(
        "GET",
        `${tenantPath}/projects/${other.id}/scripts/${saved.id}/original`,
      )
    ).statusCode,
    404,
  );
  await ok(
    "DELETE",
    `${path}/members/${member.id}`,
    undefined,
    projectMember.revision,
  );
  assert.equal(
    (
      await request(
        "GET",
        `${path}/scripts/${saved.id}/original`,
        undefined,
        undefined,
        collaborator,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await request(
        "POST",
        `${path}/scripts/preview-docx`,
        file,
        undefined,
        collaborator,
      )
    ).statusCode,
    404,
  );
  await ok("POST", `${path}/archive`, undefined, project.revision);
  assert.equal(
    (await request("POST", `${path}/scripts/import-docx`, input, 1)).statusCode,
    409,
  );
  assert.equal(
    (await request("GET", `${path}/scripts/${saved.id}/original`)).statusCode,
    200,
  );
  assert.equal(
    (await request("GET", `${path}/script-imports/${input.importRequestId}`))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await request(
        "GET",
        `${path}/script-imports/${input.importRequestId}`,
        undefined,
        undefined,
        collaborator,
      )
    ).statusCode,
    404,
  );
  await assert.rejects(
    admin.query(
      `UPDATE ${sqlIdentifier(schema)}.script_originals SET bytes=$1 WHERE id=$2`,
      [Buffer.from("tamper"), saved.id],
    ),
  );
});
