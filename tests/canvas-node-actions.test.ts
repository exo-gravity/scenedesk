import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { CanvasDocument } from "@drama/domain";
import {
  COPY_NODE,
  COPY_VARIANT,
  COPY_WITH_EDGES,
  assignCanvasGroup,
  copyCanvasNodes,
  hasInternalEdges,
  normalizeCanvasTitle,
  renameCanvasNode,
  updateCanvasNodeGeometry,
} from "../apps/web/src/business/canvas-node-actions.js";

// 固定的 id 生成器：让连线端点的断言可以直接对照。
const ids = (() => {
  let n = 0;
  return () => `copy-${(n += 1)}`;
})();

const fixture = (): CanvasDocument => {
  const reference = randomUUID();
  const draft = randomUUID();
  const downstream = randomUUID();
  return {
    nodes: [
      {
        id: reference,
        kind: "image",
        title: "固定参考",
        position: { x: 0, y: 0 },
        width: 320,
        content: {
          type: "media",
          mediaId: randomUUID(),
          assetRevisionId: randomUUID(),
        },
      },
      {
        id: draft,
        kind: "video",
        title: "拿起旧钥匙",
        position: { x: 400, y: 0 },
        width: 360,
        content: {
          type: "draft",
          prompt: "保持灰风衣与桌面位置",
          output: {},
        },
      },
      {
        id: downstream,
        kind: "video",
        title: "下游草稿",
        position: { x: 800, y: 0 },
        width: 360,
        content: { type: "draft", prompt: "下游", output: {} },
      },
    ],
    edges: [
      {
        id: randomUUID(),
        sourceNodeId: reference,
        targetNodeId: draft,
        enabled: true,
        position: 0,
        purpose: "composition",
      },
      {
        id: randomUUID(),
        sourceNodeId: draft,
        targetNodeId: downstream,
        enabled: true,
        position: 0,
        purpose: "prompt",
      },
    ],
    groups: [],
  };
};

test("复制节点只新增节点，不搬运任何连线，也不改原文档", () => {
  const original = fixture();
  const before = structuredClone(original);
  const draft = original.nodes.find((node) => node.kind === "video")!;
  const result = copyCanvasNodes(original, [draft.id], COPY_NODE, ids);
  assert.deepEqual(original, before);
  assert.equal(result.document.nodes.length, 4);
  assert.equal(result.document.edges.length, 2);
  assert.equal(result.nodeIds.length, 1);
  const copy = result.document.nodes.at(-1)!;
  assert.equal(copy.title, draft.title);
  assert.notEqual(copy.id, draft.id);
  assert.deepEqual(copy.position, { x: draft.position.x + 48, y: draft.position.y + 48 });
});

test("复制节点和连线保留所选集合内部的连线，不牵连集合外的连线", () => {
  const original = fixture();
  const [reference, draft] = original.nodes;
  const result = copyCanvasNodes(
    original,
    [reference!.id, draft!.id],
    COPY_WITH_EDGES,
    ids,
  );
  assert.equal(result.document.nodes.length, 5);
  assert.equal(result.document.edges.length, 3);
  const [referenceCopy, draftCopy] = result.nodeIds;
  const added = result.document.edges.at(-1)!;
  assert.deepEqual(
    [added.sourceNodeId, added.targetNodeId],
    [referenceCopy, draftCopy],
  );
  // 指向集合外下游的那条连线没有被复制，也没有改指向。
  assert.equal(
    result.document.edges.filter((edge) => edge.targetNodeId === original.nodes[2]!.id).length,
    1,
  );
});

test("创建副本克隆草稿参数、重指上游参考连线，并且不继承生成任务与镜头绑定", () => {
  const original = fixture();
  const before = structuredClone(original);
  const draft = original.nodes[1]!;
  const result = copyCanvasNodes(original, [draft.id], COPY_VARIANT, ids);
  assert.deepEqual(original, before, "原文档不能被修改");
  const copy = result.document.nodes.at(-1)!;
  assert.equal(copy.title, "拿起旧钥匙 副本");
  assert.equal(copy.content.type, "draft");
  assert.equal(
    copy.content.type === "draft" ? copy.content.prompt : null,
    draft.content.type === "draft" ? draft.content.prompt : null,
  );
  // 上游连线指向副本；源节点仍是原来的固定参考，没有被改动。
  const added = result.document.edges.at(-1)!;
  assert.equal(added.sourceNodeId, original.nodes[0]!.id);
  assert.equal(added.targetNodeId, copy.id);
  // 下游连线不复制：否则会静默改写既有草稿的输入。
  assert.equal(result.document.edges.length, original.edges.length + 1);
  // 新 id 不在任何既有连线上 —— 画布计划来源、镜头绑定与采用事实都按 nodeId 归属，
  // 因此副本天然不继承它们。
  assert.equal(
    original.edges.some(
      (edge) => edge.sourceNodeId === copy.id || edge.targetNodeId === copy.id,
    ),
    false,
  );
});

test("复制出来的节点不进入原分组，且沿用同一份素材引用", () => {
  const original = fixture();
  const reference = original.nodes[0]!;
  const grouped: CanvasDocument = {
    ...original,
    groups: [{ id: randomUUID(), title: "分组 1" }],
    nodes: original.nodes.map((node) =>
      node.id === reference.id ? { ...node, groupId: "g1" } : node,
    ),
  };
  grouped.groups[0]!.id = "g1";
  const result = copyCanvasNodes(grouped, [reference.id], COPY_NODE, ids);
  const copy = result.document.nodes.at(-1)!;
  assert.equal(copy.groupId, undefined);
  assert.equal(copy.content.type, "media");
  assert.equal(
    copy.content.type === "media" ? copy.content.mediaId : null,
    reference.content.type === "media" ? reference.content.mediaId : null,
  );
});

test("所选为空时拒绝复制，且拒绝时不产生半成品文档", () => {
  const original = fixture();
  assert.throws(() => copyCanvasNodes(original, [], COPY_NODE, ids), /请先选择/);
  assert.throws(
    () => copyCanvasNodes(original, [randomUUID()], COPY_NODE, ids),
    /请先选择/,
  );
});

test("hasInternalEdges 只认两端都在所选集合里的连线", () => {
  const original = fixture();
  const [reference, draft, downstream] = original.nodes;
  assert.equal(hasInternalEdges(original, [reference!.id, draft!.id]), true);
  assert.equal(hasInternalEdges(original, [draft!.id, downstream!.id]), true);
  assert.equal(hasInternalEdges(original, [reference!.id]), false);
  assert.equal(
    hasInternalEdges(original, [reference!.id, downstream!.id]),
    false,
  );
});

test("重命名只改名称：去空白、拒绝空名与超长名、名称未变时不产生新文档", () => {
  const original = fixture();
  const draft = original.nodes[1]!;
  const renamed = renameCanvasNode(original, draft.id, "  拿起旧钥匙 · 近景  ");
  const node = renamed.nodes.find((item) => item.id === draft.id)!;
  assert.equal(node.title, "拿起旧钥匙 · 近景");
  assert.equal(renamed.nodes.length, original.nodes.length);
  assert.deepEqual(renamed.edges, original.edges);
  assert.equal(
    renameCanvasNode(original, draft.id, draft.title),
    original,
    "名称没变时应当返回原文档，不制造一次空提交",
  );
  assert.throws(() => renameCanvasNode(original, draft.id, "   "), /请填写/);
  assert.throws(
    () => renameCanvasNode(original, draft.id, "字".repeat(161)),
    /请填写/,
  );
  assert.throws(
    () => renameCanvasNode(original, randomUUID(), "新的名字"),
    /已不在画布上/,
  );
});

test("normalizeCanvasTitle 接受 160 字、拒绝空与 161 字", () => {
  assert.equal(normalizeCanvasTitle("  a  "), "a");
  assert.equal(normalizeCanvasTitle("字".repeat(160))?.length, 160);
  assert.equal(normalizeCanvasTitle(""), null);
  assert.equal(normalizeCanvasTitle("   "), null);
  assert.equal(normalizeCanvasTitle("字".repeat(161)), null);
});

test("几何编辑把宽度夹在画布限制内，只改目标节点", () => {
  const original = fixture();
  const [first, second] = original.nodes;
  const moved = updateCanvasNodeGeometry(original, first!.id, {
    x: 40,
    width: 2000,
  });
  assert.deepEqual(moved.nodes[0]!.position, { x: 40, y: 0 });
  assert.equal(moved.nodes[0]!.width, 1600);
  assert.deepEqual(moved.nodes[1], second);
  assert.equal(
    updateCanvasNodeGeometry(original, first!.id, { width: 12 }).nodes[0]!
      .width,
    120,
  );
  assert.equal(updateCanvasNodeGeometry(original, first!.id, {}), original);
  assert.throws(
    () => updateCanvasNodeGeometry(original, randomUUID(), { x: 1 }),
    /已不在画布上/,
  );
});

test("节点只按分组 id 加入或退出分组，不存在的分组被拒绝", () => {
  const original = fixture();
  const grouped: CanvasDocument = {
    ...original,
    groups: [{ id: "g1", title: "第一组" }],
  };
  const node = original.nodes[0]!;
  const joined = assignCanvasGroup(grouped, [node.id], "g1");
  assert.equal(joined.nodes[0]!.groupId, "g1");
  const left = assignCanvasGroup(joined, [node.id], null);
  assert.equal("groupId" in left.nodes[0]!, false);
  assert.throws(() => assignCanvasGroup(grouped, [node.id], "nope"), /分组/);
  assert.equal(assignCanvasGroup(grouped, [node.id], null), grouped);
});
