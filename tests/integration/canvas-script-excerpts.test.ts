import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { businessFixture } from "../support/business.js";
import { Database } from "../../apps/api/src/kernel/database.js";
import { canvasDraftInput } from "../../apps/api/src/modules/generation/canvas-context.js";
import { appendCanvas } from "../../apps/api/src/modules/canvas/model.js";

test("fixed script selections append once, retain tombstone receipts and reject drift, CAS and revoked authority", async (t) => {
  const f = await businessFixture(t);
  const script = await f.ok(
    "POST",
    `${f.path}/scripts`,
    { text: "前😀她推开门。\n他在雨中。" },
    await f.next(),
  );
  const ensured = await f.request("POST", `${f.path}/canvas`);
  assert.equal(ensured.statusCode, 200, ensured.body);
  let canvas = ensured.json().canvas;
  const route = `${f.path}/canvases/${canvas.id}`,
    endpoint = `${route}/script-excerpts`;
  const sourceExcerpt = {
    scriptRevisionId: script.id,
    range: { startOffset: 1, endOffset: 7 },
    quote: "😀她推开门。",
  };
  const input = {
      nodeId: randomUUID(),
      sourceExcerpt,
      position: { x: 80, y: 80 },
    },
    key = randomUUID();
  const replies = await Promise.all([
    f.request("POST", endpoint, input, 1, key),
    f.request("POST", endpoint, input, 1),
  ]);
  for (const r of replies) assert.equal(r.statusCode, 200, r.body);
  canvas = await f.ok("GET", route);
  assert.equal(canvas.document.nodes.length, 1);
  assert.equal(canvas.revision, 2);
  assert.deepEqual(
    canvas.document.nodes[0].content.sourceExcerpt,
    sourceExcerpt,
  );
  const check = `${endpoint}/${input.nodeId}`;
  assert.equal((await f.ok("GET", check)).nodeActive, true);
  assert.equal((await f.tree()).scenes.length, 0);
  await f.ok(
    "POST",
    `${f.path}/scripts`,
    { text: "新版：所有人离开。" },
    await f.next(),
  );
  assert.deepEqual((await f.ok("GET", check)).sourceExcerpt, sourceExcerpt);

  const conflict = await f.request(
    "POST",
    endpoint,
    { ...input, nodeId: randomUUID() },
    1,
  );
  assert.equal(conflict.statusCode, 412, conflict.body);
  const wrong = await f.request(
    "POST",
    endpoint,
    {
      ...input,
      nodeId: randomUUID(),
      sourceExcerpt: { ...sourceExcerpt, quote: "伪造" },
    },
    canvas.revision,
  );
  assert.equal(wrong.statusCode, 422, wrong.body);
  const other = await f.createProject("另一个剧本项目"),
    otherPath = `/v1/tenants/${f.tenant.id}/projects/${other.id}`;
  const otherScript = await f.ok(
    "POST",
    `${otherPath}/scripts`,
    { text: sourceExcerpt.quote },
    1,
  );
  assert.equal(
    (
      await f.request(
        "POST",
        endpoint,
        {
          ...input,
          nodeId: randomUUID(),
          sourceExcerpt: { ...sourceExcerpt, scriptRevisionId: otherScript.id },
        },
        canvas.revision,
      )
    ).statusCode,
    422,
  );

  // SQL protects provenance even when callers bypass the API schema/service helper.
  const db = new Database(f.runtime, f.schema);
  const mutate = async (node: any) =>
    db.transaction(
      f.owner.token,
      { tenantId: f.tenant.id, projectId: f.project.id, write: true },
      (tx) =>
        appendCanvas(
          tx,
          canvas.id,
          { nodes: [node], edges: [], groups: [] },
          canvas.revision + 1,
        ),
    );
  const draftNode = {
    id: randomUUID(),
    kind: "image" as const,
    title: "下一张画面",
    width: 320,
    position: { x: 450, y: 80 },
    content: { type: "draft" as const, prompt: "保留原文的夜雨", output: {} },
  };
  canvas = await f.ok(
    "PUT",
    route,
    {
      schemaVersion: 1,
      document: {
        ...canvas.document,
        nodes: [...canvas.document.nodes, draftNode],
        edges: [
          {
            id: randomUUID(),
            sourceNodeId: input.nodeId,
            targetNodeId: draftNode.id,
            enabled: true,
            position: 0,
            purpose: "prompt",
          },
        ],
      },
    },
    canvas.revision,
  );
  const snapshot = await db.transaction(
    f.owner.token,
    { tenantId: f.tenant.id, projectId: f.project.id, write: false },
    (tx) =>
      canvasDraftInput(
        tx,
        {
          kind: "canvas_draft",
          objectId: draftNode.id,
          revision: canvas.revision,
        },
        true,
      ),
  );
  assert.deepEqual(
    JSON.parse(snapshot.snapshot.text).inputs[0].content.sourceExcerpt,
    sourceExcerpt,
    "generation fixes the original script reference even after the current manuscript changes",
  );
  const node = canvas.document.nodes[0];
  await assert.rejects(
    mutate({ ...node, content: { type: "text", text: node.content.text } }),
  );
  await assert.rejects(
    mutate({
      ...node,
      content: {
        ...node.content,
        sourceExcerpt: {
          ...sourceExcerpt,
          range: { startOffset: 0, endOffset: 6 },
        },
      },
    }),
  );
  await assert.rejects(
    mutate({
      ...node,
      id: randomUUID(),
      content: {
        ...node.content,
        sourceExcerpt: { ...sourceExcerpt, scriptRevisionId: otherScript.id },
      },
    }),
  );
  const changedText = await f.request(
    "PUT",
    route,
    {
      schemaVersion: 1,
      document: {
        ...canvas.document,
        nodes: [{ ...node, content: { ...node.content, text: "改写原文" } }],
      },
    },
    canvas.revision,
  );
  assert.equal(changedText.statusCode, 422, changedText.body);
  canvas = await f.ok(
    "PUT",
    route,
    { schemaVersion: 1, document: { nodes: [], edges: [], groups: [] } },
    canvas.revision,
  );
  assert.equal((await f.ok("GET", check)).nodeActive, false);
  const replay = await f.request("POST", endpoint, input, 1, key);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(
    replay.json().nodeActive,
    false,
    "cached success must not resurrect deleted nodes",
  );
  assert.equal((await f.ok("GET", route)).revision, canvas.revision);
  const retarget = await f.request(
    "POST",
    endpoint,
    { ...input, sourceExcerpt: { ...sourceExcerpt, quote: "别的选文" } },
    canvas.revision,
  );
  assert.equal(retarget.statusCode, 409, retarget.body);
  const outsider = await f.identity("excerpt-outsider");
  assert.equal(
    (await f.request("GET", check, undefined, undefined, undefined, outsider))
      .statusCode,
    404,
  );
  const member = await f.identity("excerpt-member"),
    membership = randomUUID();
  await f.admin.query(
    `INSERT INTO ${f.schema}.memberships(id,tenant_id,user_id,role,status) VALUES($1,$2,$3,'member','active')`,
    [membership, f.tenant.id, member.userId],
  );
  await f.admin.query(
    `INSERT INTO ${f.schema}.project_memberships(id,tenant_id,project_id,membership_id,role) VALUES($1,$2,$3,$4,'collaborator')`,
    [randomUUID(), f.tenant.id, f.project.id, membership],
  );
  const memberKey = randomUUID();
  assert.equal(
    (await f.request("POST", endpoint, input, 1, memberKey, member)).statusCode,
    200,
  );
  await f.admin.query(
    `DELETE FROM ${f.schema}.project_memberships WHERE membership_id=$1`,
    [membership],
  );
  assert.equal(
    (await f.request("POST", endpoint, input, 1, memberKey, member)).statusCode,
    404,
  );
  const project = await f.ok("GET", f.path);
  const archived = await f.request(
    "POST",
    `${f.path}/archive`,
    undefined,
    project.revision,
  );
  assert.equal(archived.statusCode, 201, archived.body);
  assert.equal(
    (await f.request("POST", endpoint, input, 1, key)).statusCode,
    409,
  );
  assert.equal(
    (await f.ok("GET", check)).nodeActive,
    false,
    "archived work remains readable",
  );
});
