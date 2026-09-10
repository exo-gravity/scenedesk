import type { components } from "@drama/contracts";
import type { MediaStore } from "@drama/media";
import type { StepEnvelope } from "@drama/queue";
import type { PoolClient } from "pg";
import {
  bindResourceProject,
  type Transaction,
} from "../../kernel/database.js";
import { requireThat } from "../../kernel/errors.js";
import type { ApiContext, Input } from "../../kernel/routes.js";

export type Schema<K extends keyof components["schemas"]> =
  components["schemas"][K];
export type MediaServices = {
  store: MediaStore;
  schedule(sql: PoolClient, envelope: StepEnvelope): Promise<unknown>;
};
export type MediaContext = ApiContext & { media?: MediaServices };
export function services(context: MediaContext) {
  requireThat(
    context.media,
    503,
    "MEDIA_NOT_CONFIGURED",
    "素材服务暂不可用，请稍后重试。",
  );
  return context.media;
}

const strings = [
  "id",
  "scope",
  "project_id",
  "kind",
  "status",
  "mime",
  "display_name",
  "created_by",
  "source_upload_id",
  "sha256",
] as const;
const numbers = [
  "revision",
  "bytes",
  "duration_us",
  "width",
  "height",
  "fps_num",
  "fps_den",
] as const;
const camel = (value: string) =>
  value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
export function mediaRecord(row: Record<string, any>): Schema<"Media"> {
  const result: Record<string, unknown> = {};
  for (const key of strings)
    if (row[key] !== null && row[key] !== undefined)
      result[camel(key)] = row[key];
  for (const key of numbers)
    if (row[key] !== null && row[key] !== undefined)
      result[camel(key)] = Number(row[key]);
  for (const key of ["created_at", "updated_at"])
    if (row[key]) result[camel(key)] = new Date(row[key]).toISOString();
  result.originalFileName = row.safe_original_file_name;
  result.tags = row.tags;
  result.provenance = row.provenance;
  if (row.has_audio !== null && row.has_audio !== undefined)
    result.hasAudio = row.has_audio;
  const timing = row.probe_metadata?.timing;
  // Some valid audio formats have no declared start PTS. Do not invent timing evidence.
  if (
    timing?.timeBaseNum &&
    timing.timeBaseDen &&
    timing.startPts !== undefined
  )
    result.timing = timing;
  if (row.issue) result.issue = row.issue;
  result.derivatives = (row.derivatives ?? []).map(derivativeRecord);
  return result as Schema<"Media">;
}
function derivativeRecord(row: Record<string, any>): Schema<"MediaDerivative"> {
  const result: Record<string, unknown> = {
    id: row.id,
    kind: row.kind,
    status: row.status,
    profileRevision: Number(row.profile_revision),
  };
  if (row.mime) result.mime = row.mime;
  for (const key of ["duration_us", "width", "height"])
    if (row[key] !== null && row[key] !== undefined)
      result[camel(key)] = Number(row[key]);
  if (row.issue) result.issue = row.issue;
  return result as Schema<"MediaDerivative">;
}
export const mediaSelect = `SELECT m.*,coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.kind,d.id) FROM media_derivatives d WHERE d.tenant_id=m.tenant_id AND d.media_id=m.id),'[]'::jsonb) AS derivatives FROM media m`;
export async function findMedia(tx: Transaction, id: string) {
  const result = await tx.sql.query(
    `${mediaSelect} WHERE m.tenant_id=$1 AND m.id=$2`,
    [tx.tenantId, id],
  );
  requireThat(result.rows[0], 404, "NOT_FOUND", "素材不存在或无访问权限。");
  return result.rows[0] as Record<string, any>;
}
export async function findUpload(tx: Transaction, id: string) {
  const result = await tx.sql.query(
    "SELECT u.*,m.id AS media_id FROM upload_intents u LEFT JOIN media m ON m.source_upload_id=u.id WHERE u.tenant_id=$1 AND u.id=$2",
    [tx.tenantId, id],
  );
  requireThat(result.rows[0], 404, "NOT_FOUND", "上传记录不存在或无访问权限。");
  return result.rows[0] as Record<string, any>;
}
export async function uploadRecord(
  context: MediaContext,
  row: Record<string, any>,
  authorize = false,
): Promise<Schema<"UploadIntent">> {
  const expired =
    row.status === "pending" &&
    new Date(row.expires_at).getTime() <= Date.now();
  const result: Schema<"UploadIntent"> = {
    id: row.id,
    revision: Number(row.revision),
    status: expired ? "expired" : row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    ...(row.media_id ? { mediaId: row.media_id } : {}),
    ...(row.issue ? { issue: row.issue } : {}),
  };
  if (
    authorize &&
    row.status === "pending" &&
    !expired &&
    new Date(row.expires_at).getTime() - Date.now() >= 1000
  )
    Object.assign(
      result,
      await services(context).store.authorizeUpload(
        row.staging_key,
        Number(row.expected_bytes),
        row.mime_hint,
        new Date(row.expires_at),
      ),
    );
  return result;
}

export function authorizeMediaScope(
  context: MediaContext,
  root: "upload" | "media" | "input" | "list",
  write: boolean,
) {
  return async (tx: Transaction, input: Input) => {
    services(context);
    let projectId: string | undefined;
    let scope: string | undefined;
    if (root === "upload" || root === "media") {
      const row =
        root === "upload"
          ? await findUpload(tx, input.params.uploadId!)
          : await findMedia(tx, input.params.mediaId!);
      projectId = row.project_id ?? undefined;
      scope = row.scope;
    } else {
      const source = root === "input" ? input.body : input.query;
      projectId = source.projectId?.toLowerCase();
      scope = source.scope;
      requireThat(
        !(scope === "shared" && projectId),
        422,
        "INVALID_MEDIA_SCOPE",
        "共享素材不能指定私有项目。",
      );
    }
    if (projectId) await bindResourceProject(tx, projectId, write);
    else tx.resourceScope = scope === "shared" ? "shared" : "all";
  };
}
