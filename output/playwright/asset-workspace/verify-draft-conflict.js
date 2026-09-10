async(page)=>{
  page.setDefaultTimeout(12000);
  const ok=(value,message)=>{if(!value)throw new Error(message);};
  const base='http://127.0.0.1:4311/?asset-validation=2#/app/t/b128e444-cd57-4087-bcfe-c403051bbd8f/p/1498c59a-a789-4087-8069-4c99ebcbd63f/assets?asset=b6095818-3b79-47ea-ad5a-52ff517146fa';
  await page.goto(base);
  await page.getByRole('button',{name:'基于当前版本新建修订',exact:true}).click();
  const description=page.getByRole('textbox',{name:'固定设定说明',exact:true});
  await description.fill('林晚的停顿更短。保留原有身份，重新核对两种并存造型。');
  await page.getByRole('textbox',{name:'造型名称',exact:true}).nth(0).fill('日常服 · 灰色外套');
  await page.getByText('修改已保存在本标签页，尚未提交。',{exact:true}).waitFor();
  const tabId=await page.evaluate(()=>sessionStorage.getItem('scenedesk-content-tab'));
  await page.reload();
  await page.getByRole('button',{name:'基于当前版本新建修订',exact:true}).click();
  await page.getByRole('button',{name:'恢复未提交内容',exact:true}).click();
  ok(await description.inputValue()==='林晚的停顿更短。保留原有身份，重新核对两种并存造型。','Reload lost unsaved definition');
  ok(await page.evaluate(()=>sessionStorage.getItem('scenedesk-content-tab'))===tabId,'Reload changed draft owner');
  const previous=await page.evaluate(async()=>await(await fetch(`/v1/tenants/${location.hash.split('/')[3]}/assets/${new URLSearchParams(location.hash.split('?')[1]).get('asset')}`)).json());
  let freeze=true,conflicts=0;
  const target=`**/v1/tenants/*/assets/${previous.id}`;
  const route=async route=>{if(freeze&&route.request().method()==='GET')await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(previous)});else await route.continue();};
  const response=res=>{if(res.status()===412){conflicts++;freeze=false;}};
  await page.route(target,route);page.on('response',response);
  const popup=page.waitForEvent('popup');await page.evaluate(()=>window.open(location.href,'_blank'));const child=await popup;
  child.setDefaultTimeout(12000);
  try{
    await child.getByRole('button',{name:'基于当前版本新建修订',exact:true}).click();
    await child.getByText('修改后可保存；关闭面板会保留本地草稿。',{exact:true}).waitFor();
    ok(await child.evaluate(()=>sessionStorage.getItem('scenedesk-content-tab'))!==tabId,'Duplicated tab reused live draft owner');
    await child.getByRole('textbox',{name:'声音说明',exact:true}).fill('同伴补充：低声说话，句尾保持气息。');
    await child.getByRole('textbox',{name:'造型名称',exact:true}).nth(1).fill('晚礼服 · 酒红');
    await child.getByRole('button',{name:'保存为新的固定版本',exact:true}).click();
    await child.getByRole('textbox',{name:'固定设定说明',exact:true}).waitFor({state:'hidden'});
    await page.bringToFront();
    await page.getByRole('button',{name:'保存为新的固定版本',exact:true}).click();
    await page.getByText('服务器已有新版本，当前输入已保留',{exact:true}).waitFor();
    await page.getByRole('button',{name:'已核对，继续基于当前版本',exact:true}).waitFor();
    ok(conflicts===1,'Expected actual stale If-Match rejection');
    ok(await description.inputValue()==='林晚的停顿更短。保留原有身份，重新核对两种并存造型。','Conflict discarded local input');
    await page.getByText('服务器已有新版本，当前输入已保留',{exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:'output/playwright/asset-workspace/02-definition-conflict.png'});
    await page.getByRole('button',{name:'已核对，继续基于当前版本',exact:true}).click();
    ok(await page.getByRole('textbox',{name:'声音说明',exact:true}).inputValue()==='同伴补充：低声说话，句尾保持气息。','Untouched peer voice note lost');
    ok(await page.getByRole('textbox',{name:'造型名称',exact:true}).nth(1).inputValue()==='晚礼服 · 酒红','Untouched peer look lost');
    ok(await page.getByRole('textbox',{name:'造型名称',exact:true}).nth(0).inputValue()==='日常服 · 灰色外套','Local look lost');
    await page.getByRole('button',{name:'保存为新的固定版本',exact:true}).click();
    await description.waitFor({state:'hidden'});
    const saved=await page.evaluate(async()=>{
      const tenant=location.hash.split('/')[3], id=new URLSearchParams(location.hash.split('?')[1]).get('asset');
      const a=await(await fetch(`/v1/tenants/${tenant}/assets/${id}`)).json(),r=await(await fetch(`/v1/tenants/${tenant}/asset-revisions/${a.currentRevisionId}`)).json();
      return {assetId:a.id,rootRevision:a.revision,fixedId:r.id,number:r.number,description:r.definition.description,voice:r.definition.voiceDescription,looks:r.definition.looks.map(l=>({id:l.id,label:l.label,revision:l.revision}))};
    });
    ok(saved.number===4&&saved.looks[0].revision===2&&saved.looks[1].revision===3,'Reviewed fixed revisions wrong');
    await page.getByRole('button',{name:'基于当前版本新建修订',exact:true}).click();
    await page.getByText('修改后可保存；关闭面板会保留本地草稿。',{exact:true}).waitFor();
    ok(await page.getByRole('button',{name:'恢复未提交内容',exact:true}).count()===0,'Successful save did not clear draft');
    await page.getByRole('button',{name:'收起，保留本机草稿',exact:true}).click();
    return {reloadOwnDraft:true,duplicatedTabIsolated:true,realConflicts:conflicts,reviewedMerge:saved,draftClearedAfterCommit:true};
  } finally {await child.close();await page.unroute(target,route);page.off('response',response);await page.bringToFront();}
}
