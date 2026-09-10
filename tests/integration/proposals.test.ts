import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { databaseFixture } from "../support/database.js";
import { buildApp } from "../../apps/api/src/app.js";
import { issueSession } from "../../apps/api/src/modules/identity/sessions.js";
import { Secrets } from "../../apps/api/src/kernel/crypto.js";

test("CSV proposals preserve provenance and apply selected dependency graphs exactly once in PostgreSQL", async (t) => {
  const { schema, runtime, auth, admin } = await databaseFixture(t);
  const secret = randomBytes(32).toString("base64url"),
    secrets = new Secrets(secret),
    origin = "http://127.0.0.1:4311";
  const app = buildApp(runtime, { schema, secret, origin });
  t.after(() => app.close());
  await app.ready();
  const owner = await issueSession(
    auth,
    {
      issuer: "urn:test",
      subject: "proposal-owner",
      email: "proposal@example.test",
      emailVerified: true,
      displayName: "提案制作人",
    },
    { schema },
  );
  const request = (
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: unknown,
    version?: number,
    key = randomUUID(),
  ) =>
    app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
      headers: {
        cookie: `session=${owner.token}`,
        origin,
        "x-csrf-token": secrets.csrf(owner.token),
        "idempotency-key": key,
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(version === undefined ? {} : { "if-match": `"${version}"` }),
      },
    });
  const ok = async (
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: unknown,
    version?: number,
  ) => {
    const r = await request(method, url, payload, version);
    assert.equal(r.statusCode, method === "POST" ? 201 : 200, r.body);
    return r.json();
  };
  const tenant = await ok("POST", "/v1/tenants", {
    name: "CSV 验收",
    currency: "CNY",
  });
  const member = (await ok("GET", `/v1/tenants/${tenant.id}/members`)).items[0];
  const createProject = (name: string) =>
    ok("POST", `/v1/tenants/${tenant.id}/projects`, {
      name,
      leadMembershipId: member.id,
      spec: {
        width: 1080,
        height: 1920,
        fpsNum: 24,
        fpsDen: 1,
        language: "zh-CN",
      },
    });
  const project = await createProject("钥匙"),
    other = await createProject("隔离项目");
  const path = `/v1/tenants/${tenant.id}/projects/${project.id}`,
    otherPath = `/v1/tenants/${tenant.id}/projects/${other.id}`;
  const tree = () => ok("GET", `${path}/content`),
    next = async () => (await tree()).revision;
  const csvText =
    "episode,scene,shot_label,intent,dialogue,duration_seconds\n第一集,旧公寓,01,寻找钥匙,钥匙在哪里？,4.200001\n第一集,旧公寓,02,发现纸张,,2\n第一集,走廊,03,听见脚步,,3";
  let proposal: any, scene: any;
  await t.test(
    "same source/target/baseline reuses the proposal even with different idempotency keys",
    async () => {
      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          request(
            "POST",
            `${path}/shot-list-imports`,
            { csvText, target: { mode: "new_structure" } },
            1,
          ),
        ),
      );
      results.forEach((r) => assert.equal(r.statusCode, 201, r.body));
      proposal = results[0]!.json();
      assert.ok(results.every((r) => r.json().id === proposal.id));
      assert.equal(proposal.operations.length, 6);
      assert.equal(proposal.baseContentSnapshot.revision, 1);
      assert.deepEqual(proposal.baseContentSnapshot.shots, []);
      assert.equal(await next(), 1);
      assert.equal((await ok("GET", `${path}/proposals`)).items.length, 1);
      assert.equal(
        (await request("GET", `${otherPath}/proposals/${proposal.id}`))
          .statusCode,
        404,
      );
      const original = await admin.query(
        `SELECT source_csv_text FROM "${schema}".analysis_proposals WHERE id=$1`,
        [proposal.id],
      );
      assert.equal(original.rows[0].source_csv_text, csvText);
    },
  );
  await t.test(
    "manual revision preserves original and rejects invalid parents, duplicate IDs and archive operations atomically",
    async () => {
      const operations = structuredClone(proposal.operations);
      operations.find((o: any) => o.kind === "shot").proposed.spec.intent =
        "先注意抽屉边的划痕";
      proposal = await ok(
        "PUT",
        `${path}/proposals/${proposal.id}`,
        { operations, target: proposal.target, baseContentRevision: 1 },
        1,
      );
      assert.equal(proposal.revision, 2);
      const original = await ok(
        "GET",
        `${path}/proposals/${proposal.id}?revisionNumber=1`,
      );
      assert.equal(
        original.operations.find((o: any) => o.kind === "shot").proposed.spec
          .intent,
        "寻找钥匙",
      );
      for (const corrupt of [
        (ops: any[]) => {
          ops.find((o) => o.kind === "shot").proposed.sceneId = randomUUID();
        },
        (ops: any[]) => {
          ops[1].opId = ops[0].opId.toUpperCase();
        },
        (ops: any[]) => {
          ops[0].proposed.status = "archived";
        },
      ]) {
        const invalid = structuredClone(operations);
        corrupt(invalid);
        const r = await request(
          "PUT",
          `${path}/proposals/${proposal.id}`,
          {
            operations: invalid,
            target: proposal.target,
            baseContentRevision: 1,
          },
          2,
        );
        assert.equal(r.statusCode, 422, r.body);
      }
      const result = await request(
        "PUT",
        `${path}/proposals/${proposal.id}`,
        { operations, target: proposal.target, baseContentRevision: 1 },
        1,
      );
      assert.equal(result.statusCode, 412);
      assert.equal(
        (await ok("GET", `${path}/proposals/${proposal.id}`)).revision,
        2,
      );
      await assert.rejects(
        admin.query(
          `UPDATE "${schema}".analysis_proposal_revisions SET operations='[]' WHERE proposal_id=$1`,
          [proposal.id],
        ),
        { code: "23514" },
      );
      await assert.rejects(
        admin.query(
          `UPDATE "${schema}".analysis_proposals SET source_csv_text='altered' WHERE id=$1`,
          [proposal.id],
        ),
        { code: "23514" },
      );
    },
  );
  await t.test(
    "missing selected dependencies creates nothing; complete selection applies once and records permanent mapping",
    async () => {
      const shot = proposal.operations.find((o: any) => o.kind === "shot");
      const invalid = await request(
        "POST",
        `${path}/proposals/${proposal.id}/apply`,
        { proposalRevision: 2, selectedOperationIds: [shot.opId] },
        1,
      );
      assert.equal(invalid.statusCode, 422, invalid.body);
      assert.equal((await tree()).shots.length, 0);
      assert.equal(await next(), 1);
      const selected = proposal.operations
        .filter(
          (o: any) =>
            o.kind === "episode" ||
            o.temporaryId === shot.proposed.sceneId ||
            o.opId === shot.opId,
        )
        .map((o: any) => o.opId);
      const body = { proposalRevision: 2, selectedOperationIds: selected },
        key = randomUUID();
      const results = await Promise.all([
        request("POST", `${path}/proposals/${proposal.id}/apply`, body, 1, key),
        request("POST", `${path}/proposals/${proposal.id}/apply`, body, 1, key),
      ]);
      results.forEach((r) => assert.equal(r.statusCode, 201, r.body));
      assert.deepEqual(results[0]!.json(), results[1]!.json());
      const content = await tree();
      assert.equal(content.revision, 2);
      assert.equal(content.episodes.length, 1);
      assert.equal(content.scenes.length, 1);
      assert.equal(content.shots.length, 1);
      assert.equal(content.shots[0].spec.plannedDurationUs, 4200001);
      scene = content.scenes[0];
      const closed = await request(
        "POST",
        `${path}/proposals/${proposal.id}/apply`,
        {
          ...body,
          selectedOperationIds: proposal.operations.map((o: any) => o.opId),
        },
        2,
      );
      assert.equal(closed.statusCode, 409, closed.body);
      const old = await ok(
        "GET",
        `${path}/proposals/${proposal.id}?revisionNumber=1`,
      );
      assert.equal(old.status, "applied");
      assert.equal(old.revision, 1);
      assert.deepEqual(old.application.selectedOperationIds, selected);
      assert.equal(old.application.proposalRevision, 2);
      assert.equal(old.application.contentRevision, 2);
      assert.deepEqual(old.baseContentSnapshot.shots, []);
      const application = (
        await admin.query(
          `SELECT * FROM "${schema}".proposal_applications WHERE proposal_id=$1`,
          [proposal.id],
        )
      ).rows[0];
      assert.equal(Object.keys(application.created_objects).length, 3);
      await assert.rejects(
        admin.query(
          `DELETE FROM "${schema}".proposal_applications WHERE proposal_id=$1`,
          [proposal.id],
        ),
        { code: "23514" },
      );
      assert.equal(
        (
          await request(
            "PUT",
            `${path}/proposals/${proposal.id}`,
            {
              operations: proposal.operations,
              target: proposal.target,
              baseContentRevision: 2,
            },
            2,
          )
        ).statusCode,
        409,
      );
    },
  );
  let append: any;
  await t.test(
    "append target is explicit, scoped and versioned; mixed source scenes do not get silently flattened",
    async () => {
      const target = {
        mode: "append_to_scene",
        sceneId: scene.id,
        sceneRevision: scene.revision,
        episodeId: scene.episodeId,
      };
      const mixed = await request(
        "POST",
        `${path}/shot-list-imports`,
        { csvText, target },
        2,
      );
      assert.equal(mixed.statusCode, 422, mixed.body);
      const input = {
        csvText:
          "episode,scene,shot_label,intent\n别名,来源场,04,转身\n别名,来源场,05,停步",
        target,
      };
      append = await ok("POST", `${path}/shot-list-imports`, input, 2);
      assert.ok(
        append.operations.every(
          (o: any) => o.kind === "shot" && o.proposed.sceneId === scene.id,
        ),
      );
      assert.equal(
        (await request("POST", `${otherPath}/shot-list-imports`, input, 1))
          .statusCode,
        404,
      );
      assert.equal(
        (
          await request(
            "POST",
            `${path}/shot-list-imports`,
            { ...input, target: { ...target, episodeId: randomUUID() } },
            2,
          )
        ).statusCode,
        422,
      );
      assert.equal(
        (
          await request(
            "POST",
            `${path}/shot-list-imports`,
            { ...input, target: { ...target, sceneRevision: 99 } },
            2,
          )
        ).statusCode,
        412,
      );
    },
  );
  await t.test(
    "stale baseline requires an explicit reviewed rebase; append positions never overwrite existing order",
    async () => {
      await ok(
        "POST",
        `${path}/episodes`,
        { title: "其他修改", position: 10, status: "active" },
        2,
      );
      let r = await request(
        "POST",
        `${path}/proposals/${append.id}/apply`,
        {
          proposalRevision: 1,
          selectedOperationIds: append.operations.map((o: any) => o.opId),
        },
        3,
      );
      assert.equal(r.statusCode, 409, r.body);
      assert.equal(r.json().code, "PROPOSAL_BASE_CHANGED");
      assert.equal((await tree()).shots.length, 1);
      const operations = structuredClone(append.operations);
      operations[0].proposed.position = 9999;
      operations[1].proposed.position = 0;
      r = await request(
        "PUT",
        `${path}/proposals/${append.id}`,
        { operations, target: append.target, baseContentRevision: 2 },
        1,
      );
      assert.equal(r.statusCode, 412);
      append = await ok(
        "PUT",
        `${path}/proposals/${append.id}`,
        { operations, target: append.target, baseContentRevision: 3 },
        1,
      );
      const before = await tree();
      const applied = await ok(
        "POST",
        `${path}/proposals/${append.id}/apply`,
        {
          proposalRevision: 2,
          selectedOperationIds: append.operations.map((o: any) => o.opId),
        },
        3,
      );
      assert.deepEqual(applied.shots[0], before.shots[0]);
      assert.deepEqual(
        applied.shots.map((s: any) => [s.label, s.position]),
        [
          ["01", 0],
          ["04", 1],
          ["05", 2],
        ],
      );
      assert.equal(applied.revision, 4);
    },
  );
  await t.test(
    "pagination is bound to every filter and proposals survive a new app instance",
    async () => {
      const first = await ok("GET", `${path}/proposals?limit=1`);
      assert.ok(first.nextCursor);
      const second = await ok(
        "GET",
        `${path}/proposals?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
      );
      assert.equal(second.items[0].id, append.id);
      const wrong = await request(
        "GET",
        `${path}/proposals?limit=1&status=applied&cursor=${encodeURIComponent(first.nextCursor)}`,
      );
      assert.equal(wrong.statusCode, 422, wrong.body);
      assert.equal(
        (
          await ok(
            "GET",
            `${path}/proposals?sceneId=${scene.id}&status=applied&sourceKind=csv_import`,
          )
        ).items.length,
        1,
      );
      const restored = buildApp(runtime, { schema, secret, origin });
      await restored.ready();
      try {
        const found = await restored.inject({
          method: "GET",
          url: `${path}/proposals/${append.id}`,
          headers: { cookie: `session=${owner.token}` },
        });
        assert.equal(found.statusCode, 200, found.body);
        assert.equal(found.json().revision, 2);
        assert.equal(found.json().status, "applied");
      } finally {
        await restored.close();
      }
    },
  );
});
