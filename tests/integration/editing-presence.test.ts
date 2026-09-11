import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { businessFixture } from "../support/business.js";
import { Database } from "../../apps/api/src/kernel/database.js";

test("editing presence is expiring session-scoped advice with no content write", async (t) => {
  const f = await businessFixture(t),
    db = new Database(f.runtime, f.schema);
  const episode = await f.ok(
    "POST",
    `${f.path}/episodes`,
    { title: "第一集", position: 0, status: "active" },
    await f.next(),
  );
  const scene = await f.ok(
    "POST",
    `${f.path}/scenes`,
    {
      episodeId: episode.id,
      title: "场次",
      position: 0,
      status: "active",
      summary: "",
      state: { characters: [], props: [], spatialNotes: "" },
    },
    await f.next(),
  );
  const ensured = await f.request(
    "POST",
    `${f.path}/scenes/${scene.id}/canvas`,
  );
  assert.equal(ensured.statusCode, 200, ensured.body);
  const canvas = ensured.json().canvas;
  const cut = await f.ok("POST", `${f.path}/cuts`, {
    name: "旧工作稿",
    sceneId: scene.id,
  });
  const target = { kind: "canvas", objectId: canvas.id },
    path = `${f.path}/editing-presence`;
  const body = (client = randomUUID(), activity = "viewing") => ({
    target,
    clientSessionId: client,
    activity,
  });
  const read = () => f.ok("GET", `${path}?kind=canvas&objectId=${canvas.id}`);
  const count = async () =>
    Number(
      (await f.admin.query(`SELECT count(*) FROM ${f.schema}.editing_presence`))
        .rows[0].count,
    );
  const tx = (run: Parameters<Database["transaction"]>[2]) =>
    db.transaction(
      f.owner.token,
      { tenantId: f.tenant.id, projectId: f.project.id, write: false },
      run,
    );
  const client = randomUUID();
  await t.test(
    "heartbeat returns server timestamps, updates one client and never changes content or audit",
    async () => {
      const before = await f.tree(),
        audit = (
          await f.admin.query(`SELECT count(*) FROM ${f.schema}.audit_events`)
        ).rows[0].count;
      assert.deepEqual((await read()).entries, []);
      const first = await f.ok("PUT", path, body(client));
      assert.equal(first.entries.length, 1);
      assert.equal(first.entries[0].membershipId, f.membership.id);
      assert.equal(
        Date.parse(first.entries[0].expiresAt) -
          Date.parse(first.entries[0].lastSeenAt),
        90000,
      );
      assert.deepEqual(Object.keys(first.entries[0]).sort(), [
        "activity",
        "clientSessionId",
        "expiresAt",
        "lastSeenAt",
        "membershipId",
      ]);
      assert.ok(
        Date.parse(first.serverTime) >= Date.parse(first.entries[0].lastSeenAt),
      );
      const next = await f.ok("PUT", path, body(client, "editing"));
      assert.equal(next.entries.length, 1);
      assert.equal(next.entries[0].activity, "editing");
      assert.deepEqual(await f.tree(), before);
      assert.equal(
        (await f.ok("GET", `${f.path}/canvases/${canvas.id}`)).revision,
        canvas.revision,
      );
      assert.equal(
        (await f.ok("GET", `${f.path}/cuts/${cut.id}/work-draft`)).revision,
        0,
      );
      assert.equal(
        (await f.admin.query(`SELECT count(*) FROM ${f.schema}.audit_events`))
          .rows[0].count,
        audit,
      );
    },
  );
  await t.test(
    "actual typed target and current project authority are required; browser origin and CSRF apply",
    async () => {
      assert.equal(
        (
          await f.request("PUT", path, {
            ...body(),
            target: { kind: "cut_work_draft", objectId: canvas.id },
          })
        ).statusCode,
        404,
      );
      assert.equal(
        (await f.request("GET", `${path}?kind=canvas&objectId=${randomUUID()}`))
          .statusCode,
        404,
      );
      const foreign = await f.createProject("其他项目");
      assert.equal(
        (await f.request("PUT", path.replace(f.project.id, foreign.id), body()))
          .statusCode,
        404,
      );
      assert.equal(
        (await f.request("PUT", path, { ...body(), activity: "locked" }))
          .statusCode,
        422,
      );
      const bad = await f.app.inject({
        method: "PUT",
        url: path,
        payload: body(),
        headers: {
          cookie: `session=${f.owner.token}`,
          origin: "https://example.invalid",
          "x-csrf-token": "invalid",
        },
      });
      assert.equal(bad.statusCode, 403);
      const csrf = await f.app.inject({
        method: "PUT",
        url: path,
        payload: body(),
        headers: {
          cookie: `session=${f.owner.token}`,
          origin: "http://127.0.0.1:4311",
          "x-csrf-token": "invalid",
        },
      });
      assert.equal(csrf.statusCode, 403);
      assert.equal(
        (
          await f.ok("PUT", path, {
            ...body(),
            target: { kind: "cut_work_draft", objectId: cut.id },
          })
        ).entries.length,
        1,
      );
    },
  );
  await t.test(
    "five client limit is serialized; expired slots can be reused",
    async () => {
      const replies = await Promise.all(
        Array.from({ length: 5 }, () => f.request("PUT", path, body())),
      );
      assert.equal(replies.filter((r) => r.statusCode === 200).length, 4);
      const limited = replies.find((r) => r.statusCode === 429)!;
      assert.ok(limited);
      assert.equal(limited.headers["retry-after"], "30");
      assert.equal((await read()).entries.length, 5);
      await f.admin.query(
        `UPDATE ${f.schema}.editing_presence SET last_seen_at=statement_timestamp()-interval '120 seconds',expires_at=statement_timestamp()-interval '30 seconds' WHERE client_session_id=$1`,
        [client],
      );
      assert.equal((await read()).entries.length, 4);
      assert.equal((await f.ok("PUT", path, body(client))).entries.length, 5);
    },
  );
  await t.test(
    "newer login owns a reused client; old heartbeat is rejected and logout removes only its own entries",
    async () => {
      const newer = await f.identity("owner");
      assert.equal(
        (
          await f.request(
            "PUT",
            path,
            body(client),
            undefined,
            randomUUID(),
            newer,
          )
        ).statusCode,
        200,
      );
      const stale = await f.request("PUT", path, body(client));
      assert.equal(stale.statusCode, 409);
      assert.equal(stale.json().code, "EDITING_CLIENT_CHANGED");
      // Revoke only the newer session after checking a separate older client is retained.
      assert.equal(
        (
          await f.request(
            "POST",
            "/v1/session/logout",
            undefined,
            undefined,
            randomUUID(),
            newer,
          )
        ).statusCode,
        204,
      );
      assert.equal(
        (await read()).entries.some((e: any) => e.clientSessionId === client),
        false,
      );
      assert.equal((await read()).entries.length, 4);
    },
  );
  await t.test(
    "revoking a project member immediately removes their activity and prevents reads and replay",
    async () => {
      const user = await f.identity("presence-member"),
        member = randomUUID();
      await f.admin.query(
        `INSERT INTO ${f.schema}.memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')`,
        [member, f.tenant.id, user.userId],
      );
      await f.admin.query(
        `INSERT INTO ${f.schema}.project_memberships(id,tenant_id,project_id,membership_id,role) VALUES($1,$2,$3,$4,'collaborator')`,
        [randomUUID(), f.tenant.id, f.project.id, member],
      );
      assert.equal(
        (await f.request("PUT", path, body(), undefined, randomUUID(), user))
          .statusCode,
        200,
      );
      assert.ok(
        (await read()).entries.some((e: any) => e.membershipId === member),
      );
      await f.admin.query(
        `DELETE FROM ${f.schema}.project_memberships WHERE membership_id=$1`,
        [member],
      );
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*) FROM ${f.schema}.editing_presence WHERE membership_id=$1`,
            [member],
          )
        ).rows[0].count,
        "0",
      );
      assert.equal(
        (
          await f.request(
            "GET",
            `${path}?kind=canvas&objectId=${canvas.id}`,
            undefined,
            undefined,
            randomUUID(),
            user,
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (await f.request("PUT", path, body(), undefined, randomUUID(), user))
          .statusCode,
        404,
      );
    },
  );
  await t.test(
    "older logout cannot erase a client reclaimed by a newer login",
    async () => {
      const older = await f.identity("presence-relogin"),
        newer = await f.identity("presence-relogin"),
        member = randomUUID(),
        tab = randomUUID();
      await f.admin.query(
        `INSERT INTO ${f.schema}.memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')`,
        [member, f.tenant.id, older.userId],
      );
      await f.admin.query(
        `INSERT INTO ${f.schema}.project_memberships(id,tenant_id,project_id,membership_id,role) VALUES($1,$2,$3,$4,'collaborator')`,
        [randomUUID(), f.tenant.id, f.project.id, member],
      );
      for (const who of [older, newer])
        assert.equal(
          (
            await f.request(
              "PUT",
              path,
              body(tab),
              undefined,
              randomUUID(),
              who,
            )
          ).statusCode,
          200,
        );
      assert.equal(
        (
          await f.request(
            "POST",
            "/v1/session/logout",
            undefined,
            undefined,
            randomUUID(),
            older,
          )
        ).statusCode,
        204,
      );
      assert(
        (await read()).entries.some(
          (entry: any) =>
            entry.membershipId === member && entry.clientSessionId === tab,
        ),
      );
      await f.request(
        "POST",
        "/v1/session/logout",
        undefined,
        undefined,
        randomUUID(),
        newer,
      );
    },
  );
  await t.test(
    "restricted SQL cannot forge timestamps or another user's session",
    async () => {
      await assert.rejects(
        tx(({ sql }) => sql.query("DELETE FROM editing_presence")),
        { code: "42501" },
      );
      const other = await f.identity("unrelated-presence-user");
      await assert.rejects(
        tx(({ sql }) =>
          sql.query(
            "SELECT put_editing_presence($1,'canvas',$2,$3,'editing',$4)",
            [f.project.id, canvas.id, randomUUID(), other.id],
          ),
        ),
        { code: "42501" },
      );
      const before = await count();
      await assert.rejects(
        tx(async ({ sql }) => {
          await sql.query(
            "SELECT put_editing_presence($1,'canvas',$2,$3,'editing',$4)",
            [f.project.id, canvas.id, client, f.owner.id],
          );
          throw Error("rollback");
        }),
        /rollback/,
      );
      assert.equal(await count(), before);
    },
  );
  await t.test(
    "archived targets accept viewing only, without becoming an exclusive lock",
    async () => {
      await f.admin.query(
        `UPDATE ${f.schema}.projects SET status='archived' WHERE id=$1`,
        [f.project.id],
      );
      assert.equal(await count(), 0);
      const editing = await f.request("PUT", path, body(client, "editing"));
      assert.equal(editing.statusCode, 409);
      assert.equal(editing.json().code, "EDITING_TARGET_ARCHIVED");
      assert.equal((await f.ok("PUT", path, body(client))).entries.length, 1);
      await f.admin.query(
        `UPDATE ${f.schema}.projects SET status='active' WHERE id=$1`,
        [f.project.id],
      );
      assert.equal(
        (await f.ok("PUT", path, body(client, "editing"))).entries.length,
        1,
      );
    },
  );
});
