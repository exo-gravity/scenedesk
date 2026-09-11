async page => {
  page.setDefaultTimeout(15000);
  const ok=(v,m)=>{if(!v)throw new Error(m);}, cases=[], errors=[];
  const onError=e=>errors.push(e.message);page.on('pageerror',onError);
  await page.reload();
  await page.getByRole('button',{name:'自由画布',exact:true}).waitFor();
  const restore=page.getByRole('button',{name:'恢复本机修改',exact:true});
  if(await restore.isVisible()) {await restore.click();await page.getByRole('status').filter({hasText:'有待完成输入'}).waitFor();await page.getByRole('textbox',{name:'横向位置',exact:true}).fill('30.5');await page.getByRole('button',{name:'保存画布',exact:true}).click();await page.getByRole('status').filter({hasText:'画布 · 已保存'}).waitFor();}
  const dock=page.getByRole('complementary',{name:'素材浏览',exact:true});if(await dock.isVisible())await dock.getByRole('button',{name:'收起',exact:true}).click();
  await page.getByText('节点列表与键盘定位',{exact:true}).click();
  await page.getByRole('button',{name:'四秒技术测试片 · 双人核对',exact:true}).click();
  await page.getByText('节点列表与键盘定位',{exact:true}).click();
  await page.getByRole('article',{name:'四秒技术测试片 · 双人核对 · video',exact:true}).getByRole('button',{name:'播放预览',exact:true}).click();
  await page.getByRole('button',{name:'适应内容',exact:true}).click();
  const video=page.locator('video');
  await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.readyState>=2;});
  ok(await video.count()===1,'expected one decoder');
  const geometry=await page.getByRole('article',{name:'四秒技术测试片 · 双人核对 · video',exact:true}).boundingBox();
  await page.getByRole('button',{name:'播放',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.2);
  const after=await page.getByRole('article',{name:'四秒技术测试片 · 双人核对 · video',exact:true}).boundingBox();
  ok(Math.abs(geometry.x-after.x)<1&&Math.abs(geometry.y-after.y)<1,'player interaction dragged node');
  cases.push('real proxy decodes and plays; player controls do not drag node');
  await page.getByRole('button',{name:'复制',exact:true}).click();
  await page.getByRole('button',{name:'适应内容',exact:true}).click();
  await page.locator('.react-flow__node.selected').getByRole('button',{name:'播放预览',exact:true}).click();
  await page.waitForFunction(()=>{const videos=[...document.querySelectorAll('video')];return videos.length===1&&videos[0].readyState>=2;});
  cases.push('second preview releases prior decoder');
  await page.getByRole('button',{name:'分镜',exact:true}).click();
  ok(await page.locator('video').count()===0,'mode change retained player');
  await page.getByRole('button',{name:'自由画布',exact:true}).click();
  ok(await page.locator('video').count()===0,'mode return auto-started prior player');
  cases.push('mode switch releases player and returns to thumbnails');
  // A number remains raw through a mode switch and a real reload.
  await page.getByRole('status').filter({hasText:'画布 · 已保存'}).waitFor();
  const x=page.getByRole('textbox',{name:'横向位置',exact:true});
  const prior=await x.inputValue();await x.fill('12.');
  await page.getByRole('status').filter({hasText:'有待完成输入'}).waitFor();
  await page.getByRole('button',{name:'分镜',exact:true}).click();await page.getByRole('button',{name:'自由画布',exact:true}).click();
  ok(await x.inputValue()==='12.','mode switch lost incomplete coordinate');
  await page.reload();await page.getByRole('button',{name:'恢复本机修改',exact:true}).click();
  ok(await x.inputValue()==='12.','reload lost incomplete coordinate');
  await x.fill(prior);await page.getByRole('button',{name:'保存画布',exact:true}).click();await page.getByRole('status').filter({hasText:'画布 · 已保存'}).waitFor();
  cases.push('incomplete coordinate stays exact through mode switch and authorized reload recovery');
  const layouts=[];
  for(const [width,height] of [[1512,982],[1366,900],[760,900],[390,844]]){
    await page.setViewportSize({width,height});
    await page.getByRole('button',{name:'适应内容',exact:true}).click();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const overflow=await page.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)>window.innerWidth);
    ok(!overflow,`horizontal overflow at ${width}`);
    const box=await page.getByRole('textbox',{name:'节点名称',exact:true}).boundingBox();
    if(width>=1366)ok(box&&box.y+box.height<height,'editor below viewport');
    await page.screenshot({path:`output/playwright/scene-canvas/09-media-layout-v2-${width}.png`});layouts.push({width,height,horizontalOverflow:overflow});
  }
  await page.setViewportSize({width:1512,height:982});
  page.off('pageerror',onError);ok(errors.length===0,errors.join(';'));
  return {cases,layouts,pageErrors:errors.length,scope:'production build, real imported technical media; narrow layout is a list, not mobile canvas acceptance'};
}
