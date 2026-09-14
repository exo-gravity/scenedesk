import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAssistanceFixture, localAssistanceFixtureOutput, type AssistanceSubmission } from "@drama/provider";
import { imageGenerationFixture } from "../support/image-generation.js";
import { createAssistanceWorker } from "../../apps/api/src/modules/generation/worker.js";

test("explicit canvas assistance preserves node identity, authorization and CAS application receipts", async (t) => {
  const f=await imageGenerationFixture(t), cap=randomUUID(), connection=randomUUID(), version=randomUUID();
  await f.admin.query(`INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
    [cap,f.tenant.id,connection,version,{purpose:"creative_assistance",mode:"fixture",modelVersion:"明确技术测试",supportedPurposes:["composition","look"],maxReferences:20}]);
  const response=await f.request("POST",`${f.path}/scenes/${f.scene.id}/canvas`);
  assert.equal(response.statusCode,200,response.body);
  let canvas=response.json().canvas;
  const textId=randomUUID(),draftId=randomUUID(),hiddenId=randomUUID(),mediaId=randomUUID(),upload=randomUUID();
  // Relational media evidence only; this does not claim object decoding or model quality.
  await f.admin.query(`INSERT INTO ${f.scope}.upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch) VALUES($1,$2,$3,'project',$4,64,$5,'fixture.png','image/png','关系测试图',$6,'accepted',now()+interval '15 minutes','fixture-version',1)`,[upload,f.tenant.id,f.project.id,`staging/${upload}`,"a".repeat(64),f.owner.userId]);
  await f.admin.query(`INSERT INTO ${f.scope}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio) VALUES($1,$2,$3,'project','image','ready','关系测试图','fixture.png',$4,$5,$6,'fixture-version',$7,64,'image/png',32,32,false)`,[mediaId,f.tenant.id,f.project.id,f.owner.userId,upload,`originals/${mediaId}`,"a".repeat(64)]);
  const mediaNode=randomUUID();
  const save=async(document=canvas.document)=>{canvas=await f.ok("PUT",`${f.path}/canvases/${canvas.id}`,{schemaVersion:1,document},canvas.revision);return canvas;};
  await save({nodes:[
    {id:textId,kind:"text",title:"选中想法",position:{x:0,y:0},width:280,content:{type:"text",text:'固定😀文本 é 与 é " 引号\\'}},
    {id:draftId,kind:"image",title:"当前草稿",position:{x:400,y:0},width:280,content:{type:"draft",prompt:"原手工提示",output:f.input.output,connectionId:f.input.connectionId,capabilityId:f.input.capabilityId}},
    {id:hiddenId,kind:"text",title:"未选择",position:{x:0,y:400},width:280,content:{type:"text",text:"绝不能隐式读取的相邻秘密"}},
    {id:mediaNode,kind:"image",title:"固定媒体",position:{x:400,y:400},width:280,content:{type:"media",mediaId}},
  ],edges:[{id:randomUUID(),sourceNodeId:hiddenId,targetNodeId:draftId,enabled:true,position:0,purpose:"prompt"}],groups:[]});
  const input=(ids=[textId,draftId])=>({...f.input,purpose:"creative_assistance",connectionId:connection,capabilityId:cap,output:{},shotSources:[],contextSources:[],additionalReferences:[],referenceOverrides:[],prompt:"改写明确选中材料",canvasSources:ids.map(nodeId=>({canvasId:canvas.id,canvasRevision:canvas.revision,nodeId,...(nodeId===mediaNode?{purpose:"composition"}:{})})),assistance:{kind:"prepare_prompt",targetCapabilityId:f.input.capabilityId,targetCapabilityRevision:1}});
  const prepare=()=>f.ok("POST",`${f.base}/generation-plans`,input());
  let calls=0,unknown=false,last:AssistanceSubmission|undefined;
  const output=(s:AssistanceSubmission)=>({...localAssistanceFixtureOutput(s),prompt:"明确建议的新提示"});
  const worker=await createAssistanceWorker({pool:f.generationDb,schema:f.schema,adapters:[createAssistanceFixture(version,async(s)=>{calls++;last=s;return unknown?{kind:"unknown",correlation:s.attemptId}:{kind:"completed",correlation:s.attemptId,output:output(s)};},async(s)=>unknown?null:{kind:"completed",correlation:s.attemptId,output:output(s)})]});
  let plan:any,job:any,artifact:any;
  await t.test("zero shots fixes only explicit ordered node bodies, without edges or neighbouring content",async()=>{
    plan=await prepare();
    assert.deepEqual(plan.resolvedInput.shots,[]);
    assert.deepEqual(plan.resolvedInput.references,[]);
    assert.deepEqual(plan.resolvedInput.canvasSnapshots.map((s:any)=>s.source.nodeId),[textId,draftId]);
    assert.equal(plan.resolvedInput.canvasSnapshots[0].content.text,canvas.document.nodes[0].content.text);
    assert.ok(!JSON.stringify(plan.resolvedInput).includes("相邻秘密"));
    assert.equal((await f.admin.query(`SELECT count(*)::int n FROM ${f.scope}.generation_plan_shots WHERE plan_id=$1`,[plan.id])).rows[0].n,0);
    assert.equal((await f.admin.query(`SELECT count(*)::int n FROM ${f.scope}.generation_canvas_contexts WHERE plan_id=$1`,[plan.id])).rows[0].n,2);
  });
  await t.test("old revision, duplicate source, cross-project canvas and unsupported media purpose are rejected",async()=>{
    const stale=input();stale.canvasSources[0]!.canvasRevision--;
    assert.equal((await f.request("POST",`${f.base}/generation-plans`,stale)).statusCode,412);
    const duplicate=input([textId,textId]);
    assert.equal((await f.request("POST",`${f.base}/generation-plans`,duplicate)).json().code,"DUPLICATE_CANVAS_SOURCE");
    const cross={...input(),projectId:(await f.createProject("另一个项目")).id};
    assert.equal((await f.request("POST",`${f.base}/generation-plans`,cross)).statusCode,404);
    const wrong=input([mediaNode]);wrong.canvasSources[0]!.purpose="voice";
    assert.equal((await f.request("POST",`${f.base}/generation-plans`,wrong)).json().code,"TARGET_REFERENCE_UNSUPPORTED");
    const mediaPlan=await f.ok("POST",`${f.base}/generation-plans`,input([mediaNode]));
    assert.equal(mediaPlan.resolvedInput.references[0].reference.mediaId,mediaId);
    const restricted=randomUUID();
    await f.admin.query(`INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) SELECT $1,tenant_id,connection_id,connection_version_id,revision,jsonb_set(definition,'{inputRules}', $2::jsonb),execution_mode,true,max_inflight,max_daily_jobs FROM ${f.scope}.generation_capabilities WHERE id=$3`,
      [restricted,JSON.stringify([{kind:"image",purposes:["composition"],mimeTypes:["image/png"],minCount:0,maxCount:1,maxBytes:32}]),f.input.capabilityId]);
    const tooLarge=input([mediaNode]);tooLarge.assistance.targetCapabilityId=restricted;
    assert.equal((await f.request("POST",`${f.base}/generation-plans`,tooLarge)).json().code,"ASSISTANCE_REFERENCE_UNSUPPORTED");
  });
  await t.test("layout changes do not invalidate fixed text; changed selected content blocks unsubmitted plans",async()=>{
    const changed=await prepare(),doc=structuredClone(canvas.document);
    doc.nodes[0].content.text="修改后正文";
    await save(doc);
    assert.equal((await f.request("POST",`${f.base}/generation-jobs`,{planId:changed.id})).json().code,"PLAN_INPUT_CHANGED");
    plan=await prepare();
    const moved=structuredClone(canvas.document);moved.nodes[0].position.x+=10;moved.nodes[0].title="仅改标题";await save(moved);
    job=await f.execute(plan.id);
    const later=structuredClone(canvas.document);later.nodes[0].content.text="执行后的新稿，不能替换已执行文本";await save(later);
    await Promise.all([worker.process(job.id),worker.process(job.id)]);
    assert.equal(calls,1);assert.equal(last!.resolvedInput.canvasSnapshots![0]!.content.type,"text");
    assert.equal((last!.resolvedInput.canvasSnapshots![0]!.content as any).text,"修改后正文");
    const complete=await f.job(job.id);assert.equal(complete.status,"succeeded");assert.equal(complete.inputOutdated,true);
    artifact=await f.ok("GET",`${f.path}/assistance-artifacts/${complete.assistanceArtifactId}`);
    assert.equal(artifact.body.prompt,"明确建议的新提示");assert.deepEqual(artifact.shotSources,[]);
    const listed=await f.ok("GET",`${f.path}/assistance-artifacts?canvasId=${canvas.id}`);
    assert.equal(listed.items[0].id,artifact.id);
  });
  await t.test("explicit CAS application changes only target prompt and survives lost receipt/cache expiry",async()=>{
    const stale=await f.request("POST",`${f.path}/canvases/${canvas.id}/assistance-applications`,{applicationId:randomUUID(),artifactId:artifact.id,artifactRevision:artifact.revision,nodeId:draftId,mode:"append"},canvas.revision);
    assert.equal(stale.json().code,"PLAN_INPUT_CHANGED");
    const freshPlan=await prepare(),freshJob=await f.execute(freshPlan.id);await worker.process(freshJob.id);
    artifact=await f.ok("GET",`${f.path}/assistance-artifacts/${(await f.job(freshJob.id)).assistanceArtifactId}`);
    const body={applicationId:randomUUID(),artifactId:artifact.id,artifactRevision:artifact.revision,nodeId:draftId,mode:"append"},key=randomUUID(),base=canvas.revision,before=structuredClone(canvas.document);
    const result=await f.request("POST",`${f.path}/canvases/${canvas.id}/assistance-applications`,body,base,key);
    assert.equal(result.statusCode,200,result.body);
    const applied=result.json();canvas=applied.canvas;
    assert.equal(applied.application.id,body.applicationId);
    assert.equal(applied.application.resultCanvasRevision,base+1);
    assert.equal(applied.application.beforePrompt,"原手工提示");
    assert.equal(applied.application.afterPrompt,"原手工提示\n\n明确建议的新提示");
    before.nodes.find((n:any)=>n.id===draftId).content.prompt=applied.application.afterPrompt;
    assert.deepEqual(canvas.document,before);
    const receipt=await f.ok("GET",`${f.path}/canvases/${canvas.id}/assistance-applications/${body.applicationId}`);
    assert.deepEqual(receipt.application,applied.application);
    await f.admin.query(`UPDATE ${f.scope}.idempotency_records SET expires_at=now()-interval '1 second' WHERE operation_id='applyCanvasAssistance'`);
    const newer=structuredClone(canvas.document);newer.nodes.find((n:any)=>n.id===draftId).content.prompt="应用后继续手改";await save(newer);
    const replay=await f.request("POST",`${f.path}/canvases/${canvas.id}/assistance-applications`,body,base,randomUUID());
    assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().canvas.revision,canvas.revision);
    assert.deepEqual(replay.json().application,applied.application);
    assert.equal((await f.request("POST",`${f.path}/canvases/${canvas.id}/assistance-applications`,{...body,mode:"replace"},base)).json().code,"CANVAS_ASSISTANCE_CONFLICT");
    assert.equal((await f.request("POST",`${f.path}/canvases/${canvas.id}/assistance-applications`,{...body,applicationId:randomUUID()},base)).statusCode,412);
    assert.equal((await f.admin.query(`SELECT count(*)::int n FROM ${f.scope}.canvas_assistance_applications`)).rows[0].n,1);
    assert.equal((await f.admin.query(`SELECT count(*)::int n FROM ${f.scope}.takes`)).rows[0].n,0);
    assert.equal(calls,2);
  });
  await t.test("unknown submission resolves the same attempt and no second provider submission",async()=>{
    unknown=true;const p=await prepare(),j=await f.execute(p.id);await worker.process(j.id);await worker.process(j.id);
    assert.equal((await f.job(j.id)).status,"submission_unknown");
    unknown=false;await worker.reconcile(j.id);
    assert.equal((await f.job(j.id)).status,"succeeded");assert.equal(calls,3);
    assert.equal((await f.admin.query(`SELECT count(*)::int n FROM ${f.scope}.generation_attempts WHERE job_id=$1`,[j.id])).rows[0].n,1);
  });
  await t.test("cached preparation rechecks current selected content and both model capabilities",async()=>{
    const body=input(),key=randomUUID();
    const first=await f.request("POST",`${f.base}/generation-plans`,body,undefined,key);
    assert.equal(first.statusCode,201,first.body);
    for (const capabilityId of [f.input.capabilityId,cap]) {
      await f.admin.query(`UPDATE ${f.scope}.generation_capabilities SET enabled=false WHERE id=$1`,[capabilityId]);
      try {
        const retry=await f.request("POST",`${f.base}/generation-plans`,body,undefined,key);
        assert.equal(retry.statusCode,503,retry.body);
      } finally { await f.admin.query(`UPDATE ${f.scope}.generation_capabilities SET enabled=true WHERE id=$1`,[capabilityId]); }
    }
    const changed=structuredClone(canvas.document);changed.nodes.find((n:any)=>n.id===textId).content.text="同 key 不能掩盖新的来源正文";await save(changed);
    assert.equal((await f.request("POST",`${f.base}/generation-plans`,body,undefined,key)).statusCode,412);
    assert.equal((await f.admin.query(`SELECT count(*)::int n FROM ${f.scope}.generation_plans WHERE id=$1`,[first.json().id])).rows[0].n,1);
  });
  await t.test("read, execute retry, and first dispatch retain current media authority",async()=>{
    const p=await f.ok("POST",`${f.base}/generation-plans`,input([mediaNode])),j=await f.execute(p.id);
    await f.admin.query(`UPDATE ${f.scope}.media SET status='archived',revision=revision+1 WHERE id=$1`,[mediaId]);
    assert.equal((await f.request("GET",`${f.base}/generation-plans/${p.id}`)).statusCode,422);
    assert.equal((await f.request("POST",`${f.base}/generation-jobs`,{planId:p.id})).statusCode,422);
    await worker.process(j.id);
    const stored=(await f.admin.query(`SELECT status,error_code FROM ${f.scope}.generation_jobs WHERE id=$1`,[j.id])).rows[0];
    assert.equal(stored.status,"cancelled");assert.equal(stored.error_code,"EXECUTION_SOURCE_UNAVAILABLE");assert.equal(calls,3);
  });
  await t.test("restricted SQL rejects forged snapshots/hash, missing projection and receipt mutation",async()=>{
    const current=await prepare();
    const columns=(await f.admin.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='generation_plans' AND is_generated='NEVER' ORDER BY ordinal_position",[f.schema])).rows.map(r=>r.column_name as string);
    for (const change of ["content","missing"]){
      const sql=await f.runtime.connect();
      try {
        await sql.query("BEGIN");await sql.query(`SET LOCAL search_path TO ${f.scope},pg_catalog`);
        await sql.query("SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",[f.owner.userId,f.tenant.id]);
        const resolved=structuredClone(current.resolvedInput);if(change==="content")resolved.canvasSnapshots[0].content.text="伪造原文";
        await assert.rejects(async()=>{
          await sql.query(`INSERT INTO generation_plans(${columns.map(c=>'"'+c+'"').join(',')}) SELECT ${columns.map(c=>c==='id'?'$2::uuid':c==='resolved_input'?'$3::jsonb':c==='input_hash'?'rework_input_hash(input,$3::jsonb,capability_revision,connection_version_id)':'"'+c+'"').join(',')} FROM generation_plans WHERE id=$1`,[current.id,randomUUID(),resolved]);
          await sql.query("SET CONSTRAINTS ALL IMMEDIATE");
        },(error:any)=>error.code==="23514");
      } finally {await sql.query("ROLLBACK");sql.release();}
    }
    const sql=await f.runtime.connect();
    try{await assert.rejects(sql.query(`DELETE FROM ${f.scope}.canvas_assistance_applications`),(e:any)=>e.code==="42501");}finally{sql.release();}
  });
  await t.test("revoked project access cannot replay plans, jobs or permanent application receipts",async()=>{
    const member=await f.identity("canvas-helper"),membership=randomUUID();
    await f.admin.query(`INSERT INTO ${f.scope}.memberships(id,tenant_id,user_id,role,status) VALUES($1,$2,$3,'member','active')`,[membership,f.tenant.id,member.userId]);
    await f.admin.query(`INSERT INTO ${f.scope}.project_memberships(id,tenant_id,project_id,membership_id,role) VALUES($1,$2,$3,$4,'collaborator')`,[randomUUID(),f.tenant.id,f.project.id,membership]);
    const fixed=input([textId]),prepareKey=randomUUID(),executeKey=randomUUID(),applicationKey=randomUUID();
    const prepared=await f.request("POST",`${f.base}/generation-plans`,fixed,undefined,prepareKey,member);
    assert.equal(prepared.statusCode,201,prepared.body);
    const executeBody={planId:prepared.json().id};
    const started=await f.request("POST",`${f.base}/generation-jobs`,executeBody,undefined,executeKey,member);
    assert.equal(started.statusCode,202,started.body);
    await worker.process(started.json().id);
    const done=await f.job(started.json().id);
    const suggestion=await f.request("GET",`${f.path}/assistance-artifacts/${done.assistanceArtifactId}`,undefined,undefined,randomUUID(),member);
    assert.equal(suggestion.statusCode,200,suggestion.body);
    const body={applicationId:randomUUID(),artifactId:done.assistanceArtifactId,artifactRevision:1,nodeId:draftId,mode:"replace"},base=canvas.revision;
    const applied=await f.request("POST",`${f.path}/canvases/${canvas.id}/assistance-applications`,body,base,applicationKey,member);
    assert.equal(applied.statusCode,200,applied.body);canvas=applied.json().canvas;
    const pending=await f.request("POST",`${f.base}/generation-plans`,input([textId]),undefined,randomUUID(),member);
    assert.equal(pending.statusCode,201,pending.body);
    const queued=await f.request("POST",`${f.base}/generation-jobs`,{planId:pending.json().id},undefined,randomUUID(),member);
    assert.equal(queued.statusCode,202,queued.body);
    await f.admin.query(`DELETE FROM ${f.scope}.project_memberships WHERE project_id=$1 AND membership_id=$2`,[f.project.id,membership]);
    const blocked=[
      await f.request("POST",`${f.base}/generation-plans`,fixed,undefined,prepareKey,member),
      await f.request("POST",`${f.base}/generation-jobs`,executeBody,undefined,executeKey,member),
      await f.request("GET",`${f.path}/assistance-artifacts/${done.assistanceArtifactId}`,undefined,undefined,randomUUID(),member),
      await f.request("GET",`${f.path}/canvases/${canvas.id}/assistance-applications/${body.applicationId}`,undefined,undefined,randomUUID(),member),
      await f.request("POST",`${f.path}/canvases/${canvas.id}/assistance-applications`,body,base,applicationKey,member),
    ];
    for (const response of blocked) assert.ok([403,404].includes(response.statusCode),response.body);
    const before=calls;await worker.process(queued.json().id);assert.equal(calls,before);
    assert.equal((await f.admin.query(`SELECT status FROM ${f.scope}.generation_jobs WHERE id=$1`,[queued.json().id])).rows[0].status,"cancelled");
  });
  await t.test("archived mixed shot context blocks new applications while the prior successful receipt remains readable",async()=>{
    const mixed={...input([textId]),shotSources:f.input.shotSources};
    const p=await f.ok("POST",`${f.base}/generation-plans`,mixed),j=await f.execute(p.id);
    await worker.process(j.id);
    const done=await f.job(j.id),advice=await f.ok("GET",`${f.path}/assistance-artifacts/${done.assistanceArtifactId}`);
    assert.equal(advice.resolvedInput.shots[0].shotRevisionId,f.shot.specRevisionId);
    const body={applicationId:randomUUID(),artifactId:advice.id,artifactRevision:advice.revision,nodeId:draftId,mode:"append"},base=canvas.revision;
    const applied=await f.request("POST",`${f.path}/canvases/${canvas.id}/assistance-applications`,body,base);
    assert.equal(applied.statusCode,200,applied.body);canvas=applied.json().canvas;
    await f.ok("PUT",`${f.path}/shots/${f.shot.id}`,{
      sceneId:f.scene.id,label:f.shot.label,position:f.shot.position,status:"archived",spec:f.shot.spec,
    },f.shot.revision);
    const before=structuredClone(canvas),rejected=await f.request("POST",`${f.path}/canvases/${canvas.id}/assistance-applications`,{...body,applicationId:randomUUID()},canvas.revision);
    assert.equal(rejected.statusCode,409,rejected.body);
    assert.equal(rejected.json().code,"ASSISTANCE_SHOT_UNAVAILABLE");
    assert.deepEqual(await f.ok("GET",`${f.path}/canvases/${canvas.id}`),before);
    const receipt=await f.ok("GET",`${f.path}/canvases/${canvas.id}/assistance-applications/${body.applicationId}`);
    assert.deepEqual(receipt.application,applied.json().application);
    const replay=await f.request("POST",`${f.path}/canvases/${canvas.id}/assistance-applications`,body,base);
    assert.equal(replay.statusCode,200,replay.body);
    assert.deepEqual(replay.json().application,applied.json().application);
    assert.equal(replay.json().canvas.revision,before.revision);
    const sql=await f.runtime.connect();
    try {
      await sql.query("BEGIN");await sql.query(`SET LOCAL search_path TO ${f.scope},pg_catalog`);
      await sql.query("SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",[f.owner.userId,f.tenant.id]);
      await assert.rejects(sql.query(`INSERT INTO canvas_assistance_applications(id,tenant_id,project_id,canvas_id,node_id,artifact_id,artifact_revision,mode,base_revision,result_revision,before_prompt,after_prompt,created_by)
        SELECT $2,tenant_id,project_id,canvas_id,node_id,artifact_id,artifact_revision,mode,base_revision,result_revision,before_prompt,after_prompt,created_by FROM canvas_assistance_applications WHERE id=$1`,[body.applicationId,randomUUID()]),(error:any)=>error.code==="23514");
    } finally {await sql.query("ROLLBACK");sql.release();}
  });
});
