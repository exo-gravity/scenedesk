async (page) => {
 await page.setViewportSize({width:1512,height:982});
 await page.goto('http://127.0.0.1:4312/#/journey/?variant=recommendation&screen=production&mode=storyboard&tone=light&assistant=off'); await page.reload();
 await page.getByRole('textbox',{name:'SH-04提示词',exact:true}).waitFor();
 await page.screenshot({path:'output/playwright/2026-09-10-scene-walkthrough/10-storyboard-default.png',animations:'disabled'});
 await page.getByRole('button',{name:'助手',exact:true}).click(); await page.getByRole('button',{name:'自由画布',exact:true}).click(); await page.getByRole('button',{name:'编辑探索草稿',exact:true}).click();
 await page.screenshot({path:'output/playwright/2026-09-10-scene-walkthrough/11-canvas-default.png',animations:'disabled'});
 await page.getByRole('button',{name:'返回场次',exact:true}).click();
 await page.screenshot({path:'output/playwright/2026-09-10-scene-walkthrough/12-project-scenes.png',animations:'disabled'});
 return {url:page.url()};
}
