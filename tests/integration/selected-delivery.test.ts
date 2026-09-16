import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import type { MediaStore } from "@drama/media";
import { businessFixture } from "../support/business.js";
import { seedSelectedMedia } from "../support/selected-media.js";
import { readZip } from "../support/read-zip.js";

test("selected delivery fixes a scene's selected originals and rejects stale, revoked, archived or failed packages", async (t) => {
  const originals = new Map<
    string,
    Awaited<ReturnType<typeof seedSelectedMedia>>
  >();
  const downloaded: string[] = [];
  let duringDownload: ((signal: AbortSignal) => Promise<void>) | undefined;
  const store = {
    async verify() {},
    async download(
      source: { key: string; versionId: string; bytes: number },
      path: string,
      sha: string,
      signal: AbortSignal,
    ) {
      const media = originals.get(source.key)!;
      assert.ok(media);
      assert.equal(source.versionId, "synthetic-v1");
      assert.equal(source.bytes, media.bytes.length);
      assert.equal(sha, media.sha);
      signal.throwIfAborted();
      await writeFile(path, media.bytes, { flag: "wx", mode: 0o600 });
      downloaded.push(path);
      const action = duringDownload;
      duringDownload = undefined;
      await action?.(signal);
    },
  } as unknown as MediaStore;
  const f = await businessFixture(t, async () => ({
    media: {
      store,
      async schedule() {
        throw new Error("No generation expected");
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
  originals.set(blue.key, blue);
  originals.set(orange.key, orange);
  const episode = await f.ok(
    "POST",
    `${f.path}/episodes`,
    { title: "合成集", position: 0, status: "active" },
    await f.next(),
  );
  const sceneInput = {
    episodeId: episode.id,
    title: "合成场次",
    position: 0,
    summary: "交接验收",
    state: {},
    status: "active",
  };
  const scene = await f.ok(
    "POST",
    `${f.path}/scenes`,
    sceneInput,
    await f.next(),
  );
  const path = `${f.path}/scenes/${scene.id}/selected-delivery`;
  const empty = await f.request("GET", path);
  assert.equal(empty.statusCode, 409);
  assert.equal(empty.json().code, "NO_SELECTED_TAKES");
  const shots: any[] = [];
  for (let i = 0; i < 4; i++)
    shots.push(
      await f.ok(
        "POST",
        `${f.path}/shots`,
        {
          sceneId: scene.id,
          label: `${i + 1} 合成镜头`,
          position: i,
          status: "active",
          spec: {
            intent: i === 0 ? "=SUM(1,2)" : "合成镜头说明",
            references: [],
          },
        },
        await f.next(),
      ),
    );
  const takes: any[] = [];
  for (let i = 0; i < 3; i++) {
    const shot = shots[i];
    const take = await f.ok("POST", `${f.path}/takes`, {
      shotId: shot.id,
      shotRevisionId: shot.specRevisionId,
      mediaId: i === 1 ? orange.id : blue.id,
      range: { inUs: 250001, outUs: 2000001 },
      note: "合成原片，未经裁剪",
    });
    takes.push(take);
    const state = await f.ok("GET", `${f.path}/shots/${shot.id}/selection`);
    await f.ok(
      "PUT",
      `${f.path}/shots/${shot.id}/selection`,
      { takeId: take.id, reason: "明确选用" },
      state.revision,
    );
  }
  const third = (await f.tree()).shots.find((s: any) => s.id === shots[2].id);
  await f.ok(
    "PUT",
    `${f.path}/shots/${third.id}`,
    {
      sceneId: scene.id,
      label: third.label,
      position: third.position,
      status: "archived",
      spec: third.spec,
    },
    third.revision,
  );
  const preview = async () => {
    const response = await f.request("GET", path);
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const download = (ticket: string, key = randomUUID()) =>
    f.request("POST", `${path}/download`, { ticket }, undefined, key);
  const initial = await preview();
  await t.test(
    "actual ZIP contains only selected active shots in order, fixed IDs, integer ranges and unchanged full media",
    async () => {
      assert.equal(initial.manifest.entries.length, 2);
      assert.equal(initial.manifest.archivedCount, 1);
      assert.equal(initial.manifest.unselectedCount, 1);
      assert.deepEqual(
        initial.manifest.entries.map((e: any) => e.shotId),
        shots.slice(0, 2).map((s) => s.id),
      );
      const response = await download(initial.ticket);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.headers["content-type"], "application/zip");
      assert.equal(
        Number(response.headers["content-length"]),
        response.rawPayload.length,
      );
      const files = await readZip(response.rawPayload);
      assert.equal(files.size, 5);
      assert.deepEqual(
        JSON.parse(files.get("manifest.json")!.toString()),
        initial.manifest,
      );
      for (const item of initial.manifest.entries) {
        const bytes = files.get(`originals/${item.fileName}`)!;
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          item.sha256,
        );
        assert.deepEqual(
          bytes,
          item.mediaId === blue.id ? blue.bytes : orange.bytes,
        );
        assert.deepEqual(item.range, { inUs: 250001, outUs: 2000001 });
        assert.equal(
          item.shotRevisionId,
          shots.find((s) => s.id === item.shotId).specRevisionId,
        );
      }
      const csv = files.get("shots.csv")!.toString();
      assert.ok(csv.startsWith("\uFEFF"));
      assert.ok(csv.includes("'\u003dSUM(1,2)"));
      const json = files.get("manifest.json")!.toString();
      assert.ok(!json.includes("synthetic-v1") && !json.includes(blue.key));
      assert.ok(
        [...files.keys()].every(
          (name) => !name.includes("..") && !name.startsWith("/"),
        ),
      );
    },
  );
  await t.test(
    "tampered preview and foreign scope do not read storage",
    async () => {
      const count = downloaded.length;
      assert.equal((await download(initial.ticket + "a")).statusCode, 422);
      const other = await f.createProject("另一项目");
      assert.equal(
        (
          await f.request(
            "POST",
            `${f.path.replace(f.project.id, other.id)}/scenes/${scene.id}/selected-delivery/download`,
            { ticket: initial.ticket },
          )
        ).statusCode,
        422,
      );
      assert.equal(downloaded.length, count);
    },
  );
  await t.test(
    "the read-only POST still requires same-origin CSRF and expired previews do not read storage",
    async () => {
      const count = downloaded.length;
      const session = await f.ok("GET", "/v1/session");
      for (const [origin, csrf] of [
        ["https://synthetic-foreign.example", session.csrfToken],
        ["http://127.0.0.1:4311", "invalid-csrf"],
      ]) {
        const result = await f.app.inject({
          method: "POST",
          url: `${path}/download`,
          payload: { ticket: initial.ticket },
          headers: {
            cookie: `session=${f.owner.token}`,
            origin,
            "x-csrf-token": csrf,
          },
        });
        assert.equal(result.statusCode, 403);
      }
      const now = Date.now();
      const clock = t.mock.method(Date, "now", () => now + 16 * 60_000);
      try {
        const result = await download(initial.ticket);
        assert.equal(result.statusCode, 409);
        assert.equal(result.json().code, "DELIVERY_PREVIEW_EXPIRED");
      } finally {
        clock.mock.restore();
      }
      assert.equal(downloaded.length, count);
    },
  );
  await t.test(
    "storage failure sends a structured error and removes partial files; the same preview can retry",
    async () => {
      duringDownload = async () => {
        throw new Error("synthetic interrupted source");
      };
      const result = await download(initial.ticket);
      assert.equal(result.statusCode, 503);
      assert.equal(result.json().code, "DELIVERY_SOURCE_UNAVAILABLE");
      await assert.rejects(access(downloaded.at(-1)!));
      assert.equal((await download(initial.ticket)).statusCode, 200);
    },
  );
  await t.test(
    "client disconnect cancels preparation, cleans partial files and releases its concurrency slot",
    async () => {
      const origin = await f.app.listen({ port: 0, host: "127.0.0.1" });
      const session = await f.ok("GET", "/v1/session");
      let began!: () => void, cancelled!: () => void;
      const started = new Promise<void>((resolve) => {
        began = resolve;
      });
      const stopped = new Promise<void>((resolve) => {
        cancelled = resolve;
      });
      duringDownload = async (signal) => {
        began();
        await new Promise<void>((_, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              cancelled();
              reject(new Error("synthetic client disconnected"));
            },
            { once: true },
          ),
        );
      };
      const controller = new AbortController();
      const pending = fetch(`${origin}${path}/download`, {
        method: "POST",
        headers: {
          cookie: `session=${f.owner.token}`,
          origin: "http://127.0.0.1:4311",
          "x-csrf-token": session.csrfToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ticket: initial.ticket }),
        signal: controller.signal,
      });
      void pending.catch(() => {});
      await started;
      const partial = downloaded.at(-1)!;
      const competing = await download(initial.ticket);
      assert.equal(competing.statusCode, 429);
      controller.abort();
      await assert.rejects(pending);
      await Promise.race([
        stopped,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Server did not observe disconnect")),
            3000,
          ).unref(),
        ),
      ]);
      let response = await download(initial.ticket);
      for (let retry = 0; response.statusCode === 429 && retry < 20; retry++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        response = await download(initial.ticket);
      }
      assert.equal(response.statusCode, 200, response.body);
      await assert.rejects(access(partial));
    },
  );
  await t.test(
    "selection changed during preparation refuses the completed archive and cleans it",
    async () => {
      const other = await f.ok("POST", `${f.path}/takes`, {
        shotId: shots[0].id,
        shotRevisionId: shots[0].specRevisionId,
        mediaId: orange.id,
        range: { inUs: 0, outUs: 1000000 },
        note: "新选用",
      });
      duringDownload = async () => {
        const state = await f.ok(
          "GET",
          `${f.path}/shots/${shots[0].id}/selection`,
        );
        await f.ok(
          "PUT",
          `${f.path}/shots/${shots[0].id}/selection`,
          { takeId: other.id },
          state.revision,
        );
      };
      const response = await download(initial.ticket);
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, "DELIVERY_CHANGED");
      await assert.rejects(access(downloaded.at(-1)!));
      assert.equal((await download(initial.ticket)).statusCode, 409);
      assert.equal((await preview()).manifest.entries[0].takeId, other.id);
    },
  );
  await t.test(
    "order changes require a new preview, never silently reorder the confirmed package",
    async () => {
      const old = await preview();
      await f.ok(
        "POST",
        `${f.path}/content/reorder`,
        {
          kind: "shot",
          parentId: scene.id,
          orderedIds: shots.map((s) => s.id).reverse(),
        },
        await f.next(),
      );
      assert.equal((await download(old.ticket)).statusCode, 409);
      const current = await preview();
      assert.deepEqual(
        current.manifest.entries.map((e: any) => e.shotId),
        [shots[1].id, shots[0].id],
      );
    },
  );
  await t.test(
    "revocation during storage IO denies delivery and cached request replay",
    async () => {
      const collaborator = await f.identity("delivery-collaborator"),
        membershipId = randomUUID();
      await f.admin.query(
        `INSERT INTO ${f.schema}.memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')`,
        [membershipId, f.tenant.id, collaborator.userId],
      );
      const grant = await f.ok("POST", `${f.path}/members`, { membershipId });
      const p = await f.request(
        "GET",
        path,
        undefined,
        undefined,
        undefined,
        collaborator,
      );
      const key = randomUUID();
      const run = () =>
        f.request(
          "POST",
          `${path}/download`,
          { ticket: p.json().ticket },
          undefined,
          key,
          collaborator,
        );
      duringDownload = async () => {
        await f.ok(
          "DELETE",
          `${f.path}/members/${membershipId}`,
          undefined,
          grant.revision,
        );
      };
      assert.equal((await run()).statusCode, 404);
      await assert.rejects(access(downloaded.at(-1)!));
      const count = downloaded.length;
      assert.equal((await run()).statusCode, 404);
      assert.equal(downloaded.length, count);
    },
  );
  await t.test(
    "archived ancestors cannot create or replay a batch package",
    async () => {
      const old = await preview();
      const currentScene = (await f.tree()).scenes.find(
        (s: any) => s.id === scene.id,
      );
      await f.ok(
        "PUT",
        `${f.path}/scenes/${scene.id}`,
        { ...sceneInput, status: "archived" },
        currentScene.revision,
      );
      const result = await download(old.ticket);
      assert.equal(result.statusCode, 409);
      assert.equal(result.json().code, "DELIVERY_ARCHIVED");
      assert.equal((await f.request("GET", path)).statusCode, 409);
    },
  );
});
