import type { FastifyInstance } from "fastify";
import type { Transaction } from "../../kernel/database.js";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import { requireThat, versionMatches } from "../../kernel/errors.js";
import { canonical } from "../../kernel/crypto.js";
import type { Schema } from "../content/model.js";
import { appendCanvas, canvasRoot, readCanvas } from "./model.js";

async function receipt(
  tx: Transaction,
  canvasId: string,
  nodeId: string,
): Promise<Schema<"CanvasScriptExcerptReceipt"> | undefined> {
  const row = (
    await tx.sql.query(
      "SELECT source_excerpt FROM canvas_node_index WHERE tenant_id=$1 AND project_id=$2 AND canvas_id=$3 AND node_id=$4",
      [tx.tenantId, tx.projectId, canvasId, nodeId],
    )
  ).rows[0];
  if (!row?.source_excerpt) return undefined;
  const canvas = await readCanvas(tx, canvasId);
  return {
    canvasId,
    nodeId,
    sourceExcerpt: row.source_excerpt,
    nodeActive: canvas.document.nodes.some(
      (node) => node.id.toLowerCase() === nodeId,
    ),
  };
}
export function canvasScriptExcerptRoutes(
  app: FastifyInstance,
  context: ApiContext,
) {
  registerAction(app, context, "getCanvasScriptExcerpt", async (tx, input) => {
    await canvasRoot(tx, input.params.canvasId!);
    const body = await receipt(
      tx,
      input.params.canvasId!,
      input.params.nodeId!,
    );
    requireThat(body, 404, "NOT_FOUND", "尚未找到这次选文添加记录。");
    return { body };
  });
  registerAction(
    app,
    context,
    "placeCanvasScriptExcerpt",
    async (tx, input) => {
      const canvasId = input.params.canvasId!,
        body = input.body as Schema<"PlaceCanvasScriptExcerpt">;
      const nodeId = body.nodeId.toLowerCase();
      const sourceExcerpt = {
        ...body.sourceExcerpt,
        scriptRevisionId: body.sourceExcerpt.scriptRevisionId.toLowerCase(),
      };
      await canvasRoot(tx, canvasId, true);
      const existing = await receipt(tx, canvasId, nodeId);
      if (existing) {
        requireThat(
          canonical(existing.sourceExcerpt) === canonical(sourceExcerpt),
          409,
          "CANVAS_EXCERPT_IDENTITY_CONFLICT",
          "原请求已引用另一段原文，请保留并核对原记录。",
        );
        // A historical receipt is not permission to resurrect a deliberately removed node.
        return { body: existing, auditObjectId: nodeId };
      }
      const canvas = await readCanvas(tx, canvasId);
      versionMatches(canvas.revision, input.version);
      const script = (
        await tx.sql.query(
          "SELECT text,number FROM script_revisions WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
          [tx.tenantId, tx.projectId, sourceExcerpt.scriptRevisionId],
        )
      ).rows[0];
      requireThat(
        script,
        422,
        "INVALID_SCRIPT_SOURCE",
        "引用的剧本不存在或不属于这个项目。",
      );
      const points = Array.from(script.text as string),
        { startOffset, endOffset } = sourceExcerpt.range;
      requireThat(
        startOffset < endOffset &&
          endOffset <= points.length &&
          points.slice(startOffset, endOffset).join("") === sourceExcerpt.quote,
        422,
        "SOURCE_QUOTE_MISMATCH",
        "选文与原剧本不一致，请重新选择。",
      );
      await appendCanvas(
        tx,
        canvasId,
        {
          ...canvas.document,
          nodes: [
            ...canvas.document.nodes,
            {
              id: nodeId,
              title: `剧本选文 · 第 ${script.number} 稿`,
              kind: "text",
              position: body.position,
              width: 320,
              content: {
                type: "text",
                text: sourceExcerpt.quote,
                sourceExcerpt,
              },
            },
          ],
        },
        canvas.revision + 1,
      );
      return {
        body: (await receipt(tx, canvasId, nodeId))!,
        auditObjectId: nodeId,
      };
    },
    {
      // Do not return a stale cached active flag; the permanent node identity is the receipt.
      replayCachedResponse: () => false,
      authorizeScope: async (tx, input) => {
        const found = await tx.sql.query(
          "SELECT 1 FROM project_canvas_links l JOIN projects p ON p.id=l.project_id WHERE l.tenant_id=$1 AND l.project_id=$2 AND l.canvas_id=$3 AND p.status='active'",
          [tx.tenantId, tx.projectId, input.params.canvasId],
        );
        requireThat(
          found.rows[0],
          409,
          "PROJECT_CANVAS_INACTIVE",
          "请在当前可编辑的项目画布中添加选文。",
        );
      },
    },
  );
}
