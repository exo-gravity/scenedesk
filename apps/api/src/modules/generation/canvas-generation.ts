import { services, type MediaContext } from "../media/model.js";
import { randomUUID } from "node:crypto";
import { CANVAS_RESULT_LAYOUT } from "@drama/domain";
import type { FastifyInstance } from "fastify";
import { requireThat, versionMatches } from "../../kernel/errors.js";
import { page, searchPattern } from "../../kernel/pages.js";
import { registerAction } from "../../kernel/routes.js";
import { activeParent } from "../content/model.js";
import {
  appendCanvas,
  canvasRoot,
  readCanvas,
  sceneCanvasId,
} from "../canvas/model.js";
import { createPlan, planRecord } from "./model.js";

const originSql = `jsonb_build_object('canvasId',o.canvas_id,'nodeId',o.node_id,'canvasRevision',o.canvas_revision,'inputFingerprint',o.input_fingerprint,'sourceNodeIds',o.source_node_ids)`;
export function canvasGenerationRoutes(
  app: FastifyInstance,
  context: MediaContext,
) {
  for (const operation of [
    "prepareCanvasGeneration",
    "prepareProjectCanvasGeneration",
  ] as const)
    registerAction(app, context, operation, async (tx, input) => {
      services(context);
      const canvasId =
        input.params.canvasId ??
        (await sceneCanvasId(tx, input.params.sceneId!));
      if (input.params.sceneId)
        await activeParent(tx, "scenes", input.params.sceneId);
      requireThat(
        (
          await tx.sql.query(
            "SELECT discussion_canvas_scope($1,$2,$3,true) AS scope",
            [tx.tenantId, tx.projectId, canvasId],
          )
        ).rows[0]?.scope,
        404,
        "CANVAS_CONTEXT_UNAVAILABLE",
        "画布不存在、已归档或无访问权限。",
      );
      await canvasRoot(tx, canvasId, true);
      const canvas = await readCanvas(tx, canvasId);
      versionMatches(canvas.revision, input.version);
      const node = canvas.document.nodes.find(
        (n) => n.id === input.body.nodeId.toLowerCase(),
      );
      requireThat(
        (node?.kind === "image" ||
          node?.kind === "video" ||
          node?.kind === "audio") &&
          node.content.type === "draft" &&
          node.content.connectionId &&
          node.content.capabilityId,
        422,
        "IMAGE_DRAFT_REQUIRED",
        "请保存一个已选模型能力的图片、视频或音频草稿。",
      );
      const plan = await createPlan(tx, {
        scope: "project",
        projectId: tx.projectId!,
        purpose: node.kind,
        connectionId: node.content.connectionId,
        capabilityId: node.content.capabilityId,
        prompt: node.content.prompt,
        output: node.content.output,
        shotSources: input.body.shotSources,
        referenceOverrides: input.body.referenceOverrides,
        additionalReferences: [],
        promptPolicy: input.body.promptPolicy,
        contextSources: [
          {
            kind: "canvas_draft",
            objectId: node.id,
            revision: canvas.revision,
          },
        ],
      });
      const origin = (
        await tx.sql.query(
          `SELECT ${originSql} AS origin FROM generation_canvas_origins o WHERE plan_id=$1`,
          [plan.id],
        )
      ).rows[0].origin;
      return { body: { plan, origin } };
    });
  registerAction(app, context, "listCanvasPlans", async (tx, input) => {
    await canvasRoot(tx, input.params.canvasId!);
    return {
      body: await page(
        tx,
        context.secrets,
        `listCanvasPlans:${input.params.canvasId}`,
        input.query,
        `SELECT p.*,${originSql} AS origin,j.id AS job_id,j.status AS job_status FROM generation_canvas_origins o JOIN generation_plans p ON p.id=o.plan_id LEFT JOIN generation_jobs j ON j.plan_id=p.id WHERE o.tenant_id=$1 AND o.project_id=$2 AND o.canvas_id=$3 AND ($4::uuid IS NULL OR o.node_id=$4) AND p.input->>'prompt' ILIKE $5`,
        [
          tx.tenantId,
          tx.projectId,
          input.params.canvasId,
          input.query.nodeId ?? null,
          searchPattern(input.query),
        ],
        (row) => ({
          plan: planRecord(row),
          origin: row.origin,
          ...(row.job_id
            ? { jobId: row.job_id, jobStatus: row.job_status }
            : {}),
        }),
      ),
    };
  });
  registerAction(
    app,
    context,
    "materializeCanvasResults",
    async (tx, input) => {
      const canvasId = input.params.canvasId!;
      await canvasRoot(tx, canvasId, true);
      const canvas = await readCanvas(tx, canvasId);
      versionMatches(canvas.revision, input.version);
      const job = (
        await tx.sql.query(
          "SELECT j.id,j.status FROM generation_jobs j JOIN generation_canvas_origins o ON o.plan_id=j.plan_id WHERE j.tenant_id=$1 AND j.project_id=$2 AND j.id=$3 AND o.canvas_id=$4",
          [tx.tenantId, tx.projectId, input.body.jobId, canvasId],
        )
      ).rows[0];
      requireThat(
        job?.status === "succeeded",
        409,
        "CANVAS_RESULT_UNAVAILABLE",
        "请选择来自此画布且已验证归档的完成任务。",
      );
      const placements: { mediaId: string; nodeId: string }[] = [],
        pending: { mediaId: string; nodeId: string }[] = [],
        document = structuredClone(canvas.document);
      let changed = false;
      for (const [index, rawId] of (
        input.body.mediaIds as string[]
      ).entries()) {
        const mediaId = rawId.toLowerCase(),
          media = (
            await tx.sql.query(
              "SELECT id,kind,display_name FROM media WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND source_job_id=$4 AND status='ready'",
              [tx.tenantId, tx.projectId, mediaId, job.id],
            )
          ).rows[0];
        requireThat(
          media && ["image", "video", "audio"].includes(media.kind),
          422,
          "CANVAS_RESULT_UNAVAILABLE",
          "结果必须是该任务的可用图片、视频或音频，不能加入别处素材。",
        );
        const previous = (
          await tx.sql.query(
            "SELECT node_id FROM generation_canvas_results WHERE canvas_id=$1 AND job_id=$2 AND media_id=$3",
            [canvasId, job.id, mediaId],
          )
        ).rows[0];
        const nodeId = previous?.node_id ?? randomUUID();
        placements.push({ mediaId, nodeId });
        if (!document.nodes.some((node) => node.id === nodeId)) {
          requireThat(
            document.nodes.length < 2000,
            422,
            "CANVAS_CAPACITY_EXCEEDED",
            "画布节点数量已达上限，请整理后添加结果。",
          );
          document.nodes.push({
            id: nodeId,
            kind: media.kind,
            title: media.display_name,
            width: CANVAS_RESULT_LAYOUT.width,
            position: {
              x: input.body.position.x + index * CANVAS_RESULT_LAYOUT.stepX,
              y: input.body.position.y,
            },
            content: { type: "media", mediaId },
          });
          changed = true;
        }
        if (!previous) pending.push({ mediaId, nodeId });
      }
      const saved = changed
        ? await appendCanvas(tx, canvasId, document, canvas.revision + 1)
        : canvas;
      for (const placement of pending)
        await tx.sql.query(
          "INSERT INTO generation_canvas_results(tenant_id,project_id,canvas_id,job_id,media_id,node_id) VALUES($1,$2,$3,$4,$5,$6)",
          [
            tx.tenantId,
            tx.projectId,
            canvasId,
            job.id,
            placement.mediaId,
            placement.nodeId,
          ],
        );
      return { body: { canvas: saved, placements }, etag: saved.revision };
    },
  );
}
