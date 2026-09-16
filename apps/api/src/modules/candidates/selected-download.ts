import type { FastifyInstance } from "fastify";
import { registerAction } from "../../kernel/routes.js";
import { requireThat } from "../../kernel/errors.js";
import { findContent } from "../content/model.js";
import {
  findMedia,
  mediaRecord,
  services,
  type MediaContext,
} from "../media/model.js";
import { getTake } from "./model.js";

/** Sign the exact selection the user reviewed, never substitute a newer choice. */
export function selectedDownloadRoutes(
  app: FastifyInstance,
  context: MediaContext,
) {
  registerAction(
    app,
    context,
    "downloadSelectedTake",
    async (tx, input) => {
      const shot = await findContent(tx, "shots", input.params.shotId!);
      requireThat(
        shot.current_selection_id === input.body.selectionId.toLowerCase(),
        409,
        "SELECTION_CHANGED",
        "镜头选用已改变，请核对当前结果后再下载。",
      );
      const selected = await tx.sql.query(
        "SELECT take_id FROM selections WHERE tenant_id=$1 AND project_id=$2 AND shot_id=$3 AND id=$4",
        [tx.tenantId, tx.projectId, shot.id, shot.current_selection_id],
      );
      requireThat(
        selected.rows[0]?.take_id,
        409,
        "NO_SELECTED_TAKE",
        "此镜头尚未选用视频候选。",
      );
      const take = await getTake(tx, selected.rows[0].take_id);
      const source = await findMedia(tx, take.mediaId);
      requireThat(
        source.kind === "video" &&
          ["ready", "archived"].includes(source.status),
        409,
        "MEDIA_NOT_READY",
        "选用视频的原件当前不可下载。",
      );
      requireThat(
        !source.project_id || source.project_id === tx.projectId,
        404,
        "NOT_FOUND",
        "选用视频不属于当前可访问范围。",
      );
      const access = await services(context).store.access(
        {
          key: source.immutable_key,
          versionId: source.storage_version_id,
          bytes: Number(source.bytes),
        },
        source.safe_original_file_name,
        source.mime,
        "attachment",
      );
      return {
        body: {
          selectionId: shot.current_selection_id,
          take,
          media: mediaRecord(source),
          access,
        },
        auditObjectId: take.id,
      };
    },
    { readOnly: true, replayCachedResponse: () => false },
  );
}
