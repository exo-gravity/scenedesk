import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { sqlIdentifier } from "@drama/database";
import { databaseFixture } from "../support/database.js";
import { buildApp } from "../../apps/api/src/app.js";
import { issueSession } from "../../apps/api/src/modules/identity/sessions.js";
import { Secrets } from "../../apps/api/src/kernel/crypto.js";

test("identity and projects enforce actual PostgreSQL roles, tenant scope, CAS and replay authorization", async (t) => {
  const { schema, admin, runtime, auth, authorizerRole } =
    await databaseFixture(t);
  const secret = randomBytes(32).toString("base64url"),
    secrets = new Secrets(secret);
  const origin = "http://127.0.0.1:4311";
  const app = buildApp(runtime, { origin, secret, schema });
  t.after(() => app.close());
  await app.ready();
  async function identity(name: string) {
    return issueSession(
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
  }
  const owner = await identity("owner"),
    outsider = await identity("outsider"),
    collaborator = await identity("collaborator"),
    manager = await identity("manager");
  function request(
    who: typeof owner,
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    url: string,
    payload?: unknown,
    extra: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
      headers: {
        cookie: `session=${who.token}`,
        origin,
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
        "x-csrf-token": secrets.csrf(who.token),
        ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
        ...extra,
      },
    });
  }
  await t.test(
    "sessions use hashed tokens and expose only contract fields",
    async () => {
      const found = await request(owner, "GET", "/v1/session");
      assert.equal(found.statusCode, 200, found.body);
      assert.equal(found.json().userId, owner.userId);
      assert.equal(found.json().csrfToken, secrets.csrf(owner.token));
      const anonymous = await app.inject("/v1/session");
      assert.equal(anonymous.statusCode, 401);
      await assert.rejects(
        runtime.query(`SELECT * FROM ${sqlIdentifier(schema)}.sessions`),
        /permission denied/,
      );
      await assert.rejects(
        auth.query(`SELECT * FROM ${sqlIdentifier(schema)}.projects`),
        /permission denied/,
      );
      await assert.rejects(
        runtime.query(`SET ROLE ${sqlIdentifier(authorizerRole)}`),
        /permission denied/,
      );
      const sql = await runtime.connect();
      try {
        await sql.query("BEGIN");
        await sql.query("CREATE TEMP TABLE users(id uuid)");
        // A temp-table shadow cannot redirect a SECURITY DEFINER relation lookup.
        const found = await sql.query(
          `SELECT * FROM ${sqlIdentifier(schema)}.authenticate_session($1)`,
          ["0".repeat(64)],
        );
        assert.equal(found.rowCount, 0);
        await sql.query("ROLLBACK");
      } finally {
        sql.release();
      }
    },
  );
  let tenant: any,
    otherTenant: any,
    ownerMembership: any,
    collaboratorMembership: string,
    managerMembership: string;
  const createKey = randomUUID();
  await t.test(
    "concurrent repeat creates one tenant and one owner in a single transaction",
    async () => {
      const calls = await Promise.all(
        Array.from({ length: 4 }, () =>
          request(
            owner,
            "POST",
            "/v1/tenants",
            { name: "幕序制作", currency: "CNY" },
            { "idempotency-key": createKey },
          ),
        ),
      );
      for (const result of calls)
        assert.equal(result.statusCode, 201, result.body);
      tenant = calls[0]!.json();
      assert.ok(calls.every((r) => r.json().id === tenant.id));
      const members = await request(
        owner,
        "GET",
        `/v1/tenants/${tenant.id}/members`,
      );
      assert.equal(members.statusCode, 200, members.body);
      assert.equal(members.json().items.length, 1);
      ownerMembership = members.json().items[0];
      assert.equal(ownerMembership.role, "owner");
      const mismatch = await request(
        owner,
        "POST",
        "/v1/tenants",
        { name: "different", currency: "CNY" },
        { "idempotency-key": createKey },
      );
      assert.equal(mismatch.statusCode, 409);
      const other = await request(outsider, "POST", "/v1/tenants", {
        name: "另一工作室",
        currency: "CNY",
      });
      assert.equal(other.statusCode, 201, other.body);
      otherTenant = other.json();
    },
  );
  await t.test(
    "tenant lists, origin, CSRF and stale versions preserve scope",
    async () => {
      const list = await request(owner, "GET", "/v1/tenants");
      assert.deepEqual(
        list.json().items.map((i: any) => i.id),
        [tenant.id],
      );
      const forbidden = await request(
        owner,
        "GET",
        `/v1/tenants/${otherTenant.id}`,
      );
      assert.equal(forbidden.statusCode, 404, forbidden.body);
      const attack = await request(
        owner,
        "PATCH",
        `/v1/tenants/${tenant.id}`,
        { name: "injected" },
        { origin: "https://evil.example", "if-match": '"1"' },
      );
      assert.equal(attack.statusCode, 403);
      const csrf = await request(
        owner,
        "PATCH",
        `/v1/tenants/${tenant.id}`,
        { name: "injected" },
        { "x-csrf-token": "wrong", "if-match": '"1"' },
      );
      assert.equal(csrf.statusCode, 403);
      const extra = await request(owner, "POST", "/v1/tenants", {
        name: "bad",
        currency: "CNY",
        ownerUserId: outsider.userId,
      });
      assert.equal(extra.statusCode, 422);
      const changed = await request(
        owner,
        "PATCH",
        `/v1/tenants/${tenant.id}`,
        { name: "新工作室名" },
        { "if-match": '"1"' },
      );
      assert.equal(changed.statusCode, 200, changed.body);
      assert.equal(changed.headers.etag, '"2"');
      const stale = await request(
        owner,
        "PATCH",
        `/v1/tenants/${tenant.id}`,
        { name: "lost update" },
        { "if-match": '"1"' },
      );
      assert.equal(stale.statusCode, 412, stale.body);
    },
  );
  let acceptedKey: string, acceptedToken: string;
  await t.test(
    "invitations bind verified email, hide secrets, and accept exactly once",
    async () => {
      async function invite(who: typeof owner, role: string) {
        const created = await request(
          owner,
          "POST",
          `/v1/tenants/${tenant.id}/invitations`,
          {
            email: `${who === collaborator ? "collaborator" : "manager"}@example.test`,
            role,
          },
        );
        assert.equal(created.statusCode, 201, created.body);
        return created.json();
      }
      const invited = await invite(collaborator, "member");
      const secret = new URLSearchParams(
        new URL(invited.invitationUrl).hash.split("?")[1],
      ).get("token")!;
      const wrongEmail = await request(
        outsider,
        "POST",
        "/v1/invitations/accept",
        { token: secret },
      );
      assert.equal(wrongEmail.statusCode, 404, wrongEmail.body);
      acceptedKey = randomUUID();
      acceptedToken = secret;
      const accepted = await Promise.all(
        Array.from({ length: 3 }, () =>
          request(
            collaborator,
            "POST",
            "/v1/invitations/accept",
            { token: secret },
            { "idempotency-key": acceptedKey },
          ),
        ),
      );
      for (const result of accepted)
        assert.equal(result.statusCode, 201, result.body);
      collaboratorMembership = accepted[0]!.json().id;
      assert.ok(accepted.every((r) => r.json().id === collaboratorMembership));
      const duplicate = await request(
        collaborator,
        "POST",
        "/v1/invitations/accept",
        { token: secret },
      );
      assert.equal(duplicate.statusCode, 409);
      const adminInvite = await invite(manager, "admin");
      const adminToken = new URLSearchParams(
        new URL(adminInvite.invitationUrl).hash.split("?")[1],
      ).get("token")!;
      const joined = await request(manager, "POST", "/v1/invitations/accept", {
        token: adminToken,
      });
      assert.equal(joined.statusCode, 201, joined.body);
      managerMembership = joined.json().id;
      const noElevatedInvite = await request(
        manager,
        "POST",
        `/v1/tenants/${tenant.id}/invitations`,
        { email: "new@example.test", role: "admin" },
      );
      assert.equal(noElevatedInvite.statusCode, 403);
      const list = await request(
        owner,
        "GET",
        `/v1/tenants/${tenant.id}/invitations`,
      );
      assert.equal(list.statusCode, 200, list.body);
      assert.ok(
        list
          .json()
          .items.every(
            (i: any) =>
              i.status === "accepted" && !i.invitationUrl && !i.tokenHash,
          ),
      );
      const stored = await admin.query(
        `SELECT token_hash FROM ${sqlIdentifier(schema)}.invitations WHERE id=$1`,
        [invited.id],
      );
      assert.notEqual(stored.rows[0].token_hash, secret);
      const outsiderInvite = await request(
        owner,
        "POST",
        `/v1/tenants/${tenant.id}/invitations`,
        { email: "outsider@example.test", role: "member" },
      );
      assert.equal(outsiderInvite.statusCode, 201, outsiderInvite.body);
      const revoked = await request(
        owner,
        "POST",
        `/v1/tenants/${tenant.id}/invitations/${outsiderInvite.json().id}/revoke`,
        undefined,
        { "if-match": '"1"' },
      );
      assert.equal(revoked.statusCode, 201, revoked.body);
      const revokedToken = new URLSearchParams(
        new URL(outsiderInvite.json().invitationUrl).hash.split("?")[1],
      ).get("token")!;
      assert.equal(
        (
          await request(outsider, "POST", "/v1/invitations/accept", {
            token: revokedToken,
          })
        ).statusCode,
        409,
      );
    },
  );
  let project: any, privateProject: any;
  const projectKey = randomUUID();
  const spec = {
    width: 1080,
    height: 1920,
    fpsNum: 24,
    fpsDen: 1,
    language: "zh-CN",
  };
  await t.test(
    "project creation also creates its production and lead; members see only assigned projects",
    async () => {
      const created = await request(
        owner,
        "POST",
        `/v1/tenants/${tenant.id}/projects`,
        { name: "旧钥匙", leadMembershipId: ownerMembership.id, spec },
        { "idempotency-key": projectKey },
      );
      assert.equal(created.statusCode, 201, created.body);
      project = created.json();
      const replay = await request(
        owner,
        "POST",
        `/v1/tenants/${tenant.id.toUpperCase()}/projects`,
        { name: "旧钥匙", leadMembershipId: ownerMembership.id, spec },
        { "idempotency-key": projectKey },
      );
      assert.equal(replay.statusCode, 201, replay.body);
      assert.equal(replay.json().id, project.id);
      const second = await request(
        owner,
        "POST",
        `/v1/tenants/${tenant.id}/projects`,
        { name: "私有项目", leadMembershipId: ownerMembership.id, spec },
      );
      assert.equal(second.statusCode, 201, second.body);
      privateProject = second.json();
      const production = await request(
        owner,
        "GET",
        `/v1/tenants/${tenant.id}/projects/${project.id}/production`,
      );
      assert.equal(production.statusCode, 200, production.body);
      assert.equal(production.json().title, "旧钥匙");
      const denied = await request(
        collaborator,
        "GET",
        `/v1/tenants/${tenant.id}/projects/${project.id}`,
      );
      assert.equal(denied.statusCode, 404, denied.body);
      const added = await request(
        owner,
        "POST",
        `/v1/tenants/${tenant.id}/projects/${project.id}/members`,
        { membershipId: collaboratorMembership },
      );
      assert.equal(added.statusCode, 201, added.body);
      const list = await request(
        collaborator,
        "GET",
        `/v1/tenants/${tenant.id}/projects`,
      );
      assert.equal(list.statusCode, 200, list.body);
      assert.deepEqual(
        list.json().items.map((p: any) => p.id),
        [project.id],
      );
      const adminList = await request(
        manager,
        "GET",
        `/v1/tenants/${tenant.id}/projects`,
      );
      assert.equal(adminList.json().items.length, 2);
      const noCreate = await request(
        collaborator,
        "POST",
        `/v1/tenants/${tenant.id}/projects`,
        { name: "no", leadMembershipId: collaboratorMembership, spec },
      );
      assert.equal(noCreate.statusCode, 403);
      const foreign = await request(
        outsider,
        "GET",
        `/v1/tenants/${otherTenant.id}/projects/${project.id}`,
      );
      assert.equal(foreign.statusCode, 404);
    },
  );
  await t.test(
    "RLS hides another tenant and another private project even without SQL WHERE clauses",
    async () => {
      const sql = await runtime.connect();
      try {
        await sql.query("BEGIN");
        await sql.query(
          `SET LOCAL search_path TO ${sqlIdentifier(schema)},pg_catalog`,
        );
        await sql.query(
          "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",
          [collaborator.userId, tenant.id],
        );
        const projects = await sql.query("SELECT id FROM projects");
        assert.deepEqual(
          projects.rows.map((r) => r.id),
          [project.id],
        );
        const memberships = await sql.query(
          "SELECT tenant_id FROM memberships",
        );
        assert.ok(memberships.rows.every((r) => r.tenant_id === tenant.id));
        await sql.query("ROLLBACK");
        const empty = await sql.query(
          `SELECT id FROM ${sqlIdentifier(schema)}.projects`,
        );
        assert.equal(empty.rowCount, 0);
      } finally {
        sql.release();
      }
    },
  );
  await t.test(
    "production settings persist independently and reject lost updates",
    async () => {
      const path = `/v1/tenants/${tenant.id}/projects/${project.id}/production`;
      const content = {
        title: "旧钥匙",
        brief: "保留人物与空间连续性。",
        defaultAssetRevisionIds: [],
      };
      const saved = await request(collaborator, "PUT", path, content, {
        "if-match": '"1"',
      });
      assert.equal(saved.statusCode, 200, saved.body);
      assert.equal(saved.headers.etag, '"2"');
      const read = await request(owner, "GET", path);
      assert.equal(read.json().brief, content.brief);
      const stale = await request(
        owner,
        "PUT",
        path,
        { ...content, brief: "覆盖旧内容" },
        { "if-match": '"1"' },
      );
      assert.equal(stale.statusCode, 412);
      const projectRoot = await request(
        owner,
        "GET",
        `/v1/tenants/${tenant.id}/projects/${project.id}`,
      );
      assert.equal(projectRoot.json().revision, 1);
    },
  );
  await t.test(
    "role restrictions, owner and lead invariants reject invalid changes",
    async () => {
      const elevate = await request(
        manager,
        "PATCH",
        `/v1/tenants/${tenant.id}/members/${collaboratorMembership}`,
        { role: "admin", status: "active" },
        { "if-match": '"1"' },
      );
      assert.equal(elevate.statusCode, 403);
      const ownerChange = await request(
        owner,
        "PATCH",
        `/v1/tenants/${tenant.id}/members/${ownerMembership.id}`,
        { role: "member", status: "active" },
        { "if-match": '"1"' },
      );
      assert.equal(ownerChange.statusCode, 409);
      const removeLead = await request(
        owner,
        "DELETE",
        `/v1/tenants/${tenant.id}/projects/${project.id}/members/${ownerMembership.id}`,
        undefined,
        { "if-match": '"1"' },
      );
      assert.equal(removeLead.statusCode, 409, removeLead.body);
      await assert.rejects(
        admin.query(
          `UPDATE ${sqlIdentifier(schema)}.memberships SET role='admin' WHERE id=$1`,
          [ownerMembership.id],
        ),
        /active owner/,
      );
      const lead = await request(
        manager,
        "POST",
        `/v1/tenants/${tenant.id}/projects/${privateProject.id}/lead`,
        { membershipId: managerMembership },
        { "if-match": '"1"' },
      );
      assert.equal(lead.statusCode, 201, lead.body);
      assert.equal(lead.json().leadMembershipId, managerMembership);
      const oldLead = await request(
        owner,
        "GET",
        `/v1/tenants/${tenant.id}/projects/${privateProject.id}/members`,
      );
      assert.equal(
        oldLead
          .json()
          .items.find((m: any) => m.membershipId === ownerMembership.id).role,
        "collaborator",
      );
      const suspendLead = await request(
        owner,
        "PATCH",
        `/v1/tenants/${tenant.id}/members/${managerMembership}`,
        { role: "admin", status: "suspended" },
        { "if-match": '"1"' },
      );
      assert.equal(suspendLead.statusCode, 409, suspendLead.body);
    },
  );
  await t.test(
    "archive, restore, pagination cursors and access revocation are explicit",
    async () => {
      const archive = await request(
        owner,
        "POST",
        `/v1/tenants/${tenant.id}/projects/${project.id}/archive`,
        undefined,
        { "if-match": '"1"' },
      );
      assert.equal(archive.statusCode, 201, archive.body);
      const blocked = await request(
        owner,
        "PATCH",
        `/v1/tenants/${tenant.id}/projects/${project.id}`,
        { name: "bad", spec },
        { "if-match": '"2"' },
      );
      assert.equal(blocked.statusCode, 409);
      const restore = await request(
        owner,
        "POST",
        `/v1/tenants/${tenant.id}/projects/${project.id}/restore`,
        undefined,
        { "if-match": '"2"' },
      );
      assert.equal(restore.statusCode, 201, restore.body);
      const first = await request(
        owner,
        "GET",
        `/v1/tenants/${tenant.id}/projects?limit=1`,
      );
      assert.equal(first.statusCode, 200, first.body);
      assert.ok(first.json().nextCursor);
      const cursor = encodeURIComponent(first.json().nextCursor);
      const next = await request(
        owner,
        "GET",
        `/v1/tenants/${tenant.id}/projects?limit=1&cursor=${cursor}`,
      );
      assert.equal(next.statusCode, 200, next.body);
      assert.notEqual(next.json().items[0].id, first.json().items[0].id);
      const stolen = await request(
        collaborator,
        "GET",
        `/v1/tenants/${tenant.id}/projects?cursor=${cursor}`,
      );
      assert.equal(stolen.statusCode, 422);
      const revoked = await request(
        owner,
        "PATCH",
        `/v1/tenants/${tenant.id}/members/${collaboratorMembership}`,
        { role: "member", status: "suspended" },
        { "if-match": '"1"' },
      );
      assert.equal(revoked.statusCode, 200, revoked.body);
      const lost = await request(
        collaborator,
        "GET",
        `/v1/tenants/${tenant.id}/projects/${project.id}`,
      );
      assert.equal(lost.statusCode, 404);
      const oldInviteReplay = await request(
        collaborator,
        "POST",
        "/v1/invitations/accept",
        { token: acceptedToken },
        { "idempotency-key": acceptedKey },
      );
      assert.equal(oldInviteReplay.statusCode, 403, oldInviteReplay.body);
      const transfer = await request(
        owner,
        "POST",
        `/v1/tenants/${tenant.id}/ownership`,
        { membershipId: managerMembership },
        { "if-match": '"2"' },
      );
      assert.equal(transfer.statusCode, 201, transfer.body);
      assert.equal(transfer.json().ownerUserId, manager.userId);
      const finalMembers = await request(
        manager,
        "GET",
        `/v1/tenants/${tenant.id}/members`,
      );
      assert.equal(
        finalMembers.json().items.filter((m: any) => m.role === "owner").length,
        1,
      );
      assert.equal(
        finalMembers.json().items.find((m: any) => m.id === ownerMembership.id)
          .role,
        "admin",
      );
      const logout = await request(owner, "POST", "/v1/session/logout");
      assert.equal(logout.statusCode, 204, logout.body);
      assert.equal(
        (await request(owner, "GET", "/v1/session")).statusCode,
        401,
      );
    },
  );
});
