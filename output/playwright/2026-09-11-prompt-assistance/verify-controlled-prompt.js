async (page) => {
  await page.unrouteAll({behavior:"ignoreErrors"});
  const tenant='b128e444-cd57-4087-bcfe-c403051bbd8f', project='1498c59a-a789-4087-8069-4c99ebcbd63f', sceneId='c31f8ac4-a0f4-4b43-983a-6e3b09c05d1d';
  const base=`/v1/tenants/${tenant}`, path=`${base}/projects/${project}`;
  const workspaceUrl=`http://127.0.0.1:4316/#/app/t/${tenant}/p/${project}/production?scene=${sceneId}&shot=29840c60-a783-4283-9547-3f5ee5af5e7a&mode=storyboard`;
  const source = await page.evaluate(async ({path,sceneId}) => {
    const [tree, scripts, preference] = await Promise.all([fetch(`${path}/content`), fetch(`${path}/scripts`), fetch(`${path}/scenes/${sceneId}/workspace-preference`)]);
    if (!tree.ok || !scripts.ok) throw new Error('Actual context unavailable');
    return {tree: await tree.json(), scripts: await scripts.json(), preference: await preference.json()};
  },{path,sceneId});
  await page.goto('http://127.0.0.1:4316/');
  await page.evaluate(async()=>{for(const name of ['scenedesk-assistant','scenedesk-content-drafts'])await new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.length){db.close();const remove=indexedDB.deleteDatabase(name);remove.onsuccess=()=>resolve();remove.onerror=()=>reject(remove.error);return;}const tx=db.transaction(Array.from(db.objectStoreNames),'readwrite');for(const store of Array.from(db.objectStoreNames))tx.objectStore(store).clear();tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);});});

  const tree=source.tree, shot=tree.shots.find(s=>s.id==='29840c60-a783-4283-9547-3f5ee5af5e7a');
  if(!shot)throw Error('Actual shot fixture missing');
  const text={id:'6173d697-b96a-4b7f-a4e9-d888ce6487ae',revision:2,connectionId:'dd28d22a-4454-48e3-8271-51eab9ca0b68',purpose:'creative_assistance',modelVersion:'受控提示准备',mode:'text',enabled:true,executionMode:'test_fixture',supportedPurposes:[]};
  const target={...text,id:'c7732f90-589f-4fc1-8289-92c12f8f6e01',revision:3,purpose:'video',modelVersion:'受控视频目标',mode:'text_to_video'};
  const planId='f84ab73b-5895-4ce4-9dce-5f31b1ce6d37',jobId='b13131cf-4b24-4dfe-97de-7ad0b8ee7f04',artifactId='a102f9e0-d001-4f95-b76c-c45b8dd62d85';
  let plan,job,artifact,original,planPosts=0,executePosts=0,editPosts=0,capabilitiesEnabled=true;
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const fulfill=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  await page.route(`**${base}/capabilities*`,route=>fulfill(route,{items:capabilitiesEnabled&&!route.request().url().includes('purpose=script_analysis')?[text,target]:[]}));
  let preference={...source.preference,mode:'storyboard'};
  await page.route(`**${path}/scenes/${sceneId}/workspace-preference`,route=>{if(route.request().method()==='PUT')preference={...route.request().postDataJSON(),sceneId,revision:preference.revision+1};return fulfill(route,preference);});
  await page.route(`**${base}/generation-plans**`,route=>{
    if(route.request().method()==='POST'){
      planPosts++;const input=route.request().postDataJSON();
      if(input.purpose!=='creative_assistance'||input.assistance.kind!=='prepare_prompt'||input.shotSources[0].shotId!==shot.id||input.shotSources[0].shotRevisionId!==shot.specRevisionId||input.assistance.targetCapabilityRevision!==3||input.contextSources.length)throw Error('Plan sources/target are not fixed');
      plan={id:planId,revision:1,input,capabilityRevision:2,inputHash:'controlled-input',expiresAt:'2099-01-01T00:00:00Z',status:'ready',blockingReasons:[],executionMode:'test_fixture',connectionVersionId:'3218e626-cfeb-4f53-979c-0e2d71a3e00d',resolvedInput:{resolverVersion:'test-1',prompt:input.prompt,references:[],shots:[{shotId:shot.id,shotRevisionId:shot.specRevisionId,spec:shot.spec}],dependencies:[],targetCapabilitySnapshot:target,targetConnectionVersionId:'152eb4df-f27e-4c38-b6e2-c13ac4bbe227'}};
      artifact={id:artifactId,revision:1,projectId:project,generationJobId:jobId,request:input.assistance,shotSources:input.shotSources,resolvedInput:plan.resolvedInput,body:{prompt:'受控建议：镜头缓慢推进，人物先看向门口。',referenceSuggestions:[],retain:['人物造型'],change:['运镜节奏'],notes:'这是受控传输测试结果。'},inputOutdated:false,executionMode:'test_fixture'};original=JSON.parse(JSON.stringify(artifact));
      return fulfill(route,plan,201);
    }
    return fulfill(route,plan);
  });
  await page.route(`**${base}/generation-jobs**`,route=>{
    if(route.request().method()==='POST'){
      executePosts++;if(executePosts>1)throw Error('Duplicate generation submission');
      job={id:jobId,revision:1,scope:'project',projectId:project,planId,status:'submission_unknown',mediaIds:[],inputOutdated:false,executionMode:'test_fixture'};plan.status='consumed';return route.abort('failed');
    }
    return fulfill(route,route.request().url().split('?')[0].endsWith('/generation-jobs')?{items:job?[job]:[]}:job);
  });
  await page.route(`**${path}/assistance-artifacts**`,route=>{
    const req=route.request(),url=req.url().split('?')[0];
    if(req.method()==='PUT'){
      editPosts++;if(req.headers()['if-match']!=='"1"')throw Error('Missing fixed edit precondition');
      artifact={...artifact,revision:2,body:req.postDataJSON().body};return route.abort('failed');
    }
    if(url.endsWith('/assistance-artifacts'))return fulfill(route,{items:job?.status==='succeeded'?[artifact]:[]});
    return fulfill(route,url.endsWith('/revisions/1')?original:artifact);
  });
  await page.setViewportSize({width:1512,height:982});await page.goto(workspaceUrl);
  const composer=page.locator('[aria-label="本次创作输入"]').filter({has:page.getByRole('textbox',{name:'本次提示',exact:true})});
  await composer.getByRole('textbox',{name:'本次提示',exact:true}).fill('手工原文：保留人物造型。');
  await composer.getByRole('button',{name:'AI 准备提示',exact:true}).click();
  await composer.getByRole('combobox',{name:'准备提示的模型',exact:true}).click();await page.getByRole('option',{name:'受控提示准备',exact:false}).click();
  await composer.getByRole('combobox',{name:'提示将用于哪项能力',exact:true}).click();await page.getByRole('option',{name:'受控视频目标',exact:false}).click();
  await composer.getByRole('textbox',{name:'本次准备要求',exact:true}).fill('重点安排动作与运镜。');
  await composer.getByRole('button',{name:'查看固定计划',exact:true}).click();await composer.getByText('固定生成计划',{exact:true}).waitFor();
  await composer.getByRole('textbox',{name:'本次提示',exact:true}).fill('手工原文：保留人物造型。计划后继续手工编辑。');
  await composer.getByRole('button',{name:'明确执行提示准备',exact:true}).click();await composer.getByText('提交待核对',{exact:true}).waitFor();
  await page.reload();await composer.getByRole('button',{name:'AI 准备提示',exact:true}).click();await composer.getByText('提交待核对',{exact:true}).waitFor();
  if(executePosts!==1)throw Error('Reload resubmitted generation');
  if(!(await composer.getByRole('textbox',{name:'本次提示',exact:true}).inputValue()).includes('计划后继续手工编辑'))throw Error('Manual prompt lost while plan fixed');
  job={...job,status:'succeeded',assistanceArtifactId:artifactId};await composer.getByRole('button',{name:'核对原任务',exact:true}).click();await composer.getByRole('button',{name:'打开提示建议',exact:true}).click();
  await composer.getByRole('textbox',{name:'建议提示',exact:true}).fill('人工修订建议：先停顿，再缓慢推进。');const retainInput=composer.getByRole('textbox',{name:'保留要求（每行一项）',exact:true});await retainInput.fill('人物造型');await retainInput.press('End');await retainInput.press('Enter');await retainInput.pressSequentially('服装');if((await retainInput.inputValue())!=='人物造型\n服装')throw Error('Multiline requirements lost Enter input');await composer.getByRole('button',{name:'保存建议修订',exact:true}).click();await composer.getByText('保存结果待核对',{exact:true}).waitFor();
  if(!await composer.getByRole('button',{name:'按原修订重试保存',exact:true}).isDisabled())throw Error('Unknown save may replay before GET');
  await page.reload();await composer.getByRole('button',{name:'AI 准备提示',exact:true}).click();await composer.getByText('保存结果待核对',{exact:true}).waitFor();
  await composer.getByRole('button',{name:'核对建议修订',exact:true}).click();await composer.getByRole('button',{name:'追加到本次提示…',exact:true}).waitFor();
  await composer.getByRole('combobox',{name:'查看已保存的建议历史',exact:true}).click();await page.getByRole('option',{name:'r1 · 原始建议',exact:true}).click();await composer.getByText('受控建议：镜头缓慢推进，人物先看向门口。',{exact:true}).waitFor();
  if((await composer.getByRole('textbox',{name:'建议提示',exact:true}).inputValue())!=='人工修订建议：先停顿，再缓慢推进。')throw Error('History replaced edited revision');
  await composer.getByRole('button',{name:'追加到本次提示…',exact:true}).click();await page.getByRole('dialog',{name:'确认追加到本次提示',exact:true}).waitFor();
  await page.screenshot({path:'output/playwright/2026-09-11-prompt-assistance/confirm.png',fullPage:false,animations:'disabled'});
  await page.getByRole('button',{name:'确认追加，保留原文',exact:true}).click();await composer.getByText('本次输入已应用建议',{exact:true}).waitFor();
  const expected='手工原文：保留人物造型。计划后继续手工编辑。\n\n人工修订建议：先停顿，再缓慢推进。';
  if((await composer.getByRole('textbox',{name:'本次提示',exact:true}).inputValue())!==expected)throw Error('Apply did not preserve and append exactly');
  await page.reload();if((await composer.getByRole('textbox',{name:'本次提示',exact:true}).inputValue())!==expected)throw Error('Applied input failed refresh recovery');
  for(const size of [{width:1512,height:982},{width:390,height:844}]){
    await page.setViewportSize(size);await composer.scrollIntoViewIfNeeded();const bounds=await composer.boundingBox();if(!bounds||bounds.x<0||bounds.x+bounds.width>size.width+1)throw Error('Composer exceeds viewport');
    await page.screenshot({path:`output/playwright/2026-09-11-prompt-assistance/applied-${size.width}.png`,fullPage:false,animations:'disabled'});
  }
  await page.setViewportSize({width:1512,height:982});await page.getByRole('button',{name:'自由画布',exact:true}).click();const dock=page.getByRole('complementary',{name:'AI 创作助手'});if(!await dock.isVisible())await page.getByRole('button',{name:'AI 助手',exact:true}).click();
  await dock.getByText('准备提示',{exact:true}).click();await dock.getByRole('combobox',{name:'选择本次提示的镜头来源',exact:true}).click();await page.getByRole('option',{name:shot.label,exact:true}).click();
  await dock.getByText('本次输入已应用建议',{exact:true}).waitFor();
  await page.getByRole('button',{name:'分镜',exact:true}).click();
  await composer.getByRole('button',{name:'保留当前输入，另开一次',exact:true}).click();await page.getByRole('button',{name:'保留并开始下一次输入',exact:true}).click();
  if((await composer.getByRole('textbox',{name:'本次提示',exact:true}).inputValue())!=='')throw Error('New input not empty');
  await composer.locator('summary').filter({hasText:'此前保留的输入'}).click();await composer.getByText(expected,{exact:true}).waitFor();
  capabilitiesEnabled=false;await page.reload();await composer.getByRole('button',{name:'AI 准备提示',exact:true}).click();await composer.getByText('提示准备暂不可用',{exact:true}).waitFor();
  if(!await composer.getByRole('button',{name:'查看固定计划',exact:true}).isDisabled())throw Error('No-model prepare not disabled');
  await composer.getByText('提示准备暂不可用',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/2026-09-11-prompt-assistance/unavailable.png',fullPage:false,animations:'disabled'});
  if(executePosts!==1||editPosts!==1||planPosts!==1)throw Error('Unexpected duplicate mutation');
  if(errors.length)throw Error('Page errors: '+errors.join(';'));
  return {controlledTransport:true,actualReadOnlyContext:true,notRealModelAcceptance:true,planPosts,executePosts,editPosts,preservedManualInput:true,saveRecovery:'GET confirmed r2; no repeat PUT',fixedArtifactRevision:2,originalRevisionReadable:true,modeRecovery:true,viewportWidths:[1512,390],pageErrors:errors,newInputPreservesPrevious:true,noModelDisabled:true};
}