import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { CanvasDocument } from "@drama/domain";
import {
  createCanvasDraft,
  prepareCanvasCreation,
} from "../apps/web/src/business/canvas-creation.js";

const fixture = (): CanvasDocument => ({
  nodes: [
    {
      id: randomUUID(),
      kind: "text",
      title: "动作说明",
      position: { x: 10, y: 20 },
      width: 320,
      content: { type: "text", text: "先看向门，再放下钥匙" },
    },
    {
      id: randomUUID(),
      kind: "image",
      title: "固定角色",
      position: { x: 400, y: 60 },
      width: 360,
      content: {
        type: "media",
        mediaId: randomUUID(),
        assetRevisionId: randomUUID(),
      },
    },
  ],
  edges: [],
  groups: [],
});
test("continuing creates one independent draft with ordered explicit sources and retains originals", () => {
  const original = fixture(),
    before = structuredClone(original),
    ids = original.nodes.map((node) => node.id);
  const intent = prepareCanvasCreation(original, ids);
  const changed = createCanvasDraft(original, intent, "video"),
    node = changed.nodes.at(-1)!;
  assert.deepEqual(original, before);
  assert.deepEqual(changed.nodes.slice(0, -1), before.nodes);
  assert.equal(node.kind, "video");
  assert.equal(node.content.type, "draft");
  assert.equal(node.groupId, undefined);
  assert.deepEqual(
    changed.edges.map((edge) => [
      edge.sourceNodeId,
      edge.targetNodeId,
      edge.purpose,
      edge.position,
    ]),
    [
      [ids[0], node.id, "prompt", 0],
      [ids[1], node.id, "composition", 1],
    ],
  );
  assert.throws(() => createCanvasDraft(changed, intent, "video"), /已创建/);
});
test("source selection is pinned while unrelated layout/content can advance", () => {
  const original = fixture(),
    intent = prepareCanvasCreation(original, [original.nodes[0]!.id]);
  const moved = structuredClone(original);
  moved.nodes[0]!.position.x += 100;
  moved.nodes[1]!.title = "另一份内容的新名称";
  assert.equal(
    createCanvasDraft(moved, intent, "image").nodes[1]!.title,
    "另一份内容的新名称",
  );
  const changed = structuredClone(original);
  changed.nodes[0]!.content = { type: "text", text: "另一个动作" };
  assert.throws(
    () => createCanvasDraft(changed, intent, "image"),
    /来源已修改/,
  );
  assert.throws(
    () =>
      createCanvasDraft(
        { ...original, nodes: original.nodes.slice(1) },
        intent,
        "audio",
      ),
    /来源已修改/,
  );
});
test("unfinished outputs and canvas capacity cannot be bypassed by continued creation", () => {
  const original = fixture();
  const draft = createCanvasDraft(
    original,
    prepareCanvasCreation(original, [original.nodes[0]!.id]),
    "audio",
  ).nodes.at(-1)!;
  assert.throws(
    () => prepareCanvasCreation({ ...original, nodes: [draft] }, [draft.id]),
    /未完成的草稿/,
  );
  const full = {
    ...original,
    nodes: Array.from({ length: 2000 }, () => ({
      ...original.nodes[0]!,
      id: randomUUID(),
    })),
  };
  const intent = prepareCanvasCreation(full, [full.nodes[0]!.id]);
  assert.throws(() => createCanvasDraft(full, intent, "video"), /容量限制/);
  assert.equal(full.nodes.length, 2000);
});

test("a continued draft is sized for the project's shape; audio keeps its fixed width", () => {
  const original = fixture(),
    intent = prepareCanvasCreation(original, [original.nodes[0]!.id]);
  const portrait = { width: 9, height: 16 };
  assert.equal(createCanvasDraft(original, intent, "video", portrait).nodes[2]!.width, 270);
  assert.equal(createCanvasDraft(original, intent, "image", portrait).nodes[2]!.width, 270);
  assert.equal(createCanvasDraft(original, intent, "audio", portrait).nodes[2]!.width, 360);
  assert.equal(createCanvasDraft(original, intent, "video").nodes[2]!.width, 360);
});
