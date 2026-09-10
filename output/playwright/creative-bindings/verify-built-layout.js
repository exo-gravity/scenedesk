async(page)=>{
  page.setDefaultTimeout(15000);
  const ok=(v,m)=>{if(!v)throw new Error(m);};
  const base='http://127.0.0.1:4311/?binding-built=1#/app/t/b128e444-cd57-4087-bcfe-c403051bbd8f/p/1498c59a-a789-4087-8069-4c99ebcbd63f';
  const errors=[];const capture=e=>errors.push(e.message);page.on('pageerror',capture);const measures=[];
  const settle=()=>page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect&&Number.isFinite(a.effect.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));});
  const measure=async(name)=>{
    const value=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,dialogs:Array.from(document.querySelectorAll('[role=dialog]')).map(d=>({width:d.clientWidth,scrollWidth:d.scrollWidth}))}));
    ok(value.scrollWidth<=value.width,`${name}: document overflow`);ok(value.dialogs.every(d=>d.scrollWidth<=d.width+1),`${name}: dialog overflow`);measures.push({name,...value});
  };
  try{
    await page.goto(base);await page.getByText('项目样片参考',{exact:true}).waitFor();
    ok(await page.evaluate(()=>Array.from(document.scripts).some(s=>s.src.includes('/assets/index-'))&&!Array.from(document.scripts).some(s=>s.src.includes('/@vite/client'))),'Expected actual production build');
    for(const size of [{width:1366,height:768},{width:320,height:740}]){
      await page.setViewportSize(size);await page.getByText('剧目默认资产',{exact:true}).scrollIntoViewIfNeeded();await measure('production-defaults');await page.screenshot({path:`output/playwright/creative-bindings/06-built-defaults-${size.width}.png`});
      await page.getByText('项目样片参考',{exact:true}).scrollIntoViewIfNeeded();await page.waitForFunction(()=>Array.from(document.querySelectorAll('main img')).every(i=>i.complete));await measure('quality-references');await page.screenshot({path:`output/playwright/creative-bindings/07-built-quality-${size.width}.png`});
    }
    const opening=page.waitForEvent('popup');await page.getByRole('link',{name:'在新标签页查看素材',exact:true}).nth(1).click();const media=await opening;
    try{await media.getByRole('heading',{name:'四秒技术测试片 · 双人核对',exact:true}).waitFor();}finally{await media.close();await page.bringToFront();}
    await page.goto(base+'/content');await page.getByRole('button',{name:'编辑01 · 旧公寓重逢',exact:true}).click();
    const editor=page.getByRole('dialog',{name:'编辑场次',exact:true});
    await editor.getByRole('button',{name:'选择此处角色造型',exact:true}).click();
    const picker=page.getByRole('dialog',{name:'选择此处角色造型',exact:true});
    await picker.getByRole('button',{name:/^使用 v5 · 晚礼服/}).waitFor();await settle();await measure('fixed-look-choice');
    const clipped=await picker.getByRole('button',{name:/^使用 v/}).evaluateAll(buttons=>buttons.flatMap(b=>Array.from(b.querySelectorAll('*')).filter(e=>e.clientWidth>0&&e.scrollWidth>e.clientWidth+1).map(e=>e.textContent)));
    ok(clipped.length===0,'Look choices clip their visible labels');await page.screenshot({path:'output/playwright/creative-bindings/08-built-look-picker-320.png'});
    await picker.getByRole('button',{name:'关闭弹窗',exact:true}).click();
    await editor.getByRole('textbox',{name:'道具状态',exact:true}).scrollIntoViewIfNeeded();await settle();await measure('scene-state-editor');await page.screenshot({path:'output/playwright/creative-bindings/09-built-scene-editor-320.png'});
    await editor.getByRole('button',{name:'关闭弹窗',exact:true}).click();
    await page.getByRole('button',{name:'要求历史',exact:true}).first().click();
    const history=page.getByRole('dialog',{name:'01A · 入屋 · 要求历史',exact:true});
    await history.getByText('第 1 句',{exact:true}).scrollIntoViewIfNeeded();await history.getByText('林晚 · 共享声音设定 · v2 · 草稿',{exact:true}).waitFor();await settle();await measure('fixed-shot-history');await page.screenshot({path:'output/playwright/creative-bindings/10-built-shot-history-320.png'});
    await history.getByRole('button',{name:'关闭弹窗',exact:true}).click();
    await page.setViewportSize({width:1366,height:768});await page.getByRole('heading',{level:1}).scrollIntoViewIfNeeded();
    ok(errors.length===0,errors.join(';'));
    return {productionBuild:true,measures,lookLabelsNotClipped:true,qualityMediaOpenedByActualIdentity:true,pageErrors:errors};
  }finally{page.off('pageerror',capture);}
}
