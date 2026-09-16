import { scriptDocumentRoutes } from "./script-documents.js";
import { insertEpisode, insertScene, insertShot } from "./commands.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../../kernel/routes.js";
import { registerAction } from "../../kernel/routes.js";
import { page } from "../../kernel/pages.js";
import { requireThat, versionMatches } from "../../kernel/errors.js";
import {
  activeParent,
  appendShotRevision,
  bumpContent,
  contentRecord,
  contentTree,
  contentVersion,
  findContent,
  shotSelect,
  specChanged,
  type Schema,
} from "./model.js";

export function contentRoutes(app: FastifyInstance, context: ApiContext) {
  scriptDocumentRoutes(app, context);
  registerAction(app, context, "getContent", async (tx) => {
    const body = await contentTree(tx);
    return { body, etag: body.revision };
  });
  registerAction(app, context, "listScripts", async (tx, input) => ({
    body: await page(
      tx,
      context.secrets,
      "listScripts",
      input.query,
      "SELECT id,project_id,number,revision,text,parent_revision_id,source_format,file_name,sha256,created_at FROM script_revisions WHERE tenant_id=$1 AND project_id=$2",
      [tx.tenantId, tx.projectId],
      contentRecord<Schema<"ScriptRevision">>,
    ),
  }));
  registerAction(app, context, "reviseScript", async (tx, input) => {
    const root = await contentVersion(tx, input.version);
    const body = input.body as Schema<"ScriptInput">;
    requireThat(
      !Array.from(body.text).some(
        (c) =>
          c === "\0" ||
          (c.codePointAt(0)! >= 0xd800 && c.codePointAt(0)! <= 0xdfff),
      ),
      422,
      "INVALID_SCRIPT_TEXT",
      "剧本含有无法保存的字符，请检查文本编码。",
    );
    requireThat(
      !body.parentRevisionId ||
        body.parentRevisionId.toLowerCase() === root.current_script_revision_id,
      409,
      "SCRIPT_PARENT_CHANGED",
      "父剧本必须是当前版本，请先核对最新原文。",
    );
    const created = await tx.sql.query(
      `INSERT INTO script_revisions (id,tenant_id,project_id,number,text,parent_revision_id)
      SELECT $1,$2,$3,coalesce(max(number),0)+1,$4,$5 FROM script_revisions WHERE tenant_id=$2 AND project_id=$3 RETURNING *`,
      [
        randomUUID(),
        tx.tenantId,
        tx.projectId,
        body.text,
        root.current_script_revision_id,
      ],
    );
    await tx.sql.query(
      "UPDATE project_content_versions SET revision=revision+1,current_script_revision_id=$3 WHERE tenant_id=$1 AND project_id=$2",
      [tx.tenantId, tx.projectId, created.rows[0].id],
    );
    return {
      body: contentRecord<Schema<"ScriptRevision">>(created.rows[0]),
      etag: 1,
    };
  });
  for (const [operation, insert] of [
    ["createEpisode", insertEpisode],
    ["createScene", insertScene],
    ["createShot", insertShot],
  ] as const) {
    registerAction(app, context, operation, async (tx, input) => {
      await contentVersion(tx, input.version);
      // Each operation's input is validated against its matching OpenAPI schema by registerAction.
      const saved = await insert(tx, input.body as never);
      await bumpContent(tx);
      return { body: saved, etag: saved.revision };
    });
  }
  registerAction(app, context, "updateEpisode", async (tx, input) => {
    const body = input.body as Schema<"EpisodeInput">,
      id = input.params.objectId!;
    versionMatches(
      Number((await findContent(tx, "episodes", id)).revision),
      input.version,
    );
    const result = await tx.sql.query(
      "UPDATE episodes SET title=$4,position=$5,status=$6,revision=revision+1,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND project_id=$3 RETURNING *",
      [id, tx.tenantId, tx.projectId, body.title, body.position, body.status],
    );
    await bumpContent(tx);
    const saved = contentRecord<Schema<"Episode">>(result.rows[0]);
    return { body: saved, etag: saved.revision };
  });
  registerAction(app, context, "updateScene", async (tx, input) => {
    const body = input.body as Schema<"SceneInput">,
      id = input.params.objectId!;
    versionMatches(
      Number((await findContent(tx, "scenes", id)).revision),
      input.version,
    );
    await activeParent(tx, "episodes", body.episodeId);
    const result = await tx.sql.query(
      "UPDATE scenes SET episode_id=$4,title=$5,position=$6,time_label=$7,location_label=$8,summary=$9,state=$10,default_asset_revision_ids=$11,status=$12,revision=revision+1,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND project_id=$3 RETURNING *",
      [
        id,
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
    await bumpContent(tx);
    const saved = contentRecord<Schema<"Scene">>(result.rows[0]);
    return { body: saved, etag: saved.revision };
  });
  registerAction(app, context, "updateShot", async (tx, input) => {
    const body = input.body as Schema<"ShotInput">,
      id = input.params.objectId!;
    const previous = await findContent(tx, "shots", id);
    versionMatches(Number(previous.revision), input.version);
    if (body.sceneId.toLowerCase() !== previous.scene_id) {
      const bound = await tx.sql.query(
        "SELECT id FROM production_tasks WHERE tenant_id=$1 AND project_id=$2 AND shot_id=$3 AND scene_id IS NOT NULL LIMIT 1",
        [tx.tenantId, tx.projectId, id],
      );
      requireThat(
        !bound.rows[0],
        409,
        "TASK_SCOPE_WOULD_CHANGE",
        "此镜头有绑定原场次的任务，请负责人先调整任务范围，再移动镜头。",
      );
    }
    await activeParent(tx, "scenes", body.sceneId);
    const old = await tx.sql.query(
      "SELECT number,spec FROM shot_revisions WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
      [tx.tenantId, tx.projectId, previous.current_revision_id],
    );
    const revisionId = specChanged(old.rows[0].spec, body.spec)
      ? await appendShotRevision(
          tx,
          id,
          body.spec,
          Number(old.rows[0].number) + 1,
        )
      : previous.current_revision_id;
    await tx.sql.query(
      "UPDATE shots SET scene_id=$4,label=$5,position=$6,current_revision_id=$7,status=$8,revision=revision+1,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND project_id=$3",
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
    await bumpContent(tx);
    const result = await tx.sql.query(
      `${shotSelect} WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.id=$3`,
      [tx.tenantId, tx.projectId, id],
    );
    const saved = contentRecord<Schema<"Shot">>(result.rows[0]);
    return { body: saved, etag: saved.revision };
  });
  registerAction(app, context, "listShotRevisions", async (tx, input) => {
    await findContent(tx, "shots", input.params.shotId!);
    return {
      body: await page(
        tx,
        context.secrets,
        `listShotRevisions:${input.params.shotId}`,
        input.query,
        "SELECT * FROM shot_revisions WHERE tenant_id=$1 AND project_id=$2 AND shot_id=$3",
        [tx.tenantId, tx.projectId, input.params.shotId],
        contentRecord<Schema<"ShotRevision">>,
      ),
    };
  });
  registerAction(app, context, "getShotRevision", async (tx, input) => {
    const result = await tx.sql.query(
      "SELECT * FROM shot_revisions WHERE tenant_id=$1 AND project_id=$2 AND shot_id=$3 AND id=$4",
      [tx.tenantId, tx.projectId, input.params.shotId, input.params.revisionId],
    );
    requireThat(
      result.rows[0],
      404,
      "NOT_FOUND",
      "镜头要求版本不存在或无访问权限。",
    );
    return {
      body: contentRecord<Schema<"ShotRevision">>(result.rows[0]),
      etag: 1,
    };
  });
  registerAction(app, context, "getFixedShotRevision", async (tx, input) => {
    const result = await tx.sql.query(
      "SELECT * FROM shot_revisions WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
      [tx.tenantId, tx.projectId, input.params.revisionId],
    );
    requireThat(
      result.rows[0],
      404,
      "NOT_FOUND",
      "镜头要求版本不存在或无访问权限。",
    );
    return {
      body: contentRecord<Schema<"ShotRevision">>(result.rows[0]),
      etag: 1,
    };
  });
  registerAction(
    app,
    context,
    "reorderContent",
    async (tx, input) => {
      await contentVersion(tx, input.version);
      const body = input.body as Schema<"Reorder">;
      const kinds = {
        episode: ["episodes", "project_id"],
        scene: ["scenes", "episode_id"],
        shot: ["shots", "scene_id"],
      } as const;
      const [table, parent] = kinds[body.kind];
      if (body.kind === "episode")
        requireThat(
          body.parentId.toLowerCase() === tx.projectId,
          422,
          "INVALID_PARENT",
          "单集重排必须属于当前项目。",
        );
      else
        await activeParent(
          tx,
          body.kind === "scene" ? "episodes" : "scenes",
          body.parentId,
        );
      const children = await tx.sql.query(
        `SELECT id FROM ${table} WHERE tenant_id=$1 AND project_id=$2 AND ${parent}=$3`,
        [tx.tenantId, tx.projectId, body.parentId],
      );
      const ids = body.orderedIds.map((id) => id.toLowerCase());
      requireThat(
        new Set(ids).size === ids.length &&
          ids.length === children.rowCount &&
          children.rows.every((row) => ids.includes(row.id)),
        422,
        "INCOMPLETE_CHILDREN",
        "排序必须包含该位置的全部内容（含归档项），且每项仅出现一次。",
      );
      await tx.sql.query(
        `UPDATE ${table} t SET position=ordering.ordinality-1,revision=revision+1,updated_at=now() FROM unnest($3::uuid[]) WITH ORDINALITY AS ordering(id,ordinality) WHERE t.tenant_id=$1 AND t.project_id=$2 AND t.id=ordering.id AND t.position<>ordering.ordinality-1`,
        [tx.tenantId, tx.projectId, ids],
      );
      await bumpContent(tx);
      const saved = await contentTree(tx);
      return { body: saved, etag: saved.revision };
    },
    {
      authorizeScope: async (tx, input) => {
        // The original POST may be replayed after its parent was archived.
        requireThat(
          (
            await tx.sql.query(
              "SELECT status FROM projects WHERE tenant_id=$1 AND id=$2",
              [tx.tenantId, tx.projectId],
            )
          ).rows[0]?.status === "active",
          409,
          "PROJECT_ARCHIVED",
          "项目已归档，请先恢复。",
        );
        const body = input.body as Schema<"Reorder">;
        if (body.kind !== "episode")
          await activeParent(
            tx,
            body.kind === "scene" ? "episodes" : "scenes",
            body.parentId,
          );
      },
    },
  );
}
