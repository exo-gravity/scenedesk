import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { inspectWorkDocument, EDITING_HISTORY_POLICY } from "@drama/domain";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import { digest, canonical } from "../../kernel/crypto.js";
import { Problem, requireThat } from "../../kernel/errors.js";
import { page, searchPattern } from "../../kernel/pages.js";
import type { Schema } from "../content/model.js";
import {
  findCut,
  cutSelect,
  cutRecord,
  readWork,
  pruneWorkHistory,
  workHistory,
} from "./model.js";

export function editingRoutes(app: FastifyInstance, context: ApiContext) {
  registerAction(app, context, "listCuts", async (tx, input) => ({
    body: await page(
      tx,
      context.secrets,
      "listCuts",
      input.query,
      `${cutSelect} WHERE c.tenant_id=$1 AND c.project_id=$2 AND c.name ILIKE $3
      AND ($4::uuid IS NULL OR coalesce(c.episode_id,s.episode_id)=$4) AND ($5::uuid IS NULL OR c.scene_id=$5)`,
      [
        tx.tenantId,
        tx.projectId,
        searchPattern(input.query),
        input.query.episodeId ?? null,
        input.query.sceneId ?? null,
      ],
      cutRecord,
    ),
  }));
  registerAction(app, context, "getCut", async (tx, input) => {
    const cut = await findCut(tx, input.params.cutId!);
    return { body: cut, etag: cut.revision };
  });
  registerAction(app, context, "createCut", async (tx, input) => {
    const body = input.body as Schema<"CutInput">;
    requireThat(
      !Array.from(body.name).some(
        (c) =>
          c === "\0" ||
          (c.codePointAt(0)! >= 0xd800 && c.codePointAt(0)! <= 0xdfff),
      ),
      422,
      "INVALID_CUT_NAME",
      "剪辑名称包含无效字符。",
    );
    const project = (
      await tx.sql.query(
        "SELECT spec FROM projects WHERE tenant_id=$1 AND id=$2",
        [tx.tenantId, tx.projectId],
      )
    ).rows[0];
    if (body.sceneId && body.episodeId) {
      const scene = (
        await tx.sql.query(
          "SELECT episode_id FROM scenes WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
          [tx.tenantId, tx.projectId, body.sceneId],
        )
      ).rows[0];
      requireThat(
        scene?.episode_id === body.episodeId.toLowerCase(),
        422,
        "CUT_PARENT_MISMATCH",
        "场次与所选集不一致。",
      );
    }
    const timeline = {
      schemaVersion: "1",
      spec: project.spec,
      tracks: [{ id: randomUUID(), kind: "video", muted: false, items: [] }],
      burnSubtitles: false,
    };
    const id = randomUUID();
    await tx.sql.query(
      "INSERT INTO cuts(id,tenant_id,project_id,episode_id,scene_id,name,timeline,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        tx.tenantId,
        tx.projectId,
        body.sceneId ? null : (body.episodeId ?? null),
        body.sceneId ?? null,
        body.name,
        timeline,
        tx.session.userId,
      ],
    );
    return { body: await findCut(tx, id), etag: 1 };
  });
  registerAction(app, context, "getCutWorkDraft", async (tx, input) => {
    const work = await readWork(tx, await findCut(tx, input.params.cutId!));
    return { body: work, etag: work.revision };
  });
  registerAction(app, context, "saveCutWorkDraft", async (tx, input) => {
    const body = input.body as Schema<"SaveCutWorkDraft">;
    const cut = await findCut(tx, input.params.cutId!, true);
    await tx.sql.query(
      "SELECT revision FROM cut_work_drafts WHERE tenant_id=$1 AND project_id=$2 AND cut_id=$3 FOR UPDATE",
      [tx.tenantId, tx.projectId, cut.id],
    );
    requireThat(cut.status === "active", 409, "CUT_ARCHIVED", "剪辑已归档。");
    const work = await readWork(tx, cut);
    if (input.version !== work.revision)
      throw new Problem(
        412,
        "WORK_DRAFT_VERSION_CONFLICT",
        "工作稿已被更新，请保留本机内容并比较。",
        { currentRevision: work.revision },
      );
    requireThat(
      body.baseCutRevision === cut.revision ||
        (work.revision > 0 && body.baseCutRevision === work.baseCutRevision),
      409,
      "CUT_BASE_CHANGED",
      "请继续原工作稿基线，或明确比较后提交当前编排基线。",
    );
    const inspected = inspectWorkDocument(body.document);
    const hash = digest(inspected.canonical);
    requireThat(
      body.document.timingOrigins.length === 0,
      422,
      "INVALID_TIMING_ORIGIN",
      "没有可引用的同剪辑归一结果。",
    );
    if (
      work.revision > 0 &&
      work.documentHash === hash &&
      work.baseCutRevision === body.baseCutRevision
    )
      return { body: work, etag: work.revision, auditObjectId: cut.id };
    await tx.sql.query(
      "INSERT INTO edit_history_bodies(tenant_id,project_id,cut_id,hash,canonical_json) VALUES($1,$2,$3,$4,$5) ON CONFLICT(cut_id,hash) DO NOTHING",
      [tx.tenantId, tx.projectId, cut.id, hash, inspected.canonical],
    );
    await tx.sql.query(
      "INSERT INTO cut_work_draft_revisions(tenant_id,project_id,cut_id,revision,base_cut_revision,body_hash,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        tx.tenantId,
        tx.projectId,
        cut.id,
        work.revision + 1,
        body.baseCutRevision,
        hash,
        tx.session.userId,
      ],
    );
    await pruneWorkHistory(tx, cut.id);
    const saved = await readWork(tx, cut);
    return { body: saved, etag: saved.revision, auditObjectId: cut.id };
  });
  registerAction(app, context, "getCutWorkDraftRevision", async (tx, input) => {
    const work = await readWork(
      tx,
      await findCut(tx, input.params.cutId!),
      Number(input.params.revisionNumber),
    );
    return { body: work, etag: work.revision };
  });
  registerAction(app, context, "listCutWorkDraftHistory", async (tx, input) => {
    const cut = await findCut(tx, input.params.cutId!);
    const history = await workHistory(tx, cut.id);
    const current = await readWork(tx, cut);
    const cursorContext = canonical([
      "cutWorkHistory-v1",
      tx.session.userId,
      tx.tenantId,
      tx.projectId,
      cut.id,
    ]);
    let before = Infinity;
    if (input.query.cursor !== undefined) {
      try {
        before = context.secrets.open<number>(
          String(input.query.cursor),
          cursorContext,
        );
        requireThat(
          Number.isSafeInteger(before) && before > 0,
          422,
          "INVALID_CURSOR",
          "恢复列表游标无效。",
        );
      } catch {
        throw new Problem(
          422,
          "INVALID_CURSOR",
          "恢复列表游标无效或属于其他剪辑。",
        );
      }
    }
    const limit = Number(input.query.limit ?? 30);
    // Expired rows await physical pruning; they are no longer offered as
    // recovery points. Reading never changes current or historical content.
    const rows = history.rows.filter(
        (row) =>
          Number(row.revision) < before &&
          history.retained.has(Number(row.revision)),
      ),
      selected = rows.slice(0, limit);
    return {
      body: {
        items: selected.map((row) => ({
          revision: Number(row.revision),
          documentHash: row.body_hash,
          updatedAt: row.created_at.toISOString(),
          updatedBy: row.updated_by,
          retainedFor: [...history.retained.get(Number(row.revision))!],
        })),
        latestRevision: current.revision,
        policy: EDITING_HISTORY_POLICY,
        ...(rows.length > limit
          ? {
              nextCursor: context.secrets.seal(
                Number(selected.at(-1)!.revision),
                cursorContext,
              ),
            }
          : {}),
      },
    };
  });
}
