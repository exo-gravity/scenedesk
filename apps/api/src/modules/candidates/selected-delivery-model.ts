import type { Transaction } from "../../kernel/database.js";
import { requireThat } from "../../kernel/errors.js";
import { findContent, type Schema } from "../content/model.js";
import { findMedia } from "../media/model.js";
import { getTake } from "./model.js";

export const DELIVERY_LIMITS = {
  files: 100,
  bytes: 256 * 1024 * 1024,
  singleBytes: 256 * 1024 * 1024,
  preparationMs: 180_000,
  transferMs: 120_000,
  ticketMs: 15 * 60_000,
  concurrent: 2,
} as const;

export type DeliverySource = {
  key: string;
  versionId: string;
  bytes: number;
  sha256: string;
  fileName: string;
};
export type DeliverySnapshot = {
  manifest: Schema<"SelectedDeliveryManifest">;
  sources: DeliverySource[];
};

/** Read under the existing project authority lock, before and after slow file IO. */
export async function selectedDeliverySnapshot(
  tx: Transaction,
  sceneId: string,
): Promise<DeliverySnapshot> {
  const project = (
    await tx.sql.query(
      "SELECT name,status FROM projects WHERE tenant_id=$1 AND id=$2",
      [tx.tenantId, tx.projectId],
    )
  ).rows[0];
  const scene = await findContent(tx, "scenes", sceneId);
  const episode = await findContent(tx, "episodes", scene.episode_id);
  requireThat(
    project?.status === "active" &&
      scene.status === "active" &&
      episode.status === "active",
    409,
    "DELIVERY_ARCHIVED",
    "项目或场次已归档。请恢复后打包；历史选用仍可单独下载。",
  );
  const shots = (
    await tx.sql.query(
      `SELECT s.id,s.label,s.position,s.status,s.current_selection_id,sel.take_id,sel.reason
       FROM shots s LEFT JOIN selections sel ON sel.id=s.current_selection_id
       WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.scene_id=$3 ORDER BY s.position,s.id`,
      [tx.tenantId, tx.projectId, sceneId],
    )
  ).rows;
  const selected = shots.filter((s) => s.status === "active" && s.take_id);
  requireThat(
    selected.length > 0,
    409,
    "NO_SELECTED_TAKES",
    "本场暂无可打包的已选用镜头。请先明确选用视频。",
  );
  requireThat(
    selected.length <= DELIVERY_LIMITS.files,
    422,
    "DELIVERY_LIMIT",
    "一次最多打包 100 个已选用镜头。请按场次分开整理或单独下载原片。",
  );
  const entries: Schema<"SelectedDeliveryEntry">[] = [],
    sources: DeliverySource[] = [];
  let totalBytes = 0;
  for (const shot of selected) {
    const take = await getTake(tx, shot.take_id);
    const media = await findMedia(tx, take.mediaId);
    requireThat(
      take.shotId === shot.id &&
        media.kind === "video" &&
        ["ready", "archived"].includes(media.status),
      409,
      "MEDIA_NOT_READY",
      "选用视频的原件当前不可下载。请先核对该镜头。",
    );
    requireThat(
      !media.project_id || media.project_id === tx.projectId,
      404,
      "NOT_FOUND",
      "选用视频不属于当前可访问范围。",
    );
    const bytes = Number(media.bytes);
    totalBytes += bytes;
    requireThat(
      Number.isSafeInteger(bytes) &&
        bytes > 0 &&
        bytes <= DELIVERY_LIMITS.singleBytes &&
        totalBytes <= DELIVERY_LIMITS.bytes,
      422,
      "DELIVERY_LIMIT",
      "本场原片合计超过 256 MB，请分场整理或单独下载原片。",
    );
    const revision = (
      await tx.sql.query(
        "SELECT spec FROM shot_revisions WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND shot_id=$4",
        [tx.tenantId, tx.projectId, take.shotRevisionId, shot.id],
      )
    ).rows[0];
    requireThat(
      revision,
      409,
      "DELIVERY_SOURCE_MISSING",
      "候选的固定镜头说明无法读取，请核对后重试。",
    );
    // Generated ASCII-only names cannot escape the archive or collide on Windows.
    const extension =
      media.mime === "video/quicktime"
        ? "mov"
        : media.mime === "video/webm"
          ? "webm"
          : "mp4";
    const fileName = `${String(entries.length + 1).padStart(3, "0")}_${shot.id}.${extension}`;
    entries.push({
      order: entries.length + 1,
      shotId: shot.id,
      shotLabel: shot.label,
      shotRevisionId: take.shotRevisionId,
      intent: revision.spec.intent,
      selectionId: shot.current_selection_id,
      selectionReason: shot.reason ?? "",
      takeId: take.id,
      takeNote: take.note ?? "",
      mediaId: take.mediaId,
      fileName,
      originalFileName: media.safe_original_file_name,
      bytes,
      sha256: media.sha256,
      range: take.range,
    });
    sources.push({
      key: media.immutable_key,
      versionId: media.storage_version_id,
      bytes,
      sha256: media.sha256,
      fileName,
    });
  }
  return {
    manifest: {
      format: "scenedesk_selected_originals_v1",
      projectId: tx.projectId!,
      projectName: project.name,
      sceneId,
      sceneTitle: scene.title,
      episodeTitle: episode.title,
      entries,
      unselectedCount: shots.filter((s) => s.status === "active" && !s.take_id)
        .length,
      archivedCount: shots.filter((s) => s.status === "archived").length,
      totalBytes,
    },
    sources,
  };
}
