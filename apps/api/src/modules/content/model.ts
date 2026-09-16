import { randomUUID } from "node:crypto";
import type { components } from "@drama/contracts";
import type { Transaction } from "../../kernel/database.js";
import { record } from "../../kernel/database.js";
import { canonical } from "../../kernel/crypto.js";
import { requireThat, versionMatches } from "../../kernel/errors.js";

export type Schema<T extends keyof components["schemas"]> =
  components["schemas"][T];
export function contentRecord<T>(row: Record<string, unknown>): T {
  const {
    tenant_id: _tenant,
    import_request_id: _request,
    imported_by: _actor,
    import_base_version: _base,
    ...values
  } = row;
  for (const [key, value] of Object.entries(values)) {
    if (value === null) delete values[key];
    else if (key === "position" || key === "number")
      values[key] = Number(value);
  }
  return record<T>(values);
}
export async function contentVersion(tx: Transaction, expected?: number) {
  const { rows } = await tx.sql.query(
    "SELECT revision,current_script_revision_id FROM project_content_versions WHERE tenant_id=$1 AND project_id=$2",
    [tx.tenantId, tx.projectId],
  );
  const root = rows[0]!;
  if (expected !== undefined) versionMatches(Number(root.revision), expected);
  return root;
}
export async function bumpContent(tx: Transaction) {
  await tx.sql.query(
    "UPDATE project_content_versions SET revision=revision+1 WHERE tenant_id=$1 AND project_id=$2",
    [tx.tenantId, tx.projectId],
  );
}
export const shotSelect = `SELECT s.id,s.project_id,s.scene_id,s.label,s.position,s.status,s.revision,s.created_at,s.updated_at,s.current_revision_id AS spec_revision_id,r.spec,sel.take_id AS current_take_id FROM shots s JOIN shot_revisions r ON r.id=s.current_revision_id LEFT JOIN selections sel ON sel.id=s.current_selection_id`;
export async function contentTree(
  tx: Transaction,
): Promise<Schema<"ContentTree">> {
  const root = await contentVersion(tx);
  const values = [tx.tenantId, tx.projectId];
  const episodes = await tx.sql.query(
    "SELECT * FROM episodes WHERE tenant_id=$1 AND project_id=$2 ORDER BY position,id",
    values,
  );
  const scenes = await tx.sql.query(
    "SELECT * FROM scenes WHERE tenant_id=$1 AND project_id=$2 ORDER BY position,id",
    values,
  );
  const shots = await tx.sql.query(
    `${shotSelect} WHERE s.tenant_id=$1 AND s.project_id=$2 ORDER BY s.position,s.id`,
    values,
  );
  return {
    id: tx.projectId!,
    projectId: tx.projectId!,
    revision: Number(root.revision),
    ...(root.current_script_revision_id
      ? { currentScriptRevisionId: root.current_script_revision_id }
      : {}),
    episodes: episodes.rows.map(contentRecord<Schema<"Episode">>),
    scenes: scenes.rows.map(contentRecord<Schema<"Scene">>),
    shots: shots.rows.map(contentRecord<Schema<"Shot">>),
  };
}
export async function findContent(
  tx: Transaction,
  kind: "episodes" | "scenes" | "shots",
  id: string,
) {
  const { rows } = await tx.sql.query(
    `SELECT * FROM ${kind} WHERE tenant_id=$1 AND project_id=$2 AND id=$3`,
    [tx.tenantId, tx.projectId, id],
  );
  requireThat(rows[0], 404, "NOT_FOUND", "内容不存在或不属于当前项目。");
  return rows[0]!;
}
export async function activeParent(
  tx: Transaction,
  kind: "episodes" | "scenes",
  id: string,
) {
  const found = await findContent(tx, kind, id);
  requireThat(
    found.status === "active",
    409,
    "PARENT_ARCHIVED",
    "上级内容已归档，请先恢复或选择其他位置。",
  );
  if (kind === "scenes") await activeParent(tx, "episodes", found.episode_id);
  return found;
}
export async function validateShotSpec(
  tx: Transaction,
  shotId: string,
  spec: Schema<"ShotSpec">,
  options: { existingShot?: boolean } = {},
) {
  // Asset scope, fixed versions, looks and retained media are validated by the
  // same database boundary. A proposal's temporary identity is never an owner,
  // even when its caller-supplied UUID happens to match a persisted shot.
  await tx.sql.query(
    "SELECT validate_creative_links($1,$2,$3,coalesce((SELECT r.spec FROM shots s JOIN shot_revisions r ON r.id=s.current_revision_id WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.id=$4),'{}'))",
    [tx.tenantId, tx.projectId, spec, options.existingShot ? shotId : null],
  );
  const dialogue = spec.dialogue ?? [];
  requireThat(
    new Set(dialogue.map((d) => d.id.toLowerCase())).size === dialogue.length,
    422,
    "DUPLICATE_DIALOGUE",
    "同一镜头要求内的台词标识不能重复。",
  );
  const sources = (spec.sourceShotIds ?? []).map((s) => s.toLowerCase());
  requireThat(
    new Set(sources).size === sources.length &&
      !(options.existingShot && sources.includes(shotId.toLowerCase())),
    422,
    "INVALID_SHOT_SOURCE",
    "来源镜头不能重复或指向自身。",
  );
  for (const id of sources) await findContent(tx, "shots", id);
  const excerpts = [
    ...(spec.sourceExcerpts ?? []),
    ...dialogue.flatMap((d) => (d.sourceExcerpt ? [d.sourceExcerpt] : [])),
  ];
  const scripts = new Map<string, string[]>();
  for (const excerpt of excerpts) {
    const id = excerpt.scriptRevisionId.toLowerCase();
    if (!scripts.has(id)) {
      const result = await tx.sql.query(
        "SELECT text FROM script_revisions WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
        [tx.tenantId, tx.projectId, id],
      );
      requireThat(
        result.rows[0],
        422,
        "INVALID_SCRIPT_SOURCE",
        "引用的剧本版本不存在或不属于当前项目。",
      );
      scripts.set(id, Array.from(result.rows[0].text as string));
    }
    const text = scripts.get(id)!;
    const { startOffset: start, endOffset: end } = excerpt.range;
    requireThat(
      start < end &&
        end <= text.length &&
        text.slice(start, end).join("") === excerpt.quote,
      422,
      "SOURCE_QUOTE_MISMATCH",
      "原文引用与所选剧本版本的位置不一致，请重新选择原文。",
    );
  }
  for (const line of dialogue) {
    if (line.sourceDialogueId) {
      const found = await tx.sql.query(
        "SELECT 1 FROM dialogue_lines d JOIN shot_revisions r ON r.id=d.shot_revision_id WHERE d.tenant_id=$1 AND d.project_id=$2 AND d.dialogue_id=$3 AND r.shot_id=ANY($4::uuid[]) LIMIT 1",
        [
          tx.tenantId,
          tx.projectId,
          line.sourceDialogueId,
          [...(options.existingShot ? [shotId] : []), ...sources],
        ],
      );
      requireThat(
        found.rows[0],
        422,
        "INVALID_DIALOGUE_SOURCE",
        "来源台词必须属于本镜历史或明确记录的来源镜头。",
      );
    }
  }
  return { scripts: [...scripts.keys()], sources };
}
export async function appendShotRevision(
  tx: Transaction,
  shotId: string,
  spec: Schema<"ShotSpec">,
  number: number,
  id = randomUUID(),
) {
  const { scripts, sources } = await validateShotSpec(tx, shotId, spec, {
    existingShot: true,
  });
  await tx.sql.query(
    "INSERT INTO shot_revisions (id,tenant_id,project_id,shot_id,number,spec,source_script_revision_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [
      id,
      tx.tenantId,
      tx.projectId,
      shotId,
      number,
      spec,
      scripts.length === 1 ? scripts[0] : null,
    ],
  );
  for (const source of scripts)
    await tx.sql.query(
      "INSERT INTO shot_source_scripts (tenant_id,project_id,shot_revision_id,script_revision_id) VALUES ($1,$2,$3,$4)",
      [tx.tenantId, tx.projectId, id, source],
    );
  for (const source of sources)
    await tx.sql.query(
      "INSERT INTO shot_source_shots (tenant_id,project_id,shot_revision_id,source_shot_id) VALUES ($1,$2,$3,$4)",
      [tx.tenantId, tx.projectId, id, source],
    );
  return id;
}
export function specChanged(a: Schema<"ShotSpec">, b: Schema<"ShotSpec">) {
  return canonical(a) !== canonical(b);
}
