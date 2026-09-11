import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { businessFixture } from "../support/business.js";
import { Database } from "../../apps/api/src/kernel/database.js";
import { readProjectEvents } from "../../apps/api/src/modules/project-events/routes.js";

test("project hints relay after commit, replay in sequence and reauthorize live streams", async (t) => {
  const f = await businessFixture(t),
    database = new Database(f.runtime, f.schema);
  const scope = { tenantId: f.tenant.id, projectId: f.project.id };
  const read = (after?: string) =>
    readProjectEvents(database, f.owner.token, scope, after);
  let cursor = "0";
  const episode = await f.ok(
    "POST",
    `${f.path}/episodes`,
    { title: "通知测试", position: 0, status: "active" },
    await f.next(),
  );
  const scene = await f.ok(
    "POST",
    `${f.path}/scenes`,
    {
      episodeId: episode.id,
      title: "第一场",
      position: 0,
      status: "active",
      summary: "",
      state: { characters: [], props: [], spatialNotes: "" },
    },
    await f.next(),
  );
  const canvasResponse = await f.request(
    "POST",
    `${f.path}/scenes/${scene.id}/canvas`,
  );
  assert.equal(canvasResponse.statusCode, 200, canvasResponse.body);
  const canvas = canvasResponse.json().canvas;
  await t.test(
    "first connection resets; only committed resources and revisions appear",
    async () => {
      const reset = await read();
      assert.equal(reset.events[0]?.type, "reset");
      cursor = reset.events[0]!.seq;
      const history = await read("0");
      assert(
        history.events.some(
          (e) => e.resourceKind === "canvas" && e.resourceId === canvas.id,
        ),
      );
      assert(
        history.events.some(
          (e) => e.resourceKind === "content" && e.resourceId === f.project.id,
        ),
      );
      assert(
        history.events.every(
          (e) =>
            Object.keys(e).sort().join() ===
            "resourceId,resourceKind,resourceRevision,seq,type",
        ),
      );
      assert.deepEqual((await read(cursor)).events, []);
    },
  );
  await t.test(
    "producer cannot relay its own uncommitted hints; rollback leaks neither hint nor cursor",
    async () => {
      await assert.rejects(
        database.transaction(
          f.owner.token,
          { ...scope, write: true },
          async ({ sql }) => {
            await sql.query(
              "UPDATE projects SET revision=revision+1 WHERE id=$1",
              [scope.projectId],
            );
            await sql.query("SELECT relay_project_events($1)", [
              scope.projectId,
            ]);
            const head = await sql.query(
              "SELECT seq FROM project_event_heads WHERE project_id=$1",
              [scope.projectId],
            );
            assert.equal(head.rows[0].seq, cursor);
            throw new Error("rollback producer");
          },
        ),
        /rollback producer/,
      );
      assert.deepEqual((await read(cursor)).events, []);
      const version = await f.ok("GET", f.path);
      await f.ok(
        "PATCH",
        f.path,
        { name: "已提交名称", spec: version.spec },
        version.revision,
      );
      const batch = await read(cursor);
      assert.equal(batch.events.length, 1);
      assert.equal(batch.events[0]!.resourceKind, "project");
      assert.equal(batch.events[0]!.resourceRevision, version.revision + 1);
      assert(BigInt(batch.events[0]!.seq) > BigInt(cursor));
      assert.deepEqual((await read(cursor)).events, batch.events);
      cursor = batch.events[0]!.seq;
    },
  );
  await t.test(
    "concurrent relays allocate one durable hint and isolate other projects",
    async () => {
      const current = await f.ok("GET", f.path);
      await f.ok(
        "PATCH",
        f.path,
        { name: "并发通知", spec: current.spec },
        current.revision,
      );
      const other = await f.createProject("另一个项目");
      const batches = await Promise.all(
        Array.from({ length: 4 }, () => read(cursor)),
      );
      assert(batches.every((b) => b.events.length === 1));
      assert(
        batches.every((b) => b.events[0]!.seq === batches[0]!.events[0]!.seq),
      );
      assert(batches.every((b) => b.events[0]!.resourceId !== other.id));
      cursor = batches[0]!.events[0]!.seq;
      assert(
        Number(
          (
            await f.admin.query(
              `SELECT count(*) FROM ${f.schema}.project_event_outbox WHERE project_id=$1`,
              [other.id],
            )
          ).rows[0].count,
        ) > 0,
      );
      const stranger = await f.identity("events-stranger");
      await assert.rejects(
        readProjectEvents(database, stranger.token, scope, "0"),
        (e: any) => e.status === 404,
      );
    },
  );
  await t.test(
    "expired and future cursors reset; hints cannot be fabricated by restricted SQL",
    async () => {
      await f.admin.query(
        `UPDATE ${f.schema}.project_events SET created_at=now()-interval '25 hours' WHERE project_id=$1`,
        [scope.projectId],
      );
      assert.deepEqual((await read("0")).events, [
        { seq: cursor, type: "reset" },
      ]);
      assert.deepEqual((await read("9".repeat(1000))).events, [
        { seq: cursor, type: "reset" },
      ]);
      assert.deepEqual((await read(`000${cursor}`)).events, []);
      await assert.rejects(
        database.transaction(
          f.owner.token,
          { ...scope, write: false },
          ({ sql }) =>
            sql.query(
              "INSERT INTO project_events(tenant_id,project_id,seq,resource_kind,resource_id,resource_revision) VALUES($1,$2,999,'canvas',$3,1)",
              [scope.tenantId, scope.projectId, randomUUID()],
            ),
        ),
        (e: any) => e.code === "42501",
      );
      await assert.rejects(
        database.transaction(
          f.owner.token,
          { ...scope, write: false },
          ({ sql }) =>
            sql.query(
              "INSERT INTO canvas_outbox(tenant_id,project_id,canvas_id,revision) VALUES($1,$2,$3,999)",
              [scope.tenantId, scope.projectId, canvas.id],
            ),
        ),
        (e: any) => e.code === "P0425",
      );
    },
  );
  const address = await f.app.listen({ host: "127.0.0.1", port: 0 });
  async function connect(who = f.owner, last?: string) {
    const controller = new AbortController();
    t.after(() => controller.abort());
    const response = await fetch(`${address}${f.path}/events`, {
      headers: {
        cookie: `session=${who.token}`,
        ...(last === undefined ? {} : { "last-event-id": last }),
      },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /^text\/event-stream/);
    assert.equal(
      response.headers.get("cache-control"),
      "no-store, no-transform",
    );
    const reader = response.body!.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    const next = async (): Promise<any> => {
      const deadline = setTimeout(() => controller.abort(), 8_000);
      try {
        while (true) {
          const end = buffer.indexOf("\n\n");
          if (end >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = block
              .split("\n")
              .find((line) => line.startsWith("data: "));
            if (data) {
              const result = JSON.parse(data.slice(6));
              if (result.type !== "access_revoked")
                assert(block.includes(`id: ${result.seq}`));
              return result;
            }
          } else {
            const chunk = await reader.read();
            if (chunk.done) return null;
            buffer += decoder.decode(chunk.value, { stream: true });
          }
        }
      } finally {
        clearTimeout(deadline);
      }
    };
    return { controller, next };
  }
  await t.test(
    "real SSE replays on Last-Event-ID, closes after logout and releases connection slots",
    async () => {
      const who = await f.identity("owner");
      const stream = await connect(who);
      const initial = await stream.next();
      assert.equal(initial.type, "reset");
      const current = await f.ok("GET", f.path);
      await f.ok(
        "PATCH",
        f.path,
        { name: "流中更新", spec: current.spec },
        current.revision,
      );
      const event = await stream.next();
      assert.equal(event.type, "resource_changed");
      assert.equal(event.resourceId, f.project.id);
      const replay = await connect(who, initial.seq);
      assert.deepEqual(await replay.next(), event);
      const logout = await f.request(
        "POST",
        "/v1/session/logout",
        undefined,
        undefined,
        randomUUID(),
        who,
      );
      assert.equal(logout.statusCode, 204);
      assert.equal((await stream.next()).type, "access_revoked");
      assert.equal(await stream.next(), null);
      assert.equal((await replay.next()).type, "access_revoked");
      assert.equal(await replay.next(), null);
      const denied = await fetch(`${address}${f.path}/events`, {
        headers: { cookie: `session=${who.token}` },
      });
      assert.equal(denied.status, 401);
    },
  );
  await t.test(
    "revoking project membership closes an already connected stream and prevents replay",
    async () => {
      const who = await f.identity("events-member"),
        member = randomUUID();
      await f.admin.query(
        `INSERT INTO ${f.schema}.memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')`,
        [member, f.tenant.id, who.userId],
      );
      await f.admin.query(
        `INSERT INTO ${f.schema}.project_memberships(id,tenant_id,project_id,membership_id,role) VALUES($1,$2,$3,$4,'collaborator')`,
        [randomUUID(), f.tenant.id, f.project.id, member],
      );
      const stream = await connect(who),
        initial = await stream.next();
      await f.admin.query(
        `DELETE FROM ${f.schema}.project_memberships WHERE membership_id=$1`,
        [member],
      );
      assert.equal((await stream.next()).type, "access_revoked");
      assert.equal(await stream.next(), null);
      const denied = await fetch(`${address}${f.path}/events`, {
        headers: {
          cookie: `session=${who.token}`,
          "last-event-id": initial.seq,
        },
      });
      assert.equal(denied.status, 404);
    },
  );
  await t.test(
    "input rejection is JSON; connection cap recovers and app shutdown closes streams",
    async () => {
      const invalid = await f.app.inject({
        url: `${f.path}/events`,
        headers: { cookie: `session=${f.owner.token}`, "last-event-id": "-1" },
      });
      assert.equal(invalid.statusCode, 422);
      const streams: Awaited<ReturnType<typeof connect>>[] = [];
      for (let i = 0; i < 5; i++) {
        const stream = await connect();
        await stream.next();
        streams.push(stream);
      }
      const limited = await fetch(`${address}${f.path}/events`, {
        headers: { cookie: `session=${f.owner.token}` },
      });
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get("retry-after"), "30");
      const deadline = setTimeout(() => {
        for (const stream of streams) stream.controller.abort();
      }, 5_000);
      try {
        await f.app.close();
        for (const stream of streams) assert.equal(await stream.next(), null);
      } finally {
        clearTimeout(deadline);
      }
    },
  );
});
