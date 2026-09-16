import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { MediaStore } from "@drama/media";
import { businessFixture } from "../support/business.js";
import { seedSelectedMedia } from "../support/selected-media.js";

test("shot organization fixes selections and exact originals, with fresh replay authority", async (t) => {
  const signed: {
    key: string;
    versionId: string;
    bytes: number;
    name: string;
    disposition: string;
  }[] = [];
  const store = {
    async verify() {},
    async access(
      source: { key: string; versionId: string; bytes: number },
      name: string,
      _mime: string,
      disposition: string,
    ) {
      signed.push({ ...source, name, disposition });
      return {
        url: `https://synthetic.example.test/original/${signed.length}`,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };
    },
  } as unknown as MediaStore;
  const f = await businessFixture(t, async () => ({
    media: {
      store,
      async schedule() {
        throw new Error("No media jobs expected");
      },
    },
  }));
  const seed = {
    ...f,
    tenantId: f.tenant.id,
    projectId: f.project.id,
    userId: f.owner.userId,
  };
  const blue = await seedSelectedMedia(seed, "blue"),
    orange = await seedSelectedMedia(seed, "orange");
  const image = await seedSelectedMedia(seed, "blue", "image");
  const episode = await f.ok(
    "POST",
    `${f.path}/episodes`,
    { title: "测试集", position: 0, status: "active" },
    await f.next(),
  );
  const sceneInput = {
    episodeId: episode.id,
    title: "测试场次",
    position: 0,
    summary: "合成视频整理",
    state: {},
    status: "active",
  };
  let scene = await f.ok(
    "POST",
    `${f.path}/scenes`,
    sceneInput,
    await f.next(),
  );
  const shotInput = {
    sceneId: scene.id,
    label: "01",
    position: 0,
    status: "active",
    spec: { intent: "推门", references: [] },
  };
  let shot = await f.ok("POST", `${f.path}/shots`, shotInput, await f.next());
  const second = await f.ok(
    "POST",
    `${f.path}/shots`,
    { ...shotInput, label: "02", position: 1 },
    await f.next(),
  );
  const archived = await f.ok(
    "POST",
    `${f.path}/shots`,
    { ...shotInput, label: "03", position: 2 },
    await f.next(),
  );
  await f.ok(
    "PUT",
    `${f.path}/shots/${archived.id}`,
    { ...shotInput, label: "03", position: 2, status: "archived" },
    archived.revision,
  );
  const takeInput = {
    shotId: shot.id,
    shotRevisionId: shot.specRevisionId,
    mediaId: blue.id,
    range: { inUs: 250001, outUs: 2000001 },
    note: "合成蓝片",
  };
  const takeKey = randomUUID();
  const created = await f.request(
    "POST",
    `${f.path}/takes`,
    takeInput,
    undefined,
    takeKey,
  );
  assert.equal(created.statusCode, 201, created.body);
  const take = created.json(),
    alternate = await f.ok("POST", `${f.path}/takes`, {
      ...takeInput,
      mediaId: orange.id,
    });
  const selectionPath = `${f.path}/shots/${shot.id}/selection`,
    downloadPath = `${selectionPath}/download`;
  const selected = await f.ok(
    "PUT",
    selectionPath,
    { takeId: take.id },
    shot.revision,
  );
  shot = (await f.tree()).shots.find((s: any) => s.id === shot.id);
  const downloadKey = randomUUID();
  await t.test(
    "download signs fixed original and source interval; replay signs fresh and never substitutes changed selection",
    async () => {
      const first = await f.request(
        "POST",
        downloadPath,
        { selectionId: selected.id },
        undefined,
        downloadKey,
      );
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().selectionId, selected.id);
      assert.deepEqual(first.json().take.range, takeInput.range);
      assert.equal(first.json().media.id, blue.id);
      assert.deepEqual(signed[0], {
        key: blue.key,
        versionId: "synthetic-v1",
        bytes: blue.bytes.length,
        name: blue.name,
        disposition: "attachment",
      });
      const replay = await f.request(
        "POST",
        downloadPath,
        { selectionId: selected.id },
        undefined,
        downloadKey,
      );
      assert.equal(replay.statusCode, 200, replay.body);
      assert.notEqual(replay.json().access.url, first.json().access.url);
      const next = await f.ok(
        "PUT",
        selectionPath,
        { takeId: alternate.id },
        shot.revision,
      );
      const stale = await f.request(
        "POST",
        downloadPath,
        { selectionId: selected.id },
        undefined,
        downloadKey,
      );
      assert.equal(stale.statusCode, 409, stale.body);
      assert.equal(stale.json().code, "SELECTION_CHANGED");
      assert.equal(signed.length, 2, "stale choice cannot obtain a new grant");
      assert.equal(
        first.json().take.mediaId,
        blue.id,
        "old receipt still identifies its original selection",
      );
      const now = await f.request("POST", downloadPath, {
        selectionId: next.id,
      });
      assert.equal(now.statusCode, 200, now.body);
      assert.equal(now.json().media.id, orange.id);
      const history = (
        await f.ok("GET", `${f.path}/shots/${shot.id}/selections`)
      ).items;
      assert.equal(
        history.find((item: any) => item.id === selected.id).takeId,
        take.id,
      );
    },
  );
  await t.test("images cannot be registered as video candidates", async () => {
    assert.equal(
      (
        await f.request("POST", `${f.path}/takes`, {
          ...takeInput,
          mediaId: image.id,
        })
      ).statusCode,
      422,
    );
  });
  let orderRevision = 0,
    orderKey = randomUUID();
  const order = {
    kind: "shot",
    parentId: scene.id,
    orderedIds: [second.id, archived.id, shot.id],
  };
  await t.test(
    "sorting includes archived children, uses CAS and retains their positions",
    async () => {
      const omitted = await f.request(
        "POST",
        `${f.path}/content/reorder`,
        { ...order, orderedIds: [second.id, shot.id] },
        await f.next(),
      );
      assert.equal(omitted.statusCode, 422, omitted.body);
      orderRevision = await f.next();
      orderKey = randomUUID();
      const response = await f.request(
        "POST",
        `${f.path}/content/reorder`,
        order,
        orderRevision,
        orderKey,
      );
      assert.equal(response.statusCode, 201, response.body);
      assert.deepEqual(
        response
          .json()
          .shots.sort((a: any, b: any) => a.position - b.position)
          .map((s: any) => s.id),
        order.orderedIds,
      );
      assert.equal(
        (
          await f.request(
            "POST",
            `${f.path}/content/reorder`,
            { ...order, orderedIds: [...order.orderedIds].reverse() },
            orderRevision,
          )
        ).statusCode,
        412,
      );
    },
  );
  await t.test(
    "revoked project collaborator cannot replay candidate, order or download success",
    async () => {
      const collaborator = await f.identity("shot-collaborator"),
        membershipId = randomUUID();
      await f.admin.query(
        `INSERT INTO ${f.schema}.memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')`,
        [membershipId, f.tenant.id, collaborator.userId],
      );
      const grant = await f.ok("POST", `${f.path}/members`, { membershipId });
      const keys = [randomUUID(), randomUUID(), randomUUID()];
      const current = await f.ok("GET", selectionPath),
        rev = await f.next();
      const requests = [
        [
          "POST",
          `${f.path}/takes`,
          takeInput,
          undefined,
          keys[0],
          collaborator,
        ],
        [
          "POST",
          `${f.path}/content/reorder`,
          order,
          rev,
          keys[1],
          collaborator,
        ],
        [
          "POST",
          downloadPath,
          { selectionId: current.currentSelection.id },
          undefined,
          keys[2],
          collaborator,
        ],
      ] as const;
      for (const args of requests)
        assert.ok(
          [200, 201].includes(
            (
              await f.request(
                args[0],
                args[1],
                args[2],
                args[3],
                args[4],
                args[5],
              )
            ).statusCode,
          ),
        );
      await f.ok(
        "DELETE",
        `${f.path}/members/${membershipId}`,
        undefined,
        grant.revision,
      );
      const count = signed.length;
      for (const args of requests)
        assert.equal(
          (
            await f.request(
              args[0],
              args[1],
              args[2],
              args[3],
              args[4],
              args[5],
            )
          ).statusCode,
          404,
        );
      assert.equal(signed.length, count);
    },
  );
  await t.test(
    "archived ancestors reject cached writes but preserve authorized fixed downloads",
    async () => {
      scene = (await f.tree()).scenes.find((s: any) => s.id === scene.id);
      await f.ok(
        "PUT",
        `${f.path}/scenes/${scene.id}`,
        { ...sceneInput, status: "archived" },
        scene.revision,
      );
      assert.equal(
        (
          await f.request(
            "POST",
            `${f.path}/takes`,
            takeInput,
            undefined,
            takeKey,
          )
        ).statusCode,
        422,
      );
      assert.equal(
        (
          await f.request(
            "POST",
            `${f.path}/content/reorder`,
            order,
            orderRevision,
            orderKey,
          )
        ).statusCode,
        409,
      );
      const current = await f.ok("GET", selectionPath);
      const before = await f.request("POST", downloadPath, {
        selectionId: current.currentSelection.id,
      });
      assert.equal(before.statusCode, 200, before.body);
      await f.ok("POST", `${f.path}/archive`, undefined, f.project.revision);
      assert.equal(
        (
          await f.request(
            "POST",
            `${f.path}/takes`,
            takeInput,
            undefined,
            takeKey,
          )
        ).statusCode,
        422,
      );
      assert.equal(
        (
          await f.request(
            "POST",
            `${f.path}/content/reorder`,
            order,
            orderRevision,
            orderKey,
          )
        ).statusCode,
        409,
      );
      const after = await f.request("POST", downloadPath, {
        selectionId: current.currentSelection.id,
      });
      assert.equal(after.statusCode, 200, after.body);
      assert.equal(after.json().take.id, alternate.id);
    },
  );
});
