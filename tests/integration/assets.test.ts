import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { businessFixture } from "../support/business.js";
import { Database } from "../../apps/api/src/kernel/database.js";

test("asset definitions preserve fixed references, independent looks and scoped confirmation", async (t) => {
  const f = await businessFixture(t),
    base = `/v1/tenants/${f.tenant.id}`;
  const second = await f.createProject("无关项目"),
    member = await f.identity("asset-member"),
    reader = await f.identity("asset-reader");
  const memberId = randomUUID();
  await f.admin.query(
    `INSERT INTO ${f.schema}.memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member'),($4,$2,$5,'member')`,
    [memberId, f.tenant.id, member.userId, randomUUID(), reader.userId],
  );
  await f.admin.query(
    `INSERT INTO ${f.schema}.project_memberships(id,tenant_id,project_id,membership_id,role) VALUES($1,$2,$3,$4,'collaborator')`,
    [randomUUID(), f.tenant.id, f.project.id, memberId],
  );
  // Relational fixtures only. Actual byte verification remains covered by test:media.
  async function media(projectId: string | null = f.project.id) {
    const upload = randomUUID(),
      id = randomUUID(),
      scope = projectId ? "project" : "shared";
    await f.admin.query(
      `INSERT INTO ${f.schema}.upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch) VALUES($1,$2,$3,$4,$5,64,$6,'fixture.png','image/png','参考', $7,'accepted',now()+interval '15 minutes','fixture-version',1)`,
      [
        upload,
        f.tenant.id,
        projectId,
        scope,
        `staging/${upload}`,
        "a".repeat(64),
        f.owner.userId,
      ],
    );
    await f.admin.query(
      `INSERT INTO ${f.schema}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio) VALUES($1,$2,$3,$4,'image','ready','参考','fixture.png',$5,$6,$7,'fixture-version',$8,64,'image/png',32,32,false)`,
      [
        id,
        f.tenant.id,
        projectId,
        scope,
        f.owner.userId,
        upload,
        `originals/${randomUUID()}`,
        "a".repeat(64),
      ],
    );
    return id;
  }
  const privateMedia = await media(),
    otherMedia = await media(second.id),
    sharedMedia = await media(null);
  const create = (name: string, kind = "character", shared = false) =>
    f.ok("POST", `${base}/assets`, {
      scope: shared ? "shared" : "project",
      ...(!shared ? { projectId: f.project.id } : {}),
      kind,
      name,
    });
  const current = (id: string) => f.ok("GET", `${base}/assets/${id}`);
  const revise = async (id: string, definition: unknown) =>
    f.ok(
      "POST",
      `${base}/assets/${id}/revisions`,
      { definition },
      (await current(id)).revision,
    );
  let character: any,
    first: any,
    secondRevision: any,
    voice: any,
    voiceRevision: any;
  const daily = randomUUID(),
    evening = randomUUID();
  const initial = {
    description: "女主的固定设定",
    references: [{ mediaId: privateMedia, purpose: "identity" }],
    looks: [
      {
        id: daily,
        revision: 1,
        label: "日常服",
        references: [{ mediaId: privateMedia, purpose: "look" }],
      },
      {
        id: evening,
        revision: 1,
        label: "晚礼服",
        references: [{ mediaId: sharedMedia, purpose: "look" }],
      },
    ],
  };
  await t.test(
    "root CAS and idempotency create exactly one fixed version",
    async () => {
      character = await create("许岚");
      const key = randomUUID();
      const responses = await Promise.all(
        Array.from({ length: 3 }, () =>
          f.request(
            "POST",
            `${base}/assets/${character.id}/revisions`,
            { definition: initial },
            1,
            key,
          ),
        ),
      );
      responses.forEach((r) => assert.equal(r.statusCode, 201, r.body));
      first = responses[0]!.json();
      assert.ok(responses.every((r) => r.json().id === first.id));
      assert.equal((await current(character.id)).revision, 2);
      const bad = await f.request(
        "POST",
        `${base}/assets/${character.id}/revisions`,
        { definition: initial },
        1,
      );
      assert.equal(bad.statusCode, 412);
      assert.equal(
        (await f.ok("GET", `${base}/assets/${character.id}/revisions`)).items
          .length,
        1,
      );
    },
  );
  await t.test(
    "changing one look preserves the other and old immutable definition",
    async () => {
      const changed = structuredClone(initial);
      changed.looks[1]!.label = "深蓝晚礼服";
      changed.looks[1]!.revision = 2;
      secondRevision = await revise(character.id, changed);
      assert.equal(secondRevision.parentRevisionId, first.id);
      assert.deepEqual(secondRevision.definition.looks[0], initial.looks[0]);
      assert.equal(secondRevision.definition.looks[1].id, evening);
      assert.equal(secondRevision.definition.looks[1].revision, 2);
      const history = await f.ok(
        "GET",
        `${base}/assets/${character.id}/revisions`,
      );
      assert.deepEqual(history.items[0].definition, initial);
      const invalid = structuredClone(changed);
      invalid.looks[0]!.label = "换了衣服却不递增";
      const failed = await f.request(
        "POST",
        `${base}/assets/${character.id}/revisions`,
        { definition: invalid },
        (await current(character.id)).revision,
      );
      assert.equal(failed.statusCode, 409, failed.body);
      assert.equal(
        (await current(character.id)).currentRevisionId,
        secondRevision.id,
      );
      const projections = await f.admin.query(
        `SELECT number FROM ${f.schema}.asset_revision_looks WHERE asset_revision_id=$1 ORDER BY look_id`,
        [secondRevision.id],
      );
      assert.equal(projections.rowCount, 2);
      await assert.rejects(
        f.admin.query(
          `UPDATE ${f.schema}.asset_revisions SET definition='{}' WHERE id=$1`,
          [first.id],
        ),
        { code: "23514" },
      );
    },
  );
  await t.test("scope and role are checked before confirmation", async () => {
    assert.equal(
      (
        await f.request(
          "GET",
          `${base}/assets/${character.id}`,
          undefined,
          undefined,
          randomUUID(),
          reader,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await f.request(
          "POST",
          `${base}/assets`,
          { scope: "shared", kind: "prop", name: "越权" },
          undefined,
          randomUUID(),
          member,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.request(
          "POST",
          `${base}/assets/${character.id}/revisions/${first.id}/confirm`,
          undefined,
          1,
          randomUUID(),
          member,
        )
      ).statusCode,
      403,
    );
    const confirmed = await f.ok(
      "POST",
      `${base}/assets/${character.id}/revisions/${first.id}/confirm`,
      undefined,
      1,
    );
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.revision, 2);
    assert.deepEqual(confirmed.definition, initial);
    assert.equal(
      (await current(character.id)).currentRevisionId,
      secondRevision.id,
    );
    assert.equal(
      (
        await f.request(
          "POST",
          `${base}/assets/${character.id}/revisions/${secondRevision.id}/confirm`,
          undefined,
          2,
        )
      ).statusCode,
      412,
    );
  });
  await t.test(
    "reference projections reject wrong project, wrong revision membership and invented look identity",
    async () => {
      for (const reference of [
        { mediaId: otherMedia, purpose: "identity" },
        {
          mediaId: privateMedia,
          purpose: "identity",
          assetRevisionId: randomUUID(),
        },
      ]) {
        const r = await f.request(
          "POST",
          `${base}/assets/${character.id}/revisions`,
          { definition: { description: "错误参考", references: [reference] } },
          (await current(character.id)).revision,
        );
        assert.equal(r.statusCode, 409, r.body);
      }
      const other = await create("另一角色");
      const r = await f.request(
        "POST",
        `${base}/assets/${other.id}/revisions`,
        { definition: initial },
        1,
      );
      assert.equal(r.statusCode, 409, r.body);
      const db = new Database(f.runtime, f.schema);
      await assert.rejects(
        db.transaction(
          f.owner.token,
          { tenantId: f.tenant.id, projectId: f.project.id, write: true },
          (tx) =>
            tx.sql.query(
              `INSERT INTO asset_revision_media(tenant_id,asset_revision_id,media_id,look_key,position,role) VALUES($1,$2,$3,'',199,'identity')`,
              [f.tenant.id, first.id, otherMedia],
            ),
        ),
        { code: "23514" },
      );
    },
  );
  await t.test(
    "shared voice imports pin a version; dependencies and usages remain fixed",
    async () => {
      voice = await create("许岚声线", "voice", true);
      voiceRevision = await revise(voice.id, {
        description: "低声，平稳",
        references: [],
      });
      const def = {
        ...secondRevision.definition,
        defaultVoiceAssetRevisionId: voiceRevision.id,
      };
      assert.equal(
        (
          await f.request(
            "POST",
            `${base}/assets/${character.id}/revisions`,
            { definition: def },
            (await current(character.id)).revision,
          )
        ).statusCode,
        409,
      );
      const imported = await f.ok("POST", `${f.path}/shared-imports`, {
        assetRevisionId: voiceRevision.id,
      });
      const repeated = await f.ok("POST", `${f.path}/shared-imports`, {
        assetRevisionId: voiceRevision.id,
      });
      assert.equal(imported.id, repeated.id);
      const imports = await f.ok("GET", `${f.path}/shared-imports`);
      assert.equal(imports.items.length, 1);
      assert.equal(imports.items[0].assetRevisionId, voiceRevision.id);
      const fixed = await revise(character.id, def);
      assert.equal(
        fixed.definition.defaultVoiceAssetRevisionId,
        voiceRevision.id,
      );
      await revise(voice.id, { description: "更明亮的新版本", references: [] });
      const history = await f.ok(
        "GET",
        `${base}/assets/${character.id}/revisions`,
      );
      assert.equal(
        history.items.at(-1).definition.defaultVoiceAssetRevisionId,
        voiceRevision.id,
      );
      const usages = await f.ok("GET", `${base}/assets/${voice.id}/usages`);
      assert.ok(usages.items.some((item: any) => item.objectId === fixed.id));
      const hidden = await f.request(
        "GET",
        `${base}/assets/${voice.id}/usages`,
        undefined,
        undefined,
        randomUUID(),
        reader,
      );
      assert.equal(hidden.statusCode, 200, hidden.body);
      assert.equal(hidden.json().items.length, 0);
      assert.equal(
        (
          await f.request("POST", `${f.path}/shared-imports`, {
            assetRevisionId: first.id,
          })
        ).statusCode,
        422,
      );
    },
  );
  await t.test(
    "archiving retains prior definitions while new uses and further revisions are blocked",
    async () => {
      await f.admin.query(
        `UPDATE ${f.schema}.media SET status='archived',revision=revision+1 WHERE id=$1`,
        [privateMedia],
      );
      const root = await current(character.id),
        history = await f.ok("GET", `${base}/assets/${character.id}/revisions`);
      const preserved = await revise(character.id, {
        ...history.items.at(-1).definition,
        description: "补充说明，保留既有参考",
      });
      assert.equal(preserved.definition.references[0].mediaId, privateMedia);
      const newcomer = await create("新用途", "prop");
      const invalid = await f.request(
        "POST",
        `${base}/assets/${newcomer.id}/revisions`,
        {
          definition: {
            description: "不能新增归档素材引用",
            references: [{ mediaId: privateMedia, purpose: "prop" }],
          },
        },
        1,
      );
      assert.equal(invalid.statusCode, 409, invalid.body);
      const archived = await f.ok(
        "POST",
        `${base}/assets/${character.id}/archive`,
        undefined,
        (await current(character.id)).revision,
      );
      assert.equal(archived.status, "archived");
      const denied = await f.request(
        "POST",
        `${base}/assets/${character.id}/revisions`,
        { definition: initial },
        archived.revision,
      );
      assert.equal(denied.statusCode, 409);
      assert.equal(denied.json().code, "ASSET_ARCHIVED");
      assert.ok(
        (await f.ok("GET", `${base}/assets/${character.id}/revisions`)).items
          .length > 3,
      );
      const renamed = await f.ok(
        "PATCH",
        `${base}/assets/${character.id}`,
        { name: "许岚 · 已归档", description: "保留历史", tags: [] },
        archived.revision,
      );
      assert.equal(renamed.currentRevisionId, preserved.id);
      assert.equal(root.currentRevisionId, history.items.at(-1).id);
    },
  );
  await t.test(
    "revoked project membership blocks cached create replay; project archive keeps reads only",
    async () => {
      const key = randomUUID(),
        body = {
          scope: "project",
          projectId: f.project.id,
          kind: "prop",
          name: "成员准备的道具",
        };
      const created = await f.request(
        "POST",
        `${base}/assets`,
        body,
        undefined,
        key,
        member,
      );
      assert.equal(created.statusCode, 201, created.body);
      await f.admin.query(
        `DELETE FROM ${f.schema}.project_memberships WHERE project_id=$1 AND membership_id=$2`,
        [f.project.id, memberId],
      );
      const replay = await f.request(
        "POST",
        `${base}/assets`,
        body,
        undefined,
        key,
        member,
      );
      assert.equal(replay.statusCode, 404, replay.body);
      assert.equal(
        (
          await f.request(
            "GET",
            `${base}/assets/${created.json().id}`,
            undefined,
            undefined,
            randomUUID(),
            member,
          )
        ).statusCode,
        404,
      );
      await f.ok(
        "POST",
        `${f.path}/archive`,
        undefined,
        (await f.ok("GET", f.path)).revision,
      );
      assert.equal(
        (await f.request("GET", `${base}/assets/${created.json().id}`))
          .statusCode,
        200,
      );
      const write = await f.request(
        "PATCH",
        `${base}/assets/${created.json().id}`,
        { name: "仍不可修改", description: "", tags: [] },
        1,
      );
      assert.equal(write.statusCode, 409, write.body);
    },
  );
});
