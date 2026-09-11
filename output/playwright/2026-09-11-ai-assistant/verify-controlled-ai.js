async (page) => {
  await page.unrouteAll({behavior:"ignoreErrors"});
  const tenant='b128e444-cd57-4087-bcfe-c403051bbd8f', project='1498c59a-a789-4087-8069-4c99ebcbd63f', sceneId='c31f8ac4-a0f4-4b43-983a-6e3b09c05d1d';
  const base=`/v1/tenants/${tenant}`, path=`${base}/projects/${project}`;
  const workspaceUrl=`http://127.0.0.1:4316/#/app/t/${tenant}/p/${project}/production?scene=${sceneId}&mode=canvas`;
  const source = await page.evaluate(async ({path,sceneId}) => {
    const [tree, scripts, preference] = await Promise.all([fetch(`${path}/content`), fetch(`${path}/scripts`), fetch(`${path}/scenes/${sceneId}/workspace-preference`)]);
    if (!tree.ok || !scripts.ok) throw new Error('Actual context unavailable');
    return {tree: await tree.json(), scripts: await scripts.json(), preference: await preference.json()};
  },{path,sceneId});
  await page.goto('http://127.0.0.1:4316/');
  await page.evaluate(async()=>{for(const name of ['scenedesk-assistant','scenedesk-content-drafts'])await new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.length){db.close();const remove=indexedDB.deleteDatabase(name);remove.onsuccess=()=>resolve();remove.onerror=()=>reject(remove.error);return;}const tx=db.transaction(Array.from(db.objectStoreNames),'readwrite');for(const store of Array.from(db.objectStoreNames))tx.objectStore(store).clear();tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);});});
  let tree=JSON.parse(JSON.stringify(source.tree)), scripts=source.scripts.items;
  if (!scripts?.length) throw new Error('Need an actual saved script fixture');
  const script=scripts[0], scene=tree.scenes.find(s=>s.id===sceneId);
  const capability={id:'6173d697-b96a-4b7f-a4e9-d888ce6487ae',revision:2,connectionId:'dd28d22a-4454-48e3-8271-51eab9ca0b68',purpose:'script_analysis',modelVersion:'受控分镜测试',mode:'script_analysis',enabled:true,executionMode:'test_fixture',supportedPurposes:[],notes:'仅验证界面与恢复，不是真实模型验收。'};
  const proposalId='98723c80-77cd-4a87-a7ab-bd7e7b56c9f8', planId='f84ab73b-5895-4ce4-9dce-5f31b1ce6d37', jobId='b13131cf-4b24-4dfe-97de-7ad0b8ee7f04';
  let capabilityEnabled=true;
  let plan, job, proposal, planPosts=0, executePosts=0, editPosts=0, applyPosts=0;
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  const fulfill=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  await page.route(`**${base}/capabilities*`,route=>fulfill(route,{items:capabilityEnabled?[capability]:[]}));
  await page.route(`**${path}/content`,route=>fulfill(route,tree));
  let preference=source.preference;
  await page.route(`**${path}/scenes/${sceneId}/workspace-preference`, route=>{if(route.request().method()==='PUT')preference={...route.request().postDataJSON(),sceneId,revision:preference.revision+1};return fulfill(route,preference);});
  await page.route(`**${base}/generation-plans**`,async route=>{
    if(route.request().method()==='POST'){
      planPosts++; const input=route.request().postDataJSON();
      const selected=Array.from(script.text).slice(input.scriptRange.startOffset,input.scriptRange.endOffset).join('');
      if(input.sourceScriptRevisionId!==script.id || input.contextSources.length!==1 || input.contextSources[0].objectId!==sceneId)throw new Error('Context not explicitly fixed');
      plan={id:planId,revision:1,input,capabilityRevision:2,inputHash:'controlled-fixture-hash',expiresAt:'2099-01-01T00:00:00Z',status:'ready',blockingReasons:[],executionMode:'test_fixture',connectionVersionId:'3218e626-cfeb-4f53-979c-0e2d71a3e00d',resolvedInput:{resolverVersion:'test-1',prompt:input.prompt,references:[],shots:[],dependencies:[],sourceExcerpt:{scriptRevisionId:script.id,range:input.scriptRange,quote:selected},contextSnapshots:[{source:{kind:'scene',objectId:scene.id,revision:scene.revision,tracking:'fixed',contentHash:'test'},text:scene.summary}]}};
      const excerpt=plan.resolvedInput.sourceExcerpt;
      proposal={id:proposalId,revision:1,projectId:project,baseContentRevision:tree.revision,status:'proposed',sourceKind:'ai_analysis',sourceScriptRevisionId:script.id,sourceHash:'controlled-fixture-hash',scriptRange:input.scriptRange,target:input.proposalTarget,baseContentSnapshot:JSON.parse(JSON.stringify(tree)),operations:[{opId:'be2df5aa-05b8-48ae-966f-fd83efdd35ef',temporaryId:'79c1b5e4-ed14-43e0-8877-086fd68c89be',kind:'shot',action:'create',summary:'受控测试镜头',proposed:{sceneId, label:'AI-测试镜头',position:999,spec:{intent:'受控测试：人物反应',references:[],sourceExcerpts:[excerpt]}},sourceExcerpts:[excerpt]}]};
      return fulfill(route,plan,201);
    }
    return plan?fulfill(route,plan):fulfill(route,{code:'FIXTURE_NOT_READY',message:'受控计划尚未创建'},404);
  });
  await page.route(`**${base}/generation-jobs**`,async route=>{
    const pathname=route.request().url().split("?")[0];
    if(route.request().method()==='POST'){
      executePosts++;if(executePosts>1)throw new Error('Duplicate execution request');
      job={id:jobId,revision:1,scope:'project',projectId:project,planId,status:'submission_unknown',mediaIds:[],reservationStatus:'held',inputOutdated:false,connectionVersionId:plan.connectionVersionId,costStatus:'unavailable',confirmedCost:{currency:'CNY',amountMicros:'0'},reservationRemaining:{currency:'CNY',amountMicros:'0'},recoveryEpoch:0,executionMode:'test_fixture'};
      plan.status='consumed';
      return route.abort('failed');
    }
    return fulfill(route,pathname.endsWith('/generation-jobs')?{items:job?[job]:[]}:job);
  });
  await page.route(`**${path}/proposals/${proposalId}**`,async route=>{
    const req=route.request();
    if(req.method()==='PUT'){editPosts++; const edit=req.postDataJSON(); proposal={...proposal,...edit,revision:proposal.revision+1}; return fulfill(route,proposal);}
    if(req.method()==='POST' && req.url().endsWith('/apply')){
      applyPosts++; const selected=req.postDataJSON().selectedOperationIds;
      if(selected.length!==1)throw new Error('Wrong proposal selection');
      tree={...tree,revision:tree.revision+1,shots:[...tree.shots,{...proposal.operations[0].proposed,id:'3751acbe-82f4-4590-835d-35bb9a383866',projectId:project,status:'active',revision:1,specRevisionId:'f5d6bf56-947a-44e4-87d2-a72d7a8f36a7'}]};
      proposal={...proposal,status:'applied',application:{proposalRevision:proposal.revision,selectedOperationIds:selected,createdObjects:{[selected[0]]:'3751acbe-82f4-4590-835d-35bb9a383866'},contentRevision:tree.revision,appliedAt:new Date().toISOString()}};
      return fulfill(route,tree);
    }
    return fulfill(route,proposal);
  });
  await page.setViewportSize({width:1512,height:982}); await page.goto(workspaceUrl);
  const dock=page.getByRole('complementary',{name:'AI 创作助手'});
  await page.getByRole('button',{name:'AI 助手',exact:true}).waitFor();
  if(!await dock.isVisible())await page.getByRole('button',{name:'AI 助手',exact:true}).click();
  await dock.getByRole('combobox',{name:'来源剧本',exact:true}).click();
  await page.getByRole('option',{name:`剧本第 ${script.number} 版`,exact:false}).click();
  const start=0,end=Math.min(script.text.length,40);
  await dock.getByRole('textbox',{name:'选择要分析的原文',exact:true}).evaluate((el,{start,end})=>{el.focus();el.setSelectionRange(start,end);el.dispatchEvent(new Event('select',{bubbles:true}));},{start,end});
  await dock.getByRole('button',{name:'使用选区',exact:true}).click();
  await dock.getByRole('textbox',{name:'分镜要求',exact:true}).fill('浏览器受控测试：保留原对白与动作，不覆盖已有镜头。');
  await dock.getByRole('checkbox',{name:'附带本场摘要与连续性设定',exact:true}).check();
  await dock.getByRole('combobox',{name:'分镜分析模型',exact:true}).click();
  await page.getByRole('option',{name:'受控分镜测试',exact:false}).click();
  await page.getByRole('button',{name:'分镜',exact:true}).click();
  if((await dock.getByRole('textbox',{name:'分镜要求',exact:true}).inputValue()).indexOf('受控测试')<0)throw new Error('Draft lost on mode switch');
  await page.getByRole('button',{name:'自由画布',exact:true}).click();
  await dock.getByRole('button',{name:'查看分镜分析计划',exact:true}).click();
  await dock.getByRole('region',{name:'固定生成计划'}).waitFor();
  await dock.getByRole('button',{name:'确认执行测试计划',exact:true}).click();
  await dock.getByText('提交待核对',{exact:true}).first().waitFor();
  await page.reload(); await page.getByRole('button',{name:'AI 助手',exact:true}).waitFor(); if(!await dock.isVisible())await page.getByRole('button',{name:'AI 助手',exact:true}).click(); await dock.getByText('提交待核对',{exact:true}).first().waitFor();
  if(executePosts!==1)throw new Error('Refresh repeated execution');
  await page.getByRole('button',{name:'分镜',exact:true}).click(); await page.getByRole('button',{name:'自由画布',exact:true}).click();
  if(executePosts!==1)throw new Error('Mode switch repeated execution');
  for(const size of [{width:1512,height:982},{width:1366,height:900},{width:390,height:844}]){
    await page.setViewportSize(size); await dock.scrollIntoViewIfNeeded();
    const bounds=await dock.boundingBox(); if(!bounds || bounds.x<0 || bounds.x+bounds.width>size.width+1)throw new Error('Assistant exceeds viewport');
    await page.screenshot({path:`output/playwright/2026-09-11-ai-assistant/unknown-${size.width}.png`,fullPage:false});
  }
  await page.setViewportSize({width:1512,height:982});
  job={...job,status:'succeeded',proposalId};
  await dock.getByRole('button',{name:'刷新分镜任务',exact:true}).click();
  await dock.getByRole('button',{name:'编辑并采纳分镜提案',exact:true}).click();
  await page.getByRole('button',{name:'修改AI-测试镜头',exact:true}).first().click();
  await page.getByRole('textbox',{name:'叙事意图',exact:true}).fill('人工修改：先看到犹豫，再切到手部。');
  await page.getByRole('button',{name:'保留本项修改',exact:true}).click();
  await page.getByRole('button',{name:'保存提案修订',exact:true}).click();
  await page.getByRole('checkbox',{name:'采纳镜头 AI-测试镜头',exact:true}).check();
  await page.getByRole('button',{name:'检查采纳结果',exact:true}).click();
  await page.getByRole('button',{name:'确认采纳并创建',exact:true}).click();
  await page.getByText('本提案已采纳',{exact:true}).waitFor();
  if(planPosts!==1 || executePosts!==1 || editPosts!==1 || applyPosts!==1)throw new Error('Wrong call counts');
  await page.screenshot({path:'output/playwright/2026-09-11-ai-assistant/proposal-applied-1512.png',fullPage:false});
  await dock.getByRole('button',{name:'准备另一份提案',exact:true}).click();
  capabilityEnabled=false;await page.reload();await page.getByRole('button',{name:'AI 助手',exact:true}).waitFor();if(!await dock.isVisible())await page.getByRole('button',{name:'AI 助手',exact:true}).click();
  await dock.getByText('分镜分析服务尚不可用',{exact:true}).waitFor();
  if(!await dock.getByRole('button',{name:'查看分镜分析计划',exact:true}).isDisabled())throw new Error('No-model execution was enabled');
  await page.route(`**${path}/scenes/${sceneId}/canvas`,route=>fulfill(route,{code:'SCENE_CANVAS_NOT_CREATED',message:'受控测试：未创建画布'},404));
  await page.reload();await page.getByRole('button',{name:'分镜',exact:true}).click();
  await dock.getByText('分镜分析服务尚不可用',{exact:true}).waitFor();
  await page.setViewportSize({width:1366,height:900});await dock.scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/2026-09-11-ai-assistant/no-model-without-canvas-1366.png',fullPage:false});
  if(errors.length)throw new Error(JSON.stringify(errors));
  return {verification:'Controlled AI transport with actual read-only project/script/canvas context; no provider or database proposal write',draftAcrossModes:true,fixedExplicitContext:true,lostExecutionReceipt:true,reloadAndModeNeverResubmit:true,proposalEditedAndExplicitlyAdopted:true,noModelDisabled:true,assistantWithoutCanvas:true,viewports:[1512,1366,390],planPosts,executePosts,editPosts,applyPosts,pageErrors:errors.length};
}
