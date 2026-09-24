import { test } from "node:test";
import assert from "node:assert/strict";
import { businessFixture } from "../support/business.js";
import type { Schema } from "../../apps/api/src/modules/content/model.js";

test("content moves append under the project lock and retain stable identities", async (t) => {
  const f = await businessFixture(t);
  const episodeInput = { title: "来源集", position: 0, status: "active" } as const;
  const source = await f.ok("POST", `${f.path}/episodes`, episodeInput, await f.next());
  const target = await f.ok("POST", `${f.path}/episodes`, { ...episodeInput, title: "目标集", position: 1 }, await f.next());
  const sceneInput: Schema<"SceneInput"> = {
    episodeId: source.id, title: "来源场", position: 0,
    summary: "保留整场内容", state: {}, status: "active",
  };
  let a: Schema<"Scene"> = await f.ok("POST", `${f.path}/scenes`, sceneInput, await f.next());
  let b: Schema<"Scene"> = await f.ok("POST", `${f.path}/scenes`, { ...sceneInput, title: "来源场二", position: 1 }, await f.next());
  const destination: Schema<"Scene"> = await f.ok("POST", `${f.path}/scenes`, { ...sceneInput, episodeId: target.id, title: "目标场" }, await f.next());
  const archivedScene: Schema<"Scene"> = await f.ok("POST", `${f.path}/scenes`, { ...sceneInput, episodeId: target.id, title: "归档场", position: 7, status: "archived" }, await f.next());
  const shotInput: Schema<"ShotInput"> = {
    sceneId: a.id, label: "01", position: 0, status: "active",
    spec: { intent: "保留镜头要求", references: [] },
  };
  let first: Schema<"Shot"> = await f.ok("POST", `${f.path}/shots`, shotInput, await f.next());
  let second: Schema<"Shot"> = await f.ok("POST", `${f.path}/shots`, { ...shotInput, label: "02", position: 1 }, await f.next());
  const archivedShot: Schema<"Shot"> = await f.ok("POST", `${f.path}/shots`, { ...shotInput, sceneId: destination.id, position: 5, status: "archived" }, await f.next());
  const scenePath = `${f.path}/scenes/${a.id}/canvas`;
  const entered = await f.request("POST", scenePath);
  assert.equal(entered.statusCode, 200, entered.body);
  const canvas = entered.json();

  await t.test("concurrent scene moves append after archived siblings and preserve the canvas and shots", async () => {
    const before = await f.tree();
    const results = await Promise.all([a, b].map((scene) =>
      f.request("PUT", `${f.path}/scenes/${scene.id}`, {
        ...sceneInput, title: scene.title, episodeId: target.id, position: 0,
      }, scene.revision),
    ));
    results.forEach((result) => assert.equal(result.statusCode, 200, result.body));
    a = results[0]!.json();
    b = results[1]!.json();
    assert.deepEqual([a.position, b.position].sort((x, y) => x - y), [8, 9]);
    const after = await f.tree();
    assert.equal(after.revision, before.revision + 2);
    assert.deepEqual(after.shots, before.shots);
    assert.deepEqual(await f.ok("GET", scenePath), canvas);
    assert.deepEqual(after.scenes.find((s: Schema<"Scene">) => s.id === archivedScene.id), archivedScene);
  });

  await t.test("concurrent shot moves append without creating requirements revisions and stale retries fail", async () => {
    const previous = [first, second];
    const results = await Promise.all(previous.map((shot) =>
      f.request("PUT", `${f.path}/shots/${shot.id}`, {
        ...shotInput, label: shot.label, sceneId: destination.id, position: 0,
      }, shot.revision),
    ));
    results.forEach((result) => assert.equal(result.statusCode, 200, result.body));
    first = results[0]!.json();
    second = results[1]!.json();
    assert.deepEqual([first.position, second.position].sort((x, y) => x - y), [6, 7]);
    for (const [index, shot] of [first, second].entries()) {
      assert.equal(shot.specRevisionId, previous[index]!.specRevisionId);
      assert.equal(shot.revision, previous[index]!.revision + 1);
      assert.equal((await f.ok("GET", `${f.path}/shots/${shot.id}/revisions`)).items.length, 1);
    }
    const before = await f.tree();
    const retry = await f.request("PUT", `${f.path}/shots/${first.id}`, { ...shotInput, sceneId: destination.id }, previous[0]!.revision);
    assert.equal(retry.statusCode, 412, retry.body);
    assert.deepEqual(await f.tree(), before);
    assert.deepEqual(before.shots.find((s: Schema<"Shot">) => s.id === archivedShot.id), archivedShot);
  });

  await t.test("empty targets start at zero and same-parent updates keep the submitted position", async () => {
    b = await f.ok("PUT", `${f.path}/scenes/${b.id}`, { ...sceneInput, episodeId: source.id, position: 91 }, b.revision);
    assert.equal(b.position, 0);
    first = await f.ok("PUT", `${f.path}/shots/${first.id}`, { ...shotInput, sceneId: b.id, position: 91 }, first.revision);
    assert.equal(first.position, 0);
    first = await f.ok("PUT", `${f.path}/shots/${first.id}`, { ...shotInput, sceneId: b.id.toUpperCase(), label: "改名", position: 3 }, first.revision);
    assert.equal(first.position, 3);
    b = await f.ok("PUT", `${f.path}/scenes/${b.id}`, { ...sceneInput, episodeId: source.id.toUpperCase(), position: 4 }, b.revision);
    assert.equal(b.position, 4);
  });

  await t.test("archived and foreign parents are rejected without changing either hierarchy", async () => {
    const other = await f.createProject("其他项目");
    const otherPath = `/v1/tenants/${f.tenant.id}/projects/${other.id}`;
    const foreignEpisode = await f.ok("POST", `${otherPath}/episodes`, episodeInput, 1);
    const before = await f.tree();
    const foreign = await f.request("PUT", `${f.path}/scenes/${a.id}`, { ...sceneInput, episodeId: foreignEpisode.id }, a.revision);
    assert.equal(foreign.statusCode, 404, foreign.body);
    const archived = await f.request("PUT", `${f.path}/shots/${first.id}`, { ...shotInput, sceneId: archivedScene.id }, first.revision);
    assert.equal(archived.statusCode, 409, archived.body);
    assert.equal(archived.json().code, "PARENT_ARCHIVED");
    assert.deepEqual(await f.tree(), before);
  });

  await t.test("a full position range rejects the entire move without appending a specification", async () => {
    await f.ok("POST", `${f.path}/shots`, { ...shotInput, sceneId: a.id, position: Number.MAX_SAFE_INTEGER }, await f.next());
    const before = await f.tree();
    const response = await f.request("PUT", `${f.path}/shots/${first.id}`, {
      ...shotInput, sceneId: a.id, spec: { intent: "不应保存", references: [] },
    }, first.revision);
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().code, "CONTENT_POSITION_EXHAUSTED");
    assert.deepEqual(await f.tree(), before);
    assert.equal((await f.ok("GET", `${f.path}/shots/${first.id}/revisions`)).items.length, 1);
  });
});
