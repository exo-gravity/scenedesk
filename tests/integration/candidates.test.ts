import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { businessFixture } from "../support/business.js";
import { Database } from "../../apps/api/src/kernel/database.js";

test("fixed video candidates and append-only adoption remain distinct from shot requirements", async (t) => {
  const f = await businessFixture(t);
  // These are relational fixtures. Actual video acceptance is tested by the
  // media suite and the imported-file browser journey, not by fake bytes here.
  async function media(
    projectId: string | null = f.project.id,
    kind = "video",
  ) {
    const id = randomUUID(),
      upload = randomUUID(),
      scope = projectId ? "project" : "shared";
    await f.admin.query(
      `INSERT INTO ${f.schema}.upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch)
      VALUES($1,$2,$3,$4,$5,64,$6,'fixture.mp4','video/mp4','关系测试片',$7,'accepted',now()+interval '15 minutes','fixture-version',1)`,
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
      `INSERT INTO ${f.schema}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio,duration_us,fps_num,fps_den)
      VALUES($1,$2,$3,$4,$5,'ready','关系测试片','fixture.mp4',$6,$7,$8,'fixture-version',$9,64,'video/mp4',32,32,false,4000000,24,1)`,
      [
        id,
        f.tenant.id,
        projectId,
        scope,
        kind,
        f.owner.userId,
        upload,
        `originals/${id}`,
        "a".repeat(64),
      ],
    );
    return id;
  }
  const other = await f.createProject("隔离项目"),
    video = await media(),
    shared = await media(null),
    foreign = await media(other.id),
    image = await media(f.project.id, "image");
  const ep = await f.ok(
    "POST",
    `${f.path}/episodes`,
    { title: "第一集", position: 0, status: "active" },
    await f.next(),
  );
  const sceneInput = {
    episodeId: ep.id,
    title: "旧公寓",
    position: 0,
    status: "active",
    summary: "重逢",
    state: { characters: [], props: [], spatialNotes: "" },
  };
  let scene = await f.ok(
    "POST",
    `${f.path}/scenes`,
    sceneInput,
    await f.next(),
  );
  const spec = { intent: "进门后停下", references: [] };
  const shotInput = {
    sceneId: scene.id,
    label: "01A",
    position: 0,
    status: "active",
    spec,
  };
  let shot = await f.ok("POST", `${f.path}/shots`, shotInput, await f.next());
  const shot2 = await f.ok(
    "POST",
    `${f.path}/shots`,
    { ...shotInput, label: "01B", position: 1 },
    await f.next(),
  );
  const body = {
    shotId: shot.id,
    shotRevisionId: shot.specRevisionId,
    mediaId: video,
    range: { inUs: 250001, outUs: 2000001 },
    note: "入屋",
  };
  const route = `${f.path}/shots/${shot.id}/selection`;
  const db = new Database(f.runtime, f.schema);
  const tx = (run: Parameters<Database["transaction"]>[2]) =>
    db.transaction(
      f.owner.token,
      { tenantId: f.tenant.id, projectId: f.project.id, write: true },
      run,
    );
  let take: any, nextTake: any;
  await t.test(
    "deduplicates concurrent archives and preserves immutable identity and metadata",
    async () => {
      const version = await f.next(),
        key = randomUUID();
      const answers = await Promise.all([
        f.request("POST", `${f.path}/takes`, body, undefined, key),
        f.request("POST", `${f.path}/takes`, body, undefined, key),
      ]);
      for (const answer of answers)
        assert.equal(answer.statusCode, 201, answer.body);
      take = answers[0]!.json();
      assert.deepEqual(answers[1]!.json(), take);
      assert.deepEqual(await f.ok("POST", `${f.path}/takes`, body), take);
      assert.deepEqual(take.range, body.range);
      assert.equal(take.createdBy, f.owner.userId);
      assert.equal(
        (
          await f.request("POST", `${f.path}/takes`, {
            ...body,
            note: "覆盖说明",
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (await f.ok("GET", `${f.path}/takes/${take.id}`)).note,
        "入屋",
      );
      assert.equal(await f.next(), version);
      assert.equal((await f.tree()).shots[0].currentTakeId, undefined);
    },
  );
  await t.test(
    "one source has separate intervals for two shots; query cursors stay bound to scope",
    async () => {
      const second = await f.ok("POST", `${f.path}/takes`, {
        ...body,
        shotId: shot2.id,
        shotRevisionId: shot2.specRevisionId,
        range: { inUs: 2000001, outUs: 4000000 },
      });
      assert.notEqual(second.id, take.id);
      await f.ok("POST", `${f.path}/takes`, { ...body, mediaId: shared });
      const first = await f.ok(
        "GET",
        `${f.path}/takes?shotId=${shot.id}&limit=1`,
      );
      assert.ok(first.nextCursor);
      const last = await f.ok(
        "GET",
        `${f.path}/takes?shotId=${shot.id}&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
      );
      assert.notEqual(last.items[0].id, first.items[0].id);
      assert.equal(
        (
          await f.request(
            "GET",
            `${f.path}/takes?shotId=${shot2.id}&cursor=${encodeURIComponent(first.nextCursor)}`,
          )
        ).statusCode,
        422,
      );
      assert.equal(
        (await f.request("GET", `${f.path}/takes?shotId=${randomUUID()}`))
          .statusCode,
        404,
      );
      assert.equal(
        (await f.request("PUT", route, { takeId: second.id }, shot.revision))
          .statusCode,
        422,
      );
    },
  );
  await t.test(
    "invalid range, video, scope, source and forged actor cannot create a candidate",
    async () => {
      const invalid = [
        { ...body, range: { inUs: 2, outUs: 2 } },
        { ...body, range: { inUs: 0, outUs: 4000001 } },
        { ...body, range: { inUs: 0.5, outUs: 2 } },
        { ...body, range: { inUs: 0, outUs: 9007199254740992 } },
        { ...body, mediaId: foreign },
        { ...body, mediaId: image },
        { ...body, shotRevisionId: shot2.specRevisionId },
        {
          ...body,
          sourceTakeId: take.id,
          mediaId: shared,
          range: { inUs: 0, outUs: 1 },
        },
        { ...body, note: "\0" },
      ];
      for (const value of invalid) {
        const response = await f.request("POST", `${f.path}/takes`, value);
        assert.equal(response.statusCode, 422, response.body);
      }
      await assert.rejects(
        tx(({ sql }) =>
          sql.query(
            "INSERT INTO takes(id,tenant_id,project_id,shot_id,shot_revision_id,media_id,in_us,out_us,created_by) VALUES($1,$2,$3,$4,$5,$6,0,1,$7)",
            [
              randomUUID(),
              f.tenant.id,
              f.project.id,
              shot.id,
              shot.specRevisionId,
              video,
              randomUUID(),
            ],
          ),
        ),
        { code: "P0423" },
      );
    },
  );
  await t.test(
    "adoption appends exactly one decision under concurrent CAS without changing requirements",
    async () => {
      const before = await f.next(),
        initial = await f.ok("GET", route);
      assert.equal(initial.currentSelection, undefined);
      assert.equal(initial.revision, shot.revision);
      const answers = await Promise.all([
        f.request(
          "PUT",
          route,
          { takeId: take.id, reason: "动作核对完成" },
          shot.revision,
        ),
        f.request("PUT", route, { takeId: take.id }, shot.revision),
      ]);
      assert.deepEqual(answers.map((r) => r.statusCode).sort(), [200, 412]);
      const response = answers.find((r) => r.statusCode === 200)!;
      const decision = response.json();
      assert.equal(decision.number, 1);
      assert.equal(decision.revision, 1);
      assert.equal(decision.selectedBy, f.owner.userId);
      assert.deepEqual(decision.affectedCutIds, []);
      assert.equal(response.headers.etag, `"${shot.revision + 1}"`);
      const tree = await f.tree();
      shot = tree.shots.find((s: any) => s.id === shot.id);
      assert.equal(tree.revision, before + 1);
      assert.equal(shot.currentTakeId, take.id);
      assert.equal(shot.specRevisionId, take.shotRevisionId);
      assert.deepEqual(shot.spec, spec);
      assert.equal(
        (await f.ok("GET", `${f.path}/shots/${shot.id}/revisions`)).items
          .length,
        1,
      );
      assert.equal(
        (await f.ok("GET", `${f.path}/shots/${shot.id}/selections`)).items
          .length,
        1,
      );
    },
  );
  await t.test(
    "new requirements preserve prior adoption and require explicit lineage reuse",
    async () => {
      const old = shot.specRevisionId;
      shot = await f.ok(
        "PUT",
        `${f.path}/shots/${shot.id}`,
        { ...shotInput, spec: { ...spec, intent: "进门后先看门锁" } },
        shot.revision,
      );
      assert.notEqual(shot.specRevisionId, old);
      assert.equal(shot.currentTakeId, take.id);
      const rejected = await f.request(
        "PUT",
        route,
        { takeId: take.id },
        shot.revision,
      );
      assert.equal(rejected.statusCode, 409);
      assert.equal(rejected.json().code, "TAKE_REQUIREMENTS_CHANGED");
      nextTake = await f.ok("POST", `${f.path}/takes`, {
        ...body,
        shotRevisionId: shot.specRevisionId,
        sourceTakeId: take.id,
        note: "按新要求复核沿用",
      });
      assert.equal(nextTake.sourceTakeId, take.id);
      assert.deepEqual(nextTake.range, take.range);
      assert.equal((await f.ok("GET", route)).currentSelection.takeId, take.id);
      const adopted = await f.ok(
        "PUT",
        route,
        { takeId: nextTake.id },
        shot.revision,
      );
      assert.equal(adopted.number, 2);
      assert.ok(adopted.supersedesSelectionId);
      shot = (await f.tree()).shots.find((s: any) => s.id === shot.id);
    },
  );
  await t.test(
    "clear appends history and stale retry cannot clear a later adoption",
    async () => {
      const clear = await f.request("DELETE", route, undefined, shot.revision);
      assert.equal(clear.statusCode, 200, clear.body);
      assert.equal(clear.json().number, 3);
      assert.equal(clear.json().takeId, undefined);
      const state = await f.ok("GET", route);
      assert.equal(state.currentSelection.id, clear.json().id);
      assert.equal(state.revision, shot.revision + 1);
      assert.equal(
        (await f.tree()).shots.find((s: any) => s.id === shot.id).currentTakeId,
        undefined,
      );
      await f.ok("PUT", route, { takeId: nextTake.id }, state.revision);
      assert.equal(
        (await f.request("DELETE", route, undefined, shot.revision)).statusCode,
        412,
      );
      const history = await f.ok(
        "GET",
        `${f.path}/shots/${shot.id}/selections`,
      );
      assert.equal(history.items.length, 4);
      assert.deepEqual(
        history.items.map((s: any) => s.number),
        [1, 2, 3, 4],
      );
      shot = (await f.tree()).shots.find((s: any) => s.id === shot.id);
    },
  );
  await t.test(
    "restricted SQL cannot rewrite facts or bypass the projected current selection",
    async () => {
      for (const table of ["takes", "selections"]) {
        await assert.rejects(
          tx(({ sql }) =>
            sql.query(
              `UPDATE ${table} SET revision=revision WHERE project_id=$1`,
              [f.project.id],
            ),
          ),
          { code: "42501" },
        );
        await assert.rejects(
          tx(({ sql }) =>
            sql.query(`DELETE FROM ${table} WHERE project_id=$1`, [
              f.project.id,
            ]),
          ),
          { code: "42501" },
        );
        await assert.rejects(
          f.admin.query(
            `UPDATE ${f.schema}.${table} SET revision=revision WHERE project_id=$1`,
            [f.project.id],
          ),
          { code: "23514" },
        );
      }
      await assert.rejects(
        tx(({ sql }) =>
          sql.query(
            "UPDATE shots SET current_selection_id=NULL,revision=revision+1 WHERE id=$1",
            [shot.id],
          ),
        ),
        { code: "23514" },
      );
      await assert.rejects(
        tx(({ sql }) =>
          sql.query(
            "INSERT INTO selections(id,tenant_id,project_id,shot_id,number,take_id,selected_by) VALUES($1,$2,$3,$4,5,$5,$6)",
            [
              randomUUID(),
              f.tenant.id,
              f.project.id,
              shot.id,
              nextTake.id,
              f.owner.userId,
            ],
          ),
        ),
        { code: "P0412" },
      );
    },
  );
  await t.test(
    "archive retains readable historical media and selection but forbids new adoption",
    async () => {
      await tx(({ sql }) =>
        sql.query(
          "UPDATE media SET status='archived',revision=revision+1 WHERE id=$1",
          [video],
        ),
      );
      assert.equal(
        (await f.ok("GET", `${f.path}/takes/${take.id}`)).mediaId,
        video,
      );
      assert.equal(
        (await f.ok("GET", route)).currentSelection.takeId,
        nextTake.id,
      );
      assert.equal(
        (await f.request("PUT", route, { takeId: nextTake.id }, shot.revision))
          .statusCode,
        422,
      );
      assert.equal(
        (
          await f.request("POST", `${f.path}/takes`, {
            ...body,
            range: { inUs: 0, outUs: 1 },
          })
        ).statusCode,
        422,
      );
      const clear = await f.request("DELETE", route, undefined, shot.revision);
      assert.equal(clear.statusCode, 200, clear.body);
      scene = await f.ok(
        "PUT",
        `${f.path}/scenes/${scene.id}`,
        { ...sceneInput, status: "archived" },
        scene.revision,
      );
      assert.equal(
        (
          await f.request("POST", `${f.path}/takes`, {
            ...body,
            mediaId: shared,
            range: { inUs: 0, outUs: 1 },
          })
        ).statusCode,
        422,
      );
    },
  );
  await t.test(
    "tenant membership alone cannot read private candidates or replay cached creation",
    async () => {
      const member = await f.identity("member");
      const invitation = await f.ok(
        "POST",
        `/v1/tenants/${f.tenant.id}/invitations`,
        { email: "member@example.test", role: "member" },
      );
      const parsed = new URLSearchParams(
        invitation.invitationUrl.split("?")[1],
      );
      const accepted = await f.request(
        "POST",
        "/v1/invitations/accept",
        { token: parsed.get("token") },
        undefined,
        randomUUID(),
        member,
      );
      assert.equal(accepted.statusCode, 201, accepted.body);
      const membership = await f.ok("POST", `${f.path}/members`, {
        membershipId: accepted.json().id,
      });
      const key = randomUUID();
      const replay = await f.request(
        "POST",
        `${f.path}/takes`,
        body,
        undefined,
        key,
        member,
      );
      assert.equal(replay.statusCode, 201, replay.body);
      await f.ok(
        "DELETE",
        `${f.path}/members/${accepted.json().id}`,
        undefined,
        membership.revision,
      );
      for (const [method, url, payload] of [
        ["GET", `${f.path}/takes/${take.id}`, undefined],
        ["GET", route, undefined],
        ["POST", `${f.path}/takes`, body],
      ] as const) {
        const response = await f.request(
          method,
          url,
          payload,
          undefined,
          key,
          member,
        );
        assert.equal(response.statusCode, 404, response.body);
      }
    },
  );
});
