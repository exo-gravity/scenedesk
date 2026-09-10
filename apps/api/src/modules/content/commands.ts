import { randomUUID } from "node:crypto";
import type { Transaction } from "../../kernel/database.js";
import {
  activeParent,
  appendShotRevision,
  contentRecord,
  shotSelect,
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
export async function insertScene(tx: Transaction, body: Schema<"SceneInput">) {
  await activeParent(tx, "episodes", body.episodeId);
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
export async function validateScene(
  tx: Transaction,
  body: Schema<"SceneInput">,
) {
  await tx.sql.query("SELECT validate_creative_links($1,$2,$3,'{}')", [
    tx.tenantId,
    tx.projectId,
    { defaults: body.defaultAssetRevisionIds ?? [], state: body.state },
  ]);
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
