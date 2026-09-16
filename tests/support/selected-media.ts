import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

export async function fixtureVideo(color: "blue" | "orange") {
  return readFile(
    new URL(`../fixtures/video/synthetic-${color}.mp4`, import.meta.url),
  );
}

/** Accepted relational media, explicitly synthetic; not upload/probe/provider acceptance. */
export async function seedSelectedMedia(
  input: {
    admin: Pool;
    schema: string;
    tenantId: string;
    projectId: string;
    userId: string;
  },
  color: "blue" | "orange",
  kind = "video",
) {
  const bytes = await fixtureVideo(color),
    sha = createHash("sha256").update(bytes).digest("hex");
  const id = randomUUID(),
    uploadId = randomUUID(),
    key = `originals/${id}`;
  const name = `synthetic-${color}.mp4`;
  await input.admin.query(
    `INSERT INTO ${input.schema}.upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch)
     VALUES($1,$2,$3,'project',$4,$5,$6,$7,'video/mp4',$7,$8,'accepted',now()+interval '15 minutes','synthetic-v1',1)`,
    [
      uploadId,
      input.tenantId,
      input.projectId,
      `staging/${uploadId}`,
      bytes.length,
      sha,
      name,
      input.userId,
    ],
  );
  await input.admin.query(
    `INSERT INTO ${input.schema}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio,duration_us,fps_num,fps_den)
     VALUES($1,$2,$3,'project',$4,'ready',$5,$5,$6,$7,$8,'synthetic-v1',$9,$10,'video/mp4',96,160,false,4000000,24,1)`,
    [
      id,
      input.tenantId,
      input.projectId,
      kind,
      name,
      input.userId,
      uploadId,
      key,
      sha,
      bytes.length,
    ],
  );
  return { id, key, bytes, sha, name };
}
