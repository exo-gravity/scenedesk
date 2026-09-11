import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Transaction } from "../../kernel/database.js";
import { requireThat } from "../../kernel/errors.js";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import { uploadRecord, type Schema } from "../media/model.js";
import { canvasRoot } from "./model.js";

export async function lockCanvasUploadTarget(
  tx: Transaction,
  input: Schema<"UploadInput">,
) {
  if (!input.canvasTarget) return;
  requireThat(
    input.scope === "project" &&
      tx.projectId &&
      input.projectId === tx.projectId,
    422,
    "CANVAS_UPLOAD_SCOPE_INVALID",
    "画布文件必须导入到画布所属项目。",
  );
  requireThat(
    /^(image|video|audio)\//.test(input.mime),
    422,
    "CANVAS_UPLOAD_TYPE_INVALID",
    "画布文件上传支持图片、视频和声音；文档请从素材库导入。",
  );
  await canvasRoot(tx, input.canvasTarget.canvasId.toLowerCase(), true);
}

export async function registerCanvasUpload(
  tx: Transaction,
  input: Schema<"UploadInput">,
  uploadId: string,
) {
  if (!input.canvasTarget) return;
  await tx.sql.query(
    `INSERT INTO canvas_upload_placements(upload_id,tenant_id,project_id,canvas_id,node_id,x,y,created_by,client_request_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      uploadId,
      tx.tenantId,
      tx.projectId,
      input.canvasTarget.canvasId,
      randomUUID(),
      input.canvasTarget.position.x,
      input.canvasTarget.position.y,
      tx.session.userId,
      input.canvasTarget.clientRequestId,
    ],
  );
}

// Parameterize each upload identity lookup: an unrestricted join plan can scan
// all tenant uploads for every placement and repeatedly evaluate their RLS.
const select = `SELECT u.*,m.id AS media_id,p.canvas_id,p.node_id,p.client_request_id,p.x,p.y,p.dismissed,
  EXISTS(SELECT 1 FROM canvas_node_index n WHERE n.node_id=p.node_id) AS placed
  FROM canvas_upload_placements p
  JOIN LATERAL (SELECT * FROM upload_intents WHERE tenant_id=p.tenant_id AND id=p.upload_id OFFSET 0) u ON true
  LEFT JOIN LATERAL (SELECT * FROM media WHERE tenant_id=p.tenant_id AND source_upload_id=u.id OFFSET 0) m ON true`;

async function record(
  context: ApiContext,
  row: Record<string, any>,
): Promise<Schema<"CanvasUpload">> {
  return {
    canvasId: row.canvas_id,
    nodeId: row.node_id,
    clientRequestId: row.client_request_id,
    createdBy: row.created_by,
    position: { x: row.x, y: row.y },
    placed: row.placed,
    dismissed: row.dismissed,
    upload: await uploadRecord(context, row),
    declaration: {
      scope: "project",
      projectId: row.project_id,
      fileName: row.safe_file_name,
      displayName: row.display_name,
      bytes: Number(row.expected_bytes),
      sha256: row.expected_sha256,
      mime: row.mime_hint,
      tags: row.tags,
      ...(row.provenance.record ? { provenance: row.provenance.record } : {}),
      canvasTarget: {
        canvasId: row.canvas_id,
        clientRequestId: row.client_request_id,
        position: { x: row.x, y: row.y },
      },
    },
  };
}

async function find(tx: Transaction, canvasId: string, uploadId: string) {
  const result = await tx.sql.query(
    `${select} WHERE p.tenant_id=$1 AND p.project_id=$2 AND p.canvas_id=$3 AND p.upload_id=$4`,
    [tx.tenantId, tx.projectId, canvasId, uploadId],
  );
  requireThat(
    result.rows[0],
    404,
    "NOT_FOUND",
    "本画布的上传记录不存在或无访问权限。",
  );
  return result.rows[0];
}

export function canvasUploadRoutes(app: FastifyInstance, context: ApiContext) {
  registerAction(
    app,
    context,
    "getCanvasUploadRequest",
    async (tx, { params }) => {
      await canvasRoot(tx, params.canvasId!);
      const result = await tx.sql.query(
        `${select} WHERE p.tenant_id=$1 AND p.project_id=$2 AND p.canvas_id=$3 AND p.created_by=$4 AND p.client_request_id=$5`,
        [
          tx.tenantId,
          tx.projectId,
          params.canvasId,
          tx.session.userId,
          params.clientRequestId,
        ],
      );
      requireThat(
        result.rows[0],
        404,
        "CANVAS_UPLOAD_REQUEST_MISSING",
        "尚未找到本次请求的上传记录，可使用原请求身份核对创建。",
      );
      return { body: await record(context, result.rows[0]) };
    },
  );
  registerAction(app, context, "listCanvasUploads", async (tx, { params }) => {
    await canvasRoot(tx, params.canvasId!);
    const result = await tx.sql.query(
      `${select} WHERE p.tenant_id=$1 AND p.project_id=$2 AND p.canvas_id=$3 AND NOT p.dismissed
      AND NOT EXISTS(SELECT 1 FROM canvas_node_index n WHERE n.node_id=p.node_id) ORDER BY p.created_at,p.upload_id LIMIT 100`,
      [tx.tenantId, tx.projectId, params.canvasId],
    );
    return {
      body: {
        items: await Promise.all(
          result.rows.map((row) => record(context, row)),
        ),
      },
    };
  });
  registerAction(app, context, "getCanvasUpload", async (tx, { params }) => {
    await canvasRoot(tx, params.canvasId!);
    return {
      body: await record(
        context,
        await find(tx, params.canvasId!, params.uploadId!),
      ),
    };
  });
  registerAction(
    app,
    context,
    "dismissCanvasUpload",
    async (tx, { params }) => {
      await canvasRoot(tx, params.canvasId!, true);
      const previous = await find(tx, params.canvasId!, params.uploadId!);
      requireThat(
        !previous.placed,
        409,
        "CANVAS_UPLOAD_ALREADY_PLACED",
        "素材已放入画布，请使用画布中的移除操作。",
      );
      if (!previous.dismissed)
        await tx.sql.query(
          "UPDATE canvas_upload_placements SET dismissed=true WHERE tenant_id=$1 AND project_id=$2 AND canvas_id=$3 AND upload_id=$4",
          [tx.tenantId, tx.projectId, params.canvasId, params.uploadId],
        );
      return {
        body: await record(
          context,
          await find(tx, params.canvasId!, params.uploadId!),
        ),
      };
    },
  );
}
