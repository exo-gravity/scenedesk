async (page) => {
  const frame=page.frameLocator('iframe');
  const root=frame.locator('#scene-two-modes');
  const checks=[];
  for(const width of [1024,736,360]){
    await page.setViewportSize({width,height:1000});
    for(const mode of ['分镜模式','自由画布']){
      await frame.getByRole('button',{name:mode,exact:true}).click();
      const geometry=await root.evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,viewport:innerWidth,bodyWidth:document.documentElement.scrollWidth}));
      if(geometry.scrollWidth>geometry.width+1||geometry.bodyWidth>geometry.viewport+1)throw new Error(JSON.stringify({width,mode,geometry}));
      checks.push({width,mode,...geometry});
      if(width===1024||width===360&&mode==='自由画布')await root.screenshot({path:'output/playwright/scene-two-modes-'+width+'-'+(mode==='自由画布'?'canvas':'board')+'.png'});
    }
  }
  await page.setViewportSize({width:1024,height:1000});
  await frame.getByRole('button',{name:'剪辑',exact:true}).click();
  await frame.getByRole('region',{name:'共用的场次剪辑'}).waitFor();
  await frame.getByRole('button',{name:'审阅稿 v1 · 待修改',exact:true}).click();
  await frame.getByRole('region',{name:'共用的固定稿审阅'}).waitFor();
  await frame.getByRole('button',{name:'镜头制作',exact:true}).click();
  if(await frame.getByRole('button',{name:'自由画布',exact:true}).getAttribute('aria-pressed')!=='true')throw new Error('Mode was not retained');
  await frame.getByRole('button',{name:'分镜模式',exact:true}).click();
  await frame.getByRole('button',{name:'林夏 · 近景 SH02 迟来的追问 当前采用 A',exact:true}).click();
  await frame.getByRole('button',{name:'自由画布',exact:true}).click();
  if(!await root.locator('[data-group-title]').textContent().then(s=>s.startsWith('SH02')))throw new Error('Shot was not retained');
  return {checks,sharedEditingAndReview:true,modeRetained:true,shotRetained:true};
}
