import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { MEDIA_LIMITS } from "@drama/media";
import { canonical } from "../../kernel/crypto.js";
import { Problem, requireThat, versionMatches } from "../../kernel/errors.js";
import { page, searchPattern } from "../../kernel/pages.js";
import { registerAction } from "../../kernel/routes.js";
import {
  lockCanvasUploadTarget,
  registerCanvasUpload,
} from "../canvas/uploads.js";
import {
  authorizeMediaScope,
  findMedia,
  findUpload,
  mediaRecord,
  mediaSelect,
  services,
  uploadRecord,
  type MediaContext,
  type Schema,
} from "./model.js";
import {
  currentEpoch,
  provenance,
  replaceEvidence,
  tags,
  text,
  uploadInput,
} from "./commands.js";

export function mediaRoutes(app: FastifyInstance, context: MediaContext) {
  registerAction(
    app,
    context,
    "recoverMediaDerivative",
    async (tx, { params, body }) => {
      const media = await findMedia(tx, params.mediaId!);
      requireThat(
        ["ready", "archived"].includes(media.status),
        409,
        "MEDIA_NOT_READY",
        "原文件尚未通过验收。",
      );
      const derivative = media.derivatives.find(
        (row: Record<string, any>) => row.kind === body.variant,
      );
      requireThat(
        derivative,
        404,
        "DERIVATIVE_NOT_FOUND",
        "该素材不支持所选预览类型。",
      );
      const epoch = await currentEpoch(tx);
      if (derivative.status === "failed") {
        await tx.sql.query(
          "UPDATE media_derivatives SET status='queued',step_revision=step_revision+1,epoch=$3,processing_attempts=0,issue=NULL,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [tx.tenantId, derivative.id, epoch],
        );
        await services(context).schedule(tx.sql, {
          taskKind: "media_derivative",
          businessId: derivative.id,
          epoch,
          stepRevision: Number(derivative.step_revision) + 1,
        });
      } else if (derivative.status === "queued") {
        await services(context).schedule(tx.sql, {
          taskKind: "media_derivative",
          businessId: derivative.id,
          epoch: Number(derivative.epoch),
          stepRevision: Number(derivative.step_revision),
        });
      }
      return { body: mediaRecord(await findMedia(tx, media.id)) };
    },
    { authorizeScope: authorizeMediaScope(context, "media", true) },
  );
  registerAction(
    app,
    context,
    "createUpload",
    async (tx, { body: input }) => {
      const body = uploadInput(input as Schema<"UploadInput">);
      await lockCanvasUploadTarget(tx, body);
      const recorded = await provenance(tx, body.provenance);
      const id = randomUUID(),
        epoch = await currentEpoch(tx);
      const expiresAt = new Date(
        Date.now() + MEDIA_LIMITS.uploadSeconds * 1000,
      );
      await tx.sql.query(
        `INSERT INTO upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,tags,provenance,created_by,expires_at,epoch)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          id,
          tx.tenantId,
          tx.projectId ?? null,
          body.scope,
          `staging/${id}`,
          body.bytes,
          body.sha256,
          body.fileName,
          body.mime,
          body.displayName,
          body.tags,
          recorded,
          tx.session.userId,
          expiresAt,
          epoch,
        ],
      );
      await registerCanvasUpload(tx, body, id);
      for (const evidenceId of recorded.record?.evidenceMediaIds ?? [])
        await tx.sql.query(
          "INSERT INTO upload_provenance_evidence(tenant_id,upload_id,evidence_media_id) VALUES ($1,$2,$3)",
          [tx.tenantId, id, evidenceId],
        );
      return {
        body: await uploadRecord(context, await findUpload(tx, id), true),
      };
    },
    { authorizeScope: authorizeMediaScope(context, "input", true) },
  );

  registerAction(
    app,
    context,
    "getUpload",
    async (tx, { params }) => ({
      body: await uploadRecord(
        context,
        await findUpload(tx, params.uploadId!),
        tx.resourceScope === "project" ||
          ["owner", "admin"].includes(tx.tenantRole ?? ""),
      ),
    }),
    { authorizeScope: authorizeMediaScope(context, "upload", false) },
  );

  registerAction(
    app,
    context,
    "completeUpload",
    async (tx, { params, body }) => {
      const upload = await findUpload(tx, params.uploadId!);
      requireThat(
        upload.expected_sha256 === body.sha256 &&
          Number(upload.expected_bytes) === body.bytes,
        422,
        "UPLOAD_DECLARATION_CHANGED",
        "完成确认须与原上传声明的大小和摘要一致。",
      );
      if (upload.status === "accepted")
        return { body: await uploadRecord(context, upload) };
      requireThat(
        !["rejected", "expired"].includes(upload.status) &&
          !(
            upload.status === "pending" &&
            new Date(upload.expires_at).getTime() <= Date.now()
          ),
        409,
        "UPLOAD_CLOSED",
        "本次上传已拒绝或过期，请重新导入。",
      );
      const epoch = await currentEpoch(tx);
      requireThat(
        epoch === Number(upload.epoch),
        409,
        "PROCESSING_EPOCH_CHANGED",
        "处理环境已恢复到新代次，请重新导入。",
      );
      if (upload.status === "pending" || upload.retryable) {
        await tx.sql.query(
          `UPDATE upload_intents SET status='uploaded',step_revision=step_revision+$3,processing_attempts=0,issue=NULL,retryable=false,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
          [tx.tenantId, upload.id, upload.status === "pending" ? 0 : 1],
        );
        if (!upload.media_id) {
          const id = randomUUID();
          const kind = upload.mime_hint.startsWith("image/")
            ? "image"
            : upload.mime_hint.startsWith("video/")
              ? "video"
              : upload.mime_hint.startsWith("audio/")
                ? "audio"
                : "document";
          await tx.sql.query(
            `INSERT INTO media(id,tenant_id,project_id,scope,kind,display_name,safe_original_file_name,tags,provenance,created_by,source_upload_id,mime)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              id,
              tx.tenantId,
              upload.project_id,
              upload.scope,
              kind,
              upload.display_name,
              upload.safe_file_name,
              upload.tags,
              upload.provenance,
              upload.created_by,
              upload.id,
              upload.mime_hint,
            ],
          );
          const evidence = await tx.sql.query(
            "SELECT evidence_media_id FROM upload_provenance_evidence WHERE tenant_id=$1 AND upload_id=$2",
            [tx.tenantId, upload.id],
          );
          await replaceEvidence(
            tx,
            id,
            evidence.rows.map((row) => row.evidence_media_id),
          );
        }
      }
      const current = await findUpload(tx, upload.id);
      if (current.status === "uploaded")
        await services(context).schedule(tx.sql, {
          taskKind: "media_probe",
          businessId: upload.id,
          epoch,
          stepRevision: Number(current.step_revision),
        });
      return { body: await uploadRecord(context, current) };
    },
    { authorizeScope: authorizeMediaScope(context, "upload", true) },
  );

  registerAction(
    app,
    context,
    "listMedia",
    async (tx, { query }) => ({
      body: await page(
        tx,
        context.secrets,
        "listMedia",
        query,
        `${mediaSelect} WHERE m.tenant_id=$1 AND ($2::uuid IS NULL OR m.project_id=$2) AND ($3::text IS NULL OR m.scope=$3)
      AND ($4::text IS NULL OR m.kind=$4) AND ($5::text IS NULL OR m.status=$5) AND $6::uuid IS NULL
      AND (m.display_name ILIKE $7 OR m.safe_original_file_name ILIKE $7 OR array_to_string(m.tags,' ') ILIKE $7)`,
        [
          tx.tenantId,
          query.projectId ?? null,
          query.scope ?? null,
          query.kind ?? null,
          query.status ?? null,
          query.sourceJobId ?? null,
          searchPattern(query),
        ],
        mediaRecord,
      ),
    }),
    { authorizeScope: authorizeMediaScope(context, "list", false) },
  );

  registerAction(
    app,
    context,
    "getMedia",
    async (tx, { params }) => {
      const media = mediaRecord(await findMedia(tx, params.mediaId!));
      return { body: media, etag: media.revision };
    },
    { authorizeScope: authorizeMediaScope(context, "media", false) },
  );

  registerAction(
    app,
    context,
    "changeMediaMetadata",
    async (tx, { params, body: input, version }) => {
      const previous = await findMedia(tx, params.mediaId!);
      versionMatches(Number(previous.revision), version);
      const body = input as Schema<"MediaMetadataChange">;
      const displayName = text(body.displayName, "素材名称", 160),
        labels = tags(body.tags);
      const recorded = await provenance(
        tx,
        body.provenance,
        previous.provenance,
      );
      if (
        previous.display_name !== displayName ||
        canonical(previous.tags) !== canonical(labels) ||
        canonical(previous.provenance) !== canonical(recorded)
      ) {
        await replaceEvidence(
          tx,
          previous.id,
          recorded.record?.evidenceMediaIds ?? [],
        );
        await tx.sql.query(
          "UPDATE media SET display_name=$3,tags=$4,provenance=$5,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [tx.tenantId, previous.id, displayName, labels, recorded],
        );
      }
      const media = mediaRecord(await findMedia(tx, previous.id));
      return { body: media, etag: media.revision };
    },
    { authorizeScope: authorizeMediaScope(context, "media", true) },
  );

  registerAction(
    app,
    context,
    "archiveMedia",
    async (tx, { params, version }) => {
      const previous = await findMedia(tx, params.mediaId!);
      versionMatches(Number(previous.revision), version);
      requireThat(
        ["ready", "archived"].includes(previous.status),
        409,
        "MEDIA_NOT_READY",
        "素材验收完成后才能归档。",
      );
      if (previous.status !== "archived")
        await tx.sql.query(
          "UPDATE media SET status='archived',revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [tx.tenantId, previous.id],
        );
      const media = mediaRecord(await findMedia(tx, previous.id));
      return { body: media, etag: media.revision };
    },
    { authorizeScope: authorizeMediaScope(context, "media", true) },
  );

  registerAction(
    app,
    context,
    "getMediaAccess",
    async (tx, { params, body: input }) => {
      const media = await findMedia(tx, params.mediaId!);
      const body = input as Schema<"AccessRequest">;
      requireThat(
        ["ready", "archived"].includes(media.status),
        409,
        "MEDIA_NOT_READY",
        "原文件尚未通过验收。",
      );
      let source = media;
      if (body.variant === "original")
        requireThat(
          !body.derivativeId,
          422,
          "INVALID_VARIANT",
          "原文件访问不能指定派生文件。",
        );
      else {
        const matches = media.derivatives.filter(
          (d: Record<string, any>) =>
            d.kind === body.variant &&
            (!body.derivativeId || d.id === body.derivativeId.toLowerCase()),
        );
        requireThat(
          matches.length === 1,
          404,
          "DERIVATIVE_NOT_FOUND",
          "所选预览文件不存在。",
        );
        source = matches[0];
        if (source.status !== "ready")
          throw new Problem(
            409,
            "DERIVATIVE_NOT_READY",
            "所选预览尚未就绪，可查看处理状态或下载原文件。",
            {
              status: source.status,
              ...(source.issue ? { issue: source.issue } : {}),
            },
          );
      }
      const fileName =
        body.variant === "original"
          ? media.safe_original_file_name
          : `${media.display_name}.${body.variant === "poster" ? "jpg" : "mp4"}`;
      return {
        auditObjectId: media.id,
        body: await services(context).store.access(
          {
            key: source.immutable_key,
            versionId: source.storage_version_id,
            bytes: Number(source.bytes),
          },
          fileName,
          source.mime,
          media.kind === "document" ? "attachment" : body.disposition,
        ),
      };
    },
    {
      authorizeScope: authorizeMediaScope(context, "media", false),
      readOnly: true,
    },
  );
}
