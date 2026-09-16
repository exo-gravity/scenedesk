import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { requireThat, versionMatches } from "../../kernel/errors.js";
import { page, searchPattern } from "../../kernel/pages.js";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import { contentRecord, findContent, type Schema } from "../content/model.js";
import { archiveTake, getTake, takeRecord, validText } from "./model.js";

function selectionRecord(row: Record<string, unknown>): Schema<"Selection"> {
  return contentRecord<Schema<"Selection">>(row);
}
const selectionSelect = `SELECT s.*,ARRAY(
  SELECT DISTINCT w.cut_id FROM cut_work_drafts w
  JOIN cut_work_draft_revisions r ON r.cut_id=w.cut_id AND r.revision=w.revision
  JOIN edit_history_media_refs used ON used.cut_id=r.cut_id AND used.body_hash=r.body_hash
  JOIN takes t ON t.id=used.take_id JOIN cuts c ON c.id=w.cut_id
  WHERE w.tenant_id=s.tenant_id AND w.project_id=s.project_id AND t.shot_id=s.shot_id AND c.status='active'
  ORDER BY w.cut_id) AS affected_cut_ids FROM selections s`;
export function candidateRoutes(app: FastifyInstance, context: ApiContext) {
  registerAction(app, context, "listTakes", async (tx, input) => {
    if (input.query.shotId)
      await findContent(tx, "shots", String(input.query.shotId));
    return {
      body: await page(
        tx,
        context.secrets,
        "listTakes",
        input.query,
        "SELECT * FROM takes WHERE tenant_id=$1 AND project_id=$2 AND ($3::uuid IS NULL OR shot_id=$3) AND (coalesce(note,'') ILIKE $4 OR id::text ILIKE $4)",
        [
          tx.tenantId,
          tx.projectId,
          input.query.shotId ?? null,
          searchPattern(input.query),
        ],
        takeRecord,
      ),
    };
  });
  registerAction(app, context, "getTake", async (tx, input) => ({
    body: await getTake(tx, input.params.takeId!),
    etag: 1,
  }));
  registerAction(
    app,
    context,
    "createTake",
    async (tx, input) => ({
      body: await archiveTake(tx, input.body as Schema<"TakeInput">),
      etag: 1,
    }),
    {
      authorizeScope: async (tx, input) => {
        await findContent(tx, "shots", input.body.shotId);
        requireThat(
          (
            await tx.sql.query(
              "SELECT candidate_shot_active($1,$2,$3) AS active",
              [tx.tenantId, tx.projectId, input.body.shotId],
            )
          ).rows[0]?.active,
          422,
          "INVALID_CANDIDATE",
          "镜头或上级内容已归档，不能建立候选。",
        );
      },
    },
  );
  registerAction(app, context, "getSelection", async (tx, input) => {
    const shot = await findContent(tx, "shots", input.params.shotId!);
    const selection = shot.current_selection_id
      ? (
          await tx.sql.query(
            `${selectionSelect} WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.id=$3`,
            [tx.tenantId, tx.projectId, shot.current_selection_id],
          )
        ).rows[0]
      : undefined;
    return {
      body: {
        shotId: shot.id,
        revision: Number(shot.revision),
        ...(selection ? { currentSelection: selectionRecord(selection) } : {}),
      } satisfies Schema<"SelectionState">,
      etag: Number(shot.revision),
    };
  });
  registerAction(app, context, "listSelections", async (tx, input) => {
    await findContent(tx, "shots", input.params.shotId!);
    return {
      body: await page(
        tx,
        context.secrets,
        "listSelections",
        { ...input.query, shotId: input.params.shotId },
        `${selectionSelect} WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.shot_id=$3 AND (coalesce(s.reason,'') ILIKE $4 OR s.id::text ILIKE $4)`,
        [
          tx.tenantId,
          tx.projectId,
          input.params.shotId,
          searchPattern(input.query),
        ],
        selectionRecord,
      ),
    };
  });
  for (const operation of ["selectTake", "clearSelection"] as const)
    registerAction(app, context, operation, async (tx, input) => {
      const shot = await findContent(tx, "shots", input.params.shotId!);
      versionMatches(Number(shot.revision), input.version);
      const body =
        operation === "selectTake"
          ? (input.body as Schema<"SelectionInput">)
          : undefined;
      validText(body?.reason);
      const result = await tx.sql.query(
        "INSERT INTO selections(id,tenant_id,project_id,shot_id,number,take_id,selected_by,reason,supersedes_selection_id) VALUES($1,$2,$3,$4,coalesce((SELECT number FROM selections WHERE id=$5),0)+1,$6,$7,$8,$5) RETURNING *",
        [
          randomUUID(),
          tx.tenantId,
          tx.projectId,
          shot.id,
          shot.current_selection_id,
          body?.takeId ?? null,
          tx.session.userId,
          body?.reason ?? null,
        ],
      );
      return {
        body: selectionRecord(
          (
            await tx.sql.query(
              `${selectionSelect} WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.id=$3`,
              [tx.tenantId, tx.projectId, result.rows[0].id],
            )
          ).rows[0],
        ),
        etag: Number(shot.revision) + 1,
      };
    });
}
