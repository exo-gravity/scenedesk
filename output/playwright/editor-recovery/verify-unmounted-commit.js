async(page)=>{
  page.setDefaultTimeout(15000);
  const ok=(v,m)=>{if(!v)throw new Error(m);};
  const path='/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f/projects/1498c59a-a789-4087-8069-4c99ebcbd63f',sceneId='9a49e855-1dac-49b9-8359-8ba9d5c7e753';
  await page.goto('http://127.0.0.1:4311/?unmounted-recovery=1#/app/t/b128e444-cd57-4087-bcfe-c403051bbd8f/p/1498c59a-a789-4087-8069-4c99ebcbd63f/content');await page.reload();
  await page.setViewportSize({width:1366,height:768});
  const editor=()=>page.getByRole('dialog',{name:'编辑场次',exact:true});
  const open=()=>page.getByRole('button',{name:'编辑01 · 旧公寓重逢',exact:true}).click();
  const read=()=>page.evaluate(async({path,sceneId})=>(await(await fetch(`${path}/content`)).json()).scenes.find(s=>s.id===sceneId),{path,sceneId});
  const before=await read(),text=`${before.summary}\n关闭面板后的提交回执验收 ${Date.now()}`;
  let release,received;const gate=new Promise(r=>{release=r;}),serverReady=new Promise(r=>{received=r;});
  const target=`**${path}/scenes/${sceneId}`;
  const route=async r=>{if(r.request().method()!=='PUT')return r.continue();const response=await r.fetch();ok(response.ok(),'Held command did not succeed');received();await gate;await r.fulfill({response});};
  const errors=[],capture=e=>errors.push(e.message);page.on('pageerror',capture);
  let writes=0;const request=r=>{if(r.method()==='PUT'&&r.url().endsWith(`/scenes/${sceneId}`))writes++;};page.on('request',request);
  await page.route(target,route);
  try{
    await open();await editor().getByRole('textbox',{name:'场次梗概',exact:true}).fill(text);await editor().getByText('修改已保存在本标签页，尚未提交。',{exact:true}).waitFor();
    await page.evaluate(()=>{globalThis.__failUnmountedDelete=true;const original=IDBObjectStore.prototype.delete;IDBObjectStore.prototype.delete=function(key){const r=original.call(this,key);if(this.name==='drafts'&&globalThis.__failUnmountedDelete)this.transaction.abort();return r;};});
    await editor().getByRole('button',{name:'保存修改',exact:true}).click();await serverReady;
    await editor().getByRole('button',{name:'关闭弹窗',exact:true}).click();await editor().waitFor({state:'hidden'});
    release();
    await page.waitForFunction(sceneId=>Object.keys(sessionStorage).some(k=>k.startsWith('scenedesk-draft-committed:')&&k.includes(`/scene/${sceneId}`)),sceneId);
    await open();await editor().getByRole('button',{name:'重试清理本地草稿',exact:true}).waitFor();
    ok(await editor().getByRole('button',{name:'恢复未提交内容',exact:true}).count()===0,'Unmount lost the successful command receipt');
    await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect&&Number.isFinite(a.effect.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:'output/playwright/editor-recovery/05-unmounted-receipt.png'});
    await page.evaluate(()=>{globalThis.__failUnmountedDelete=false;});
    await editor().getByRole('button',{name:'重试清理本地草稿',exact:true}).click();await editor().getByRole('textbox',{name:'场次梗概',exact:true}).waitFor();
    const saved=await read();ok(saved.summary===text&&saved.revision===before.revision+1&&writes===1,'Closing or cleanup duplicated the committed command');
    await editor().getByRole('button',{name:'关闭弹窗',exact:true}).click();ok(errors.length===0,errors.join(';'));
    return {productionBuild:true,editorUnmountedBeforeResponse:true,receiptRecorded:true,sceneRevision:saved.revision,businessWrites:writes,pageErrors:errors};
  }finally{release();await page.unroute(target,route);await page.evaluate(()=>{globalThis.__failUnmountedDelete=false;});page.off('request',request);page.off('pageerror',capture);}
}
