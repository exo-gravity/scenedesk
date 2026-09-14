import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createAssistanceFixture, localAssistanceFixtureOutput, type AssistanceSubmission } from "@drama/provider";
import { imageGenerationFixture } from "../support/image-generation.js";
import { createAssistanceWorker } from "../../apps/api/src/modules/generation/worker.js";

test("canvas follow-up turns use authorized fixed advice without copying client history", async (t) => {
  const f = await imageGenerationFixture(t), cap = randomUUID(), connection = randomUUID(), version = randomUUID();
  await f.admin.query(`INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
    [cap,f.tenant.id,connection,version,{purpose:"creative_assistance",mode:"fixture",modelVersion:"连续改稿技术验收",supportedPurposes:["composition"],maxReferences:20}]);
  const textId = randomUUID(), mediaNode = randomUUID(), mediaId = randomUUID(), upload = randomUUID();
  // Storage/decoder acceptance is covered by the separate complete media suite.
  await f.admin.query(`INSERT INTO ${f.scope}.upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch) VALUES($1,$2,$3,'project',$4,64,$5,'reply.png','image/png','固定历史参考',$6,'accepted',now()+interval '15 minutes','fixture-version',1)`,[upload,f.tenant.id,f.project.id,`staging/${upload}`,"a".repeat(64),f.owner.userId]);
  await f.admin.query(`INSERT INTO ${f.scope}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio) VALUES($1,$2,$3,'project','image','ready','固定历史参考','reply.png',$4,$5,$6,'fixture-version',$7,64,'image/png',32,32,false)`,[mediaId,f.tenant.id,f.project.id,f.owner.userId,upload,`originals/${mediaId}`,"a".repeat(64)]);
  const ensured = await f.request("POST",`${f.path}/scenes/${f.scene.id}/canvas`);
  assert.equal(ensured.statusCode,200,ensured.body);
  let canvas = ensured.json().canvas;
  const save = async (text: string) => {
    canvas = await f.ok("PUT",`${f.path}/canvases/${canvas.id}`,{schemaVersion:1,document:{nodes:[
      {id:textId,kind:"text",title:"本轮明确选区",position:{x:0,y:0},width:280,content:{type:"text",text}},
      {id:mediaNode,kind:"image",title:"历史参考",position:{x:300,y:0},width:280,content:{type:"media",mediaId}},
    ],edges:[],groups:[]}},canvas.revision);
  };
  await save("最初明确的画面材料");
  const input = (source?: {artifactId: string; revision: number}, withMedia = false) => ({
    ...f.input, connectionId:connection, capabilityId:cap, purpose:"creative_assistance", output:{}, shotSources:[],
    prompt:source ? "进一步收敛动作，保持简短" : "围绕钥匙准备最初建议", contextSources:[],
    canvasSources:[{canvasId:canvas.id,canvasRevision:canvas.revision,nodeId:textId},
      ...(withMedia ? [{canvasId:canvas.id,canvasRevision:canvas.revision,nodeId:mediaNode,purpose:"composition"}] : [])],
    assistance:{kind:"prepare_prompt",targetCapabilityId:f.input.capabilityId,targetCapabilityRevision:1},
    ...(source ? {assistanceSource:source} : {}),
  });
  let calls = 0, uncertain = false, last: AssistanceSubmission | undefined;
  const output = (submission: AssistanceSubmission) => ({...localAssistanceFixtureOutput(submission),prompt:`建议：${submission.input.prompt}`});
  const worker = await createAssistanceWorker({pool:f.generationDb,schema:f.schema,adapters:[createAssistanceFixture(version,
    async submission => {calls++;last=submission;return uncertain ? {kind:"unknown",correlation:submission.attemptId} : {kind:"completed",correlation:submission.attemptId,output:output(submission)};},
    async submission => uncertain ? null : {kind:"completed",correlation:submission.attemptId,output:output(submission)},
  )]});
  const finish = async (plan: any) => {
    const job = await f.execute(plan.id);await worker.process(job.id);
    const complete = await f.job(job.id);assert.equal(complete.status,"succeeded");
    return f.ok("GET",`${f.path}/assistance-artifacts/${complete.assistanceArtifactId}`);
  };
  const firstInput = input(undefined,true), first = await finish(await f.ok("POST",`${f.base}/generation-plans`,firstInput));
  const source = {artifactId:first.id,revision:first.revision};
  let second: any, secondPlan: any;

  await t.test("a second turn fixes the selected old revision and original instruction while current nodes remain independent",async()=>{
    await f.ok("PUT",`${f.path}/assistance-artifacts/${first.id}`,{body:{...first.body,prompt:"后续人工版本不得代替打开的旧建议"}},first.revision);
    await save("本轮重新固定的画面材料");
    secondPlan = await f.ok("POST",`${f.base}/generation-plans`,input(source));
    assert.deepEqual(secondPlan.resolvedInput.assistanceSnapshot,first.body);
    assert.equal(secondPlan.resolvedInput.assistanceInstruction,firstInput.prompt);
    assert.equal(secondPlan.resolvedInput.prompt,"进一步收敛动作，保持简短");
    assert.deepEqual(secondPlan.resolvedInput.references,[]);
    assert.equal(secondPlan.resolvedInput.canvasSnapshots[0].content.text,"本轮重新固定的画面材料");
    const dep = secondPlan.resolvedInput.dependencies.find((d:any)=>d.kind==="assistance_artifact");
    assert.equal(dep.objectId,first.id);assert.equal(dep.revision,1);assert.equal(dep.tracking,"fixed");
    assert.match(dep.contentHash,/^[a-f0-9]{64}$/);
    second = await finish(secondPlan);
    assert.deepEqual(last!.resolvedInput.assistanceSnapshot,first.body);
    assert.equal(last!.resolvedInput.assistanceInstruction,firstInput.prompt);
    assert.equal((await f.ok("GET",`${f.path}/assistance-artifacts/${first.id}`)).revision,2);
  });
  await t.test("follow-up retains stale checks, exact target identity and project isolation",async()=>{
    const stale = input(source);stale.canvasSources[0]!.canvasRevision--;
    assert.equal((await f.request("POST",`${f.base}/generation-plans`,stale)).statusCode,412);
    const wrong = input(source);wrong.assistance.targetCapabilityId=randomUUID();
    assert.equal((await f.request("POST",`${f.base}/generation-plans`,wrong)).json().code,"ASSISTANCE_REPLY_TARGET_MISMATCH");
    const foreign = await f.createProject("另一项目的建议");
    const prefix = `${f.base}/projects/${foreign.id}`;
    const ep = await f.ok("POST",`${prefix}/episodes`,{title:"一",position:0,status:"active"},1);
    const scene = await f.ok("POST",`${prefix}/scenes`,{episodeId:ep.id,title:"另一场",summary:"仅另一项目可用",position:0,state:{},status:"active"},2);
    const ensured = await f.request("POST",`${prefix}/scenes/${scene.id}/canvas`);assert.equal(ensured.statusCode,200,ensured.body);
    const foreignCanvas = ensured.json().canvas, foreignNode = randomUUID();
    const saved = await f.ok("PUT",`${prefix}/canvases/${foreignCanvas.id}`,{schemaVersion:1,document:{nodes:[{id:foreignNode,kind:"text",title:"外部材料",position:{x:0,y:0},width:280,content:{type:"text",text:"另一项目的固定内容"}}],edges:[],groups:[]}},foreignCanvas.revision);
    const foreignInput = {...input(),projectId:foreign.id,canvasSources:[{canvasId:saved.id,canvasRevision:saved.revision,nodeId:foreignNode}]};
    const foreignPlan = await f.ok("POST",`${f.base}/generation-plans`,foreignInput), job = await f.execute(foreignPlan.id);await worker.process(job.id);
    const foreignArtifactId = (await f.job(job.id)).assistanceArtifactId;
    const denied = await f.request("POST",`${f.base}/generation-plans`,input({artifactId:foreignArtifactId,revision:1}));
    assert.equal(denied.json().code,"ASSISTANCE_REPLY_UNAVAILABLE");
    assert.equal((await f.request("POST",`${f.base}/generation-plans`,{...input(source),assistanceSnapshot:first.body})).statusCode,422);
  });
  await t.test("restricted SQL cannot replace prior advice or instruction even with a recomputed whole-input hash",async()=>{
    const current = await f.ok("POST",`${f.base}/generation-plans`,input(source));
    const columns = (await f.admin.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='generation_plans' AND is_generated='NEVER' ORDER BY ordinal_position",[f.schema])).rows.map(r=>r.column_name as string);
    for (const change of ["body","instruction","dependency"]) {
      const sql = await f.runtime.connect();
      try {
        await sql.query("BEGIN");await sql.query(`SET LOCAL search_path TO ${f.scope},pg_catalog`);
        await sql.query("SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",[f.owner.userId,f.tenant.id]);
        const resolved = structuredClone(current.resolvedInput);
        if (change==="body") resolved.assistanceSnapshot.prompt="伪造前轮产物";
        if (change==="instruction") resolved.assistanceInstruction="伪造用户曾经要求";
        if (change==="dependency") resolved.dependencies.find((d:any)=>d.kind==="assistance_artifact").revision=2;
        await assert.rejects(sql.query(`INSERT INTO generation_plans(${columns.map(c=>'"'+c+'"').join(',')}) SELECT ${columns.map(c=>c==='id'?'$2::uuid':c==='resolved_input'?'$3::jsonb':c==='input_hash'?'rework_input_hash(input,$3::jsonb,capability_revision,connection_version_id)':'"'+c+'"').join(',')} FROM generation_plans WHERE id=$1`,[current.id,randomUUID(),resolved]),(e:any)=>e.code==="23514");
      } finally {await sql.query("ROLLBACK");sql.release();}
    }
  });
  await t.test("an unknown follow-up recovers its original attempt and fixed turn without resubmission",async()=>{
    uncertain=true;
    const p = await f.ok("POST",`${f.base}/generation-plans`,input({artifactId:second.id,revision:1})),j = await f.execute(p.id),before=calls;
    await worker.process(j.id);await worker.process(j.id);
    assert.equal((await f.job(j.id)).status,"submission_unknown");
    await save("未知提交期间编辑的新本轮材料");
    uncertain=false;await worker.reconcile(j.id);
    assert.equal((await f.job(j.id)).status,"succeeded");assert.equal(calls,before+1);
    assert.deepEqual(last!.resolvedInput.assistanceSnapshot,second.body);
    assert.equal((await f.admin.query(`SELECT count(*)::int n FROM ${f.scope}.generation_attempts WHERE job_id=$1`,[j.id])).rows[0].n,1);
  });
  await t.test("current project revocation blocks cached continuation and prevents its queued provider call",async()=>{
    const actor=await f.identity("reply-collaborator"),membership=randomUUID();
    await f.admin.query(`INSERT INTO ${f.scope}.memberships(id,tenant_id,user_id,role,status) VALUES($1,$2,$3,'member','active')`,[membership,f.tenant.id,actor.userId]);
    await f.admin.query(`INSERT INTO ${f.scope}.project_memberships(id,tenant_id,project_id,membership_id,role) VALUES($1,$2,$3,$4,'collaborator')`,[randomUUID(),f.tenant.id,f.project.id,membership]);
    const body=input(source),key=randomUUID(),executeKey=randomUUID();
    const prepared=await f.request("POST",`${f.base}/generation-plans`,body,undefined,key,actor);
    assert.equal(prepared.statusCode,201,prepared.body);
    const executeBody={planId:prepared.json().id},started=await f.request("POST",`${f.base}/generation-jobs`,executeBody,undefined,executeKey,actor);
    assert.equal(started.statusCode,202,started.body);
    await f.admin.query(`DELETE FROM ${f.scope}.project_memberships WHERE project_id=$1 AND membership_id=$2`,[f.project.id,membership]);
    for (const denied of [
      await f.request("POST",`${f.base}/generation-plans`,body,undefined,key,actor),
      await f.request("POST",`${f.base}/generation-jobs`,executeBody,undefined,executeKey,actor),
      await f.request("GET",`${f.path}/assistance-artifacts/${first.id}/revisions/1`,undefined,undefined,randomUUID(),actor),
    ]) assert.ok([403,404].includes(denied.statusCode),denied.body);
    const before=calls;await worker.process(started.json().id);assert.equal(calls,before);
    assert.equal((await f.admin.query(`SELECT status FROM ${f.scope}.generation_jobs WHERE id=$1`,[started.json().id])).rows[0].status,"cancelled");
  });
  await t.test("archiving an earlier turn's media blocks cached retries, history access and the next queued dispatch",async()=>{
    const body = input({artifactId:second.id,revision:1}),key = randomUUID();
    const prepared = await f.request("POST",`${f.base}/generation-plans`,body,undefined,key);assert.equal(prepared.statusCode,201,prepared.body);
    const j = await f.execute(prepared.json().id),before=calls;
    await f.admin.query(`UPDATE ${f.scope}.media SET status='archived',revision=revision+1 WHERE id=$1`,[mediaId]);
    assert.equal((await f.request("POST",`${f.base}/generation-plans`,body,undefined,key)).json().code,"ASSISTANCE_REPLY_UNAVAILABLE");
    assert.equal((await f.request("GET",`${f.base}/generation-plans/${secondPlan.id}`)).json().code,"ASSISTANCE_REPLY_UNAVAILABLE");
    assert.equal((await f.request("GET",`${f.path}/assistance-artifacts/${second.id}`)).json().code,"ASSISTANCE_REPLY_UNAVAILABLE");
    assert.equal((await f.request("POST",`${f.base}/generation-jobs`,{planId:prepared.json().id})).json().code,"ASSISTANCE_REPLY_UNAVAILABLE");
    await worker.process(j.id);assert.equal(calls,before);
    assert.equal((await f.admin.query(`SELECT status FROM ${f.scope}.generation_jobs WHERE id=$1`,[j.id])).rows[0].status,"cancelled");
  });
});
