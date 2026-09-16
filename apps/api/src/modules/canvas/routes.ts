import { projectWorkspaceRoutes } from "./project-workspace.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { inspectCanvasDocument } from "@drama/domain";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import { digest } from "../../kernel/crypto.js";
import { Problem, requireThat } from "../../kernel/errors.js";
import { findContent, type Schema } from "../content/model.js";
import { canvasUploadRoutes } from "./uploads.js";
import {
  canvasRoot,
  readCanvas,
  appendCanvas,
  historyPage,
  readPreference,
} from "./model.js";

import {
  readSceneCanvas,
  bindSceneNode,
  unbindSceneNode,
} from "./scene-bindings.js";

export function canvasRoutes(app: FastifyInstance, context: ApiContext) {
  canvasUploadRoutes(app, context);
  projectWorkspaceRoutes(app, context);
  registerAction(app, context, "ensureSceneCanvas", async (tx, input) => {
    const sceneId = input.params.sceneId!;
    await findContent(tx, "scenes", sceneId);
    await tx.sql.query(
      "SELECT id FROM scenes WHERE tenant_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",
      [tx.tenantId, tx.projectId, sceneId],
    );
    const existing = await tx.sql.query(
      "SELECT canvas_id FROM scene_canvas_links WHERE tenant_id=$1 AND project_id=$2 AND scene_id=$3",
      [tx.tenantId, tx.projectId, sceneId],
    );
    let id = existing.rows[0]?.canvas_id as string | undefined;
    if (!id) {
      id = randomUUID();
      await tx.sql.query(
        "INSERT INTO canvases(id,tenant_id,project_id,created_by) VALUES($1,$2,$3,$4)",
        [id, tx.tenantId, tx.projectId, tx.session.userId],
      );
      await appendCanvas(tx, id, { nodes: [], edges: [], groups: [] }, 1);
      await tx.sql.query(
        "INSERT INTO scene_canvas_links(tenant_id,project_id,scene_id,canvas_id) VALUES($1,$2,$3,$4)",
        [tx.tenantId, tx.projectId, sceneId, id],
      );
    }
    const result = await readSceneCanvas(tx, sceneId);
    return {
      body: result,
      etag: result.canvas.revision,
      auditObjectId: id,
    };
  });
  registerAction(app, context, "getSceneCanvas", async (tx, input) => {
    const sceneId = input.params.sceneId!;
    await findContent(tx, "scenes", sceneId);
    const result = await readSceneCanvas(tx, sceneId);
    return {
      body: result,
      etag: result.canvas.revision,
    };
  });
  registerAction(app, context, "bindSceneCanvasNode", async (tx, input) => {
    const body = await bindSceneNode(
      tx,
      input.params.sceneId!,
      input.params.nodeId!,
      input.version,
      input.body as Schema<"BindCanvasNode">,
    );
    return { body, etag: body.canvas.revision, auditObjectId: body.canvas.id };
  });
  registerAction(app, context, "unbindSceneCanvasNode", async (tx, input) => {
    const body = await unbindSceneNode(
      tx,
      input.params.sceneId!,
      input.params.nodeId!,
      input.params.bindingId!,
      input.version,
    );
    return { body, etag: body.canvas.revision, auditObjectId: body.canvas.id };
  });
  registerAction(app, context, "getCanvas", async (tx, input) => {
    const canvas = await readCanvas(tx, input.params.canvasId!);
    return { body: canvas, etag: canvas.revision };
  });
  registerAction(app, context, "saveCanvas", async (tx, input) => {
    const id = input.params.canvasId!,
      body = input.body as Schema<"SaveCanvas">;
    const root = await canvasRoot(tx, id, true);
    if (Number(root.revision) !== input.version)
      throw new Problem(
        412,
        "CANVAS_VERSION_CONFLICT",
        "画布已被更新，请保留本机修改并比较。",
        { currentRevision: Number(root.revision) },
      );
    const hash = digest(inspectCanvasDocument(body.document).canonical);
    const current = await readCanvas(tx, id);
    // Even a same-body retry must validate current reference access/status. A
    // revision append does this in SQL; do not bypass it on the idempotent path.
    if (hash === current.documentHash) {
      await tx.sql.query("SELECT validate_canvas_current_references($1)", [id]);
      return { body: current, etag: current.revision, auditObjectId: id };
    }
    const canvas = await appendCanvas(
      tx,
      id,
      body.document,
      current.revision + 1,
    );
    return { body: canvas, etag: canvas.revision, auditObjectId: id };
  });
  registerAction(app, context, "getCanvasRevision", async (tx, input) => {
    const canvas = await readCanvas(
      tx,
      input.params.canvasId!,
      Number(input.params.revisionNumber),
    );
    return { body: canvas, etag: canvas.revision };
  });
  registerAction(app, context, "listCanvasHistory", async (tx, input) => ({
    body: await historyPage(tx, context, input.params.canvasId!, input.query),
  }));
  registerAction(
    app,
    context,
    "getSceneWorkspacePreference",
    async (tx, input) => {
      await findContent(tx, "scenes", input.params.sceneId!);
      const preference = await readPreference(tx, input.params.sceneId!);
      return { body: preference, etag: preference.revision };
    },
  );
  registerAction(
    app,
    context,
    "saveSceneWorkspacePreference",
    async (tx, input) => {
      const sceneId = input.params.sceneId!;
      await findContent(tx, "scenes", sceneId);
      await tx.sql.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`scene-preference:${tx.session.userId}:${sceneId}`],
      );
      const old = await readPreference(tx, sceneId);
      requireThat(
        old.revision === input.version,
        412,
        "VERSION_CONFLICT",
        "个人视图偏好已更新，请重新读取后保存。",
      );
      await tx.sql.query(
        old.revision === 0
          ? `INSERT INTO scene_workspace_preferences(tenant_id,project_id,user_id,scene_id,revision,preference) VALUES($1,$2,$3,$4,$5,$6)`
          : `UPDATE scene_workspace_preferences SET revision=$5,preference=$6 WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3 AND scene_id=$4`,
        [
          tx.tenantId,
          tx.projectId,
          tx.session.userId,
          sceneId,
          old.revision + 1,
          input.body,
        ],
      );
      const preference = await readPreference(tx, sceneId);
      return {
        body: preference,
        etag: preference.revision,
        auditObjectId: sceneId,
      };
    },
  );
}
