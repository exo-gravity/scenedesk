import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendCanvasReference } from "../apps/web/src/business/canvas-reference.js";
import type { CanvasDocument } from "@drama/domain";
import {
  canvasChanges,
  replayCanvasChanges,
} from "../apps/web/src/business/canvas-reconcile.js";

function fixture(): CanvasDocument {
  const groupId = randomUUID();
  const nodes: CanvasDocument["nodes"] = [
    {
      id: randomUUID(),
      title: "构图说明",
      kind: "text",
      position: { x: 0, y: 0 },
      width: 280,
      content: { type: "text", text: "共同基线" },
      groupId,
    },
    {
      id: randomUUID(),
      title: "图像探索",
      kind: "image",
      position: { x: 400, y: 0 },
      width: 360,
      content: {
        type: "draft",
        prompt: "窗边",
        output: { aspectRatio: "16:9" },
      },
      groupId,
    },
  ];
  return {
    nodes,
    groups: [{ id: groupId, title: "第一组" }],
    edges: [
      {
        id: randomUUID(),
        sourceNodeId: nodes[0]!.id,
        targetNodeId: nodes[1]!.id,
        position: 0,
        purpose: "prompt",
        enabled: true,
      },
    ],
  };
}

test("explicit reference append preserves each draft's fixed input order and rejects duplicates", () => {
  const base = fixture(),
    first = base.edges[0]!;
  const peer = {
    ...first,
    id: randomUUID(),
    targetNodeId: randomUUID(),
    position: 400,
  };
  const edges = [{ ...first, position: 4999 }, peer];
  const added = { ...first, id: randomUUID(), sourceNodeId: randomUUID() };
  const result = appendCanvasReference(edges, added);
  assert.equal(result[0]!.position, 0);
  assert.equal(result[1], peer);
  assert.equal(result[2]!.position, 1);
  assert.equal(edges[0]!.position, 4999);
  assert.throws(
    () => appendCanvasReference(result, { ...added, id: randomUUID() }),
    /已在参考中/,
  );
  const afterDeletion = appendCanvasReference([{ ...first, position: 7 }], {
    ...added,
    id: randomUUID(),
  });
  assert.equal(afterDeletion[1]!.position, 8);
});
test("canvas replay changes only selected objects and preserves peer additions and input order", () => {
  const base = fixture(),
    local = structuredClone(base),
    remote = structuredClone(base);
  local.nodes[0]!.title = "我的说明";
  remote.nodes[0]!.title = "同伴的说明";
  remote.nodes[1]!.position.x = 800;
  remote.nodes.push({
    ...remote.nodes[0]!,
    id: randomUUID(),
    title: "同伴新内容",
  });
  remote.edges[0]!.position = 7;
  const changes = canvasChanges(base, local, remote);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.sharedChange, true);
  assert.deepEqual(replayCanvasChanges(base, local, remote, new Set()), remote);
  const merged = replayCanvasChanges(
    base,
    local,
    remote,
    new Set([changes[0]!.key]),
  );
  assert.equal(merged.nodes[0]!.title, "我的说明");
  assert.equal(merged.nodes[1]!.position.x, 800);
  assert.equal(merged.nodes[2]!.title, "同伴新内容");
  assert.deepEqual(merged.edges, remote.edges);
  assert.equal(remote.nodes[0]!.title, "同伴的说明");
});
test("canvas node and group removal requires explicit related reference choices", () => {
  const base = fixture(),
    local = structuredClone(base),
    remote = structuredClone(base);
  const removed = local.nodes.shift()!;
  local.edges = [];
  assert.throws(
    () =>
      replayCanvasChanges(
        base,
        local,
        remote,
        new Set([`nodes:${removed.id}`]),
      ),
    /端点不存在/,
  );
  assert.deepEqual(
    replayCanvasChanges(
      base,
      local,
      remote,
      new Set(canvasChanges(base, local, remote).map((c) => c.key)),
    ),
    local,
  );
  local.groups = [];
  local.nodes = local.nodes.map(({ groupId: _group, ...node }) => node);
  assert.throws(
    () =>
      replayCanvasChanges(
        base,
        local,
        remote,
        new Set([`groups:${base.groups[0]!.id}`]),
      ),
    /分组不存在/,
  );
  assert.deepEqual(
    replayCanvasChanges(
      base,
      local,
      remote,
      new Set(canvasChanges(base, local, remote).map((c) => c.key)),
    ),
    local,
  );
  assert.throws(
    () =>
      replayCanvasChanges(base, local, remote, new Set(["nodes:unreviewed"])),
    /不属于当前比较/,
  );
});
