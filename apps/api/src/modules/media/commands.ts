import { ALLOWED_UPLOAD_MIMES, MEDIA_LIMITS, safeFileName } from "@drama/media";
import type { Transaction } from "../../kernel/database.js";
import { requireThat } from "../../kernel/errors.js";
import { findMedia, type Schema } from "./model.js";

export function text(value: string, label: string, max: number, empty = false) {
  requireThat(
    (empty || value.trim().length > 0) &&
      Array.from(value).length <= max &&
      !Array.from(value).some(
        (c) =>
          c === "\0" ||
          (c.codePointAt(0)! >= 0xd800 && c.codePointAt(0)! <= 0xdfff),
      ),
    422,
    "INVALID_MEDIA_TEXT",
    `${label}包含无效内容。`,
  );
  return value.normalize("NFC");
}
export function tags(values: string[]) {
  requireThat(
    values.length <= 50,
    422,
    "TOO_MANY_TAGS",
    "每项素材最多 50 个标签。",
  );
  return [...new Set(values.map((value) => text(value, "标签", 160).trim()))];
}
export function uploadInput(body: Schema<"UploadInput">) {
  requireThat(
    body.bytes <= MEDIA_LIMITS.bytes,
    422,
    "FILE_SIZE_REJECTED",
    "文件不能超过 256 MiB。",
  );
  requireThat(
    (ALLOWED_UPLOAD_MIMES as readonly string[]).includes(body.mime),
    422,
    "FILE_TYPE_REJECTED",
    "当前不支持此文件类型。",
  );
  const original = safeFileName(text(body.fileName, "文件名", 160));
  return {
    ...body,
    ...(body.projectId ? { projectId: body.projectId.toLowerCase() } : {}),
    fileName: original,
    displayName: text(body.displayName ?? original, "素材名称", 160),
    tags: tags(body.tags ?? []),
  };
}

export async function provenance(
  tx: Transaction,
  input: Schema<"ProvenanceInput"> | undefined,
  previous?: Schema<"MediaProvenance">,
) {
  if (!input) return previous ?? { status: "unknown" as const };
  const sourceNote = text(input.sourceNote, "来源说明", 20_000, true),
    usageNote = text(input.usageNote, "用途说明", 20_000, true);
  if (input.sourceUrl) {
    let url: URL | undefined;
    try {
      url = new URL(input.sourceUrl);
    } catch {}
    requireThat(
      url &&
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password,
      422,
      "INVALID_SOURCE_URL",
      "来源链接应为不含账号密码的 HTTP 或 HTTPS 地址。",
    );
  }
  const ids = [
    ...new Set((input.evidenceMediaIds ?? []).map((id) => id.toLowerCase())),
  ];
  requireThat(
    ids.length <= 30,
    422,
    "TOO_MANY_EVIDENCE_FILES",
    "每项来源说明最多关联 30 项证据素材。",
  );
  const previousIds = previous?.record?.evidenceMediaIds ?? [];
  for (const id of ids) {
    const evidence = await findMedia(tx, id);
    requireThat(
      evidence.scope === "shared" ||
        (tx.projectId && evidence.project_id === tx.projectId),
      422,
      "EVIDENCE_SCOPE_MISMATCH",
      "来源证据须属于当前范围，或为工作室共享素材。",
    );
    requireThat(
      evidence.status === "ready" ||
        (evidence.status === "archived" && previousIds.includes(id)),
      409,
      "EVIDENCE_NOT_READY",
      "新增来源证据须已验收且未归档。",
    );
  }
  return {
    status: "recorded" as const,
    record: { ...input, sourceNote, usageNote, evidenceMediaIds: ids },
    recordedBy: tx.session.userId,
    recordedAt: new Date().toISOString(),
  };
}

export async function replaceEvidence(
  tx: Transaction,
  mediaId: string,
  ids: string[],
) {
  const old = await tx.sql.query<{ evidence_media_id: string }>(
    "SELECT evidence_media_id FROM media_provenance_evidence WHERE tenant_id=$1 AND media_id=$2",
    [tx.tenantId, mediaId],
  );
  const previous = new Set(old.rows.map((row) => row.evidence_media_id));
  for (const id of ids) {
    requireThat(
      id !== mediaId,
      422,
      "SELF_PROVENANCE_REFERENCE",
      "素材不能引用自身作为来源证据。",
    );
    if (!previous.has(id))
      await tx.sql.query(
        "INSERT INTO media_provenance_evidence(tenant_id,media_id,evidence_media_id) VALUES ($1,$2,$3)",
        [tx.tenantId, mediaId, id],
      );
  }
  for (const id of previous)
    if (!ids.includes(id))
      await tx.sql.query(
        "DELETE FROM media_provenance_evidence WHERE tenant_id=$1 AND media_id=$2 AND evidence_media_id=$3",
        [tx.tenantId, mediaId, id],
      );
}
export async function currentEpoch(tx: Transaction) {
  const result = await tx.sql.query<{ epoch: string }>(
    "SELECT epoch FROM media_processing_state",
  );
  requireThat(
    result.rows.length === 1,
    503,
    "MEDIA_RUNTIME_NOT_READY",
    "素材处理服务尚未就绪。",
  );
  return Number(result.rows[0]!.epoch);
}
