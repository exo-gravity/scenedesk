import { randomUUID } from "node:crypto";
import type { Transaction } from "../../kernel/database.js";
import { requireThat } from "../../kernel/errors.js";
import {
  activeParent,
  appendShotRevision,
  contentRecord,
  shotSelect,
  validateState,
  type Schema,
} from "./model.js";

/** Callers hold the project write lock and own the content-root CAS/bump.
 * These commands are shared by manual creation and atomic proposal adoption. */
export async function insertEpisode(
  tx: Transaction,
  body: Schema<"EpisodeInput">,
) {
  const result = await tx.sql.query(
    "INSERT INTO episodes (id,tenant_id,project_id,title,position,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [
      randomUUID(),
      tx.tenantId,
      tx.projectId,
      body.title,
      body.position,
      body.status,
    ],
  );
  return contentRecord<Schema<"Episode">>(result.rows[0]);
}
export function validateScene(body: Schema<"SceneInput">) {
  validateState(body.state);
  requireThat(
    !body.defaultAssetRevisionIds?.length,
    422,
    "ASSETS_NOT_READY",
    "场次参考需要先建立有效资产。",
  );
}
export async function insertScene(tx: Transaction, body: Schema<"SceneInput">) {
  await activeParent(tx, "episodes", body.episodeId);
  validateScene(body);
  const result = await tx.sql.query(
    "INSERT INTO scenes (id,tenant_id,project_id,episode_id,title,position,time_label,location_label,summary,state,default_asset_revision_ids,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
    [
      randomUUID(),
      tx.tenantId,
      tx.projectId,
      body.episodeId,
      body.title,
      body.position,
      body.timeLabel ?? null,
      body.locationLabel ?? null,
      body.summary,
      body.state,
      JSON.stringify(body.defaultAssetRevisionIds ?? []),
      body.status,
    ],
  );
  return contentRecord<Schema<"Scene">>(result.rows[0]);
}
export async function insertShot(tx: Transaction, body: Schema<"ShotInput">) {
  await activeParent(tx, "scenes", body.sceneId);
  const id = randomUUID(),
    revisionId = randomUUID();
  await tx.sql.query(
    "INSERT INTO shots (id,tenant_id,project_id,scene_id,label,position,current_revision_id,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id,
      tx.tenantId,
      tx.projectId,
      body.sceneId,
      body.label,
      body.position,
      revisionId,
      body.status,
    ],
  );
  await appendShotRevision(tx, id, body.spec, 1, revisionId);
  const result = await tx.sql.query(
    `${shotSelect} WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.id=$3`,
    [tx.tenantId, tx.projectId, id],
  );
  return contentRecord<Schema<"Shot">>(result.rows[0]);
}
