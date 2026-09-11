async(page)=>{
 await page.unrouteAll({behavior:'wait'});
 await page.route('http://127.0.0.1:4318/v1/**',async route=>{
  if(['GET','HEAD','OPTIONS'].includes(route.request().method())) return route.continue();
  const response=await route.fetch({headers:{...route.request().headers(),origin:'http://127.0.0.1:4311'}});
  await route.fulfill({response});
 });
 await page.setViewportSize({width:1512,height:982});
 await page.reload();
 await page.locator('.react-flow__node').first().waitFor();
 const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
 const result={browser:await cdp.send('Browser.getVersion'),dom:await cdp.send('Memory.getDOMCounters'),metrics:await cdp.send('Performance.getMetrics'),page:await page.evaluate(()=>({ua:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize,limit:performance.memory.jsHeapSizeLimit}:null,renderedNodes:document.querySelectorAll('.react-flow__node').length,renderedEdges:document.querySelectorAll('.react-flow__edge').length,totalElements:document.querySelectorAll('*').length,players:document.querySelectorAll('video,audio').length,details:[...document.querySelectorAll('details')].map(d=>({summary:d.querySelector('summary')?.textContent,open:d.open,elements:d.querySelectorAll('*').length}))}))};await cdp.detach();return result;
}
