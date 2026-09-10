async (page) => {
  page.setDefaultTimeout(15000);
  const ok=(v,m)=>{if(!v)throw new Error(m);};
  const errors=[];const capture=e=>errors.push(e.message);page.on('pageerror',capture);
  const path='/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f/projects/1498c59a-a789-4087-8069-4c99ebcbd63f';
  const read=()=>page.evaluate(async(path)=>({project:await(await fetch(path)).json(),production:await(await fetch(`${path}/production`)).json()}),path);
  const chooseFixed=async(name,version,shared=false)=>{
    await page.getByRole('button',{name:'添加默认资产固定版',exact:true}).click();
    const picker=page.getByRole('dialog',{name:'添加默认资产固定版',exact:true});
    if(shared){await picker.getByRole('combobox',{name:'资产范围',exact:true}).click();await page.getByRole('option',{name:'工作室共享',exact:true}).click();}
    await picker.getByRole('textbox',{name:'查找资产',exact:true}).fill(name);
    await picker.getByText(new RegExp('^'+name+' ·')).locator('..').getByRole('button',{name:'选择固定版',exact:true}).click();
    await picker.getByRole('button',{name:`${shared?'引入并使用':'使用'} v${version} 固定版`,exact:true}).click();
    await picker.waitFor({state:'hidden'});
  };
  try{
    await page.getByRole('link',{name:'项目设定',exact:true}).click();
    await page.getByText('项目样片参考',{exact:true}).waitFor();
    const before=await read();ok(!before.project.spec.qualityReferenceMediaIds?.length,'Project already has QA references; inspect before rerunning');
    await page.getByRole('button',{name:'添加样片参考',exact:true}).click();
    await page.getByRole('dialog',{name:'选择样片参考',exact:true}).getByRole('button',{name:'添加参考 门框色块 · 导入验收',exact:true}).click();
    await page.getByRole('button',{name:'保存样片参考',exact:true}).click();
    await page.getByText('样片参考已保存。',{exact:true}).waitFor();
    await chooseFixed('林晚 · 固定版本复核',1);
    await chooseFixed('林晚 · 共享声音设定',1,true);
    await page.getByRole('textbox',{name:'故事与创作设定',exact:true}).fill('林晚在旧公寓寻找钥匙。角色与声音采用明确的固定版本；参考素材用于人工核对，不调用模型。');
    await page.getByRole('button',{name:'保存剧目设定',exact:true}).click();
    await page.getByText('剧目设定已保存。',{exact:true}).waitFor();
    const saved=await read();
    ok(saved.production.revision===before.production.revision+1,'Production did not advance exactly once');
    ok(saved.production.defaultAssetRevisionIds.includes('43aa2ebd-9a86-4f22-95b0-1db7e135d9aa')&&saved.production.defaultAssetRevisionIds.includes('d2dc183f-6566-4b3a-a19c-3302c355bc6f'),'Production defaults did not pin old character and voice');
    ok(saved.project.spec.qualityReferenceMediaIds[0]==='f2739951-cd07-4fa3-91e7-7f4ba17218c0','Quality reference not persisted');
    await page.getByText('剧目默认资产',{exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:'output/playwright/creative-bindings/04-production-defaults.png'});
    await page.getByRole('button',{name:'添加样片参考',exact:true}).click();
    await page.getByRole('dialog',{name:'选择样片参考',exact:true}).getByRole('button',{name:'添加参考 四秒技术测试片 · 双人核对',exact:true}).click();
    await page.getByText('修改已保存在本标签页，尚未提交。',{exact:true}).waitFor();
    await page.reload();
    await page.getByRole('button',{name:'恢复未提交内容',exact:true}).click();
    await page.getByText('四秒技术测试片 · 双人核对',{exact:true}).waitFor();
    await page.getByRole('button',{name:'保存样片参考',exact:true}).click();
    await page.getByText('样片参考已保存。',{exact:true}).waitFor();
    const final=await read();
    ok(final.project.spec.qualityReferenceMediaIds.length===2&&final.project.revision===before.project.revision+2,'Recovered quality draft did not save exactly once');
    ok(final.production.revision===saved.production.revision,'Quality save changed production version');
    await page.getByText('项目样片参考',{exact:true}).scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('img')).every(i=>i.complete));
    await page.screenshot({path:'output/playwright/creative-bindings/05-quality-references.png'});
    ok(errors.length===0,errors.join(';'));
    return {projectRevision:final.project.revision,productionRevision:final.production.revision,defaultFixedIds:final.production.defaultAssetRevisionIds,qualityMediaIds:final.project.spec.qualityReferenceMediaIds,qualityDraftReloaded:true,pageErrors:errors};
  }finally{page.off('pageerror',capture);}
}
