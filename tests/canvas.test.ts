import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  inspectCanvasDocument,
  canvasNodeIdentity,
  CanvasDocumentError,
  type CanvasDocument,
  type CanvasNode,
} from "@drama/domain";

const textNode = (): CanvasNode => ({
  id: randomUUID(),
  kind: "text",
  title: "说明",
  position: { x: 0, y: 0 },
  width: 280,
  content: { type: "text", text: "前景是窗框" },
});
test("canvas accepts incomplete drafts and uses stable portable document hashes", () => {
  const source = textNode(),
    target: CanvasNode = {
      id: randomUUID(),
      title: "画面探索",
      kind: "image",
      width: 360,
      position: { x: 400, y: 0 },
      content: { type: "draft", prompt: "", output: {} },
    };
  const doc: CanvasDocument = {
    nodes: [source, target],
    groups: [],
    edges: [
      {
        id: randomUUID(),
        sourceNodeId: source.id,
        targetNodeId: target.id,
        enabled: true,
        position: 0,
        purpose: "prompt",
      },
    ],
  };
  const inspected = inspectCanvasDocument(doc);
  assert.equal(inspected.bytes, Buffer.byteLength(inspected.canonical));
  assert.equal(
    inspected.canonical,
    inspectCanvasDocument({ groups: [], edges: doc.edges, nodes: doc.nodes })
      .canonical,
  );
  const changed = structuredClone(target);
  changed.title = "另一个标题";
  changed.position.x = 600;
  assert.deepEqual(canvasNodeIdentity(changed), canvasNodeIdentity(target));
  assert.throws(
    () =>
      inspectCanvasDocument({
        ...doc,
        edges: [
          {
            ...doc.edges[0]!,
            sourceNodeId: target.id,
            targetNodeId: source.id,
          },
        ],
      }),
    CanvasDocumentError,
  );
  assert.throws(
    () =>
      inspectCanvasDocument({
        ...doc,
        edges: [{ ...doc.edges[0]!, purpose: "identity" }],
      }),
    CanvasDocumentError,
  );
  assert.throws(
    () =>
      inspectCanvasDocument({
        ...doc,
        groups: [{ id: source.id.toUpperCase(), title: "冲突标识" }],
      }),
    CanvasDocumentError,
  );
  assert.throws(
    () =>
      inspectCanvasDocument({
        ...doc,
        nodes: [{ ...source, groupId: randomUUID() }, target],
      }),
    CanvasDocumentError,
  );
});
test("canvas rejects nonfinite coordinates and measures UTF-8 capacity without interpreting plain text", () => {
  const node = textNode();
  const doc: CanvasDocument = { nodes: [node], groups: [], edges: [] };
  node.content = { type: "text", text: "<script>literal</script> \\u0000" };
  assert.ok(inspectCanvasDocument(doc).canonical.includes("<script>"));
  node.content.text = "bad\0text";
  assert.throws(() => inspectCanvasDocument(doc), /空字符/);
  node.content.text = "字".repeat(20000);
  node.position.x = Infinity;
  assert.throws(() => inspectCanvasDocument(doc), CanvasDocumentError);
  node.position.x = 0;
  assert.throws(
    () =>
      inspectCanvasDocument({
        ...doc,
        nodes: Array.from({ length: 80 }, () => ({
          ...node,
          id: randomUUID(),
        })),
      }),
    (e: unknown) =>
      e instanceof CanvasDocumentError && e.code === "CANVAS_LIMIT_EXCEEDED",
  );
  assert.throws(
    () =>
      inspectCanvasDocument({
        ...doc,
        nodes: Array.from({ length: 2001 }, textNode),
      }),
    (e: unknown) =>
      e instanceof CanvasDocumentError && e.code === "CANVAS_LIMIT_EXCEEDED",
  );
});
