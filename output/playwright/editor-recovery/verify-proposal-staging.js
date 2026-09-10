async (page) => {
  page.setDefaultTimeout(15000);
  const ok=(v,m)=>{if(!v)throw new Error(m);};
  const path='/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f/projects/1498c59a-a789-4087-8069-4c99ebcbd63f';
  const url='http://127.0.0.1:4311/?staging-recovery=1#/app/t/b128e444-cd57-4087-bcfe-c403051bbd8f/p/1498c59a-a789-4087-8069-4c99ebcbd63f/content';
  const install=()=>{
    if(globalThis.__draftStagePatched)return;globalThis.__draftStagePatched=true;
    const put=IDBObjectStore.prototype.put,remove=IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.put=function(value,key){const result=put.call(this,value,key);if(this.name==='drafts'&&String(key).includes('/proposals/')&&!String(key).includes('/operations/')&&sessionStorage.getItem('scenedesk-test-parent-put-failure')==='1')this.transaction.abort();return result;};
    IDBObjectStore.prototype.delete=function(key){const result=remove.call(this,key);if(this.name==='drafts'&&String(key).includes('/operations/')&&sessionStorage.getItem('scenedesk-test-operation-delete-failure')==='1')this.transaction.abort();return result;};
  };
  await page.addInitScript(install);await page.goto(url);await page.reload();await page.setViewportSize({width:1366,height:768});await page.evaluate(install);
  const label=`恢复验收-${Date.now()}`,intent='保留单项输入，并明确转移到本地提案。';
  const errors=[],capture=e=>errors.push(e.message);page.on('pageerror',capture);
  try{
    await page.getByRole('button',{name:'CSV 与提案',exact:true}).click();
    await page.getByRole('button',{name:'导入 CSV',exact:true}).click();
    await page.getByRole('textbox',{name:'CSV 内容',exact:true}).fill(`episode,scene,shot_label,intent\n第一集,旧公寓,${label},原始叙事意图`);
    const creation=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/shot-list-imports'));
    await page.getByRole('button',{name:'生成导入预览',exact:true}).click();
    const proposal=await(await creation).json();ok(proposal.id,'Proposal creation failed');
    await page.getByRole('button',{name:`修改${label}`,exact:true}).click();
    await page.getByRole('textbox',{name:'叙事意图',exact:true}).fill(intent);
    await page.getByText('修改已保存在本标签页，尚未提交。',{exact:true}).waitFor();
    await page.evaluate(()=>sessionStorage.setItem('scenedesk-test-parent-put-failure','1'));
    await page.getByRole('button',{name:'保留本项修改',exact:true}).click();
    await page.getByText('无法保留到本地提案草稿。本项输入仍保留，请重试。',{exact:true}).waitFor();
    ok(await page.getByRole('textbox',{name:'叙事意图',exact:true}).inputValue()===intent,'Parent write failure lost child inputs');
    await page.evaluate(()=>{sessionStorage.removeItem('scenedesk-test-parent-put-failure');sessionStorage.setItem('scenedesk-test-operation-delete-failure','1');});
    await page.getByRole('button',{name:'保留本项修改',exact:true}).click();
    await page.getByText('已保留到本地提案草稿',{exact:true}).waitFor();
    await page.getByRole('button',{name:'重试清理本地草稿',exact:true}).waitFor();
    ok(await page.getByText('服务器已保存',{exact:true}).count()===0,'Local staging falsely claimed a server commit');
    const read=()=>page.evaluate(async({path,id})=>(await fetch(`${path}/proposals/${id}`)).json(),{path,id:proposal.id});
    ok((await read()).revision===1,'Local staging submitted the proposal');
    await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect&&Number.isFinite(a.effect.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:'output/playwright/editor-recovery/02-local-stage-cleanup.png'});
    await page.reload();await page.getByRole('button',{name:'CSV 与提案',exact:true}).click();
    const index=await page.evaluate(async({path,id})=>(await(await fetch(`${path}/proposals?limit=100`)).json()).items.findIndex(p=>p.id===id),{path,id:proposal.id});
    ok(index>=0,'Created proposal is missing from the actual list');
    await page.getByRole('button',{name:'打开提案',exact:true}).nth(index).click();
    await page.getByRole('button',{name:'恢复未提交内容',exact:true}).click();
    await page.getByText(intent,{exact:true}).waitFor();
    await page.getByRole('button',{name:`修改${label}`,exact:true}).click();
    await page.getByText('已保留到本地提案草稿',{exact:true}).waitFor();
    await page.evaluate(()=>sessionStorage.removeItem('scenedesk-test-operation-delete-failure'));
    await page.getByRole('button',{name:'重试清理本地草稿',exact:true}).click();
    await page.getByRole('textbox',{name:'叙事意图',exact:true}).waitFor();
    ok(await page.getByRole('textbox',{name:'叙事意图',exact:true}).inputValue()===intent,'Staged parent did not restore child inputs');
    await page.getByRole('button',{name:'取消本项修改',exact:true}).click();
    await page.getByRole('button',{name:'保存提案修订',exact:true}).click();
    await page.getByRole('combobox',{name:'提案修订',exact:true}).filter({hasText:''}).waitFor();
    await page.waitForFunction(async({path,id})=>(await(await fetch(`${path}/proposals/${id}`)).json()).revision===2,{path,id:proposal.id});
    const saved=await read();ok(saved.operations.find(o=>o.kind==='shot').proposed.spec.intent===intent,'Explicit proposal save lost staged input');
    ok(errors.length===0,errors.join(';'));
    return {productionBuild:true,proposalId:proposal.id,parentWriteAbortPreservedInput:true,childDeleteAbortPreservedParent:true,reloadRestoredParent:true,localStateNotServerSuccess:true,explicitServerRevision:saved.revision,pageErrors:errors};
  }finally{await page.evaluate(()=>{sessionStorage.removeItem('scenedesk-test-parent-put-failure');sessionStorage.removeItem('scenedesk-test-operation-delete-failure');});page.off('pageerror',capture);}
}
