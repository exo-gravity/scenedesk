import {
  editingCanonical,
  inspectWorkDocument,
  workDocumentIssues,
  retainEditingHistory,
  type WorkDocument,
  type WorkMediaFact,
  type WorkTakeFact,
  type HistoryFact,
} from "@drama/domain";
import type { Transaction } from "../../kernel/database.js";
import { digest } from "../../kernel/crypto.js";
import { requireThat } from "../../kernel/errors.js";
import { validateContract } from "@drama/contracts/validation";
import { contentRecord, type Schema } from "../content/model.js";

export const cutSelect = `SELECT c.*,coalesce(c.episode_id,s.episode_id) AS resolved_episode_id
  FROM cuts c LEFT JOIN scenes s ON s.tenant_id=c.tenant_id AND s.project_id=c.project_id AND s.id=c.scene_id`;
export function cutRecord(row: Record<string, unknown>): Schema<"Cut"> {
  const {
    created_by: _createdBy,
    episode_id: _episodeId,
    resolved_episode_id,
    ...fields
  } = row;
  return contentRecord<Schema<"Cut">>({
    ...fields,
    episode_id: resolved_episode_id,
  });
}
export async function findCut(tx: Transaction, id: string, lock = false) {
  const result = await tx.sql.query(
    `${cutSelect} WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.id=$3 ${lock ? "FOR UPDATE OF c" : ""}`,
    [tx.tenantId, tx.projectId, id],
  );
  requireThat(result.rows[0], 404, "NOT_FOUND", "剪辑不存在或无访问权限。");
  return cutRecord(result.rows[0]);
}
export function cutDocument(cut: Schema<"Cut">): WorkDocument {
  requireThat(
    cut.editingMode === "timeline" && cut.timeline,
    409,
    "CUT_WORK_NOT_SUPPORTED",
    "外部成片没有平台编辑工作稿。",
  );
  const document = {
    timeline: cut.timeline,
    dramaBindings: cut.dramaBindings,
    unresolvedEdits: [],
    timingOrigins: [],
  };
  if (!validateContract("CutWorkDocument", document).valid)
    throw new Error("Stored Cut cannot form a work document");
  return document as WorkDocument;
}
export async function workMediaFacts(tx: Transaction, document: WorkDocument) {
  const ids = [
    ...new Set(
      [
        ...inspectWorkDocument(document).mediaClips.map((clip) => clip.mediaId),
        ...(document.timeline.spec.qualityReferenceMediaIds ?? []),
      ].map((id) => id.toLowerCase()),
    ),
  ];
  const result = await tx.sql.query(
    "SELECT id,kind,status,duration_us,has_audio FROM media WHERE tenant_id=$1 AND (project_id=$2 OR project_id IS NULL) AND id=ANY($3::uuid[])",
    [tx.tenantId, tx.projectId, ids],
  );
  return new Map<string, WorkMediaFact>(
    result.rows.map((row) => [
      row.id,
      {
        id: row.id,
        kind: row.kind,
        status: row.status,
        ...(row.duration_us === null
          ? {}
          : { durationUs: Number(row.duration_us) }),
        hasAudio: row.has_audio,
      },
    ]),
  );
}
export async function readWork(
  tx: Transaction,
  cut: Schema<"Cut">,
  revision?: number,
): Promise<Schema<"CutWorkDraft">> {
  const confirmed = cutDocument(cut);
  const result = await tx.sql.query(
    `SELECT r.*, b.document,b.hash AS document_hash FROM cut_work_draft_revisions r
    JOIN edit_history_bodies b ON b.cut_id=r.cut_id AND b.hash=r.body_hash
    WHERE r.tenant_id=$1 AND r.project_id=$2 AND r.cut_id=$3 AND r.revision=coalesce($4::bigint,(SELECT revision FROM cut_work_drafts WHERE cut_id=$3))`,
    [tx.tenantId, tx.projectId, cut.id, revision ?? null],
  );
  const row = result.rows[0];
  if (!row && revision !== undefined) {
    const root = await tx.sql.query(
      "SELECT revision FROM cut_work_drafts WHERE tenant_id=$1 AND project_id=$2 AND cut_id=$3",
      [tx.tenantId, tx.projectId, cut.id],
    );
    requireThat(
      revision <= Number(root.rows[0]?.revision ?? 0),
      404,
      "NOT_FOUND",
      "这个工作稿版本尚不存在。",
    );
    requireThat(
      false,
      410,
      "EDIT_HISTORY_EXPIRED",
      "这个恢复点已过保留期，请查看仍保留的版本。",
    );
  }
  if (row && revision !== undefined) {
    const history = await workHistory(tx, cut.id);
    requireThat(
      history.retained.has(revision),
      410,
      "EDIT_HISTORY_EXPIRED",
      "这个恢复点已过保留期，请查看仍保留的版本。",
    );
  }
  const document = (row?.document ?? confirmed) as WorkDocument;
  const baseCutRevision = row ? Number(row.base_cut_revision) : cut.revision;
  const baseChanged = baseCutRevision !== cut.revision;
  const documentHash = row?.document_hash ?? digest(editingCanonical(document));
  const sourceIds = inspectWorkDocument(document).mediaClips.flatMap((c) =>
    c.takeId ? [c.takeId.toLowerCase()] : [],
  );
  const sourceRows = await tx.sql.query(
    "SELECT id,media_id,in_us,out_us FROM takes WHERE tenant_id=$1 AND project_id=$2 AND id=ANY($3::uuid[])",
    [tx.tenantId, tx.projectId, sourceIds],
  );
  const takes = new Map<string, WorkTakeFact>(
    sourceRows.rows.map((r) => [
      r.id,
      {
        id: r.id,
        mediaId: r.media_id,
        range: { inUs: Number(r.in_us), outUs: Number(r.out_us) },
      },
    ]),
  );
  return {
    cutId: cut.id,
    revision: Number(row?.revision ?? 0),
    baseCutRevision,
    currentCutRevision: cut.revision,
    document,
    documentHash,
    baseChanged,
    hasUnappliedChanges:
      digest(
        editingCanonical({
          timeline: document.timeline,
          dramaBindings: document.dramaBindings,
        }),
      ) !==
        digest(
          editingCanonical({
            timeline: confirmed.timeline,
            dramaBindings: confirmed.dramaBindings,
          }),
        ) || document.unresolvedEdits.length > 0,
    issues: workDocumentIssues(
      document,
      await workMediaFacts(tx, document),
      baseChanged,
      takes,
    ),
    ...(row
      ? { updatedAt: row.created_at.toISOString(), updatedBy: row.updated_by }
      : {}),
  };
}

/** No business pins exist before normalization/freeze. Those future owners must
 * add typed FKs and supply their actual retained revision set here. */
export async function workHistory(tx: Transaction, cutId: string) {
  const rows = await tx.sql.query(
    `SELECT r.*,b.canonical_bytes FROM cut_work_draft_revisions r
    JOIN edit_history_bodies b ON b.cut_id=r.cut_id AND b.hash=r.body_hash
    WHERE r.tenant_id=$1 AND r.project_id=$2 AND r.cut_id=$3 ORDER BY r.revision DESC`,
    [tx.tenantId, tx.projectId, cutId],
  );
  const clock = await tx.sql.query("SELECT transaction_timestamp() AS now");
  const policy = retainEditingHistory(
    rows.rows.map((row): HistoryFact => ({
      revision: Number(row.revision),
      documentHash: row.body_hash,
      canonicalBytes: row.canonical_bytes,
      createdAt: row.created_at.getTime(),
      pinned: false,
    })),
    clock.rows[0].now.getTime(),
  );
  return { rows: rows.rows, ...policy };
}
export async function pruneWorkHistory(tx: Transaction, cutId: string) {
  // All callers already hold the Cut root. Deleting bodies cascades their
  // projections only after every retained revision pointer is gone.
  const history = await workHistory(tx, cutId);
  const expired = history.rows
    .filter((row) => !history.retained.has(Number(row.revision)))
    .map((row) => row.revision);
  if (expired.length)
    await tx.sql.query(
      "DELETE FROM cut_work_draft_revisions WHERE tenant_id=$1 AND project_id=$2 AND cut_id=$3 AND revision=ANY($4::bigint[])",
      [tx.tenantId, tx.projectId, cutId, expired],
    );
  await tx.sql.query(
    `DELETE FROM edit_history_bodies b WHERE tenant_id=$1 AND project_id=$2 AND cut_id=$3
    AND NOT EXISTS (SELECT 1 FROM cut_work_draft_revisions r WHERE r.cut_id=b.cut_id AND r.body_hash=b.hash)`,
    [tx.tenantId, tx.projectId, cutId],
  );
}
