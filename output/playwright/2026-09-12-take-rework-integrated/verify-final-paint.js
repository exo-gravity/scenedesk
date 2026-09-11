async page => {
 await page.reload();
 const panel=page.locator('[aria-label="按意见准备修改"]'); await panel.waitFor();
 const results=[];
 for (const size of [{width:1512,height:982},{width:390,height:844}]) {
  await page.setViewportSize(size);
  const summary=panel.getByText("固定候选 346e0146 · 意见 r2",{exact:true}).locator('..');
  await summary.scrollIntoViewIfNeeded();
  const shape=await summary.evaluate(el=>({height:el.getBoundingClientRect().height,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,text:el.innerText}));
  const geometry=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
  if(shape.clientHeight<shape.scrollHeight || geometry.document>geometry.viewport) throw Error("Fixed feedback summary remains clipped");
  await page.screenshot({path:'output/playwright/2026-09-12-take-rework-integrated/rework-'+size.width+'.png',animations:'disabled'});
  results.push({size,shape,geometry});
 }
 return {readOnlyRepaint:true,results};
}
