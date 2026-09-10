async(page)=>{
  page.setDefaultTimeout(15000);
  const ok=(value,message)=>{if(!value)throw new Error(message);};
  const tenant='b128e444-cd57-4087-bcfe-c403051bbd8f',project='1498c59a-a789-4087-8069-4c99ebcbd63f';
  const origin='http://127.0.0.1:4311/?asset-built=1',base=`${origin}#/app/t/${tenant}/p/${project}/assets`,character='b6095818-3b79-47ea-ad5a-52ff517146fa',voice='d8d31719-37a9-4162-bc2b-a51b005adee4';
  const errors=[];const capture=e=>errors.push(e.message);page.on('pageerror',capture);const measures=[];
  const measure=async name=>{const m=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));ok(m.scrollWidth<=m.width,`${name} overflows ${m.width}: ${m.scrollWidth}`);measures.push({name,...m});};
  try{
    await page.goto(base+`?asset=${character}`);
    await page.getByRole('heading',{name:'林晚 · 固定版本复核',exact:true}).waitFor();
    ok(await page.evaluate(()=>Array.from(document.scripts).some(s=>s.src.includes('/assets/index-'))),'Expected production build');
    for(const size of [{width:1366,height:768},{width:320,height:740}]){
      await page.setViewportSize(size);await page.getByRole('heading',{level:1}).scrollIntoViewIfNeeded();
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('main img')).some(img=>img.complete&&img.naturalWidth>0));
      await measure('asset-detail');await page.screenshot({path:`output/playwright/asset-workspace/04-built-detail-${size.width}.png`,fullPage:size.width===320});
    }
    await page.getByRole('button',{name:'基于当前版本新建修订',exact:true}).click();
    await page.getByRole('textbox',{name:'造型名称',exact:true}).nth(1).scrollIntoViewIfNeeded();
    await measure('asset-definition-editor');await page.screenshot({path:'output/playwright/asset-workspace/05-built-editor-320.png',fullPage:true});
    await page.getByRole('button',{name:'选择声音固定版',exact:true}).click();
    const modal=page.getByRole('dialog',{name:'选择声音固定版',exact:true});
    await modal.getByRole('combobox',{name:'声音范围',exact:true}).click();await page.getByRole('option',{name:'工作室共享',exact:true}).click();
    await modal.getByRole('textbox',{name:'查找声音资产',exact:true}).fill('林晚 · 共享声音设定');
    await modal.getByRole('button',{name:'选择版本',exact:true}).click();
    await modal.getByText('v2：语速稍快，保留低声方向。',{exact:true}).waitFor();
    await modal.getByText('v1：低声、克制，句尾保留气息。',{exact:true}).waitFor();
    await measure('voice-history-choice');
    const popup=page.waitForEvent('popup');await modal.getByRole('link',{name:'在新标签页核对 v1',exact:true}).click();const review=await popup;
    try{await review.getByText('v1 的固定设定',{exact:true}).waitFor();await review.getByText('v1：低声、克制，句尾保留气息。',{exact:true}).waitFor();}finally{await review.close();await page.bringToFront();}
    await modal.getByRole('button',{name:'关闭弹窗',exact:true}).click();
    await page.getByRole('button',{name:'收起，保留本机草稿',exact:true}).click();
    await page.goto(base);await page.getByRole('heading',{level:1}).waitFor();await measure('asset-list');
    await page.goto(`${origin}#/app/t/${tenant}/assets?asset=${voice}`);
    await page.getByText('有权查看的直接使用位置',{exact:true}).click();await page.getByRole('link',{name:'林晚 · 固定版本复核 · v5',exact:true}).click();
    await page.getByText('v5 的固定设定',{exact:true}).waitFor();
    ok(page.url().includes(`asset=${character}`),'Usage link targeted wrong asset');
    await page.setViewportSize({width:1366,height:768});
    await page.goto(base+'?asset=08cfbe45-5f89-4bb6-9493-5d9f45531579');
    await page.getByRole('button',{name:'修改检索信息',exact:true}).click();
    await page.getByRole('textbox',{name:'资产名称',exact:true}).fill('林晚 · 早期保存复现记录');
    await page.getByRole('button',{name:'保存检索信息',exact:true}).click();
    await page.getByRole('textbox',{name:'资产名称',exact:true}).waitFor({state:'hidden'});
    await page.getByRole('button',{name:'归档资产',exact:true}).click();
    await page.getByRole('button',{name:'确认归档资产',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.getByText('资产已归档',{exact:true}).waitFor();
    ok(await page.getByRole('button',{name:'基于当前版本新建修订',exact:true}).count()===0,'Archived asset still offers new revisions');
    await page.getByRole('button',{name:'修改检索信息',exact:true}).click();
    await page.getByRole('textbox',{name:'资产名称',exact:true}).waitFor();
    await page.getByRole('button',{name:'收起，保留本机草稿',exact:true}).click();
    await page.getByRole('heading',{level:1}).scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/asset-workspace/06-built-archived.png'});
    ok(errors.length===0,errors.join(';'));return {productionBuild:true,measures,voiceFixedReviewNewTab:true,usageJumpsToFixedVersion:true,archiveKeepsMetadataAndHistory:true,pageErrors:errors.length};
  }finally{page.off('pageerror',capture);}
}
