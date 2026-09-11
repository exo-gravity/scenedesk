async(page)=>{
 const samples=[];const data=__CASE__;await page.goto(`http://127.0.0.1:4318/#/app/t/${data.tenantId}/p/${data.projectId}/production?scene=${data.sceneId}&mode=canvas`);
 for(let i=0;i<20;i++){
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.react-flow__node').first().waitFor();
  await page.getByRole('status').filter({hasText:'画布 · 已保存'}).waitFor();
  samples.push(await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({readyMs:performance.now(),nodes:document.querySelectorAll('.react-flow__node').length,edges:document.querySelectorAll('.react-flow__edge').length,heapUsed:performance.memory?.usedJSHeapSize,domElements:document.querySelectorAll('*').length}))))));
 }
 return {case:__CASE__.nodeCount,phase:'optimized',kind:'20 warm full reloads; ready canvas nodes + saved status + 2 RAF; app assets cached',samples};
}
