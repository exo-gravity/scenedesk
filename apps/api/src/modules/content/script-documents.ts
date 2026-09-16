import { randomUUID } from "node:crypto";
import type { Transaction } from "../../kernel/database.js";
import type { FastifyInstance } from "fastify";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import { requireThat } from "../../kernel/errors.js";
import { contentRecord, contentVersion, type Schema } from "./model.js";
import { parseScriptDocument } from "./docx.js";

export async function appendScriptDocument(
  tx: Transaction,
  parsed: Awaited<ReturnType<typeof parseScriptDocument>>,
  requestId: string,
  version: number | undefined,
  source?: Schema<"FeishuScriptSource">,
) {
  const existing = await tx.sql.query(
    "SELECT * FROM script_revisions WHERE tenant_id=$1 AND project_id=$2 AND import_request_id=$3",
    [tx.tenantId, tx.projectId, requestId],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    requireThat(
      row.imported_by === tx.session.userId &&
        row.sha256 === parsed.sha256 &&
        row.file_name === parsed.fileName &&
        (row.source?.previewId ?? null) === (source?.previewId ?? null) &&
        Number(row.import_base_version) === version,
      409,
      "IMPORT_REQUEST_CONFLICT",
      "导入身份已用于另一份文件，请核对已保存版本。",
    );
    return { body: contentRecord<Schema<"ScriptRevision">>(row), etag: 1 };
  }
  const root = await contentVersion(tx, version);
  const result = await tx.sql.query(
    `INSERT INTO script_revisions(id,tenant_id,project_id,number,text,parent_revision_id,source_format,document,file_name,sha256,import_request_id,imported_by,import_base_version,source)
      SELECT $1,$2,$3,coalesce(max(number),0)+1,$4,$5,'docx',$6,$7,$8,$9,$10,$11,$12 FROM script_revisions WHERE tenant_id=$2 AND project_id=$3 RETURNING *`,
    [
      randomUUID(),
      tx.tenantId,
      tx.projectId,
      parsed.text,
      root.current_script_revision_id,
      parsed.document,
      parsed.fileName,
      parsed.sha256,
      requestId,
      tx.session.userId,
      version,
      source ?? null,
    ],
  );
  const saved = result.rows[0]!;
  await tx.sql.query(
    "INSERT INTO script_originals(id,tenant_id,project_id,bytes) VALUES($1,$2,$3,$4)",
    [saved.id, tx.tenantId, tx.projectId, parsed.original],
  );
  await tx.sql.query(
    "UPDATE project_content_versions SET revision=revision+1,current_script_revision_id=$3 WHERE tenant_id=$1 AND project_id=$2",
    [tx.tenantId, tx.projectId, saved.id],
  );
  return { body: contentRecord<Schema<"ScriptRevision">>(saved), etag: 1 };
}

export function scriptDocumentRoutes(
  app: FastifyInstance,
  context: ApiContext,
) {
  registerAction(
    app,
    context,
    "previewScriptDocument",
    async (_tx, input) => {
      const { original: _original, ...preview } = await parseScriptDocument(
        input.body,
      );
      return { body: preview };
    },
    { readOnly: true, audit: false },
  );
  registerAction(
    app,
    context,
    "importScriptDocument",
    async (tx, input) => {
      const body = input.body as Schema<"ScriptDocumentImport">;
      const parsed = await parseScriptDocument(body);
      requireThat(
        parsed.sha256 === body.previewSha256,
        409,
        "SCRIPT_PREVIEW_CHANGED",
        "文件与预览不一致，请重新预览后导入。",
      );
      return appendScriptDocument(
        tx,
        parsed,
        body.importRequestId,
        input.version,
      );
    },
    { replayCachedResponse: () => false },
  );
  registerAction(app, context, "getScriptImportReceipt", async (tx, input) => {
    const result = await tx.sql.query(
      "SELECT * FROM script_revisions WHERE tenant_id=$1 AND project_id=$2 AND import_request_id=$3 AND imported_by=$4",
      [tx.tenantId, tx.projectId, input.params.requestId, tx.session.userId],
    );
    return {
      body: result.rows[0]
        ? {
            found: true,
            baseVersion: Number(result.rows[0].import_base_version),
            script: contentRecord<Schema<"ScriptRevision">>(result.rows[0]),
          }
        : { found: false },
    };
  });
  registerAction(app, context, "getScriptRevision", async (tx, input) => {
    const result = await tx.sql.query(
      "SELECT * FROM script_revisions WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
      [tx.tenantId, tx.projectId, input.params.revisionId],
    );
    requireThat(
      result.rows[0],
      404,
      "NOT_FOUND",
      "剧本版本不存在或无访问权限。",
    );
    return {
      body: contentRecord<Schema<"ScriptRevision">>(result.rows[0]),
      etag: 1,
    };
  });
  registerAction(app, context, "getScriptOriginal", async (tx, input) => {
    const result = await tx.sql.query(
      "SELECT r.file_name,r.sha256,o.bytes FROM script_revisions r JOIN script_originals o USING(id,tenant_id,project_id) WHERE r.tenant_id=$1 AND r.project_id=$2 AND r.id=$3",
      [tx.tenantId, tx.projectId, input.params.revisionId],
    );
    requireThat(
      result.rows[0],
      404,
      "NOT_FOUND",
      "此剧本版本没有可下载的 Word 原件，或无访问权限。",
    );
    const row = result.rows[0];
    return {
      body: {
        fileName: row.file_name,
        sha256: row.sha256,
        data: row.bytes.toString("base64"),
      },
    };
  });
}
