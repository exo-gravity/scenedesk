import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Transaction } from "../../kernel/database.js";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import { requireThat, versionMatches } from "../../kernel/errors.js";
import type { Schema } from "../content/model.js";
import { appendCanvas, readCanvas, defaultScenePreference } from "./model.js";

async function readProjectCanvas(
  tx: Transaction,
): Promise<Schema<"ProjectCanvas">> {
  const link = await tx.sql.query(
    "SELECT canvas_id FROM project_canvas_links WHERE tenant_id=$1 AND project_id=$2",
    [tx.tenantId, tx.projectId],
  );
  requireThat(
    link.rows[0],
    404,
    "PROJECT_CANVAS_NOT_CREATED",
    "项目画布尚未创建，可直接开始创作。",
  );
  return {
    projectId: tx.projectId!,
    canvas: await readCanvas(tx, link.rows[0].canvas_id),
  };
}
async function readPreference(
  tx: Transaction,
): Promise<Schema<"ProjectWorkspacePreference">> {
  const result = await tx.sql.query(
    "SELECT revision,preference FROM project_workspace_preferences WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",
    [tx.tenantId, tx.projectId, tx.session.userId],
  );
  const row = result.rows[0];
  return {
    projectId: tx.projectId!,
    revision: Number(row?.revision ?? 0),
    ...(row?.preference ?? {
      ...defaultScenePreference,
      mode: "canvas",
      selectedShotId: null,
    }),
  };
}
export function projectWorkspaceRoutes(
  app: FastifyInstance,
  context: ApiContext,
) {
  registerAction(app, context, "getProjectCanvas", async (tx) => {
    const body = await readProjectCanvas(tx);
    return { body, etag: body.canvas.revision };
  });
  registerAction(
    app,
    context,
    "ensureProjectCanvas",
    async (tx) => {
      // Serialize explicit creation on the project, including different idempotency keys.
      await tx.sql.query(
        "SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [tx.tenantId, tx.projectId],
      );
      const existing = await tx.sql.query(
        "SELECT canvas_id FROM project_canvas_links WHERE tenant_id=$1 AND project_id=$2",
        [tx.tenantId, tx.projectId],
      );
      if (!existing.rows[0]) {
        const id = randomUUID();
        await tx.sql.query(
          "INSERT INTO canvases(id,tenant_id,project_id,created_by) VALUES($1,$2,$3,$4)",
          [id, tx.tenantId, tx.projectId, tx.session.userId],
        );
        await appendCanvas(tx, id, { nodes: [], edges: [], groups: [] }, 1);
        await tx.sql.query(
          "INSERT INTO project_canvas_links(tenant_id,project_id,canvas_id) VALUES($1,$2,$3)",
          [tx.tenantId, tx.projectId, id],
        );
      }
      const body = await readProjectCanvas(tx);
      return {
        body,
        etag: body.canvas.revision,
        auditObjectId: body.canvas.id,
      };
    },
    {
      authorizeScope: async (tx) => {
        const project = await tx.sql.query(
          "SELECT status FROM projects WHERE tenant_id=$1 AND id=$2",
          [tx.tenantId, tx.projectId],
        );
        requireThat(
          project.rows[0]?.status === "active",
          409,
          "PROJECT_ARCHIVED",
          "项目已归档，不能创建画布。",
        );
      },
    },
  );
  registerAction(app, context, "getProjectWorkspacePreference", async (tx) => {
    const body = await readPreference(tx);
    return { body, etag: body.revision };
  });
  registerAction(
    app,
    context,
    "saveProjectWorkspacePreference",
    async (tx, input) => {
      await tx.sql.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`project-preference:${tx.session.userId}:${tx.projectId}`],
      );
      const old = await readPreference(tx);
      versionMatches(old.revision, input.version);
      await tx.sql.query(
        old.revision === 0
          ? "INSERT INTO project_workspace_preferences(tenant_id,project_id,user_id,revision,preference) VALUES($1,$2,$3,$4,$5)"
          : "UPDATE project_workspace_preferences SET revision=$4,preference=$5 WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",
        [
          tx.tenantId,
          tx.projectId,
          tx.session.userId,
          old.revision + 1,
          input.body,
        ],
      );
      const body = await readPreference(tx);
      return { body, etag: body.revision, auditObjectId: tx.projectId! };
    },
    { readOnly: true },
  );
}
