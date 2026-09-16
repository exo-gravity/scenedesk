import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Transaction } from "../../../kernel/database.js";
import { audit } from "../../../kernel/database.js";
import { Problem, requireThat } from "../../../kernel/errors.js";
import { registerAction, type ApiContext } from "../../../kernel/routes.js";
import { contentRecord, type Schema } from "../model.js";
import { parseScriptDocument } from "../docx.js";
import { appendScriptDocument } from "../script-documents.js";
import { FeishuFailure, requireSource, type FeishuServices } from "./client.js";
import { phased } from "./phased.js";

type Row = Record<string, any>;
type Context = ApiContext & { feishu?: FeishuServices };
const iso = (date: Date) => date.toISOString();
function view(row: Row): Schema<"FeishuImportState"> {
  const expired = +row.expires_at <= Date.now();
  return {
    id: row.id,
    state: expired ? "expired" : row.state,
    sourceUrl: row.source_url,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    nextPollAt: iso(row.next_poll_at),
    ...(row.error_code
      ? { errorCode: row.error_code, errorMessage: row.error_message }
      : {}),
    ...(!expired && row.state === "ready"
      ? {
          title: row.title,
          fetchedAt: iso(row.fetched_at),
          observedRevision: Number(row.observed_revision),
          preview: {
            fileName: row.file_name,
            sha256: row.sha256,
            bytes: row.bytes.length,
            text: row.text,
            document: row.document,
          },
        }
      : {}),
  };
}
async function owned(tx: Transaction, id: string) {
  const result = await tx.sql.query(
    "SELECT * FROM feishu_script_imports WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND actor_id=$4",
    [id, tx.tenantId, tx.projectId, tx.session.userId],
  );
  requireThat(
    result.rows[0],
    404,
    "NOT_FOUND",
    "读取记录不存在或无访问权限，请重新粘贴链接。",
  );
  return result.rows[0]!;
}
function authorized(context: Context, tx: Transaction, row: Row) {
  const source = requireSource(
    context.feishu?.config,
    tx.tenantId!,
    tx.projectId!,
    row.source_url,
  );
  requireThat(
    source.binding === row.binding_hash,
    409,
    "FEISHU_BINDING_CHANGED",
    "文档授权配置已改变，请重新读取后预览。",
  );
  requireThat(
    +row.expires_at > Date.now(),
    410,
    "FEISHU_PREVIEW_EXPIRED",
    "预览已过期，请重新读取飞书文档。",
  );
  return source.link;
}
function ready(row: Row, sha: string) {
  requireThat(
    row.state === "ready",
    409,
    "FEISHU_PREVIEW_NOT_READY",
    "文档尚未读取完成，请等待预览。",
  );
  requireThat(
    row.sha256 === sha,
    409,
    "SCRIPT_PREVIEW_CHANGED",
    "预览与确认不一致，请重新核对。",
  );
}
async function receipt(
  tx: Transaction,
  requestId: string,
  previewId: string,
  sha: string,
  version: number | undefined,
) {
  const result = await tx.sql.query(
    "SELECT * FROM script_revisions WHERE tenant_id=$1 AND project_id=$2 AND import_request_id=$3",
    [tx.tenantId, tx.projectId, requestId],
  );
  if (!result.rows[0]) return undefined;
  const row = result.rows[0];
  requireThat(
    row.imported_by === tx.session.userId &&
      row.source?.previewId === previewId &&
      row.sha256 === sha &&
      Number(row.import_base_version) === version,
    409,
    "IMPORT_REQUEST_CONFLICT",
    "导入身份已用于另一份内容，请核对已保存结果。",
  );
  return { body: contentRecord<Schema<"ScriptRevision">>(row), etag: 1 };
}
export function feishuScriptRoutes(app: FastifyInstance, context: Context) {
  registerAction(app, context, "getFeishuImportAvailability", async (tx) => {
    const configured = context.feishu?.config.tenantId === tx.tenantId;
    const bound =
      !!configured &&
      context.feishu!.config.sources.some((s) => s.projectId === tx.projectId);
    return {
      body: {
        configured,
        projectBound: bound,
        message: !configured
          ? "请管理员连接团队飞书自建应用，并授权本项目文档；现在可先上传 Word。"
          : !bound
            ? "飞书已连接。请管理员将要导入的 docx 或 wiki 链接绑定到当前项目。"
            : "支持已授权给本项目的飞书文档。源文档更新后，可再次粘贴链接导入新稿。",
      },
    };
  });
  registerAction(
    app,
    context,
    "createFeishuImport",
    async (tx, input) => {
      const body = input.body as Schema<"FeishuImportCreate">;
      const source = requireSource(
        context.feishu?.config,
        tx.tenantId!,
        tx.projectId!,
        body.sourceUrl,
      );
      const existing = await tx.sql.query(
        "SELECT * FROM feishu_script_imports WHERE id=$1",
        [body.requestId],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        requireThat(
          row.project_id === tx.projectId &&
            row.actor_id === tx.session.userId &&
            row.source_url === source.link.url &&
            row.binding_hash === source.binding,
          409,
          "FEISHU_REQUEST_CONFLICT",
          "读取身份已用于其他文档，请重新读取。",
        );
        return { body: view(row) };
      }
      // At most five 4 MB originals per actor/project. Expired rows are physically
      // removed on the next new read; inactive projects cannot accumulate more.
      await tx.sql.query(
        "DELETE FROM feishu_script_imports WHERE project_id=$1 AND actor_id=$2 AND (expires_at<=now() OR EXISTS(SELECT 1 FROM script_revisions r WHERE r.project_id=feishu_script_imports.project_id AND r.source->>'previewId'=feishu_script_imports.id::text))",
        [tx.projectId, tx.session.userId],
      );
      const count = await tx.sql.query(
        "SELECT count(*) FROM feishu_script_imports WHERE project_id=$1 AND actor_id=$2",
        [tx.projectId, tx.session.userId],
      );
      requireThat(
        Number(count.rows[0].count) < 5,
        429,
        "FEISHU_PREVIEW_LIMIT",
        "待确认预览已达 5 份，请先放弃不再使用的预览，或明天重新读取。",
      );
      const result = await tx.sql.query(
        "INSERT INTO feishu_script_imports(id,tenant_id,project_id,actor_id,source_url,source_kind,source_token,binding_hash,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending') RETURNING *",
        [
          body.requestId,
          tx.tenantId,
          tx.projectId,
          tx.session.userId,
          source.link.url,
          source.link.kind,
          source.link.token,
          source.binding,
        ],
      );
      return { body: view(result.rows[0]!) };
    },
    { audit: false, replayCachedResponse: () => false },
  );
  registerAction(app, context, "getFeishuImport", async (tx, input) => ({
    body: view(await owned(tx, input.params.importId!)),
  }));
  registerAction(
    app,
    context,
    "deleteFeishuImport",
    async (tx, input) => {
      await owned(tx, input.params.importId!);
      await tx.sql.query("DELETE FROM feishu_script_imports WHERE id=$1", [
        input.params.importId,
      ]);
      return {};
    },
    { audit: false },
  );

  phased(app, context, "advanceFeishuImport", async (scope, input) => {
    const claim = await scope(async (tx) => {
      let row = await owned(tx, input.params.importId!);
      const link = authorized(context, tx, row);
      if (row.state === "creating" && +row.lease_until <= Date.now()) {
        row = (
          await tx.sql.query(
            "UPDATE feishu_script_imports SET state='unknown',lease_token=NULL,lease_until=NULL,error_code='FEISHU_EXPORT_UNKNOWN',error_message='上次读取结果未能确认，请重新读取。' WHERE id=$1 RETURNING *",
            [row.id],
          )
        ).rows[0]!;
      }
      if (
        !["pending", "exporting"].includes(row.state) ||
        +row.next_poll_at > Date.now() ||
        (row.lease_until && +row.lease_until > Date.now())
      )
        return { row };
      if (
        row.state === "exporting" &&
        Date.now() - +row.created_at > 10 * 60_000
      ) {
        row = (
          await tx.sql.query(
            "UPDATE feishu_script_imports SET state='failed',error_code='FEISHU_EXPORT_EXPIRED',error_message='飞书导出已超时，请重新读取。',lease_token=NULL,lease_until=NULL WHERE id=$1 RETURNING *",
            [row.id],
          )
        ).rows[0]!;
        return { row };
      }
      const lease = randomUUID(),
        creating = row.state === "pending";
      await tx.sql.query(
        "UPDATE feishu_script_imports SET state=$2,lease_token=$3,lease_until=now()+interval '60 seconds',error_code=NULL,error_message=NULL WHERE id=$1",
        [row.id, creating ? "creating" : "exporting", lease],
      );
      return { row, link, lease, creating };
    });
    if (!claim.lease || !claim.link) return { body: view(claim.row) };
    let values: Record<string, unknown>;
    let submitted = false;
    try {
      const client = context.feishu!.client;
      if (claim.creating) {
        const doc = await client.inspect(claim.link);
        submitted = true;
        const ticket = await client.create(doc.documentId);
        values = {
          state: "exporting",
          document_id: doc.documentId,
          title: doc.title,
          observed_revision: doc.observedRevision,
          ticket,
        };
      } else {
        const result = await client.poll(
          claim.row.document_id,
          claim.row.ticket,
        );
        if (!result.ready) values = { state: "exporting" };
        else {
          const bytes = await client.download(result.fileToken);
          const title =
            Array.from(
              String(claim.row.title).replace(
                /[\u0000-\u001f/\\:*?"<>|]/g,
                "_",
              ),
            )
              .slice(0, 120)
              .join("") || "飞书剧本";
          const parsed = await parseScriptDocument({
            fileName: `${title}.docx`,
            data: bytes.toString("base64"),
          });
          values = {
            state: "ready",
            bytes: parsed.original,
            text: parsed.text,
            document: parsed.document,
            file_name: parsed.fileName,
            sha256: parsed.sha256,
            fetched_at: new Date(),
          };
        }
      }
    } catch (error) {
      const problem =
        error instanceof Problem
          ? error
          : new FeishuFailure(
              "FEISHU_CONNECTION_FAILED",
              "连接飞书中断，已保留读取状态。",
              true,
            );
      const retryable = problem instanceof FeishuFailure && problem.retryable;
      values = {
        state: claim.creating
          ? submitted && retryable
            ? "unknown"
            : "failed"
          : retryable
            ? "exporting"
            : "failed",
        error_code: problem.code,
        error_message: problem.message,
      };
    }
    return scope(async (tx) => {
      const row = await owned(tx, input.params.importId!);
      authorized(context, tx, row);
      if (row.lease_token !== claim.lease) return { body: view(row) };
      const entries = Object.entries(values);
      const result = await tx.sql.query(
        `UPDATE feishu_script_imports SET ${entries.map(([key], i) => `${key}=$${i + 2}`).join(",")},lease_token=NULL,lease_until=NULL,next_poll_at=now()+interval '2 seconds' WHERE id=$1 RETURNING *`,
        [row.id, ...entries.map(([, value]) => value)],
      );
      return { body: view(result.rows[0]!) };
    });
  });

  phased(app, context, "confirmFeishuImport", async (scope, input) => {
    const body = input.body as Schema<"FeishuImportConfirm">;
    const initial = await scope(async (tx) => {
      const saved = await receipt(
        tx,
        body.importRequestId,
        input.params.importId!,
        body.previewSha256,
        input.version,
      );
      if (saved) return { saved };
      const row = await owned(tx, input.params.importId!),
        link = authorized(context, tx, row);
      ready(row, body.previewSha256);
      return { row, link };
    });
    if (initial.saved) return initial.saved;
    // Permission and wiki target identity are current. The already previewed
    // export bytes remain fixed even when metadata revision changes meanwhile.
    const inspected = await context.feishu!.client.inspect(initial.link!);
    requireThat(
      inspected.documentId === initial.row!.document_id,
      409,
      "FEISHU_SOURCE_CHANGED",
      "知识库链接指向的文档已改变，请重新读取并预览。",
    );
    return scope(async (tx) => {
      const saved = await receipt(
        tx,
        body.importRequestId,
        input.params.importId!,
        body.previewSha256,
        input.version,
      );
      if (saved) return saved;
      const row = await owned(tx, input.params.importId!);
      authorized(context, tx, row);
      ready(row, body.previewSha256);
      const used = await tx.sql.query(
        "SELECT id FROM script_revisions WHERE project_id=$1 AND source->>'previewId'=$2",
        [tx.projectId, row.id],
      );
      requireThat(
        !used.rows[0],
        409,
        "FEISHU_PREVIEW_ALREADY_IMPORTED",
        "这份预览已导入。需要新稿时，请重新读取飞书文档。",
      );
      const answer = await appendScriptDocument(
        tx,
        {
          fileName: row.file_name,
          sha256: row.sha256,
          bytes: row.bytes.length,
          text: row.text,
          document: row.document,
          original: row.bytes,
        },
        body.importRequestId,
        input.version,
        {
          provider: "feishu",
          previewId: row.id,
          sourceUrl: row.source_url,
          sourceKind: row.source_kind,
          documentId: row.document_id,
          title: row.title,
          observedRevision: Number(row.observed_revision),
          fetchedAt: iso(row.fetched_at),
          permissionCheckedAt: new Date().toISOString(),
          accessMode: "team_application",
        },
      );
      await audit(tx, "confirmFeishuImport", answer.body.id);
      return answer;
    });
  });
}
