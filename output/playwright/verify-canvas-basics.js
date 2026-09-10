async (page)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1024,height:1200});await page.reload();
  const f=page.frameLocator('iframe'),root=f.locator('#scene-canvas-basics');
  await f.getByRole('button',{name:'自由画布',exact:true}).waitFor();
  await root.screenshot({path:'output/playwright/canvas-basics-desktop.png'});
  const header=f.getByRole('button',{name:'选择或移动 结果 B',exact:true});
  const before=await root.locator('[data-node="b"]').evaluate(e=>({x:parseFloat(e.style.left),y:parseFloat(e.style.top)}));
  const rect=await header.boundingBox();await page.mouse.move(rect.x+30,rect.y+10);await page.mouse.down();await page.mouse.move(rect.x+65,rect.y+40,{steps:6});await page.mouse.up();
  const after=await root.locator('[data-node="b"]').evaluate(e=>({x:parseFloat(e.style.left),y:parseFloat(e.style.top)}));
  if(after.x<=before.x||after.y<=before.y)throw new Error('Node drag failed');
  await f.getByRole('button',{name:'撤销',exact:true}).click();
  const restored=await root.locator('[data-node="b"]').evaluate(e=>parseFloat(e.style.left));if(restored!==before.x)throw new Error('Undo failed');
  await f.getByRole('textbox',{name:'本次提示',exact:true}).fill('保留构图，放慢拿钥匙的动作。');
  await f.getByRole('checkbox',{name:'结果 B',exact:true}).uncheck();
  await f.getByRole('button',{name:'分镜模式',exact:true}).click();await f.getByRole('button',{name:'自由画布',exact:true}).click();
  if(await f.getByRole('textbox',{name:'本次提示',exact:true}).inputValue()!=='保留构图，放慢拿钥匙的动作。')throw new Error('Prompt lost');
  if(await f.getByRole('checkbox',{name:'结果 B',exact:true}).isChecked())throw new Error('Reference exclusion lost');
  await f.getByRole('button',{name:'从 结果 B 继续创作',exact:true}).click();
  if(await root.locator('.fc-card').count()!==5)throw new Error('Branch not created');
  if(await root.locator('[data-node="b"]').count()!==1)throw new Error('Source removed');
  await f.getByRole('button',{name:'准备生成',exact:true}).click();await root.locator('.fc-plan').waitFor();
  await f.getByRole('button',{name:'剪辑',exact:true}).click();await f.getByRole('region',{name:'共用的场次剪辑'}).waitFor();
  await f.getByRole('button',{name:'审阅稿 v1 · 待修改',exact:true}).click();await f.getByRole('region',{name:'共用的固定稿审阅'}).waitFor();
  await f.getByRole('button',{name:'镜头制作',exact:true}).click();if(await root.locator('.fc-card').count()!==5)throw new Error('Canvas lost');
  for(const width of [736,360]){await page.setViewportSize({width,height:1200});const size=await root.evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,doc:document.documentElement.scrollWidth,view:innerWidth}));if(size.scroll>size.width+1||size.doc>size.view+1)throw new Error('Overflow '+JSON.stringify(size));}
  await root.screenshot({path:'output/playwright/canvas-basics-mobile.png'});
  if(errors.length)throw new Error(errors.join('; '));
  return{nodeDrag:true,undo:true,modePreservesPromptAndReference:true,branchRetainsSource:true,sharedCutAndReview:true,noOverflow:[736,360],errors};
}
