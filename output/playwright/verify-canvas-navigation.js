async(page)=>{
  await page.setViewportSize({width:1024,height:1200});await page.reload();
  const f=page.frameLocator('iframe'),root=f.locator('#scene-canvas-basics');await root.locator('.fc-card').first().waitFor();
  const v=await root.locator('.fc-viewport').boundingBox();
  await page.mouse.move(v.x+8,v.y+20);await page.mouse.down();await page.mouse.move(v.x+v.width-8,v.y+v.height-8,{steps:8});await page.mouse.up();
  const selected=await root.locator('.fc-card.selected').count();if(selected!==4)throw new Error('Expected four selected, got '+selected);
  await f.getByRole('button',{name:'继续创作',exact:true}).click();if(await root.locator('.fc-refs input').count()!==4)throw new Error('Multi-reference draft missing');
  await f.getByRole('button',{name:'手形',exact:true}).click();const previous=await root.locator('.fc-world').getAttribute('style');
  await page.mouse.move(v.x+30,v.y+30);await page.mouse.down();await page.mouse.move(v.x+90,v.y+60,{steps:5});await page.mouse.up();
  if(previous===await root.locator('.fc-world').getAttribute('style'))throw new Error('Pan failed');
  await f.getByRole('button',{name:'放大画布',exact:true}).click();if(await root.locator('[data-scale]').textContent()!=='110%')throw new Error('Zoom failed');
  await page.setViewportSize({width:360,height:2300});await root.screenshot({path:'output/playwright/canvas-basics-mobile.png'});
  return{marquee:true,multiReferenceDraft:true,pan:true,zoom:true};
}
