import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { MediaStore } from "@drama/media";
import type { CanvasNode } from "@drama/domain";
import { businessFixture } from "../support/business.js";
import { Database } from "../../apps/api/src/kernel/database.js";
import type { Schema } from "../../apps/api/src/modules/content/model.js";

test("canvas upload identities separate import, placement and document undo", async (t) => {
  // Only the storage grant is substituted. These are real API/SQL constraints,
  // not accepted file bytes; real import/decoding is verified in media/browser tests.
  const f = await businessFixture(t, async () => ({
    media: {
      store: {
        verify: async () => undefined,
        authorizeUpload: async () => ({
          uploadUrl: "https://storage.example.test/upload",
          method: "POST",
          formFields: { key: "fixture" },
        }),
      } as unknown as MediaStore,
      schedule: async () => undefined,
    },
  }));
  const mediaPath = `/v1/tenants/${f.tenant.id}`;
  const makeCanvas = async (projectId = f.project.id) => {
    const path = `${mediaPath}/projects/${projectId}`;
    const version = async () => (await f.ok("GET", `${path}/content`)).revision;
    const ep = await f.ok(
      "POST",
      `${path}/episodes`,
      { title: "上传检查", position: 0, status: "active" },
      await version(),
    );
    const scene = await f.ok(
      "POST",
      `${path}/scenes`,
      {
        episodeId: ep.id,
        title: "落点",
        position: 0,
        status: "active",
        summary: "",
        state: { characters: [], props: [], spatialNotes: "" },
      },
      await version(),
    );
    const entered = await f.request(
      "POST",
      `${path}/scenes/${scene.id}/canvas`,
    );
    assert.equal(entered.statusCode, 200, entered.body);
    return { canvas: entered.json().canvas as Schema<"Canvas">, path };
  };
  const initial = await makeCanvas();
  let canvas = initial.canvas;
  const route = `${initial.path}/canvases/${canvas.id}`;
  const declaration = (canvasId = canvas.id): Schema<"UploadInput"> => ({
    scope: "project",
    projectId: f.project.id,
    fileName: "reference.png",
    displayName: "参考文件",
    mime: "image/png",
    bytes: 64,
    sha256: "a".repeat(64),
    canvasTarget: {
      canvasId,
      clientRequestId: randomUUID(),
      position: { x: 123.5, y: -45.25 },
    },
  });
  const create = async (input = declaration(), key = randomUUID()) => {
    const r = await f.request(
      "POST",
      `${mediaPath}/uploads`,
      input,
      undefined,
      key,
    );
    assert.equal(r.statusCode, 201, r.body);
    return r.json() as Schema<"UploadIntent">;
  };
  const get = (id: string) =>
    f.ok("GET", `${route}/uploads/${id}`) as Promise<Schema<"CanvasUpload">>;
  const list = () =>
    f.ok("GET", `${route}/uploads`) as Promise<Schema<"CanvasUploadPage">>;
  const count = async (table: string) =>
    Number(
      (await f.admin.query(`SELECT count(*) FROM ${f.schema}.${table}`)).rows[0]
        .count,
    );
  const save = async (nodes: CanvasNode[]) => {
    const r = await f.request(
      "PUT",
      route,
      { schemaVersion: 1, document: { nodes, edges: [], groups: [] } },
      canvas.revision,
    );
    if (r.statusCode === 200) canvas = r.json();
    return r;
  };
  const accept = async (uploadId: string) => {
    const id = randomUUID();
    await f.admin.query(
      `UPDATE ${f.schema}.upload_intents SET status='accepted',staging_version_id='fixture-version',revision=revision+1 WHERE id=$1`,
      [uploadId],
    );
    await f.admin.query(
      `INSERT INTO ${f.schema}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio)
      VALUES($1,$2,$3,'project','image','ready','参考文件','reference.png',$4,$5,$6,'fixture-version',$7,64,'image/png',32,32,false)`,
      [
        id,
        f.tenant.id,
        f.project.id,
        f.owner.userId,
        uploadId,
        `originals/${id}`,
        "a".repeat(64),
      ],
    );
    return id;
  };
  const node = (
    entry: Schema<"CanvasUpload">,
    mediaId: string,
  ): CanvasNode => ({
    id: entry.nodeId,
    title: "参考文件",
    kind: "image",
    width: 360,
    position: entry.position,
    content: { type: "media", mediaId },
  });
  const key = randomUUID();
  let first!: Schema<"UploadIntent">, entry!: Schema<"CanvasUpload">;
  await t.test(
    "creation atomically fixes the landing point and survives cached response replay",
    async () => {
      const before = canvas.revision;
      const input = declaration();
      first = await create(input, key);
      assert.equal((await create(input, key)).id, first.id);
      entry = await get(first.id);
      assert.equal(
        (
          await f.ok(
            "GET",
            `${route}/uploads/by-request/${input.canvasTarget!.clientRequestId}`,
          )
        ).upload.id,
        first.id,
      );
      const beforeCount = await count("upload_intents");
      assert.equal(
        (await f.request("POST", `${mediaPath}/uploads`, input)).statusCode,
        422,
      );
      assert.equal(await count("upload_intents"), beforeCount);
      assert.deepEqual(entry.position, { x: 123.5, y: -45.25 });
      assert.equal(entry.upload.id, first.id);
      assert.equal(entry.placed, false);
      assert.equal(entry.dismissed, false);
      assert.equal(entry.upload.uploadUrl, undefined);
      assert.equal((await list()).items.length, 1);
      assert.equal((await f.ok("GET", route)).revision, before);
      assert.equal(await count("canvas_upload_placements"), 1);
    },
  );
  await t.test(
    "invalid scope, target, type and coordinates roll back the upload itself",
    async () => {
      const before = await count("upload_intents");
      for (const input of [
        { ...declaration(), scope: "shared", projectId: undefined },
        {
          ...declaration(),
          canvasTarget: { canvasId: randomUUID(), position: { x: 0, y: 0 } },
        },
        { ...declaration(), mime: "text/plain" },
        {
          ...declaration(),
          canvasTarget: { canvasId: canvas.id, position: { x: 1000001, y: 0 } },
        },
      ]) {
        const r = await f.request("POST", `${mediaPath}/uploads`, input);
        assert.ok([404, 422].includes(r.statusCode), r.body);
      }
      assert.equal(await count("upload_intents"), before);
    },
  );
  await t.test(
    "a reserved identity cannot become a note, a foreign canvas node or unverified media",
    async () => {
      const note: CanvasNode = {
        id: entry.nodeId,
        kind: "text",
        title: "伪装",
        position: entry.position,
        width: 320,
        content: { type: "text", text: "" },
      };
      assert.equal((await save([note])).statusCode, 422);
      const project = await f.createProject("另一个项目"),
        other = await makeCanvas(project.id);
      const wrong = await f.request(
        "PUT",
        `${other.path}/canvases/${other.canvas.id}`,
        {
          schemaVersion: 1,
          document: { nodes: [note], edges: [], groups: [] },
        },
        other.canvas.revision,
      );
      assert.equal(wrong.statusCode, 422, wrong.body);
      const bad = await create(),
        badEntry = await get(bad.id),
        badMedia = await accept(bad.id);
      assert.equal((await save([node(entry, badMedia)])).statusCode, 422);
      assert.equal((await get(first.id)).placed, false);
      assert.equal((await save([node(badEntry, badMedia)])).statusCode, 200);
      assert.equal((await save([])).statusCode, 200);
    },
  );
  await t.test(
    "accepted media is placed once and its permanent identity survives undo/removal",
    async () => {
      const mediaId = await accept(first.id),
        fixed = node(entry, mediaId);
      assert.equal((await save([fixed])).statusCode, 200);
      assert.equal((await get(first.id)).placed, true);
      assert.equal(
        (await list()).items.some((p) => p.upload.id === first.id),
        false,
      );
      assert.equal((await save([])).statusCode, 200);
      assert.equal((await get(first.id)).placed, true);
      assert.equal(
        (await list()).items.some((p) => p.upload.id === first.id),
        false,
      );
      assert.equal((await save([fixed])).statusCode, 200);
      const dismissed = await f.request(
        "POST",
        `${route}/uploads/${first.id}/dismiss`,
      );
      assert.equal(dismissed.statusCode, 409, dismissed.body);
      assert.equal((await get(first.id)).dismissed, false);
    },
  );
  await t.test(
    "dismissal is durable and does not remove the imported media or touch canvas CAS",
    async () => {
      const pending = await create(),
        record = await get(pending.id),
        before = canvas.revision;
      for (let i = 0; i < 2; i++) {
        const r = await f.request(
          "POST",
          `${route}/uploads/${pending.id}/dismiss`,
        );
        assert.equal(r.statusCode, 200, r.body);
        assert.equal(r.json().dismissed, true);
      }
      const mediaId = await accept(pending.id);
      assert.equal((await save([node(record, mediaId)])).statusCode, 422);
      assert.equal((await f.ok("GET", route)).revision, before);
      assert.equal(
        (await f.ok("GET", `${mediaPath}/media/${mediaId}`)).status,
        "ready",
      );
      assert.equal(
        (await list()).items.some((p) => p.upload.id === pending.id),
        false,
      );
    },
  );
  await t.test(
    "restricted writes enforce identity and the pending cap under concurrent create",
    async () => {
      const db = new Database(f.runtime, f.schema);
      const tx = (run: Parameters<Database["transaction"]>[2]) =>
        db.transaction(
          f.owner.token,
          { tenantId: f.tenant.id, projectId: f.project.id, write: true },
          run,
        );
      await assert.rejects(
        tx(({ sql }) =>
          sql.query(
            "UPDATE canvas_upload_placements SET node_id=$1 WHERE upload_id=$2",
            [randomUUID(), first.id],
          ),
        ),
        { code: "42501" },
      );
      await assert.rejects(
        tx(({ sql }) =>
          sql.query("DELETE FROM canvas_upload_placements WHERE upload_id=$1", [
            first.id,
          ]),
        ),
        { code: "42501" },
      );
      await tx(async ({ sql }) => {
        for (let i = 0; i < 99; i++) {
          const id = randomUUID();
          await sql.query(
            `INSERT INTO upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,expires_at,epoch)
          VALUES($1,$2,$3,'project',$4,64,$5,'reference.png','image/png','参考文件',$6,now()+interval '15 minutes',1)`,
            [
              id,
              f.tenant.id,
              f.project.id,
              `staging/${id}`,
              "a".repeat(64),
              f.owner.userId,
            ],
          );
          await sql.query(
            "INSERT INTO canvas_upload_placements(upload_id,tenant_id,project_id,canvas_id,node_id,x,y,created_by,client_request_id) VALUES($1,$2,$3,$4,$5,0,0,$6,$7)",
            [
              id,
              f.tenant.id,
              f.project.id,
              canvas.id,
              randomUUID(),
              f.owner.userId,
              randomUUID(),
            ],
          );
        }
      });
      const results = await Promise.all(
        [0, 1].map(() =>
          f.request("POST", `${mediaPath}/uploads`, declaration()),
        ),
      );
      assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 413]);
      assert.equal((await list()).items.length, 100);
      const winner = results.find((r) => r.statusCode === 201)!.json();
      const r = await f.request(
        "POST",
        `${route}/uploads/${winner.id}/dismiss`,
      );
      assert.equal(r.statusCode, 200, r.body);
      await create();
      assert.equal((await list()).items.length, 100);
    },
  );
  await t.test(
    "current project authority protects list, direct reads and cached creates",
    async () => {
      const user = await f.identity("upload-member"),
        membership = randomUUID();
      await f.admin.query(
        `INSERT INTO ${f.schema}.memberships(id,tenant_id,user_id,role,status) VALUES($1,$2,$3,'member','active')`,
        [membership, f.tenant.id, user.userId],
      );
      await f.admin.query(
        `INSERT INTO ${f.schema}.project_memberships(id,tenant_id,project_id,membership_id,role) VALUES($1,$2,$3,$4,'collaborator')`,
        [randomUUID(), f.tenant.id, f.project.id, membership],
      );
      const pending = (await list()).items[0]!;
      assert.equal(
        (
          await f.request(
            "POST",
            `${route}/uploads/${pending.upload.id}/dismiss`,
            undefined,
            undefined,
            randomUUID(),
            user,
          )
        ).statusCode,
        200,
      );
      const token = randomUUID();
      const created = await f.request(
        "POST",
        `${mediaPath}/uploads`,
        declaration(),
        undefined,
        token,
        user,
      );
      assert.equal(created.statusCode, 201, created.body);
      await f.admin.query(
        `DELETE FROM ${f.schema}.project_memberships WHERE project_id=$1 AND membership_id=$2`,
        [f.project.id, membership],
      );
      assert.equal(
        (
          await f.request(
            "GET",
            `${route}/uploads`,
            undefined,
            undefined,
            randomUUID(),
            user,
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await f.request(
            "GET",
            `${route}/uploads/${first.id}`,
            undefined,
            undefined,
            randomUUID(),
            user,
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await f.request(
            "POST",
            `${mediaPath}/uploads`,
            declaration(),
            undefined,
            token,
            user,
          )
        ).statusCode,
        404,
      );
    },
  );
});
