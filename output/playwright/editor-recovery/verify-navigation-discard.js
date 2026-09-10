async(page)=>{
  page.setDefaultTimeout(15000);
  const ok=(v,m)=>{if(!v)throw new Error(m);};
  const base='http://127.0.0.1:4311/?navigation-recovery=1#/app/t/b128e444-cd57-4087-bcfe-c403051bbd8f/p/1498c59a-a789-4087-8069-4c99ebcbd63f/content';
  const path='/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f/projects/1498c59a-a789-4087-8069-4c99ebcbd63f';
  const sceneId='9a49e855-1dac-49b9-8359-8ba9d5c7e753',shot='d16cf12a-00ab-4564-b535-ffa39f2c9a8a',missing='00000000-0000-4000-8000-000000000001';
  await page.goto(base);await page.reload();await page.setViewportSize({width:320,height:740});
  const errors=[],capture=e=>errors.push(e.message);page.on('pageerror',capture);
  let posts=0;const requests=r=>{if(r.method()==='POST'&&r.url().endsWith('/shot-list-imports'))posts++;};page.on('request',requests);
  const route=async r=>{const response=await r.fetch();const tree=await response.json();tree.scenes=tree.scenes.filter(s=>s.id!==sceneId);tree.shots=tree.shots.filter(s=>s.sceneId!==sceneId);await r.fulfill({response,json:tree});};
  const openImport=async()=>{await page.getByRole('button',{name:'CSV 与提案',exact:true}).click();await page.getByRole('button',{name:'导入 CSV',exact:true}).click();};
  try{
    await page.goto(`${base}?shot=${missing}`);await page.getByText('链接中的内容不可用',{exact:true}).waitFor();
    await page.getByRole('button',{name:'返回项目集场镜',exact:true}).click();await page.getByText('链接中的内容不可用',{exact:true}).waitFor({state:'hidden'});
    await page.goto(`${base}?shot=${shot}&revision=${missing}`);await page.getByText('指定的要求版本不可用',{exact:true}).waitFor();
    await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect&&Number.isFinite(a.effect.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:'output/playwright/editor-recovery/03-missing-fixed-history-320.png'});
    await page.goto(base);await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.goto(`${base}?scene=${missing}`);await page.getByText('链接中的内容不可用',{exact:true}).waitFor();
    await page.getByRole('button',{name:'返回项目集场镜',exact:true}).click();
    await openImport();
    const csv='episode,scene,shot_label,intent\n第一集,旧公寓,未提交恢复,只验证目标失效后保留输入';
    await page.getByRole('textbox',{name:'CSV 内容',exact:true}).fill(csv);await page.getByText('修改已保存在本标签页，尚未提交。',{exact:true}).waitFor();
    await page.route(`**${path}/content`,route);await page.reload();await openImport();
    await page.getByRole('button',{name:'恢复未提交内容',exact:true}).click();
    await page.getByText('所选追加场次不可用',{exact:true}).waitFor();
    ok(await page.getByRole('textbox',{name:'CSV 内容',exact:true}).inputValue()===csv,'Missing target lost CSV input');
    ok(await page.getByRole('combobox',{name:'导入目标',exact:true}).inputValue()==='追加镜头到指定场次','Missing target silently changed import mode');
    ok(await page.getByRole('button',{name:'生成导入预览',exact:true}).isDisabled(),'Missing target could submit');
    await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect&&Number.isFinite(a.effect.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:'output/playwright/editor-recovery/04-missing-append-target-320.png'});
    await page.unroute(`**${path}/content`,route);await page.reload();await openImport();
    await page.evaluate(()=>{
      const original=IDBObjectStore.prototype.delete;
      globalThis.__failDraftDiscard=true;
      IDBObjectStore.prototype.delete=function(key){const result=original.call(this,key);if(this.name==='drafts'&&globalThis.__failDraftDiscard)this.transaction.abort();return result;};
    });
    await page.getByRole('button',{name:'放弃这份本地草稿',exact:true}).click();
    await page.getByText('本地草稿操作失败，这份草稿仍保留。可以重新恢复或放弃。',{exact:true}).waitFor();
    ok(await page.getByRole('button',{name:'恢复未提交内容',exact:true}).isVisible(),'Failed discard hid the recoverable draft');
    await page.evaluate(()=>{globalThis.__failDraftDiscard=false;});
    await page.getByRole('button',{name:'放弃这份本地草稿',exact:true}).click();
    await page.getByRole('button',{name:'恢复未提交内容',exact:true}).waitFor({state:'hidden'});
    ok(posts===0,'Navigation or discard sent an import command');
    ok(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'Narrow recovery UI overflows');
    await page.reload();await page.setViewportSize({width:1366,height:768});
    ok(errors.length===0,errors.join(';'));
    return {productionBuild:true,missingShotAndSceneExplicit:true,missingFixedVersionExplicit:true,clearedLinkClosedHistory:true,missingAppendTargetPreserved:true,discardAbortPreservedRecovery:true,importsSubmitted:posts,pageErrors:errors};
  }finally{await page.unroute(`**${path}/content`,route);await page.evaluate(()=>{globalThis.__failDraftDiscard=false;});page.off('request',requests);page.off('pageerror',capture);}
}
