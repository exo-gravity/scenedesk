import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { databaseFixture } from "../support/database.js";
import { buildApp } from "../../apps/api/src/app.js";
import { issueSession } from "../../apps/api/src/modules/identity/sessions.js";
import { Secrets } from "../../apps/api/src/kernel/crypto.js";
import { Database } from "../../apps/api/src/kernel/database.js";

test("content preserves immutable source history, scoped structure and concurrent edits in PostgreSQL", async (t) => {
  const { schema, runtime, auth, admin } = await databaseFixture(t);
  const secret = randomBytes(32).toString("base64url"),
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
  const owner = await identity("content-owner"),
    outsider = await identity("content-outsider");
  const request = (
    method: "GET" | "POST" | "PUT",
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
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: unknown,
    version?: number,
  ) {
    const result = await request(method, url, payload, version);
    assert.equal(result.statusCode, method === "POST" ? 201 : 200, result.body);
    return result.json();
  }
  const tenant = await ok("POST", "/v1/tenants", {
    name: "剧本验收",
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
  const project = await createProject("旧钥匙"),
    second = await createProject("其他项目");
  const path = `/v1/tenants/${tenant.id}/projects/${project.id}`,
    otherPath = `/v1/tenants/${tenant.id}/projects/${second.id}`;
  const tree = () => ok("GET", `${path}/content`),
    next = async () => (await tree()).revision;
  let script: any, episode: any, scene: any, shot: any, shot2: any;
  const spec = { intent: "找到旧钥匙", action: "她推门进屋", references: [] };
  await t.test(
    "content root arbitrates concurrent creates and replay without changing history twice",
    async () => {
      assert.deepEqual((await tree()).episodes, []);
      const key = randomUUID(),
        input = { text: "甲😀女主：钥匙在哪里？\n她推门进屋。" };
      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          request("POST", `${path}/scripts`, input, 1, key),
        ),
      );
      results.forEach((r) => assert.equal(r.statusCode, 201, r.body));
      script = results[0]!.json();
      assert.ok(results.every((r) => r.json().id === script.id));
      assert.equal(script.number, 1);
      assert.equal((await tree()).revision, 2);
      const body = { title: "第一集", position: 0, status: "active" };
      const creates = await Promise.all([
        request("POST", `${path}/episodes`, body, 2),
        request("POST", `${path}/episodes`, body, 2),
      ]);
      assert.deepEqual(creates.map((r) => r.statusCode).sort(), [201, 412]);
      episode = creates.find((r) => r.statusCode === 201)!.json();
      assert.equal((await tree()).episodes.length, 1);
      scene = await ok(
        "POST",
        `${path}/scenes`,
        {
          episodeId: episode.id,
          title: "旧公寓",
          position: 0,
          summary: "重返旧地",
          state: { spatialNotes: "门在左侧" },
          status: "active",
        },
        await next(),
      );
      assert.equal(typeof scene.position, "number");
      assert.equal(scene.timeLabel, undefined);
    },
  );
  await t.test(
    "Unicode codepoint excerpts and dialogue lines bind to original immutable script",
    async () => {
      const excerpt = {
        scriptRevisionId: script.id,
        range: { startOffset: 2, endOffset: 4 },
        quote: "女主",
      };
      const line = {
        id: randomUUID(),
        text: "钥匙在哪里？",
        sourceExcerpt: excerpt,
      };
      const body = {
        sceneId: scene.id,
        label: "01",
        position: 0,
        spec: { ...spec, sourceExcerpts: [excerpt], dialogue: [line] },
        status: "active",
      };
      const before = await next();
      const invalid = await request(
        "POST",
        `${path}/shots`,
        {
          ...body,
          spec: {
            ...body.spec,
            sourceExcerpts: [
              { ...excerpt, range: { startOffset: 3, endOffset: 5 } },
            ],
          },
        },
        before,
      );
      assert.equal(invalid.statusCode, 422, invalid.body);
      assert.equal(invalid.json().code, "SOURCE_QUOTE_MISMATCH");
      assert.equal(await next(), before);
      const duplicate = await request(
        "POST",
        `${path}/shots`,
        {
          ...body,
          spec: {
            ...body.spec,
            dialogue: [line, { ...line, id: line.id.toUpperCase() }],
          },
        },
        before,
      );
      assert.equal(duplicate.statusCode, 422, duplicate.body);
      shot = await ok("POST", `${path}/shots`, body, before);
      const revision = await ok(
        "GET",
        `${path}/shots/${shot.id}/revisions/${shot.specRevisionId}`,
      );
      assert.equal(revision.sourceScriptRevisionId, script.id);
      assert.equal(revision.spec.sourceExcerpts[0].quote, "女主");
      assert.equal(
        (
          await admin.query(
            `SELECT * FROM "${schema}".dialogue_lines WHERE shot_revision_id=$1`,
            [shot.specRevisionId],
          )
        ).rows[0].dialogue_id,
        line.id,
      );
      const changed = await ok(
        "POST",
        `${path}/scripts`,
        { text: "全新改稿", parentRevisionId: script.id },
        await next(),
      );
      assert.equal(changed.number, 2);
      assert.equal(changed.parentRevisionId, script.id);
      const old = await ok(
        "GET",
        `${path}/shots/${shot.id}/revisions/${shot.specRevisionId}`,
      );
      assert.deepEqual(old, revision);
      const wrong = await request(
        "POST",
        `${path}/scripts`,
        { text: "错误分支", parentRevisionId: script.id },
        await next(),
      );
      assert.equal(wrong.statusCode, 409);
    },
  );
  await t.test(
    "renames, moves and reorder keep shot requirements while substantive edits append one revision",
    async () => {
      const first = shot.specRevisionId;
      const input = {
        sceneId: scene.id,
        label: "A-01",
        position: 0,
        spec: shot.spec,
        status: "active",
      };
      shot = await ok("PUT", `${path}/shots/${shot.id}`, input, shot.revision);
      assert.equal(shot.specRevisionId, first);
      const stale = await request(
        "PUT",
        `${path}/shots/${shot.id}`,
        { ...input, label: "冲突名称" },
        1,
      );
      assert.equal(stale.statusCode, 412);
      shot2 = await ok(
        "POST",
        `${path}/shots`,
        {
          ...input,
          label: "A-02",
          position: 1,
          spec: {
            ...spec,
            sourceShotIds: [shot.id],
            dialogue: [
              {
                id: randomUUID(),
                text: "同一台词的另一演法",
                sourceDialogueId: shot.spec.dialogue[0].id,
              },
            ],
          },
        },
        await next(),
      );
      const v = await next();
      const incomplete = await request(
        "POST",
        `${path}/content/reorder`,
        { kind: "shot", parentId: scene.id, orderedIds: [shot.id] },
        v,
      );
      assert.equal(incomplete.statusCode, 422);
      const wrongParent = await request(
        "POST",
        `${path}/content/reorder`,
        { kind: "episode", parentId: second.id, orderedIds: [episode.id] },
        v,
      );
      assert.equal(wrongParent.statusCode, 422);
      const reordered = await ok(
        "POST",
        `${path}/content/reorder`,
        { kind: "shot", parentId: scene.id, orderedIds: [shot2.id, shot.id] },
        v,
      );
      assert.deepEqual(
        reordered.shots.map((s: any) => s.id),
        [shot2.id, shot.id],
      );
      shot = reordered.shots[1];
      shot2 = reordered.shots[0];
      assert.equal(shot.specRevisionId, first);
      shot = await ok(
        "PUT",
        `${path}/shots/${shot.id}`,
        {
          ...input,
          position: shot.position,
          spec: { ...shot.spec, intent: "她意识到钥匙被拿走了" },
        },
        shot.revision,
      );
      assert.notEqual(shot.specRevisionId, first);
      const history = await ok("GET", `${path}/shots/${shot.id}/revisions`);
      assert.deepEqual(
        history.items.map((r: any) => r.number),
        [1, 2],
      );
      assert.equal(history.items[0].spec.intent, spec.intent);
      assert.equal(
        history.items[1].spec.dialogue[0].id,
        history.items[0].spec.dialogue[0].id,
      );
      assert.equal(
        (await ok("GET", `${path}/shots/${shot2.id}/revisions`)).items.length,
        1,
      );
    },
  );
  await t.test(
    "scope, composite foreign keys and immutable grants prevent forged lineage",
    async () => {
      const otherEpisode = await ok(
        "POST",
        `${otherPath}/episodes`,
        { title: "另一集", position: 0, status: "active" },
        1,
      );
      const forged = await request(
        "POST",
        `${path}/scenes`,
        {
          episodeId: otherEpisode.id,
          title: "伪造",
          position: 0,
          summary: "",
          state: {},
          status: "active",
        },
        await next(),
      );
      assert.equal(forged.statusCode, 404);
      const otherScript = await ok(
        "POST",
        `${otherPath}/scripts`,
        { text: "另一项目原文" },
        2,
      );
      const badSource = await request(
        "POST",
        `${path}/shots`,
        {
          sceneId: scene.id,
          label: "错误来源",
          position: 2,
          status: "active",
          spec: {
            ...spec,
            sourceExcerpts: [
              {
                scriptRevisionId: otherScript.id,
                range: { startOffset: 0, endOffset: 2 },
                quote: "另一",
              },
            ],
          },
        },
        await next(),
      );
      assert.equal(badSource.statusCode, 422);
      const unauthorized = await request(
        "GET",
        `${path}/content`,
        undefined,
        undefined,
        randomUUID(),
        outsider,
      );
      assert.equal(unauthorized.statusCode, 404);
      const scoped = new Database(runtime, schema);
      await assert.rejects(
        scoped.transaction(
          owner.token,
          { tenantId: tenant.id, projectId: project.id, write: false },
          async (tx) => {
            // A same-tenant owner can read both projects; explicit composite FKs still reject mixing parents.
            await tx.sql.query(
              "INSERT INTO scenes (id,tenant_id,project_id,episode_id,title,position,summary,state,status) VALUES ($1,$2,$3,$4,'x',0,'','{}','active')",
              [randomUUID(), tenant.id, project.id, otherEpisode.id],
            );
          },
        ),
        /foreign key/,
      );
      await assert.rejects(
        runtime.query(
          `UPDATE "${schema}".script_revisions SET text='overwrite' WHERE id=$1`,
          [script.id],
        ),
        /permission denied/,
      );
      await assert.rejects(
        admin.query(
          `UPDATE "${schema}".shot_revisions SET spec='{}' WHERE id=$1`,
          [shot.specRevisionId],
        ),
        /immutable/,
      );
      await scoped.transaction(outsider.token, { write: false }, async (tx) => {
        assert.equal(
          (await tx.sql.query("SELECT * FROM episodes")).rowCount,
          0,
        );
        assert.equal(
          (await tx.sql.query("SELECT * FROM shot_revisions")).rowCount,
          0,
        );
      });
    },
  );
  await t.test(
    "archive hides planning content without deleting history and blocks editing under an archived parent",
    async () => {
      const previous = shot.specRevisionId;
      shot = await ok(
        "PUT",
        `${path}/shots/${shot.id}`,
        {
          sceneId: scene.id,
          label: shot.label,
          position: shot.position,
          spec: shot.spec,
          status: "archived",
        },
        shot.revision,
      );
      assert.equal(shot.specRevisionId, previous);
      assert.equal(
        (await ok("GET", `${path}/shots/${shot.id}/revisions/${previous}`)).id,
        previous,
      );
      const partial = await request(
        "POST",
        `${path}/content/reorder`,
        { kind: "shot", parentId: scene.id, orderedIds: [shot2.id] },
        await next(),
      );
      assert.equal(partial.statusCode, 422);
      episode = await ok(
        "PUT",
        `${path}/episodes/${episode.id}`,
        {
          title: episode.title,
          position: episode.position,
          status: "archived",
        },
        episode.revision,
      );
      const blocked = await request(
        "POST",
        `${path}/shots`,
        {
          sceneId: scene.id,
          label: "禁止追加",
          position: 2,
          spec,
          status: "active",
        },
        await next(),
      );
      assert.equal(blocked.statusCode, 409);
      assert.equal((await tree()).shots.length, 2);
      episode = await ok(
        "PUT",
        `${path}/episodes/${episode.id}`,
        { title: episode.title, position: episode.position, status: "active" },
        episode.revision,
      );
      const restored = await ok(
        "PUT",
        `${path}/shots/${shot.id}`,
        {
          sceneId: scene.id,
          label: shot.label,
          position: shot.position,
          spec: shot.spec,
          status: "active",
        },
        shot.revision,
      );
      assert.equal(restored.specRevisionId, previous);
      await ok("POST", `${path}/archive`, undefined, project.revision);
      const denied = await request(
        "POST",
        `${path}/scripts`,
        { text: "已归档项目" },
        await next(),
      );
      assert.equal(denied.statusCode, 409);
    },
  );
  await t.test(
    "history cursors retain PostgreSQL microseconds, follow creation order and cannot switch shot or project",
    async () => {
      const ids = [
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
        "00000000-0000-4000-8000-000000000001",
      ];
      for (const [i, id] of ids.entries())
        await admin.query(
          `INSERT INTO "${schema}".script_revisions (id,tenant_id,project_id,number,text,created_at) VALUES ($1,$2,$3,$4,'分页边界',$5)`,
          [
            id,
            tenant.id,
            second.id,
            10 + i,
            `2090-01-01T00:00:00.00000${i + 1}Z`,
          ],
        );
      let url = `${otherPath}/scripts?limit=1`,
        seen: string[] = [];
      for (let i = 0; i < 4; i++) {
        const p = await ok("GET", url);
        seen.push(...p.items.map((r: any) => r.id));
        if (!p.nextCursor) break;
        url = `${otherPath}/scripts?limit=1&cursor=${encodeURIComponent(p.nextCursor)}`;
      }
      assert.equal(seen.length, 3);
      assert.deepEqual(seen.slice(-2), ids);
      const mismatch = await request(
        "GET",
        `${path}/scripts?projectId=${second.id}`,
      );
      assert.equal(mismatch.statusCode, 422);
      assert.equal(
        (
          await request(
            "GET",
            `${path}/scripts?projectId=${project.id.toUpperCase()}`,
          )
        ).statusCode,
        200,
      );
      const first = await ok(
        "GET",
        `${path}/shots/${shot.id}/revisions?limit=1`,
      );
      const foreign = await request(
        "GET",
        `${path}/shots/${shot2.id}/revisions?cursor=${encodeURIComponent(first.nextCursor)}`,
      );
      assert.equal(foreign.statusCode, 422);
    },
  );
  await t.test(
    "large Unicode scripts fit the published limit and invalid text leaves no revision",
    async () => {
      const longProject = await createProject("长剧本");
      const longPath = `/v1/tenants/${tenant.id}/projects/${longProject.id}`;
      const text = "幕".repeat(400_000);
      const saved = await request("POST", `${longPath}/scripts`, { text }, 1);
      assert.equal(saved.statusCode, 201);
      assert.equal(saved.json().text, text);
      for (const text of ["\0", "\ud800", "幕".repeat(500_001)]) {
        const rejected = await request(
          "POST",
          `${longPath}/scripts`,
          { text },
          2,
        );
        assert.equal(rejected.statusCode, 422, rejected.body);
      }
      assert.equal((await ok("GET", `${longPath}/content`)).revision, 2);
      assert.equal((await ok("GET", `${longPath}/scripts`)).items.length, 1);
    },
  );
});
