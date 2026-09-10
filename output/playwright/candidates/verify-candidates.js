async(page)=>{
  page.setDefaultTimeout(15000);
  const ok=(v,m)=>{if(!v)throw new Error(m);};
  const tenant='b128e444-cd57-4087-bcfe-c403051bbd8f',project='1498c59a-a789-4087-8069-4c99ebcbd63f',video='5b647e08-c985-4946-aa2a-33231c778aca';
  const path=`/v1/tenants/${tenant}/projects/${project}`,base=`http://127.0.0.1:4311/#/app/t/${tenant}/p/${project}`;
  await page.goto(`${base}/content`);
  const request=(method,url,body,version)=>page.evaluate(async({method,url,body,version})=>{
    const session=await(await fetch('/v1/session')).json();
    const response=await fetch(url,{method,headers:{'content-type':'application/json','x-csrf-token':session.csrfToken,'idempotency-key':crypto.randomUUID(),...(version?{'if-match':`"${version}"`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  },{method,url,body,version});
  const read=async url=>{const r=await request('GET',url);ok(r.status===200,JSON.stringify(r));return r.body;};
  const command=async(method,url,body,version)=>{const r=await request(method,url,body,version);ok(r.status===201||r.status===200,JSON.stringify(r));return r.body;};
  const before=await read(`${path}/content`),episode=before.episodes.find(e=>e.status==='active');
  const scene=await command('POST',`${path}/scenes`,{episodeId:episode.id,title:`候选流程技术验收 ${Date.now()}`,position:99,status:'active',summary:'导入视频的候选区间、恢复与采用测试，不代表生成质量验收。',state:{characters:[],props:[],spatialNotes:''}},before.revision);
  const input={sceneId:scene.id,label:'验收 A',position:0,status:'active',spec:{intent:'入屋后停步',references:[]}};
  let shot=await command('POST',`${path}/shots`,input,(await read(`${path}/content`)).revision);
  const shot2=await command('POST',`${path}/shots`,{...input,label:'验收 B',position:1,spec:{intent:'看向门锁',references:[]}},(await read(`${path}/content`)).revision);
  const url=`${base}/production?scene=${scene.id}&shot=${shot.id}`;
  const errors=[],capture=e=>errors.push(e.message);page.on('pageerror',capture);
  let creates=0,selects=0;const tracking=r=>{if(r.method()==='POST'&&r.url().endsWith(`${path}/takes`))creates++;if(r.method()==='PUT'&&r.url().endsWith(`/shots/${shot.id}/selection`))selects++;};page.on('request',tracking);
  const openVideo=async()=>{await page.getByRole('button',{name:'从素材建候选',exact:true}).click();await page.getByText('四秒技术测试片 · 双人核对',{exact:true}).locator('..').getByRole('button',{name:'选择此视频',exact:true}).click();};
  try{
    await page.goto(url);await page.reload();await page.setViewportSize({width:1366,height:900});
    await openVideo();await page.getByRole('textbox',{name:'入点（秒）',exact:true}).fill('0.250001');await page.getByRole('textbox',{name:'出点（秒）',exact:true}).fill('2.000001');await page.getByRole('textbox',{name:'候选说明',exact:true}).fill('连续入屋区间 · 本地草稿验收');await page.getByText('修改已保存在本标签页，尚未提交。',{exact:true}).waitFor();
    await page.getByRole('navigation',{name:'本场分镜顺序'}).getByRole('link').filter({hasText:'验收 B'}).click();await page.getByRole('navigation',{name:'本场分镜顺序'}).getByRole('link').filter({hasText:'验收 A'}).click();await openVideo();await page.getByRole('button',{name:'恢复未提交内容',exact:true}).click();ok(await page.getByRole('textbox',{name:'入点（秒）',exact:true}).inputValue()==='0.250001','Shot navigation lost the interval');
    await page.getByRole('textbox',{name:'出点（秒）',exact:true}).fill('4.000001');ok(await page.getByRole('button',{name:'归档为候选',exact:true}).isDisabled(),'Out-of-duration interval accepted by form');await page.getByRole('textbox',{name:'出点（秒）',exact:true}).fill('2.000001');
    await page.getByRole('button',{name:'归档为候选',exact:true}).click();await page.getByRole('button',{name:'采用此候选',exact:true}).waitFor();
    let take=(await read(`${path}/takes?shotId=${shot.id}`)).items[0];ok(creates===1&&take.range.inUs===250001&&take.range.outUs===2000001,'Archive did not preserve microseconds');ok(!(await read(`${path}/shots/${shot.id}/selection`)).currentSelection,'Archive auto-adopted');
    const viewport=page.getByRole('region',{name:'当前镜头制作'});await viewport.locator('video').waitFor();await page.waitForFunction(()=>{const v=document.querySelector('section[aria-label="当前镜头制作"] video');return v&&v.readyState>=2;});
    await viewport.locator('video').evaluate(async v=>{v.muted=true;await v.play();});await page.waitForFunction(()=>{const v=document.querySelector('section[aria-label="当前镜头制作"] video');return v&&v.paused&&v.currentTime>=2;});const time=await viewport.locator('video').evaluate(v=>v.currentTime);ok(Math.abs(time-2.000001)<0.02,'Playback did not stop at candidate end');
    await page.getByRole('button',{name:'采用此候选',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'采用理由（可选）',exact:true}).fill('已核对入屋动作，保留我的理由');
    shot=await command('PUT',`${path}/shots/${shot.id}`,{...input,label:'验收 A · 并发改名'},shot.revision);
    await dialog.getByRole('button',{name:'确认采用',exact:true}).click();await dialog.getByRole('button',{name:'已核对，使用最新修改版本',exact:true}).waitFor();ok(await dialog.getByRole('textbox',{name:'采用理由（可选）',exact:true}).inputValue()==='已核对入屋动作，保留我的理由','Conflict discarded input');await dialog.getByRole('button',{name:'已核对，使用最新修改版本',exact:true}).click();
    await page.evaluate(()=>{globalThis.__candidateDeleteFailure=true;const original=IDBObjectStore.prototype.delete;IDBObjectStore.prototype.delete=function(key){const r=original.call(this,key);if(this.name==='drafts'&&globalThis.__candidateDeleteFailure)this.transaction.abort();return r;};});
    await dialog.getByRole('button',{name:'确认采用',exact:true}).click();await dialog.getByRole('button',{name:'重试清理本地草稿',exact:true}).waitFor();await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect&&Number.isFinite(a.effect.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:'output/playwright/candidates/01-adoption-cleanup.png'});
    const decision=(await read(`${path}/shots/${shot.id}/selection`)).currentSelection;ok(decision.takeId===take.id&&selects===2,'Unexpected selection command count');await page.evaluate(()=>{globalThis.__candidateDeleteFailure=false;});await dialog.getByRole('button',{name:'重试清理本地草稿',exact:true}).click();await dialog.waitFor({state:'hidden'});ok(selects===2,'Cleanup repeated adoption');
    const duplicate=await command('POST',`${path}/takes`,{shotId:shot.id,shotRevisionId:take.shotRevisionId,mediaId:video,range:take.range,note:take.note});ok(duplicate.id===take.id,'New request key duplicated immutable interval');
    await command('POST',`${path}/takes`,{shotId:shot2.id,shotRevisionId:shot2.specRevisionId,mediaId:video,range:{inUs:2000001,outUs:4000000}});ok(!(await read(`${path}/shots/${shot2.id}/selection`)).currentSelection,'Second shot auto-adopted');
    shot=(await read(`${path}/content`)).shots.find(s=>s.id===shot.id);shot=await command('PUT',`${path}/shots/${shot.id}`,{...input,label:shot.label,spec:{intent:'入屋后停步，确认门锁方向',references:[]}},shot.revision);await page.reload();await page.getByRole('button',{name:'核对并沿用到当前要求',exact:true}).click();await page.getByRole('textbox',{name:'候选说明',exact:true}).fill('按新要求复核沿用');await page.getByRole('button',{name:'归档为候选',exact:true}).click();await page.getByRole('button',{name:'采用此候选',exact:true}).waitFor();
    const takes=(await read(`${path}/takes?shotId=${shot.id}`)).items;const reused=takes.find(t=>t.sourceTakeId===take.id);ok(reused&&reused.shotRevisionId===shot.specRevisionId,'Reuse lineage missing');ok((await read(`${path}/shots/${shot.id}/selection`)).currentSelection.takeId===take.id,'Reuse auto-replaced selection');
    await page.getByRole('button',{name:'采用此候选',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认采用',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.screenshot({path:'output/playwright/candidates/02-candidate-workspace.png'});
    await page.getByRole('button',{name:'清除当前采用',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认清除采用',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});const history=(await read(`${path}/shots/${shot.id}/selections`)).items;ok(history.length===3&&!history[2].takeId,'Clear did not append decision history');
    await page.setViewportSize({width:320,height:740});await page.goto(`${url}&take=00000000-0000-4000-8000-000000000001`);await page.getByText('指定候选不存在或不属于当前镜头。请从候选列表重新选择。',{exact:true}).waitFor();ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Small viewport overflow');await page.screenshot({path:'output/playwright/candidates/03-missing-candidate-320.png'});
    ok(errors.length===0,errors.join(';'));
    await page.setViewportSize({width:1366,height:900});await page.goto(`${url}&take=${reused.id}`);
    return {productionBuild:true,sceneId:scene.id,shotId:shot.id,secondShotId:shot2.id,takeId:take.id,reusedTakeId:reused.id,range:take.range,proxyStoppedAt:time,historyCount:history.length,conflictPreservedInput:true,cleanupNoResubmit:true,noAutoAdoption:true,smallViewportOverflow:false,pageErrors:errors};
  }finally{await page.evaluate(()=>{globalThis.__candidateDeleteFailure=false;});page.off('pageerror',capture);page.off('request',tracking);}
}
