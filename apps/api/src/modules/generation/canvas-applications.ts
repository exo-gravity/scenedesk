import type { FastifyInstance } from "fastify";
import type { Transaction } from "../../kernel/database.js";
import { requireThat, versionMatches } from "../../kernel/errors.js";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import { appendCanvas, canvasRoot, readCanvas } from "../canvas/model.js";
import type { Schema } from "../content/model.js";
import { assertCanvasAssistanceAccess } from "./canvas-assistance.js";
import { safeText } from "./input-sources.js";
import { assertSelectedCurrent, validateReference } from "./prompt-input.js";

async function artifact(tx: Transaction, id: string, revision: number) {
  const row = (await tx.sql.query(
    `SELECT r.body,p.input,p.resolved_input,j.status FROM assistance_artifacts a
     JOIN assistance_artifact_revisions r ON r.artifact_id=a.id
     JOIN generation_jobs j ON j.id=a.generation_job_id JOIN generation_plans p ON p.id=j.plan_id
     WHERE a.tenant_id=$1 AND a.project_id=$2 AND a.id=$3 AND r.number=$4`,
    [tx.tenantId, tx.projectId, id, revision],
  )).rows[0];
  requireThat(row?.status === "succeeded" && row.resolved_input.canvasSnapshots?.length,
    409, "CANVAS_ASSISTANCE_UNAVAILABLE", "请选择此项目中已完成的固定画布建议修订。");
  await assertCanvasAssistanceAccess(tx, row.resolved_input);
  for (const reference of (row.body as Schema<"AssistanceBody">).referenceSuggestions)
    await validateReference(tx, reference);
  return row;
}

function receipt(row: Record<string, any>): Schema<"CanvasAssistanceApplication"> {
  return { id: row.id, canvasId: row.canvas_id, nodeId: row.node_id,
    artifactId: row.artifact_id, artifactRevision: Number(row.artifact_revision),
    mode: row.mode, baseCanvasRevision: Number(row.base_revision), resultCanvasRevision: Number(row.result_revision),
    beforePrompt: row.before_prompt, afterPrompt: row.after_prompt, appliedAt: row.created_at.toISOString() };
}
async function previous(tx: Transaction, canvasId: string, id: string) {
  return (await tx.sql.query(
    "SELECT * FROM canvas_assistance_applications WHERE tenant_id=$1 AND project_id=$2 AND canvas_id=$3 AND id=$4 AND created_by=$5",
    [tx.tenantId,tx.projectId,canvasId,id,tx.session.userId],
  )).rows[0];
}

export function canvasApplicationRoutes(app: FastifyInstance, context: ApiContext) {
  registerAction(app, context, "getCanvasAssistanceApplication", async (tx, input) => {
    const row = await previous(tx,input.params.canvasId!,input.params.applicationId!);
    requireThat(row,404,"CANVAS_ASSISTANCE_APPLICATION_NOT_FOUND","原建议应用回执不存在或无访问权限。");
    await artifact(tx,row.artifact_id,Number(row.artifact_revision));
    const canvas = await readCanvas(tx,row.canvas_id);
    return {body:{canvas,application:receipt(row)},etag:canvas.revision};
  });
  registerAction(app, context, "applyCanvasAssistance", async (tx,input) => {
    const canvasId=input.params.canvasId!, body=input.body as Schema<"ApplyCanvasAssistance">;
    await canvasRoot(tx,canvasId,true);
    const advice=await artifact(tx,body.artifactId,body.artifactRevision),
      saved=await previous(tx,canvasId,body.applicationId), canvas=await readCanvas(tx,canvasId);
    if (saved) {
      requireThat(saved.node_id===body.nodeId.toLowerCase() && saved.artifact_id===body.artifactId.toLowerCase() &&
        Number(saved.artifact_revision)===body.artifactRevision && saved.mode===body.mode && Number(saved.base_revision)===input.version,
        409,"CANVAS_ASSISTANCE_CONFLICT","原应用身份已固定到另一份建议、目标或版本，请保留原意图核对。");
      return {body:{canvas,application:receipt(saved)},etag:canvas.revision};
    }
    versionMatches(canvas.revision,input.version);
    await assertSelectedCurrent(tx,advice.resolved_input);
    const document=structuredClone(canvas.document), node=document.nodes.find((n)=>n.id===body.nodeId.toLowerCase()),
      request=advice.input.assistance as Schema<"AssistanceRequest">,
      target=(await tx.sql.query("SELECT * FROM generation_capabilities WHERE tenant_id=$1 AND id=$2",[tx.tenantId,request.targetCapabilityId])).rows[0];
    requireThat(target?.enabled && Number(target.revision)===request.targetCapabilityRevision &&
      target.connection_version_id===advice.resolved_input.targetConnectionVersionId,
      409,"TARGET_CAPABILITY_CHANGED","原建议的目标能力已变化，请保留草稿并核对。");
    requireThat(node?.content.type==="draft" && node.kind===target.definition.purpose &&
      node.content.capabilityId===target.id && node.content.connectionId===target.connection_id,
      422,"CANVAS_ASSISTANCE_TARGET_MISMATCH","请明确选择与此建议目标模型一致的已保存创作草稿。");
    const before=node.content.prompt,
      after=safeText(body.mode==="replace" ? advice.body.prompt : [before,advice.body.prompt].filter(Boolean).join("\n\n"));
    node.content.prompt=after;
    const result=await appendCanvas(tx,canvasId,document,canvas.revision+1);
    const row=(await tx.sql.query(
      `INSERT INTO canvas_assistance_applications(id,tenant_id,project_id,canvas_id,node_id,artifact_id,artifact_revision,mode,base_revision,result_revision,before_prompt,after_prompt,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [body.applicationId,tx.tenantId,tx.projectId,canvasId,node.id,body.artifactId,body.artifactRevision,body.mode,canvas.revision,result.revision,before,after,tx.session.userId],
    )).rows[0];
    return {body:{canvas:result,application:receipt(row)},etag:result.revision,auditObjectId:body.applicationId};
  }, {replayCachedResponse:()=>false});
}
