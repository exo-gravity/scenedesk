import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { businessFixture } from "../support/business.js";
import { Database } from "../../apps/api/src/kernel/database.js";
import { canonical, digest } from "../../apps/api/src/kernel/crypto.js";
import { insertScene } from "../../apps/api/src/modules/content/commands.js";

test("creative basis captures actual sources and arbitrates explicit formal decisions", async (t) => {
  const {
    schema,
    admin,
    runtime,
    owner,
    identity,
    request,
    ok,
    tenant,
    project,
    path,
    next,
    createProject,
  } = await businessFixture(t);
  const bases = async (query = "") =>
    (await ok("GET", `${path}/creative-bases?${query}`)).items;
  const confirmations = async (query = "") =>
    (await ok("GET", `${path}/creative-confirmations?${query}`)).items;
  const current = async (subject: string) =>
    (await bases(`subjectId=${subject}`)).find((b: any) => b.isCurrentSource);
  let script: any,
    scene: any,
    shot: any,
    production: any,
    first: any,
    decision: any;
  const line = { id: randomUUID(), text: '钥匙在哪里？😀\n"原话"' };
  await t.test(
    "saved sources create fixed snapshots before confirmation; unused empty roots create none",
    async () => {
      assert.deepEqual(await bases(), []);
      production = await ok("GET", `${path}/production`);
      production = await ok(
        "PUT",
        `${path}/production`,
        {
          title: "旧钥匙",
          brief: "共同设定：日光下的旧公寓。",
          defaultAssetRevisionIds: [],
        },
        production.revision,
      );
      const episode = await ok(
        "POST",
        `${path}/episodes`,
        { title: "第一集", position: 0, status: "active" },
        await next(),
      );
      scene = await ok(
        "POST",
        `${path}/scenes`,
        {
          episodeId: episode.id,
          title: "归来",
          position: 0,
          summary: "女主重返旧地",
          state: { spatialNotes: "门在左侧" },
          status: "active",
        },
        await next(),
      );
      script = await ok(
        "POST",
        `${path}/scripts`,
        { text: line.text },
        await next(),
      );
      shot = await ok(
        "POST",
        `${path}/shots`,
        {
          sceneId: scene.id,
          label: "01",
          position: 0,
          spec: { intent: "寻找钥匙", dialogue: [line], references: [] },
          status: "active",
        },
        await next(),
      );
      const all = await bases();
      assert.equal(all.length, 4);
      assert.ok(
        all.every((b: any) => b.isCurrentSource && !b.currentConfirmationId),
      );
      assert.deepEqual(
        new Set(all.map((b: any) => b.basis.kind)),
        new Set(["production", "scene", "script", "shot_dialogue"]),
      );
      first = await current(project.id);
      assert.equal(first.snapshot.text, line.text);
      assert.equal(first.basis.objectId, script.id);
      assert.equal(first.basis.revision, 1);
      assert.deepEqual(await confirmations(), []);
      const db = new Database(runtime, schema);
      await assert.rejects(
        db.transaction(
          owner.token,
          { tenantId: tenant.id, projectId: project.id, write: true },
          async (tx) => {
            const aborted = await insertScene(tx, {
              episodeId: episode.id,
              title: "回滚场",
              position: 1,
              summary: "不能留下的依据",
              state: {},
              status: "active",
            });
            const saved = await tx.sql.query(
              "SELECT id FROM creative_basis_revisions WHERE subject_id=$1",
              [aborted.id],
            );
            assert.equal(saved.rowCount, 1);
            throw new Error("rollback source and snapshot together");
          },
        ),
        /rollback source/,
      );
      assert.equal((await bases()).length, 4);
    },
  );
  await t.test(
    "hash protects exact dialogue identity and words while ignoring presentation and source revision IDs",
    async () => {
      const original = await current(shot.id);
      shot = await ok(
        "PUT",
        `${path}/shots/${shot.id}`,
        {
          sceneId: shot.sceneId,
          label: shot.label,
          position: shot.position,
          status: shot.status,
          spec: {
            ...shot.spec,
            camera: "近景",
            dialogue: [{ ...line, performance: "轻声" }],
          },
        },
        shot.revision,
      );
      const camera = await current(shot.id);
      assert.notEqual(camera.id, original.id);
      assert.equal(camera.number, original.number + 1);
      assert.notEqual(
        camera.snapshot.shotRevisionId,
        original.snapshot.shotRevisionId,
      );
      assert.equal(camera.contentHash, original.contentHash);
      const secondLine = {
        ...line,
        id: randomUUID(),
        sourceDialogueId: line.id,
      };
      const copied = await ok(
        "POST",
        `${path}/shots`,
        {
          sceneId: scene.id,
          label: "02",
          position: 1,
          spec: {
            intent: "新的机位",
            sourceShotIds: [shot.id],
            references: [],
            dialogue: [secondLine],
          },
          status: "active",
        },
        await next(),
      );
      assert.equal(
        (await current(copied.id)).contentHash,
        original.contentHash,
      );
      shot = await ok(
        "PUT",
        `${path}/shots/${shot.id}`,
        {
          sceneId: shot.sceneId,
          label: shot.label,
          position: shot.position,
          status: shot.status,
          spec: {
            ...shot.spec,
            dialogue: [{ ...line, text: `${line.text}！` }],
          },
        },
        shot.revision,
      );
      assert.notEqual(
        (await current(shot.id)).contentHash,
        original.contentHash,
      );
      const productionBasis = await current(production.id),
        sceneBasis = await current(scene.id);
      production = await ok(
        "PUT",
        `${path}/production`,
        { title: "改名", brief: production.brief, defaultAssetRevisionIds: [] },
        production.revision,
      );
      scene = await ok(
        "PUT",
        `${path}/scenes/${scene.id}`,
        {
          episodeId: scene.episodeId,
          title: "场次改名",
          position: 10,
          summary: scene.summary,
          state: scene.state,
          status: scene.status,
        },
        scene.revision,
      );
      assert.equal((await current(production.id)).id, productionBasis.id);
      assert.equal((await current(scene.id)).id, sceneBasis.id);
      // Independently specified public hash payload; SQL canonical output must match exactly.
      const payload = {
        kind: "shot_dialogue",
        dialogue: [{ identity: line.id, speaker: null, text: line.text }],
      };
      const hash = (
        await admin.query(
          `SELECT "${schema}".creative_canonical("${schema}".creative_payload($1::jsonb)) AS value`,
          [original.snapshot],
        )
      ).rows[0].value;
      assert.equal(hash, canonical(payload));
      assert.equal(original.contentHash, digest(canonical(payload)));
      const hashFor = async (snapshot: unknown) =>
        (
          await admin.query(
            `SELECT "${schema}".creative_canonical("${schema}".creative_payload($1::jsonb)) AS value`,
            [snapshot],
          )
        ).rows[0].value;
      assert.notEqual(
        await hashFor({
          ...original.snapshot,
          dialogue: [{ ...line, id: randomUUID() }],
        }),
        hash,
      );
      assert.notEqual(
        await hashFor({
          ...original.snapshot,
          dialogue: [{ ...line, characterAssetId: randomUUID() }],
        }),
        hash,
      );
      const a = { ...line, id: randomUUID(), text: "第二句" };
      assert.equal(
        await hashFor({ ...original.snapshot, dialogue: [line, a] }),
        await hashFor({ ...original.snapshot, dialogue: [a, line] }),
      );
    },
  );
  await t.test(
    "competing first confirmations accept one; lost-response replay appends no second decision",
    async () => {
      const body = {
        basisRevisionId: first.id,
        usage: "project_default",
        expectedCurrentConfirmationId: null,
        note: "按固定文本确认",
      };
      const responses = await Promise.all([
        request("POST", `${path}/creative-confirmations`, body),
        request("POST", `${path}/creative-confirmations`, body),
      ]);
      assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 412]);
      decision = responses.find((r) => r.statusCode === 201)!.json();
      assert.equal(decision.note, body.note);
      assert.equal(decision.confirmedBy, owner.userId);
      assert.deepEqual(decision.snapshot, first.snapshot);
      const key = randomUUID(),
        replace = { ...body, expectedCurrentConfirmationId: decision.id };
      const repeated = await Promise.all([
        request(
          "POST",
          `${path}/creative-confirmations`,
          replace,
          undefined,
          key,
        ),
        request(
          "POST",
          `${path}/creative-confirmations`,
          replace,
          undefined,
          key,
        ),
      ]);
      repeated.forEach((r) => assert.equal(r.statusCode, 201, r.body));
      assert.deepEqual(repeated[0]!.json(), repeated[1]!.json());
      assert.equal(repeated[0]!.json().replacesConfirmationId, decision.id);
      decision = repeated[0]!.json();
      assert.equal((await confirmations(`subjectId=${project.id}`)).length, 2);
    },
  );
  await t.test(
    "new drafts retain the old formal pointer and allow explicitly confirming history",
    async () => {
      const newScript = await ok(
        "POST",
        `${path}/scripts`,
        { text: "新草稿：钥匙已经不在了。" },
        await next(),
      );
      const draft = await current(project.id);
      assert.equal(draft.basis.objectId, newScript.id);
      assert.equal(draft.currentConfirmationId, decision.id);
      assert.equal(
        (await ok("GET", `${path}/creative-bases/${first.id}`)).isCurrentSource,
        false,
      );
      const reconfirm = await ok("POST", `${path}/creative-confirmations`, {
        basisRevisionId: first.id,
        usage: "project_default",
        expectedCurrentConfirmationId: decision.id,
      });
      assert.equal(reconfirm.basisRevisionId, first.id);
      assert.equal((await current(project.id)).id, draft.id);
      assert.equal(
        (await current(project.id)).currentConfirmationId,
        reconfirm.id,
      );
      const invalid = await request("POST", `${path}/creative-confirmations`, {
        basisRevisionId: draft.id,
        usage: "cut_revision",
        cutRevisionId: randomUUID(),
      });
      assert.equal(invalid.statusCode, 409);
      assert.equal(invalid.json().code, "CUT_REVISION_REQUIRED");
      assert.equal(
        (await current(project.id)).currentConfirmationId,
        reconfirm.id,
      );
      // Clearing previously populated content records the real new empty draft.
      production = await ok(
        "PUT",
        `${path}/production`,
        { title: production.title, brief: "", defaultAssetRevisionIds: [] },
        production.revision,
      );
      assert.equal((await current(production.id)).snapshot.brief, "");
      assert.equal((await bases(`subjectId=${production.id}`)).length, 2);
    },
  );
  await t.test(
    "fixed snapshots and decisions resist mutation; typed links and project scope reject forgery",
    async () => {
      for (const table of [
        "creative_basis_revisions",
        "creative_confirmations",
        "creative_subjects",
      ])
        await assert.rejects(admin.query(`DELETE FROM "${schema}".${table}`), {
          code: "23514",
        });
      await assert.rejects(
        admin.query(
          `UPDATE "${schema}".creative_basis_revisions SET snapshot='{"kind":"script","text":"tampered"}' WHERE id=$1`,
          [first.id],
        ),
        { code: "23514" },
      );
      const second = await createProject("其他项目"),
        other = `/v1/tenants/${tenant.id}/projects/${second.id}`;
      assert.equal(
        (await request("GET", `${other}/creative-bases/${first.id}`))
          .statusCode,
        404,
      );
      assert.equal(
        (
          await request("POST", `${other}/creative-confirmations`, {
            basisRevisionId: first.id,
            usage: "project_default",
            expectedCurrentConfirmationId: null,
          })
        ).statusCode,
        404,
      );
      await assert.rejects(
        admin.query(
          `INSERT INTO "${schema}".creative_confirmations (id,tenant_id,project_id,subject_id,kind,basis_revision_id,usage,confirmed_by) VALUES ($1,$2,$3,$4,'script',$5,'project_default',$6)`,
          [
            randomUUID(),
            tenant.id,
            second.id,
            project.id,
            first.id,
            owner.userId,
          ],
        ),
        { code: "23503" },
      );
      // Same-project columns of the wrong kind must fail CHECK, including SQL NULL semantics.
      await assert.rejects(
        admin.query(
          `INSERT INTO "${schema}".creative_basis_revisions (id,tenant_id,project_id,subject_id,kind,ordinal,source_revision,production_id,snapshot,content_hash,hash_version) VALUES ($1,$2,$3,$3,'script',999,1,$4,'{"kind":"script"}',$5,'creative-v1')`,
          [randomUUID(), tenant.id, project.id, production.id, "0".repeat(64)],
        ),
        { code: "23514" },
      );
      const outsider = await identity("outsider");
      assert.equal(
        (
          await request(
            "GET",
            `${path}/creative-bases`,
            undefined,
            undefined,
            randomUUID(),
            outsider,
          )
        ).statusCode,
        404,
      );
      const invite = await ok("POST", `/v1/tenants/${tenant.id}/invitations`, {
        email: "outsider@example.test",
        role: "member",
      });
      const accepted = await request(
        "POST",
        "/v1/invitations/accept",
        {
          token: new URLSearchParams(
            new URL(invite.invitationUrl).hash.split("?")[1],
          ).get("token"),
        },
        undefined,
        randomUUID(),
        outsider,
      );
      assert.equal(accepted.statusCode, 201, accepted.body);
      await ok("POST", `${path}/members`, { membershipId: accepted.json().id });
      assert.equal(
        (
          await request(
            "GET",
            `${path}/creative-bases`,
            undefined,
            undefined,
            randomUUID(),
            outsider,
          )
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await request(
            "POST",
            `${path}/creative-confirmations`,
            {
              basisRevisionId: first.id,
              usage: "project_default",
              expectedCurrentConfirmationId: null,
            },
            undefined,
            randomUUID(),
            outsider,
          )
        ).statusCode,
        403,
      );
    },
  );
  await t.test(
    "pagination binds all filters and CSV adoption uses the same source capture",
    async () => {
      const firstPage = await ok("GET", `${path}/creative-bases?limit=1`);
      assert.ok(firstPage.nextCursor);
      const changed = await request(
        "GET",
        `${path}/creative-bases?limit=1&kind=script&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
      );
      assert.equal(changed.statusCode, 422);
      const follow = await ok(
        "GET",
        `${path}/creative-bases?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
      );
      assert.notEqual(follow.items[0].id, firstPage.items[0].id);
      const proposal = await ok(
        "POST",
        `${path}/shot-list-imports`,
        {
          csvText:
            "episode,scene,shot_label,intent,dialogue\n第一集,归来,03,停步,他回来过。",
          target: {
            mode: "append_to_scene",
            episodeId: scene.episodeId,
            sceneId: scene.id,
            sceneRevision: scene.revision,
          },
        },
        await next(),
      );
      const tree = await ok(
        "POST",
        `${path}/proposals/${proposal.id}/apply`,
        {
          proposalRevision: 1,
          selectedOperationIds: proposal.operations.map((op: any) => op.opId),
        },
        await next(),
      );
      const imported = tree.shots.find((s: any) => s.label === "03");
      assert.equal(
        (await current(imported.id)).snapshot.dialogue[0].text,
        "他回来过。",
      );
    },
  );
});
