async(page)=>{
 const results=[];const data=__CASE__;
 await page.evaluate(async data=>{const base=`/v1/tenants/${data.tenantId}/projects/${data.projectId}/scenes/${data.sceneId}/workspace-preference`;const pref=await (await fetch(base)).json(),session=await (await fetch('/v1/session')).json();const r=await fetch(base,{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'If-Match':`"${pref.revision}"`},body:JSON.stringify({mode:'canvas',selectedShotId:null,selectedNodeIds:[],viewport:{x:32,y:32,zoom:0.8},assetPanelOpen:false,assistantOpen:false})});if(!r.ok)throw new Error('reset '+r.status)},data);
 await page.goto(`http://127.0.0.1:4318/#/app/t/${data.tenantId}/p/${data.projectId}/production?scene=${data.sceneId}&mode=canvas`);await page.reload();await page.locator('.react-flow__node').first().waitFor();await page.getByRole('button',{name:'适应内容',exact:true}).click();await page.waitForTimeout(300);
 if(await page.getByRole('button',{name:'选择',exact:true}).count())await page.getByRole('button',{name:'选择',exact:true}).click();
 await page.locator('.react-flow').scrollIntoViewIfNeeded();
 const box=await page.locator('.react-flow').boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;
 for(const kind of ['pan'])for(let run=0;run<3;run++){
  await page.evaluate(()=>{const f=window.__frames={samples:[],longTasks:[],transforms:[],active:true,last:0,start:performance.now(),startTransform:document.querySelector('.react-flow__viewport').getAttribute('style')};window.__longs=new PerformanceObserver(list=>window.__frames.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));window.__longs.observe({type:'longtask',buffered:false});const tick=now=>{if(!f.active)return;const t=document.querySelector('.react-flow__viewport').getAttribute('style');if(f.transforms.at(-1)!==t)f.transforms.push(t);if(f.last)f.samples.push(now-f.last);f.last=now;f.raf=requestAnimationFrame(tick)};f.raf=requestAnimationFrame(tick)});
  if(kind==='pan'){
   await page.mouse.move(x,y);await page.mouse.down();
   for(let i=0;i<12;i++){await page.mouse.move(x+(i%2?0:-360),y+(i%4<2?-100:0),{steps:20});}
   await page.mouse.up();
  }else{
   await page.mouse.move(x,y);await page.keyboard.down('Control');
   for(let i=0;i<60;i++){await page.mouse.wheel(0,i%20<10?15:-15);await page.waitForTimeout(30);}
   await page.keyboard.up('Control');
  }
  results.push(await page.evaluate(({kind,run})=>{window.__frames.active=false;cancelAnimationFrame(window.__frames.raf);window.__longs.disconnect();return{kind,run,...window.__frames,end:performance.now(),endTransform:document.querySelector('.react-flow__viewport').getAttribute('style'),renderedNodes:document.querySelectorAll('.react-flow__node').length,renderedEdges:document.querySelectorAll('.react-flow__edge').length,heap:performance.memory?.usedJSHeapSize}},{kind,run}));
 }
 return {case:__CASE__.nodeCount,phase:'overview',results};
}
