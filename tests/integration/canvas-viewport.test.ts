import { test } from "node:test";
import assert from "node:assert/strict";
import { businessFixture } from "../support/business.js";
import { Database } from "../../apps/api/src/kernel/database.js";

test("complete canvas overviews persist through current authority and independent preference CAS", async (t) => {
  const f = await businessFixture(t),
    db = new Database(f.runtime, f.schema);
  const ep = await f.ok(
    "POST",
    `${f.path}/episodes`,
    { title: "全览", position: 0, status: "active" },
    await f.next(),
  );
  const scene = await f.ok(
    "POST",
    `${f.path}/scenes`,
    {
      episodeId: ep.id,
      title: "全览",
      position: 0,
      status: "active",
      summary: "远距内容",
      state: {},
    },
    await f.next(),
  );
  const ensured = await f.request("POST", `${f.path}/scenes/${scene.id}/canvas`);
  assert.equal(ensured.statusCode, 200, ensured.body);
  const linked = ensured.json();
  const path = `${f.path}/scenes/${scene.id}/workspace-preference`;
  const original = await f.ok("GET", path),
    { sceneId: _scene, revision: _version, ...body } = original;
  let revision = 0;
  for (const zoom of [
    0.00001, 0.0002509698836139663, 0.017954220314735335, 0.1, 1, 4,
  ]) {
    const saved = await f.ok(
      "PUT",
      path,
      {
        ...body,
        mode: "canvas",
        viewport: { x: 715.9598448186217, y: 300.9698836139663, zoom },
      },
      revision++,
    );
    const reread = await f.ok("GET", path);
    assert.deepEqual(reread, saved);
    assert.equal(reread.viewport.zoom, zoom);
    assert.equal(reread.revision, revision);
  }
  for (const zoom of [0, 0.000009, -1, 4.1])
    assert.equal(
      (
        await f.request(
          "PUT",
          path,
          { ...body, viewport: { x: 0, y: 0, zoom } },
          revision,
        )
      ).statusCode,
      422,
    );
  assert.equal(
    (
      await f.request(
        "PUT",
        path,
        { ...body, viewport: { x: 0, y: 0, zoom: 0.02 } },
        revision - 1,
      )
    ).statusCode,
    412,
  );
  const before = await f.ok("GET", path);
  assert.equal(before.revision, revision);
  for (const zoom of [0, 0.000009, 4.1])
    await assert.rejects(
      db.transaction(
        f.owner.token,
        { tenantId: f.tenant.id, projectId: f.project.id, write: true },
        async (tx) => {
          await tx.sql.query(
            "UPDATE scene_workspace_preferences SET revision=revision+1,preference=jsonb_set(preference,'{viewport,zoom}',$1::jsonb) WHERE scene_id=$2 AND user_id=$3",
            [JSON.stringify(zoom), scene.id, f.owner.userId],
          );
        },
      ),
    );
  assert.deepEqual(await f.ok("GET", path), before);
  assert.equal(
    (await f.ok("GET", `${f.path}/canvases/${linked.canvas.id}`)).revision,
    linked.canvas.revision,
  );
  const stranger = await f.identity("fit-no-project-access");
  assert.equal(
    (await f.request("GET", path, undefined, undefined, undefined, stranger))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await f.request(
        "PUT",
        path,
        { ...body, viewport: { x: 0, y: 0, zoom: 0.02 } },
        revision,
        undefined,
        stranger,
      )
    ).statusCode,
    404,
  );
  const roles = await f.runtime.query(
    "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
  );
  assert.equal(roles.rows[0].rolsuper, false);
  assert.equal(roles.rows[0].rolbypassrls, false);
});
