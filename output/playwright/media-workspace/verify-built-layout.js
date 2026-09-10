async(page)=>{
  page.setDefaultTimeout(15000);
  const base='http://127.0.0.1:4311/#/app/t/b128e444-cd57-4087-bcfe-c403051bbd8f/p/1498c59a-a789-4087-8069-4c99ebcbd63f/media';
  const errors=[];const capture=e=>errors.push(e.message);page.on('pageerror',capture);
  const layouts=[];
  try {
    await page.goto(base+'?media=5b647e08-c985-4946-aa2a-33231c778aca');await page.reload();
    await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
    if(await page.evaluate(()=>!!document.querySelector('script[src="/@vite/client"]')))throw new Error('Expected production build');
    for(const size of [{width:1366,height:768},{width:320,height:740}]) {
      await page.setViewportSize(size);
      await page.locator('media-play-button').hover();
      await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('media-control-bar')).opacity)===1);
      const measure=await page.evaluate(()=>{const control=document.querySelector('media-control-bar'),rect=control.getBoundingClientRect();return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,controlBottom:rect.bottom,controlWidth:rect.width,controlOpacity:getComputedStyle(control).opacity};});
      if(measure.scrollWidth>measure.width)throw new Error('Horizontal overflow at '+measure.width);
      if(size.width===1366 && measure.controlBottom>size.height)throw new Error('Laptop player controls fall below first viewport');
      await page.screenshot({path:'output/playwright/media-workspace/08-built-video-'+size.width+'.png',fullPage:size.width===320});
      layouts.push(measure);
    }
    await page.goto(base);
    await page.getByRole('heading',{name:'旧钥匙 · 我的修订 · 素材',exact:true}).waitFor();
    await page.getByRole('button',{name:'导入与恢复',exact:true}).click();
    await page.getByRole('region',{name:'文件导入与恢复'}).waitFor();
    const narrow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
    if(narrow.scrollWidth>narrow.width)throw new Error('Import panel overflows on mobile');
    await page.screenshot({path:'output/playwright/media-workspace/09-built-import-320.png',fullPage:true});
    await page.setViewportSize({width:1366,height:768});
    await page.goto('http://127.0.0.1:4311/#/design/');
    await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
    if(errors.length)throw new Error(errors.join(';'));
    return {productionBuild:true,layouts,mobileImport:narrow,designSamplePlayable:true,pageErrors:errors.length};
  } finally {page.off('pageerror',capture);}
}
