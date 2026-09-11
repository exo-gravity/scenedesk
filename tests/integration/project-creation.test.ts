import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sqlIdentifier } from "@drama/database";
import { Database } from "../../apps/api/src/kernel/database.js";
import { businessFixture } from "../support/business.js";

test("project creation identity is durable, scoped and returns its current project", async (t) => {
  const f = await businessFixture(t);
  const path = `/v1/tenants/${f.tenant.id}/projects`;
  const body = {
    name: "固定项目创建意图",
    leadMembershipId: f.membership.id,
    spec: f.project.spec,
    creationRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };
  const httpKey = randomUUID(),
    scope = sqlIdentifier(f.schema);
  let created: any;
  await t.test(
    "concurrent HTTP keys create one project and one set of business roots",
    async () => {
      const before = await f.ok("GET", path);
      const replies = await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          f.request(
            "POST",
            path,
            body,
            undefined,
            index === 0 ? httpKey : randomUUID(),
          ),
        ),
      );
      replies.forEach((reply) =>
        assert.equal(reply.statusCode, 201, reply.body),
      );
      created = replies[0]!.json();
      assert.ok(replies.every((reply) => reply.json().id === created.id));
      assert.equal(
        (await f.ok("GET", path)).items.length,
        before.items.length + 1,
      );
      const members = await f.ok("GET", `${path}/${created.id}/members`);
      assert.equal(members.items.length, 1);
      assert.equal(members.items[0].role, "lead");
      assert.equal(members.items[0].membershipId, body.leadMembershipId);
      const production = await f.ok("GET", `${path}/${created.id}/production`);
      assert.equal(production.projectId, created.id);
      assert.equal(production.title, body.name);
      const content = await f.ok("GET", `${path}/${created.id}/content`);
      assert.equal(content.revision, 1);
      assert.deepEqual(content.episodes, []);
      assert.deepEqual(content.scenes, []);
      assert.deepEqual(content.shots, []);
    },
  );

  await t.test(
    "valid HTTP keys keep their body conflict contract while durable identities accept canonical UUID case",
    async () => {
      const before = await f.ok("GET", path);
      for (const changed of [
        { ...body, name: "different" },
        { ...body, creationRequestId: randomUUID() },
        { ...body, creationRequestId: body.creationRequestId.toUpperCase() },
      ]) {
        const reply = await f.request(
          "POST",
          path,
          changed,
          undefined,
          httpKey,
        );
        assert.equal(reply.statusCode, 409, reply.body);
        assert.equal(reply.json().code, "IDEMPOTENCY_CONFLICT");
      }
      const reordered = {
        spec: body.spec,
        creationRequestId: body.creationRequestId.toUpperCase(),
        leadMembershipId: body.leadMembershipId.toUpperCase(),
        name: body.name,
      };
      const equivalent = await f.request("POST", path, reordered);
      assert.equal(equivalent.statusCode, 201, equivalent.body);
      assert.equal(equivalent.json().id, created.id);
      const conflict = await f.request("POST", path, {
        ...body,
        name: "different",
      });
      assert.equal(conflict.statusCode, 409, conflict.body);
      assert.equal(conflict.json().code, "PROJECT_CREATION_CONFLICT");
      assert.deepEqual(await f.ok("GET", path), before);
    },
  );
  await t.test(
    "same-key recovery reads current renamed and archived state without extending the HTTP cache deadline",
    async () => {
      const receipt = async () =>
        (
          await f.admin.query(
            `SELECT expires_at FROM ${scope}.idempotency_records WHERE actor_id=$1 AND request_path=$2 AND key=$3`,
            [f.owner.userId, path, httpKey],
          )
        ).rows[0].expires_at;
      const deadline = await receipt();
      const changed = await f.ok(
        "PATCH",
        `${path}/${created.id}`,
        { name: "后来更名", spec: { ...body.spec, language: "en-US" } },
        created.revision,
      );
      const replay = await f.request("POST", path, body, undefined, httpKey);
      assert.equal(replay.statusCode, 201, replay.body);
      assert.deepEqual(replay.json(), changed);
      assert.equal(replay.headers.etag, `"${changed.revision}"`);
      assert.deepEqual(await receipt(), deadline);
      const archived = await f.ok(
        "POST",
        `${path}/${created.id}/archive`,
        undefined,
        changed.revision,
      );
      const afterArchive = await f.request(
        "POST",
        path,
        body,
        undefined,
        httpKey,
      );
      assert.equal(afterArchive.statusCode, 201, afterArchive.body);
      assert.deepEqual(afterArchive.json(), archived);
      assert.equal(afterArchive.headers.etag, `"${archived.revision}"`);
      assert.deepEqual(await receipt(), deadline);
      created = archived;
    },
  );
  await t.test(
    "the original request recovers after response loss, receipt expiry or deletion without a new project",
    async () => {
      const before = await f.ok("GET", path);
      // Recovery sends only the original request; no saved response or project ID is supplied.
      await f.admin.query(
        `UPDATE ${scope}.idempotency_records SET expires_at=now()-interval '1 second' WHERE actor_id=$1 AND request_path=$2 AND key=$3`,
        [f.owner.userId, path, httpKey],
      );
      const mismatch = await f.request(
        "POST",
        path,
        { ...body, name: "different" },
        undefined,
        httpKey,
      );
      assert.equal(mismatch.statusCode, 409, mismatch.body);
      assert.equal(mismatch.json().code, "PROJECT_CREATION_CONFLICT");
      const expired = await f.request("POST", path, body, undefined, httpKey);
      assert.equal(expired.statusCode, 201, expired.body);
      assert.deepEqual(expired.json(), created);
      await f.admin.query(
        `DELETE FROM ${scope}.idempotency_records WHERE actor_id=$1 AND request_path=$2`,
        [f.owner.userId, path],
      );
      const removed = await f.request(
        "POST",
        path,
        body,
        undefined,
        randomUUID(),
      );
      assert.equal(removed.statusCode, 201, removed.body);
      assert.deepEqual(removed.json(), created);
      assert.deepEqual(await f.ok("GET", path), before);
    },
  );
  const invite = async (name: string, role: "member" | "admin") => {
    const user = await f.identity(name);
    const invitation = await f.ok(
      "POST",
      `/v1/tenants/${f.tenant.id}/invitations`,
      { email: `${name}@example.test`, role },
    );
    const token = new URLSearchParams(
      new URL(invitation.invitationUrl).hash.split("?")[1],
    ).get("token");
    const accepted = await f.request(
      "POST",
      "/v1/invitations/accept",
      { token },
      undefined,
      randomUUID(),
      user,
    );
    assert.equal(accepted.statusCode, 201, accepted.body);
    return { user, member: accepted.json() };
  };
  await t.test(
    "an original lead can be handed over and suspended without blocking the original creator's recovery",
    async () => {
      const former = await invite("former-project-lead", "member");
      const original = {
        ...body,
        creationRequestId: randomUUID(),
        name: "原负责人项目",
        leadMembershipId: former.member.id,
      };
      const project = await f.ok("POST", path, original);
      const handedOver = await f.ok(
        "POST",
        `${path}/${project.id}/lead`,
        { membershipId: f.membership.id },
        project.revision,
      );
      await f.ok(
        "PATCH",
        `/v1/tenants/${f.tenant.id}/members/${former.member.id}`,
        { role: "member", status: "suspended" },
        former.member.revision,
      );
      const replay = await f.request("POST", path, original);
      assert.equal(replay.statusCode, 201, replay.body);
      assert.deepEqual(replay.json(), handedOver);
      const newAttempt = await f.request("POST", path, {
        ...original,
        creationRequestId: randomUUID(),
      });
      assert.equal(newAttempt.statusCode, 422, newAttempt.body);
      assert.equal(newAttempt.json().code, "INVALID_PROJECT_LEAD");
    },
  );
  const manager = await invite("project-manager", "admin");
  await t.test(
    "tenant and original actor scope the durable identity; current owner/admin permission precedes replay",
    async () => {
      const managerKey = randomUUID();
      const second = await f.request(
        "POST",
        path,
        body,
        undefined,
        managerKey,
        manager.user,
      );
      assert.equal(second.statusCode, 201, second.body);
      assert.notEqual(second.json().id, created.id);
      const tenant = await f.ok("POST", "/v1/tenants", {
        name: "另一个工作室",
        currency: "CNY",
      });
      const ownerMember = (
        await f.ok("GET", `/v1/tenants/${tenant.id}/members`)
      ).items[0];
      const otherPath = `/v1/tenants/${tenant.id}/projects`;
      const other = await f.request("POST", otherPath, {
        ...body,
        leadMembershipId: ownerMember.id,
      });
      assert.equal(other.statusCode, 201, other.body);
      assert.notEqual(other.json().id, created.id);
      const crossTenant = await f.request(
        "POST",
        otherPath,
        body,
        undefined,
        managerKey,
        manager.user,
      );
      assert.equal(crossTenant.statusCode, 404, crossTenant.body);
      await f.ok(
        "PATCH",
        `/v1/tenants/${f.tenant.id}/members/${manager.member.id}`,
        { role: "member", status: "active" },
        manager.member.revision,
      );
      for (const original of [
        body,
        { ...body, name: "changed after revocation" },
      ]) {
        const denied = await f.request(
          "POST",
          path,
          original,
          undefined,
          managerKey,
          manager.user,
        );
        assert.equal(denied.statusCode, 403, denied.body);
        assert.equal(denied.json().code, "FORBIDDEN");
        assert.equal(denied.json().id, undefined);
      }
      const restored = await f.request("POST", path, body);
      assert.equal(restored.statusCode, 201, restored.body);
      assert.deepEqual(restored.json(), created);
    },
  );
  await t.test(
    "restricted bindings force row isolation and append-only grants",
    async () => {
      const flags = (
        await f.admin.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
          [`${scope}.project_creation_requests`],
        )
      ).rows[0];
      assert.deepEqual(flags, {
        relrowsecurity: true,
        relforcerowsecurity: true,
      });
      for (const mutation of ["UPDATE", "DELETE"])
        await assert.rejects(
          f.runtime.query(
            mutation === "UPDATE"
              ? `UPDATE ${scope}.project_creation_requests SET request_hash=repeat('b',64)`
              : `DELETE FROM ${scope}.project_creation_requests`,
          ),
          /permission denied/,
        );
      await assert.rejects(
        f.runtime.query(
          `INSERT INTO ${scope}.project_creation_requests (created_at) VALUES (now())`,
        ),
        /permission denied/,
      );
      await assert.rejects(
        f.admin.query(
          `UPDATE ${scope}.project_creation_requests SET request_hash=repeat('b',64) WHERE project_id=$1`,
          [created.id],
        ),
        /immutable/,
      );
      const database = new Database(f.runtime, f.schema);
      const rows = await database.transaction(
        f.owner.token,
        { tenantId: f.tenant.id, write: false },
        async (tx) =>
          (
            await tx.sql.query(
              "SELECT actor_id,tenant_id FROM project_creation_requests",
            )
          ).rows,
      );
      assert.ok(rows.length > 0);
      assert.ok(
        rows.every(
          (row) =>
            row.actor_id === f.owner.userId && row.tenant_id === f.tenant.id,
        ),
      );
      const revoked = await database.transaction(
        manager.user.token,
        { tenantId: f.tenant.id, write: false },
        async (tx) =>
          (await tx.sql.query("SELECT * FROM project_creation_requests")).rows,
      );
      assert.deepEqual(revoked, []);
      await assert.rejects(
        database.transaction(
          f.owner.token,
          { tenantId: f.tenant.id, write: true },
          (tx) =>
            tx.sql.query(
              "INSERT INTO project_creation_requests (tenant_id,actor_id,creation_request_id,request_hash,project_id) VALUES ($1,$2,$3,$4,$5)",
              [
                f.tenant.id,
                manager.user.userId,
                randomUUID(),
                "a".repeat(64),
                f.project.id,
              ],
            ),
        ),
        /row-level security/,
      );
    },
  );
  await t.test(
    "a failed binding insert rolls back all project roots and the HTTP receipt",
    async () => {
      const original = {
        ...body,
        creationRequestId: randomUUID(),
        name: "事务完整性项目",
      };
      const before = await f.ok("GET", path),
        key = randomUUID();
      await f.admin.query(
        `CREATE FUNCTION ${scope}.reject_test_creation_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected binding failure' USING ERRCODE='23514'; END $$`,
      );
      await f.admin.query(
        `CREATE TRIGGER reject_test_binding BEFORE INSERT ON ${scope}.project_creation_requests FOR EACH ROW EXECUTE FUNCTION ${scope}.reject_test_creation_binding()`,
      );
      try {
        const failed = await f.request("POST", path, original, undefined, key);
        assert.equal(failed.statusCode, 409, failed.body);
        assert.deepEqual(await f.ok("GET", path), before);
      } finally {
        await f.admin.query(
          `DROP TRIGGER reject_test_binding ON ${scope}.project_creation_requests`,
        );
        await f.admin.query(
          `DROP FUNCTION ${scope}.reject_test_creation_binding()`,
        );
      }
      const recovered = await f.request("POST", path, original, undefined, key);
      assert.equal(recovered.statusCode, 201, recovered.body);
      assert.equal(
        (await f.ok("GET", path)).items.length,
        before.items.length + 1,
      );
      for (const table of [
        "projects",
        "project_memberships",
        "productions",
        "project_content_versions",
        "project_creation_requests",
      ]) {
        const idColumn = table === "projects" ? "id" : "project_id";
        const count = (
          await f.admin.query(
            `SELECT count(*)::int AS n FROM ${scope}.${sqlIdentifier(table)} WHERE ${idColumn}=$1`,
            [recovered.json().id],
          )
        ).rows[0].n;
        assert.equal(count, 1, table);
      }
    },
  );
  await t.test(
    "clients without creationRequestId retain ordinary HTTP replay and do not create permanent bindings",
    async () => {
      const { creationRequestId: _identity, ...legacy } = body;
      const key = randomUUID();
      const original = await f.request("POST", path, legacy, undefined, key);
      assert.equal(original.statusCode, 201, original.body);
      const replay = await f.request("POST", path, legacy, undefined, key);
      assert.equal(replay.statusCode, 201, replay.body);
      assert.deepEqual(replay.json(), original.json());
      const count = (
        await f.admin.query(
          `SELECT count(*)::int AS n FROM ${scope}.project_creation_requests WHERE project_id=$1`,
          [original.json().id],
        )
      ).rows[0].n;
      assert.equal(count, 0);
    },
  );
});
