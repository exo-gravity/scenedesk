import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { businessFixture } from "../support/business.js";

test("canvas workspace index exposes only current authorized linked workspace identities", async (t) => {
  const f = await businessFixture(t);
  const route = `${f.path}/canvas-workspaces`;
  const ensureCanvas = async (path: string) => {
    const response = await f.request("POST", path);
    assert.equal(response.statusCode, 200, response.body);
    return response.json().canvas;
  };

  await t.test("empty reads do not create a canvas or workspace preference", async () => {
    const response = await f.request("GET", route);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.json(), { items: [] });
    const counts = await f.admin.query(
      `SELECT (SELECT count(*)::integer FROM ${f.schema}.canvases) AS canvases,
       (SELECT count(*)::integer FROM ${f.schema}.project_workspace_preferences) AS preferences`,
    );
    assert.deepEqual(counts.rows[0], { canvases: 0, preferences: 0 });
  });

  const episode = await f.ok(
    "POST",
    `${f.path}/episodes`,
    { title: "第一集", position: 0, status: "active" },
    await f.next(),
  );
  const otherEpisode = await f.ok(
    "POST",
    `${f.path}/episodes`,
    { title: "第二集", position: 1, status: "active" },
    await f.next(),
  );
  const createScene = async (episodeId: string, position: number) =>
    f.ok(
      "POST",
      `${f.path}/scenes`,
      {
        episodeId,
        title: `场次 ${position + 1}`,
        position,
        status: "active",
        summary: "",
        state: { characters: [], props: [], spatialNotes: "" },
      },
      await f.next(),
    );
  const scene = await createScene(episode.id, 0);
  const otherScene = await createScene(otherEpisode.id, 0);
  const unusedScene = await createScene(episode.id, 1);
  const sceneCanvas = await ensureCanvas(`${f.path}/scenes/${scene.id}/canvas`);
  const otherSceneCanvas = await ensureCanvas(
    `${f.path}/scenes/${otherScene.id}/canvas`,
  );
  const projectCanvas = await ensureCanvas(`${f.path}/canvas`);
  const otherProject = await f.createProject("另一个项目");
  const otherPath = `/v1/tenants/${f.tenant.id}/projects/${otherProject.id}`;
  const otherProjectCanvas = await ensureCanvas(`${otherPath}/canvas`);
  let activeSceneCanvasId: string;

  await t.test("index contains only linked identities for the requested project", async () => {
    const items = (await f.ok("GET", route)).items;
    assert.equal(items.length, 3);
    assert.deepEqual(
      new Set(items.map((item: unknown) => JSON.stringify(item))),
      new Set([
        { canvasId: projectCanvas.id, sceneId: null },
        { canvasId: sceneCanvas.id, sceneId: scene.id },
        { canvasId: otherSceneCanvas.id, sceneId: otherScene.id },
      ].map((item) => JSON.stringify(item))),
    );
    assert.deepEqual(await f.ok("GET", `${otherPath}/canvas-workspaces`), {
      items: [{ canvasId: otherProjectCanvas.id, sceneId: null }],
    });
  });

  await t.test("archived scenes and episodes disappear without destroying their history", async () => {
    await f.ok(
      "PUT",
      `${f.path}/scenes/${scene.id}`,
      {
        episodeId: scene.episodeId,
        title: scene.title,
        summary: scene.summary,
        position: scene.position,
        state: scene.state,
        status: "archived",
      },
      scene.revision,
    );
    assert.deepEqual(await f.ok("GET", route), {
      items: [
        { canvasId: projectCanvas.id, sceneId: null },
        { canvasId: otherSceneCanvas.id, sceneId: otherScene.id },
      ],
    });
    await f.ok(
      "PUT",
      `${f.path}/episodes/${otherEpisode.id}`,
      {
        title: otherEpisode.title,
        position: otherEpisode.position,
        status: "archived",
      },
      otherEpisode.revision,
    );
    assert.deepEqual(await f.ok("GET", route), {
      items: [{ canvasId: projectCanvas.id, sceneId: null }],
    });
    assert.equal(
      (await f.ok("GET", `${f.path}/scenes/${scene.id}/canvas`)).canvas.id,
      sceneCanvas.id,
    );
    assert.equal(
      (await f.ok("GET", `${f.path}/scenes/${otherScene.id}/canvas`)).canvas.id,
      otherSceneCanvas.id,
    );
  });

  await t.test("archived project keeps its existing authorized read behavior", async () => {
    activeSceneCanvasId = (
      await ensureCanvas(`${f.path}/scenes/${unusedScene.id}/canvas`)
    ).id;
    const project = await f.ok("GET", f.path);
    await f.ok("POST", `${f.path}/archive`, undefined, project.revision);
    assert.deepEqual(await f.ok("GET", route), {
      items: [
        { canvasId: projectCanvas.id, sceneId: null },
        { canvasId: activeSceneCanvasId, sceneId: unusedScene.id },
      ],
    });
  });

  await t.test("foreign or revoked project access cannot obtain an index", async () => {
    const collaborator = await f.identity("canvas-index-collaborator");
    const membership = randomUUID();
    await f.admin.query(
      `INSERT INTO ${f.schema}.memberships(id,tenant_id,user_id,role,status)
       VALUES($1,$2,$3,'member','active')`,
      [membership, f.tenant.id, collaborator.userId],
    );
    await f.admin.query(
      `INSERT INTO ${f.schema}.project_memberships(id,tenant_id,project_id,membership_id,role)
       VALUES($1,$2,$3,$4,'collaborator')`,
      [randomUUID(), f.tenant.id, f.project.id, membership],
    );
    const readAsCollaborator = (path: string) =>
      f.request("GET", path, undefined, undefined, undefined, collaborator);
    const allowed = await readAsCollaborator(route);
    assert.equal(allowed.statusCode, 200, allowed.body);
    assert.deepEqual(allowed.json(), {
      items: [
        { canvasId: projectCanvas.id, sceneId: null },
        { canvasId: activeSceneCanvasId, sceneId: unusedScene.id },
      ],
    });
    const foreign = await readAsCollaborator(`${otherPath}/canvas-workspaces`);
    assert.equal(foreign.statusCode, 404, foreign.body);
    assert.equal(foreign.json().items, undefined);
    await f.admin.query(
      `DELETE FROM ${f.schema}.project_memberships WHERE membership_id=$1`,
      [membership],
    );
    const revoked = await readAsCollaborator(route);
    assert.equal(revoked.statusCode, 404, revoked.body);
    assert.equal(revoked.json().items, undefined);
    const outsider = await f.identity("canvas-index-outsider");
    const outside = await f.request(
      "GET", route, undefined, undefined, undefined, outsider,
    );
    assert.equal(outside.statusCode, 404, outside.body);
    assert.equal(outside.json().items, undefined);
  });
});
