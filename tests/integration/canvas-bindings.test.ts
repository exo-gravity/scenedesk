import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { businessFixture } from "../support/business.js";
import { Database } from "../../apps/api/src/kernel/database.js";
import type { CanvasDocument, CanvasNode } from "@drama/domain";
import type { Schema } from "../../apps/api/src/modules/content/model.js";

test("canvas shot bindings keep fixed candidates, CAS and presentation independent", async (t) => {
  const f = await businessFixture(t),
    db = new Database(f.runtime, f.schema);
  const tx = (run: Parameters<Database["transaction"]>[2]) =>
    db.transaction(
      f.owner.token,
      { tenantId: f.tenant.id, projectId: f.project.id, write: true },
      run,
    );
  const ep = await f.ok(
    "POST",
    `${f.path}/episodes`,
    { title: "第一集", position: 0, status: "active" },
    await f.next(),
  );
  const sceneInput = {
    episodeId: ep.id,
    title: "门口",
    position: 0,
    status: "active",
    summary: "重逢",
    state: { characters: [], props: [], spatialNotes: "" },
  };
  const scene = await f.ok(
    "POST",
    `${f.path}/scenes`,
    sceneInput,
    await f.next(),
  );
  const elsewhere = await f.ok(
    "POST",
    `${f.path}/scenes`,
    { ...sceneInput, position: 1 },
    await f.next(),
  );
  const shotInput = {
    sceneId: scene.id,
    label: "01A",
    position: 0,
    status: "active",
    spec: { intent: "开门", references: [] },
  };
  let shot = await f.ok("POST", `${f.path}/shots`, shotInput, await f.next());
  const shot2 = await f.ok(
    "POST",
    `${f.path}/shots`,
    { ...shotInput, label: "01B", position: 1 },
    await f.next(),
  );
  const foreignShot = await f.ok(
    "POST",
    `${f.path}/shots`,
    { ...shotInput, sceneId: elsewhere.id },
    await f.next(),
  );
  const scenePath = `${f.path}/scenes/${scene.id}/canvas`;
  const enter = await f.request("POST", scenePath);
  assert.equal(enter.statusCode, 200, enter.body);
  let canvas = enter.json().canvas as Schema<"Canvas">;
  const route = `${f.path}/canvases/${canvas.id}`;
  const count = async (table: string) =>
    Number(
      (await f.admin.query(`SELECT count(*) FROM ${f.schema}.${table}`)).rows[0]
        .count,
    );
  const save = async (document: CanvasDocument) => {
    canvas = await f.ok(
      "PUT",
      route,
      { schemaVersion: 1, document },
      canvas.revision,
    );
    return canvas;
  };
  const read = async () => {
    const result = (await f.ok("GET", scenePath)) as Schema<"SceneCanvas">;
    canvas = result.canvas;
    return result;
  };
  const bindPath = (nodeId: string) =>
    `${scenePath}/nodes/${nodeId}/shot-bindings`;
  const bind = async (nodeId: string, body: Schema<"BindCanvasNode">) => {
    const r = await f.request("POST", bindPath(nodeId), body, canvas.revision);
    assert.equal(r.statusCode, 201, r.body);
    const result = r.json() as Schema<"SceneCanvas">;
    canvas = result.canvas;
    return result;
  };
  // Relational fixture only; no fake bytes are described as accepted media tests.
  async function media(projectId = f.project.id) {
    const id = randomUUID(),
      upload = randomUUID();
    await f.admin.query(
      `INSERT INTO ${f.schema}.upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch)
      VALUES($1,$2,$3,'project',$4,64,$5,'fixture.mp4','video/mp4','关系测试',$6,'accepted',now()+interval '15 minutes','fixture-version',1)`,
      [
        upload,
        f.tenant.id,
        projectId,
        `staging/${upload}`,
        "a".repeat(64),
        f.owner.userId,
      ],
    );
    await f.admin.query(
      `INSERT INTO ${f.schema}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio,duration_us,fps_num,fps_den)
      VALUES($1,$2,$3,'project','video','ready','关系测试','fixture.mp4',$4,$5,$6,'fixture-version',$7,64,'video/mp4',32,32,true,4000000,24,1)`,
      [
        id,
        f.tenant.id,
        projectId,
        f.owner.userId,
        upload,
        `originals/${id}`,
        "a".repeat(64),
      ],
    );
    return id;
  }
  const video = await media(),
    video2 = await media();
  const node: CanvasNode = {
    id: randomUUID(),
    title: "门口试拍",
    kind: "video",
    width: 360,
    position: { x: 0, y: 0 },
    content: { type: "media", mediaId: video },
  };
  const copy: CanvasNode = {
    ...node,
    id: randomUUID(),
    position: { x: 400, y: 0 },
  };
  const different: CanvasNode = {
    ...node,
    id: randomUUID(),
    content: { type: "media", mediaId: video2 },
  };
  const note: CanvasNode = {
    id: randomUUID(),
    title: "想法",
    kind: "text",
    width: 280,
    position: { x: 0, y: 320 },
    content: { type: "text", text: "门后暖光" },
  };
  const draft: CanvasNode = {
    ...note,
    id: randomUUID(),
    kind: "video",
    content: { type: "draft", prompt: "", output: {} },
  };
  await save({
    nodes: [node, copy, different, note, draft],
    edges: [],
    groups: [],
  });
  const ref: Schema<"BindCanvasNode"> = {
    role: "reference",
    shotId: shot.id,
    shotRevisionId: shot.specRevisionId,
  };
  const candidate: Schema<"BindCanvasNode"> = {
    role: "candidate",
    shotId: shot.id,
    shotRevisionId: shot.specRevisionId,
    range: { inUs: 250001, outUs: 2000001 },
  };
  let reference!: Schema<"CanvasShotBinding">,
    bound!: Schema<"CanvasShotBinding">,
    take!: Schema<"Take">;
  await t.test(
    "reference increments canvas CAS with shared body and outbox, never shot defaults",
    async () => {
      const before = canvas,
        tree = await f.tree(),
        bodies = await count("canvas_history_bodies"),
        outbox = await count("canvas_outbox");
      const result = await bind(node.id, ref);
      reference = result.bindings[0]!;
      assert.equal(canvas.revision, before.revision + 1);
      assert.equal(canvas.documentHash, before.documentHash);
      assert.equal(await count("canvas_history_bodies"), bodies);
      assert.equal(await count("canvas_outbox"), outbox + 1);
      assert.equal(await count("takes"), 0);
      assert.deepEqual(await f.tree(), tree);
      assert.equal(reference.nodeActive, true);
      assert.equal(reference.takeId, undefined);
      const version = canvas.revision;
      assert.deepEqual(await bind(node.id, ref), result);
      assert.equal(canvas.revision, version);
      const ensured = await f.request("POST", scenePath);
      assert.deepEqual(ensured.json().bindings, result.bindings);
    },
  );
  await t.test(
    "candidate reuses fixed range and existing note; multiple shots and roles remain explicit",
    async () => {
      take = await f.ok("POST", `${f.path}/takes`, {
        ...candidate,
        role: undefined,
        mediaId: video,
        note: "已存在的候选说明",
      });
      const result = await bind(node.id, candidate);
      bound = result.bindings.find((b) => b.role === "candidate")!;
      assert.equal(bound.takeId, take.id);
      assert.equal(await count("takes"), 1);
      assert.equal(
        (await f.ok("GET", `${f.path}/takes/${take.id}`)).note,
        "已存在的候选说明",
      );
      assert.equal(
        (await f.ok("GET", `${f.path}/shots/${shot.id}/selection`))
          .currentSelection,
        undefined,
      );
      const second = await bind(node.id, {
        ...ref,
        shotId: shot2.id,
        shotRevisionId: shot2.specRevisionId,
      });
      assert.equal(second.bindings.length, 3);
      assert.equal(
        second.bindings.filter((b) => b.shotId === shot2.id).length,
        1,
      );
      assert.equal(
        second.bindings.some((b) => b.nodeId === copy.id),
        false,
      );
    },
  );
  await t.test(
    "invalid node, scope, revision, interval and changed existing binding roll back every effect",
    async () => {
      const before = canvas,
        bindings = await count("node_shot_bindings"),
        takes = await count("takes"),
        outbox = await count("canvas_outbox");
      const invalid: [string, unknown, number][] = [
        [randomUUID(), ref, 404],
        [note.id, ref, 422],
        [draft.id, ref, 422],
        [
          copy.id,
          {
            ...ref,
            shotId: foreignShot.id,
            shotRevisionId: foreignShot.specRevisionId,
          },
          404,
        ],
        [copy.id, { ...ref, shotRevisionId: shot2.specRevisionId }, 422],
        [copy.id, { ...candidate, range: { inUs: 0, outUs: 4000001 } }, 422],
        [node.id, { ...candidate, range: { inUs: 0, outUs: 2000000 } }, 409],
      ];
      for (const [id, body, status] of invalid) {
        const r = await f.request("POST", bindPath(id), body, canvas.revision);
        assert.equal(r.statusCode, status, r.body);
      }
      assert.deepEqual((await read()).canvas, before);
      assert.equal(await count("takes"), takes);
      assert.equal(await count("node_shot_bindings"), bindings);
      assert.equal(await count("canvas_outbox"), outbox);
      const unrelated = await f.createProject("隔离"),
        wrong = `/v1/tenants/${f.tenant.id}/projects/${unrelated.id}/scenes/${scene.id}/canvas/nodes/${node.id}/shot-bindings`;
      assert.equal(
        (await f.request("POST", wrong, ref, canvas.revision)).statusCode,
        404,
      );
    },
  );
  await t.test("binding and document writes compete on one CAS", async () => {
    const before = canvas,
      moved = structuredClone(canvas.document);
    moved.nodes[0]!.position.x = 10;
    const replies = await Promise.all([
      f.request("POST", bindPath(copy.id), ref, before.revision),
      f.request(
        "PUT",
        route,
        { schemaVersion: 1, document: moved },
        before.revision,
      ),
    ]);
    assert.equal(replies.filter((r) => r.statusCode === 412).length, 1);
    assert.equal(
      replies.filter((r) => [200, 201].includes(r.statusCode)).length,
      1,
    );
    await read();
    assert.equal(canvas.revision, before.revision + 1);
  });
  await t.test(
    "removal, copy and restoration do not rewrite binding, candidate or adoption",
    async () => {
      const selection = await f.ok(
        "PUT",
        `${f.path}/shots/${shot.id}/selection`,
        { takeId: take.id },
        shot.revision,
      );
      const original = canvas.document;
      await save({
        ...original,
        nodes: original.nodes.filter((n) => n.id !== node.id),
      });
      assert.equal(
        (await read()).bindings.find((b) => b.id === bound.id)!.nodeActive,
        false,
      );
      assert.equal(
        (await f.ok("GET", `${f.path}/shots/${shot.id}/selection`))
          .currentSelection.id,
        selection.id,
      );
      await save(original);
      assert.equal(
        (await read()).bindings.find((b) => b.id === bound.id)!.nodeActive,
        true,
      );
      assert.deepEqual(await f.ok("GET", `${f.path}/takes/${take.id}`), take);
      shot = (await f.tree()).shots.find(
        (s: Schema<"Shot">) => s.id === shot.id,
      );
      const old = shot.specRevisionId;
      shot = await f.ok(
        "PUT",
        `${f.path}/shots/${shot.id}`,
        { ...shotInput, spec: { intent: "先敲门", references: [] } },
        shot.revision,
      );
      assert.notEqual(shot.specRevisionId, old);
      assert.equal(
        (await read()).bindings.find((b) => b.id === bound.id)!.shotRevisionId,
        old,
      );
    },
  );
  await t.test(
    "restricted SQL validates actual media and scene; direct facts must advance canvas CAS",
    async () => {
      const before = canvas,
        outbox = await count("canvas_outbox");
      for (const [nodeId, shotId, shotRevisionId, role, takeId, actor] of [
        [
          different.id,
          ref.shotId,
          ref.shotRevisionId,
          "candidate",
          take.id,
          f.owner.userId,
        ],
        [
          copy.id,
          foreignShot.id,
          foreignShot.specRevisionId,
          "reference",
          null,
          f.owner.userId,
        ],
        [
          copy.id,
          shot2.id,
          shot2.specRevisionId,
          "reference",
          null,
          randomUUID(),
        ],
      ])
        await assert.rejects(
          tx(({ sql }) =>
            sql.query(
              "INSERT INTO node_shot_bindings(id,tenant_id,project_id,canvas_id,node_id,shot_id,shot_revision_id,role,take_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
              [
                randomUUID(),
                f.tenant.id,
                f.project.id,
                canvas.id,
                nodeId,
                shotId,
                shotRevisionId,
                role,
                takeId,
                actor,
              ],
            ),
          ),
          { code: "P0425" },
        );
      assert.equal((await read()).canvas.revision, before.revision);
      assert.equal(await count("canvas_outbox"), outbox);
      await assert.rejects(
        tx(({ sql }) =>
          sql.query(
            "UPDATE node_shot_bindings SET shot_revision_id=$1 WHERE id=$2",
            [shot.specRevisionId, bound.id],
          ),
        ),
        { code: "42501" },
      );
      const id = randomUUID();
      await tx(({ sql }) =>
        sql.query(
          "INSERT INTO node_shot_bindings(id,tenant_id,project_id,canvas_id,node_id,shot_id,shot_revision_id,role,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'reference',$8)",
          [
            id,
            f.tenant.id,
            f.project.id,
            canvas.id,
            different.id,
            shot2.id,
            shot2.specRevisionId,
            f.owner.userId,
          ],
        ),
      );
      await read();
      assert.equal(canvas.revision, before.revision + 1);
      assert.equal(canvas.documentHash, before.documentHash);
      assert.equal(await count("canvas_outbox"), outbox + 1);
    },
  );
  await t.test(
    "unlink is version and node bound; removing inactive binding preserves all downstream facts",
    async () => {
      await save({
        ...canvas.document,
        nodes: canvas.document.nodes.filter((n) => n.id !== node.id),
      });
      const before = canvas,
        outbox = await count("canvas_outbox"),
        takeCount = await count("takes"),
        selection = await f.ok("GET", `${f.path}/shots/${shot.id}/selection`);
      assert.equal(
        (
          await f.request(
            "DELETE",
            `${bindPath(copy.id)}/${bound.id}`,
            undefined,
            canvas.revision,
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await f.request(
            "DELETE",
            `${bindPath(node.id)}/${bound.id}`,
            undefined,
            canvas.revision - 1,
          )
        ).statusCode,
        412,
      );
      const r = await f.request(
        "DELETE",
        `${bindPath(node.id)}/${bound.id}`,
        undefined,
        canvas.revision,
      );
      assert.equal(r.statusCode, 200, r.body);
      canvas = r.json().canvas;
      assert.equal(canvas.revision, before.revision + 1);
      assert.equal(canvas.documentHash, before.documentHash);
      assert.equal(
        r
          .json()
          .bindings.some((b: Schema<"CanvasShotBinding">) => b.id === bound.id),
        false,
      );
      assert.equal(await count("canvas_outbox"), outbox + 1);
      assert.equal(await count("takes"), takeCount);
      assert.deepEqual(
        await f.ok("GET", `${f.path}/shots/${shot.id}/selection`),
        selection,
      );
    },
  );
  await t.test(
    "current authority is required for idempotent replay and binding reads",
    async () => {
      const other = await f.identity("canvas-binding-member"),
        memberId = randomUUID();
      await f.admin.query(
        `INSERT INTO ${f.schema}.memberships(id,tenant_id,user_id,role,status) VALUES($1,$2,$3,'member','active')`,
        [memberId, f.tenant.id, other.userId],
      );
      await f.admin.query(
        `INSERT INTO ${f.schema}.project_memberships(id,project_id,membership_id,tenant_id,role) VALUES($1,$2,$3,$4,'collaborator')`,
        [randomUUID(), f.project.id, memberId, f.tenant.id],
      );
      const key = randomUUID(),
        request = {
          ...ref,
          shotId: shot2.id,
          shotRevisionId: shot2.specRevisionId,
        };
      const response = await f.request(
        "POST",
        bindPath(copy.id),
        request,
        canvas.revision,
        key,
        other,
      );
      assert.equal(response.statusCode, 201, response.body);
      await f.admin.query(
        `DELETE FROM ${f.schema}.project_memberships WHERE project_id=$1 AND membership_id=$2`,
        [f.project.id, memberId],
      );
      assert.equal(
        (
          await f.request(
            "POST",
            bindPath(copy.id),
            request,
            canvas.revision,
            key,
            other,
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await f.request(
            "GET",
            scenePath,
            undefined,
            undefined,
            randomUUID(),
            other,
          )
        ).statusCode,
        404,
      );
      await read();
    },
  );
  await t.test(
    "archived media and shots stay readable but cannot gain even duplicate bindings",
    async () => {
      const body = {
        ...ref,
        shotId: shot2.id,
        shotRevisionId: shot2.specRevisionId,
      };
      await tx(({ sql }) =>
        sql.query(
          "UPDATE media SET status='archived',revision=revision+1 WHERE id=$1",
          [video2],
        ),
      );
      const before = await read(),
        old = before.bindings.find((b) => b.nodeId === different.id)!;
      assert.equal(
        (await f.request("POST", bindPath(different.id), body, canvas.revision))
          .statusCode,
        422,
      );
      const unlink = await f.request(
        "DELETE",
        `${bindPath(different.id)}/${old.id}`,
        undefined,
        canvas.revision,
      );
      assert.equal(unlink.statusCode, 200, unlink.body);
      await read();
      const latest = (await f.tree()).shots.find(
        (s: Schema<"Shot">) => s.id === shot2.id,
      );
      await f.ok(
        "PUT",
        `${f.path}/shots/${shot2.id}`,
        { ...shotInput, label: shot2.label, position: 1, status: "archived" },
        latest.revision,
      );
      assert.equal(
        (await f.request("POST", bindPath(copy.id), body, canvas.revision))
          .statusCode,
        422,
      );
      assert.ok((await read()).bindings.some((b) => b.shotId === shot2.id));
    },
  );
});
