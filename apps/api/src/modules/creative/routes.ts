import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Transaction } from "../../kernel/database.js";
import { requireThat } from "../../kernel/errors.js";
import { page, searchPattern } from "../../kernel/pages.js";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import { contentRecord, type Schema } from "../content/model.js";

type Basis = Schema<"CreativeBasisRevision">;
const sourceFields = `b.kind,coalesce(b.script_revision_id,b.production_id,b.scene_id,b.shot_revision_id) AS source_id,b.source_revision`;
const basisSelect = `SELECT b.id,b.project_id,b.revision,b.ordinal AS number,b.subject_id,b.snapshot,b.content_hash,b.hash_version,b.created_at,${sourceFields},c.confirmation_id AS current_confirmation_id,
  CASE b.kind
    WHEN 'script' THEN EXISTS (SELECT 1 FROM project_content_versions v WHERE v.project_id=b.project_id AND v.current_script_revision_id=b.script_revision_id)
    WHEN 'shot_dialogue' THEN EXISTS (SELECT 1 FROM shots s WHERE s.id=b.subject_id AND s.current_revision_id=b.shot_revision_id)
    ELSE NOT EXISTS (SELECT 1 FROM creative_basis_revisions newer WHERE newer.subject_id=b.subject_id AND newer.ordinal>b.ordinal)
  END AS is_current_source
  FROM creative_basis_revisions b LEFT JOIN creative_current_confirmations c ON c.subject_id=b.subject_id`;
const confirmationSelect = `SELECT c.id,c.project_id,c.revision,c.subject_id,c.basis_revision_id,c.usage,c.confirmed_by,c.created_at,c.created_at AS confirmed_at,c.replaces_confirmation_id,c.note,b.snapshot,b.content_hash,${sourceFields}
  FROM creative_confirmations c JOIN creative_basis_revisions b ON b.id=c.basis_revision_id`;

function withSource<T>(row: Record<string, unknown>): T {
  const { kind, source_id, source_revision, ...fields } = row;
  return contentRecord<T>({
    ...fields,
    basis: { kind, objectId: source_id, revision: Number(source_revision) },
  });
}
async function getBasis(tx: Transaction, id: string): Promise<Basis> {
  const { rows } = await tx.sql.query(
    `${basisSelect} WHERE b.tenant_id=$1 AND b.project_id=$2 AND b.id=$3`,
    [tx.tenantId, tx.projectId, id],
  );
  requireThat(rows[0], 404, "NOT_FOUND", "创作依据不存在或无访问权限。");
  return withSource<Basis>(rows[0]);
}

export function creativeRoutes(app: FastifyInstance, context: ApiContext) {
  registerAction(
    app,
    context,
    "listCreativeBasisRevisions",
    async (tx, input) => ({
      body: await page(
        tx,
        context.secrets,
        "listCreativeBasisRevisions",
        input.query,
        `${basisSelect} WHERE b.tenant_id=$1 AND b.project_id=$2 AND ($3::uuid IS NULL OR b.subject_id=$3) AND ($4::text IS NULL OR b.kind=$4) AND b.snapshot::text ILIKE $5`,
        [
          tx.tenantId,
          tx.projectId,
          input.query.subjectId ?? null,
          input.query.kind ?? null,
          searchPattern(input.query),
        ],
        withSource<Basis>,
      ),
    }),
  );
  registerAction(
    app,
    context,
    "getCreativeBasisRevision",
    async (tx, input) => ({
      body: await getBasis(tx, input.params.basisRevisionId!),
      etag: 1,
    }),
  );
  registerAction(
    app,
    context,
    "listCreativeConfirmations",
    async (tx, input) => ({
      body: await page(
        tx,
        context.secrets,
        "listCreativeConfirmations",
        input.query,
        `${confirmationSelect} WHERE c.tenant_id=$1 AND c.project_id=$2 AND ($3::uuid IS NULL OR c.subject_id=$3) AND (b.snapshot::text ILIKE $4 OR c.note ILIKE $4)`,
        [
          tx.tenantId,
          tx.projectId,
          input.query.subjectId ?? null,
          searchPattern(input.query),
        ],
        withSource<Schema<"CreativeConfirmation">>,
      ),
    }),
  );
  registerAction(app, context, "confirmCreativeBasis", async (tx, input) => {
    const body = input.body as Schema<"ConfirmCreativeBasis">;
    const basis = await getBasis(tx, body.basisRevisionId.toLowerCase());
    requireThat(
      body.usage === "project_default",
      409,
      "CUT_REVISION_REQUIRED",
      "固定稿确认需要已冻结且实际引用该依据的稿件；当前项目尚未建立固定稿。",
    );
    // The shared project write lock serializes first confirmation and pointer replacement.
    // Confirm the exact requested history row, never substitute the newest source.
    const expected = body.expectedCurrentConfirmationId?.toLowerCase() ?? null;
    requireThat(
      expected === (basis.currentConfirmationId ?? null),
      412,
      "VERSION_CONFLICT",
      "正式依据已被其他人确认，请核对最新确认记录后重试。",
    );
    const id = randomUUID();
    await tx.sql.query(
      "INSERT INTO creative_confirmations (id,tenant_id,project_id,subject_id,kind,basis_revision_id,usage,confirmed_by,note,replaces_confirmation_id) VALUES ($1,$2,$3,$4,$5,$6,'project_default',$7,$8,$9)",
      [
        id,
        tx.tenantId,
        tx.projectId,
        basis.subjectId,
        basis.basis.kind,
        basis.id,
        tx.session.userId,
        body.note ?? null,
        expected,
      ],
    );
    await tx.sql.query(
      "INSERT INTO creative_current_confirmations (subject_id,tenant_id,project_id,confirmation_id) VALUES ($1,$2,$3,$4) ON CONFLICT (subject_id) DO UPDATE SET confirmation_id=EXCLUDED.confirmation_id",
      [basis.subjectId, tx.tenantId, tx.projectId, id],
    );
    const { rows } = await tx.sql.query(`${confirmationSelect} WHERE c.id=$1`, [
      id,
    ]);
    return {
      body: withSource<Schema<"CreativeConfirmation">>(rows[0]!),
      etag: 1,
    };
  });
}
