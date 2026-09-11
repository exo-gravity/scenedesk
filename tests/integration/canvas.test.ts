import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { businessFixture } from "../support/business.js";
import { Database } from "../../apps/api/src/kernel/database.js";
import type { CanvasDocument, CanvasNode } from "@drama/domain";
import { digest } from "../../apps/api/src/kernel/crypto.js";
import { inspectCanvasDocument } from "@drama/domain";

test("scene canvas persistence preserves identity, history and private preference boundaries", async (t) => {
  const f = await businessFixture(t),
    db = new Database(f.runtime, f.schema);
  const transaction = (run: Parameters<Database["transaction"]>[2]) =>
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
  const createScene = async (position: number) =>
    f.ok(
      "POST",
      `${f.path}/scenes`,
      {
        episodeId: ep.id,
        title: "公寓",
        position,
        status: "active",
        summary: "重逢",
        state: { characters: [], props: [], spatialNotes: "" },
      },
      await f.next(),
    );
  const scene = await createScene(0),
    secondScene = await createScene(1);
  const scenePath = `${f.path}/scenes/${scene.id}/canvas`;
  const prefPath = `${f.path}/scenes/${scene.id}/workspace-preference`;
  const count = async (table: string) =>
    Number(
      (await f.admin.query(`SELECT count(*) FROM ${f.schema}.${table}`)).rows[0]
        .count,
    );
  let canvas: any, route: string;
  const textNode = (): CanvasNode => ({
    id: randomUUID(),
    title: "构图说明",
    kind: "text",
    position: { x: 0, y: 0 },
    width: 280,
    content: { type: "text", text: "门后是暖光。" },
  });
  const save = async (document: CanvasDocument, revision = canvas.revision) => {
    const response = await f.request(
      "PUT",
      route,
      { schemaVersion: 1, document },
      revision,
    );
    assert.equal(response.statusCode, 200, response.body);
    canvas = response.json();
    return canvas;
  };
  await t.test(
    "reads are write-free; concurrent explicit entry creates exactly one canvas",
    async () => {
      const missing = await f.request("GET", scenePath);
      assert.equal(missing.statusCode, 404);
      assert.equal(missing.json().code, "SCENE_CANVAS_NOT_CREATED");
      const preference = await f.ok("GET", prefPath);
      assert.equal(preference.revision, 0);
      assert.equal(preference.mode, "storyboard");
      assert.equal(await count("canvases"), 0);
      assert.equal(await count("scene_workspace_preferences"), 0);
      const replies = await Promise.all(
        Array.from({ length: 3 }, () => f.request("POST", scenePath)),
      );
      for (const r of replies) assert.equal(r.statusCode, 200, r.body);
      assert.equal(new Set(replies.map((r) => r.json().canvas.id)).size, 1);
      canvas = replies[0]!.json().canvas;
      route = `${f.path}/canvases/${canvas.id}`;
      assert.equal(canvas.revision, 1);
      assert.equal(await count("canvases"), 1);
      assert.equal(await count("canvas_history_bodies"), 1);
      assert.equal(await count("canvas_outbox"), 1);
      assert.deepEqual(await f.ok("GET", route), canvas);
    },
  );
  await t.test(
    "one racing save wins; replay preserves revision and immutable recovery points",
    async () => {
      const a: CanvasDocument = { nodes: [textNode()], edges: [], groups: [] },
        b = structuredClone(a);
      b.nodes[0]!.title = "另一个编辑者";
      const replies = await Promise.all(
        [a, b].map((document) =>
          f.request("PUT", route, { schemaVersion: 1, document }, 1),
        ),
      );
      assert.deepEqual(replies.map((r) => r.statusCode).sort(), [200, 412]);
      assert.equal(
        replies.find((r) => r.statusCode === 412)!.json().code,
        "CANVAS_VERSION_CONFLICT",
      );
      canvas = await f.ok("GET", route);
      assert.equal(canvas.revision, 2);
      assert.deepEqual(await save(canvas.document), canvas);
      assert.equal(canvas.revision, 2);
      assert.equal(await count("canvas_outbox"), 2);
      assert.deepEqual(
        (await f.ok("GET", `${route}/revisions/1`)).document.nodes,
        [],
      );
      assert.equal(
        (await f.request("GET", `${route}/revisions/3`)).statusCode,
        404,
      );
      const history = await f.ok("GET", `${route}/revisions?limit=1`);
      assert.equal(history.items[0].revision, 2);
      assert.ok(history.items[0].retainedFor.includes("current"));
      assert.equal(
        (
          await f.ok(
            "GET",
            `${route}/revisions?cursor=${encodeURIComponent(history.nextCursor)}`,
          )
        ).items[0].revision,
        1,
      );
    },
  );
  await t.test(
    "drafts, graph references and Unicode round-trip; malformed or executable fields fail atomically",
    async () => {
      const doc = structuredClone(canvas.document) as CanvasDocument;
      const node: CanvasNode = {
        id: randomUUID(),
        title: "雨夜画面",
        kind: "image",
        width: 360,
        position: { x: 450, y: 0 },
        content: { type: "draft", prompt: "", output: {} },
      };
      doc.nodes.push(node);
      doc.edges.push({
        id: randomUUID(),
        sourceNodeId: doc.nodes[0]!.id,
        targetNodeId: node.id,
        enabled: true,
        purpose: "prompt",
        position: 0,
      });
      await save(doc);
      assert.equal(
        canvas.documentHash,
        digest(inspectCanvasDocument(doc).canonical),
      );
      const before = canvas.revision;
      for (const bad of [
        { ...doc, edges: [{ ...doc.edges[0], sourceNodeId: node.id }] },
        {
          ...doc,
          nodes: [
            ...doc.nodes,
            { ...doc.nodes[0], id: doc.nodes[0]!.id.toUpperCase() },
          ],
        },
        { ...doc, groups: [{ id: doc.nodes[0]!.id, title: "同一标识" }] },
        { ...doc, nodes: [{ ...doc.nodes[0], groupId: randomUUID() }, node] },
        { ...doc, jobs: [{ status: "ready" }] },
      ])
        assert.equal(
          (
            await f.request(
              "PUT",
              route,
              { schemaVersion: 1, document: bad },
              before,
            )
          ).statusCode,
          422,
        );
      assert.equal((await f.ok("GET", route)).revision, before);
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            {
              schemaVersion: 1,
              document: {
                nodes: Array.from({ length: 2001 }, textNode),
                edges: [],
                groups: [],
              },
            },
            before,
          )
        ).statusCode,
        413,
      );
      const huge = Array.from({ length: 80 }, () => ({
        ...textNode(),
        content: { type: "text", text: "字".repeat(20000) },
      }));
      const tooLarge = await f.request(
        "PUT",
        route,
        { schemaVersion: 1, document: { nodes: huge, edges: [], groups: [] } },
        before,
      );
      assert.equal(tooLarge.statusCode, 413, tooLarge.body);
      assert.equal(tooLarge.json().code, "CANVAS_LIMIT_EXCEEDED");
    },
  );
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
    otherVideo = await media();
  const mediaNode: CanvasNode = {
    id: randomUUID(),
    title: "门口素材",
    kind: "video",
    width: 360,
    position: { x: 0, y: 350 },
    content: { type: "media", mediaId: video },
  };
  await t.test(
    "media identity survives deletion; archived media can only remain in its current slot",
    async () => {
      await save({
        ...canvas.document,
        nodes: [...canvas.document.nodes, mediaNode],
      });
      const doc = structuredClone(canvas.document) as CanvasDocument;
      const node = doc.nodes.find((n) => n.id === mediaNode.id)!;
      assert.equal(node.content.type, "media");
      node.content = { type: "media", mediaId: otherVideo };
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            { schemaVersion: 1, document: doc },
            canvas.revision,
          )
        ).statusCode,
        422,
      );
      const withVideo = structuredClone(canvas.document);
      await save({
        ...canvas.document,
        nodes: canvas.document.nodes.filter(
          (n: CanvasNode) => n.id !== mediaNode.id,
        ),
      });
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            { schemaVersion: 1, document: doc },
            canvas.revision,
          )
        ).statusCode,
        422,
      );
      await save(withVideo);
      await transaction(async ({ sql }) => {
        await sql.query(
          "UPDATE media SET status='archived',revision=revision+1 WHERE id=$1",
          [video],
        );
      });
      const moved = structuredClone(canvas.document) as CanvasDocument;
      moved.nodes.find((n) => n.id === mediaNode.id)!.position.x = 500;
      await save(moved);
      const copied = {
        ...moved,
        nodes: [...moved.nodes, { ...mediaNode, id: randomUUID() }],
      };
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            { schemaVersion: 1, document: copied },
            canvas.revision,
          )
        ).statusCode,
        422,
      );
      await save({
        ...canvas.document,
        nodes: canvas.document.nodes.filter(
          (n: CanvasNode) => n.id !== mediaNode.id,
        ),
      });
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            { schemaVersion: 1, document: moved },
            canvas.revision,
          )
        ).statusCode,
        422,
      );
      assert.ok((await count("canvas_media_refs")) > 0);
      const identity = (
        await f.admin.query(
          `SELECT media_id FROM ${f.schema}.canvas_node_index WHERE node_id=$1`,
          [mediaNode.id],
        )
      ).rows[0];
      assert.equal(identity.media_id, video);
    },
  );
  await t.test(
    "fixed revisions require actual media membership and cross-project references fail",
    async () => {
      const foreignProject = await f.createProject("其他项目"),
        foreign = await media(foreignProject.id);
      for (const content of [
        { type: "media", mediaId: foreign },
        { type: "media", mediaId: otherVideo, assetRevisionId: randomUUID() },
      ]) {
        const invalid = {
          ...canvas.document,
          nodes: [
            ...canvas.document.nodes,
            { ...mediaNode, id: randomUUID(), content },
          ],
        };
        const response = await f.request(
          "PUT",
          route,
          { schemaVersion: 1, document: invalid },
          canvas.revision,
        );
        assert.equal(response.statusCode, 422, response.body);
      }
      const wrongRoute = `/v1/tenants/${f.tenant.id}/projects/${foreignProject.id}/canvases/${canvas.id}`;
      assert.equal((await f.request("GET", wrongRoute)).statusCode, 404);
      assert.equal(
        (
          await f.request(
            "PUT",
            wrongRoute,
            { schemaVersion: 1, document: canvas.document },
            canvas.revision,
          )
        ).statusCode,
        404,
      );
    },
  );
  await t.test(
    "preferences use independent zero-based CAS and remain private across members",
    async () => {
      const current = await f.ok("GET", prefPath),
        { sceneId: _scene, revision: _rev, ...body } = current;
      const preference = {
        ...body,
        mode: "canvas",
        selectedNodeIds: [randomUUID()],
        viewport: { x: 44, y: -23, zoom: 0.7 },
      };
      const replies = await Promise.all(
        [0, 1].map(() => f.request("PUT", prefPath, preference, 0)),
      );
      assert.deepEqual(replies.map((r) => r.statusCode).sort(), [200, 412]);
      const saved = await f.ok("GET", prefPath);
      assert.equal(saved.revision, 1);
      assert.equal(saved.mode, "canvas");
      const changed = await f.ok(
        "PUT",
        prefPath,
        { ...preference, mode: "storyboard", assistantOpen: true },
        1,
      );
      assert.equal(changed.revision, 2);
      assert.equal(changed.assistantOpen, true);
      assert.equal((await f.ok("GET", prefPath)).mode, "storyboard");
      assert.equal((await f.ok("GET", route)).revision, canvas.revision);
      const other = await f.identity("canvas-member");
      // Explicit relational membership fixture; authorization still runs in API.
      const memberId = randomUUID();
      await f.admin.query(
        `INSERT INTO ${f.schema}.memberships(id,tenant_id,user_id,role,status) VALUES($1,$2,$3,'member','active')`,
        [memberId, f.tenant.id, other.userId],
      );
      await f.admin.query(
        `INSERT INTO ${f.schema}.project_memberships(id,project_id,membership_id,tenant_id,role) VALUES($1,$2,$3,$4,'collaborator')`,
        [randomUUID(), f.project.id, memberId, f.tenant.id],
      );
      const their = await f.request(
        "GET",
        prefPath,
        undefined,
        undefined,
        randomUUID(),
        other,
      );
      assert.equal(their.statusCode, 200, their.body);
      assert.equal(their.json().revision, 0);
      assert.equal(their.json().mode, "storyboard");
      const privateRows = await db.transaction(
        other.token,
        { tenantId: f.tenant.id, projectId: f.project.id, write: false },
        async ({ sql }) =>
          (await sql.query("SELECT * FROM scene_workspace_preferences"))
            .rowCount,
      );
      assert.equal(privateRows, 0);
      const enterKey = randomUUID();
      assert.equal(
        (
          await f.request(
            "POST",
            scenePath,
            undefined,
            undefined,
            enterKey,
            other,
          )
        ).statusCode,
        200,
      );
      await f.admin.query(
        `DELETE FROM ${f.schema}.project_memberships WHERE project_id=$1 AND membership_id=$2`,
        [f.project.id, memberId],
      );
      assert.equal(
        (
          await f.request(
            "POST",
            scenePath,
            undefined,
            undefined,
            enterKey,
            other,
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await f.request(
            "GET",
            route,
            undefined,
            undefined,
            randomUUID(),
            other,
          )
        ).statusCode,
        404,
      );
    },
  );
  await t.test(
    "database guards reject forged roots, projections and node identities",
    async () => {
      await assert.rejects(
        transaction(async ({ sql }) =>
          sql.query("UPDATE canvases SET revision=revision+1 WHERE id=$1", [
            canvas.id,
          ]),
        ),
        (e: any) => e.code === "23514",
      );
      await assert.rejects(
        transaction(async ({ sql }) =>
          sql.query(
            "DELETE FROM canvas_revisions WHERE canvas_id=$1 AND revision=$2",
            [canvas.id, canvas.revision],
          ),
        ),
        (e: any) => e.code === "23514",
      );
      await assert.rejects(
        transaction(async ({ sql }) =>
          sql.query(
            "INSERT INTO canvas_node_index(tenant_id,project_id,canvas_id,node_id,kind,content_type) VALUES($1,$2,$3,$4,'text','text')",
            [f.tenant.id, f.project.id, canvas.id, randomUUID()],
          ),
        ),
        (e: any) => e.code === "P0425",
      );
      await assert.rejects(
        transaction(async ({ sql }) =>
          sql.query(
            "INSERT INTO canvas_media_refs(tenant_id,project_id,canvas_id,body_hash,node_id,media_id) VALUES($1,$2,$3,$4,$5,$6)",
            [
              f.tenant.id,
              f.project.id,
              canvas.id,
              canvas.documentHash,
              randomUUID(),
              otherVideo,
            ],
          ),
        ),
        (e: any) => e.code === "P0425",
      );
      const second = await f.request(
        "POST",
        `${f.path}/scenes/${secondScene.id}/canvas`,
      );
      assert.equal(second.statusCode, 200, second.body);
      const foreignNode = canvas.document.nodes[0];
      const response = await f.request(
        "PUT",
        `${f.path}/canvases/${second.json().canvas.id}`,
        {
          schemaVersion: 1,
          document: { nodes: [foreignNode], edges: [], groups: [] },
        },
        1,
      );
      assert.equal(response.statusCode, 422, response.body);
      const history = await f.ok("GET", `${route}/revisions?limit=1`);
      assert.equal(
        (
          await f.request(
            "GET",
            `${f.path}/canvases/${second.json().canvas.id}/revisions?cursor=${encodeURIComponent(history.nextCursor)}`,
          )
        ).statusCode,
        422,
      );
    },
  );
  await t.test(
    "recent history is bounded and expired bodies are pruned under the canvas lock",
    async () => {
      const body = structuredClone(canvas.document) as CanvasDocument;
      const first = body.nodes[0]!;
      const started = performance.now();
      for (let i = 0; i < 103; i++) {
        first.title = `恢复点 ${i}`;
        await save(body);
      }
      const history = await f.ok("GET", `${route}/revisions?limit=100`);
      assert.ok(history.items.length <= 100);
      assert.equal(history.latestRevision, canvas.revision);
      assert.equal(
        (await f.request("GET", `${route}/revisions/1`)).statusCode,
        410,
      );
      assert.equal(
        (await f.ok("GET", `${route}/revisions/${canvas.revision - 1}`))
          .revision,
        canvas.revision - 1,
      );
      assert.ok((await count("canvas_revisions")) <= 102); // includes the second canvas.
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*) FROM ${f.schema}.canvas_history_bodies WHERE canvas_id=$1 AND hash NOT IN (SELECT body_hash FROM ${f.schema}.canvas_revisions WHERE canvas_id=$1)`,
            [canvas.id],
          )
        ).rows[0].count,
        "0",
      );
      t.diagnostic(
        `103 API saves and history pruning: ${Math.round(performance.now() - started)} ms (local fixture, not browser performance acceptance)`,
      );
    },
  );
  await t.test(
    "document capacity round-trips through the real API without relaxing authorization",
    async () => {
      for (const size of [300, 2000]) {
        const nodes: CanvasNode[] = Array.from({ length: size }, (_, i) =>
          i < size / 2
            ? {
                ...textNode(),
                title: `参考 ${i}`,
                position: { x: i * 20, y: 0 },
              }
            : {
                id: randomUUID(),
                title: `画面 ${i}`,
                width: 280,
                position: { x: i * 20, y: 400 },
                kind: "image",
                content: { type: "draft", prompt: "", output: {} },
              },
        );
        const edges = Array.from(
          { length: size === 300 ? 500 : 5000 },
          (_, i) => ({
            id: randomUUID(),
            sourceNodeId: nodes[i % (size / 2)]!.id,
            targetNodeId: nodes[(i % (size / 2)) + size / 2]!.id,
            purpose: "prompt" as const,
            position: i,
            enabled: true,
          }),
        );
        const started = performance.now();
        await save({ nodes, edges, groups: [] });
        assert.equal((await f.ok("GET", route)).document.nodes.length, size);
        t.diagnostic(
          `${size} nodes/${edges.length} edges save/read: ${Math.round(performance.now() - started)} ms; API fixture only`,
        );
      }
      const nodes: CanvasNode[] = Array.from({ length: 2000 }, (_, i) => ({
        ...mediaNode,
        id: randomUUID(),
        title: `素材呈现 ${i}`,
        content: { type: "media", mediaId: otherVideo },
      }));
      const started = performance.now();
      await save({ nodes, edges: [], groups: [] });
      assert.equal((await f.ok("GET", route)).document.nodes.length, 2000);
      t.diagnostic(
        `2000 authorized media nodes save/read: ${Math.round(performance.now() - started)} ms; no browser decoder acceptance`,
      );
    },
  );
});
