async(page)=>{
 const data=__CASE__,samples=[];
 for(let i=0;i<40;i++){
  const id=data.firstNodeIds[i%2+1];
  await page.evaluate(id=>{window.__sample=new Promise(resolve=>{window.addEventListener('click',function hit(){const start=performance.now();let checks=0;const check=()=>{if(document.querySelector(`[data-id="${id}"] article[data-selected="true"]`)) requestAnimationFrame(()=>resolve({ms:performance.now()-start,id}));else if(++checks>300)resolve({failed:true,id});else requestAnimationFrame(check)};requestAnimationFrame(check)}, {once:true,capture:true});})},id);
  await page.locator(`[data-id="${id}"] .canvas-drag-handle`).click();
  samples.push(await page.evaluate(()=>window.__sample));
 }
 return {case:data.nodeCount,phase:'optimized',kind:'native click capture to selected node DOM + next RAF',samples,dom:await page.evaluate(()=>({elements:document.querySelectorAll('*').length,flowNodes:document.querySelectorAll('.react-flow__node').length,heap:performance.memory?.usedJSHeapSize}))};
}
