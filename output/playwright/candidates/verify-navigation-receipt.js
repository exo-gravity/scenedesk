async(page)=>{
  const ok=(v,m)=>{if(!v)throw new Error(m);};page.setDefaultTimeout(15000);
  const path='/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f/projects/1498c59a-a789-4087-8069-4c99ebcbd63f';
  const query=await page.evaluate(()=>Object.fromEntries(new URLSearchParams(location.hash.split('?')[1]))),shotId=query.shot,sceneId=query.scene;
  const tree=await page.evaluate(async path=>(await(await fetch(`${path}/content`)).json()),path),second=tree.shots.find(s=>s.sceneId===sceneId&&s.id!==shotId);
  ok(second,'Second fixture shot missing');
  await page.reload();await page.getByRole('button',{name:'从素材建候选',exact:true}).click();await page.getByText('四秒技术测试片 · 双人核对',{exact:true}).locator('..').getByRole('button',{name:'选择此视频',exact:true}).click();
  const start=500000+Date.now()%100000;await page.getByRole('textbox',{name:'入点（秒）',exact:true}).fill(`0.${start}`);await page.getByRole('textbox',{name:'出点（秒）',exact:true}).fill('0.900001');await page.getByRole('textbox',{name:'候选说明',exact:true}).fill('归档响应返回前切镜头，导航保持在新镜头');
  const edited=tree.shots.find(s=>s.id===shotId);
  const revised=await page.evaluate(async({path,shot})=>{const session=await(await fetch('/v1/session')).json();const r=await fetch(`${path}/shots/${shot.id}`,{method:'PUT',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken,'if-match':`"${shot.revision}"`},body:JSON.stringify({sceneId:shot.sceneId,label:shot.label,position:shot.position,status:shot.status,spec:{...shot.spec,intent:shot.spec.intent+' · 草稿核对更新'}})});return {status:r.status,body:await r.json()};},{path,shot:edited});ok(revised.status===200,'Could not revise fixture requirements');
  await page.getByRole('button',{name:'刷新制作状态',exact:true}).click();await page.getByRole('button',{name:'已核对，绑定当前要求',exact:true}).click();ok(await page.getByRole('textbox',{name:'入点（秒）',exact:true}).inputValue()===`0.${start}`,'Rebinding requirements lost interval');
  let release,received,takeId;const gate=new Promise(r=>release=r),saved=new Promise(r=>received=r);
  const target=`**${path}/takes`,route=async r=>{if(r.request().method()!=='POST')return r.continue();const response=await r.fetch();ok(response.status()===201,'Archive did not commit');const take=await response.json();takeId=take.id;ok(take.shotRevisionId===revised.body.specRevisionId,'Rebinding did not pin latest requirements');received();await gate;await r.fulfill({response});};
  await page.route(target,route);
  try{
    await page.getByRole('button',{name:'归档为候选',exact:true}).click();await saved;
    await page.getByRole('navigation',{name:'本场分镜顺序'}).getByRole('link').filter({hasText:'验收 B'}).click();release();
    await page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`${path}/takes`));
    await page.getByRole('heading',{name:'验收 B · 看向门锁',exact:true}).waitFor();
    await page.waitForFunction(shotId=>!Object.keys(sessionStorage).some(k=>k.startsWith('scenedesk-draft-committed:')&&k.includes(`/takes/new/${shotId}`)),shotId);
    ok(await page.evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).get('shot'))===second.id,'Late archive response navigated back to old shot');
    await page.getByRole('navigation',{name:'本场分镜顺序'}).getByRole('link').filter({hasText:'验收 A'}).click();await page.getByRole('link',{name:`查看候选 ${takeId.slice(0,8)}`,exact:true}).waitFor();
    await page.getByRole('button',{name:'从素材建候选',exact:true}).click();await page.getByText('四秒技术测试片 · 双人核对',{exact:true}).locator('..').getByRole('button',{name:'选择此视频',exact:true}).click();await page.getByRole('textbox',{name:'候选说明',exact:true}).waitFor();ok(await page.getByRole('textbox',{name:'候选说明',exact:true}).inputValue()==='','Committed input was recovered as unsaved');
    await page.getByRole('button',{name:'收起，保留输入',exact:true}).click();
    return {explicitRequirementRebind:true,archiveSurvivedNavigation:true,currentShotPreserved:true,committedDraftRemoved:true,takeId};
  }finally{release();await page.unroute(target,route);}
}
