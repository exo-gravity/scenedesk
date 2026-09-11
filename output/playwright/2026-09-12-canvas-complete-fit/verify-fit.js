async (page) => {
  const fixture = {"path": "/v1/tenants/2438d7ca-a1ce-4d99-80d1-53ca25ae03d0/projects/c7df6542-f8b8-46a6-8a7b-6dcf11fedbb7", "cases": [{"count": 2, "sceneId": "d484ea13-209a-4eb4-af3d-80864219225c", "canvasId": "652093b7-42f1-4e2a-8d32-04e40811a980", "documentHash": "38347472155cca798a838ac42dad66b946b4db9f0b78e2b8921394b7bf9a3922", "revision": 2, "url": "http://127.0.0.1:4316/#/app/t/2438d7ca-a1ce-4d99-80d1-53ca25ae03d0/p/c7df6542-f8b8-46a6-8a7b-6dcf11fedbb7/production?scene=d484ea13-209a-4eb4-af3d-80864219225c&mode=canvas"}, {"count": 2000, "sceneId": "572ec38d-eed0-48c0-9a72-a9817f0b67cc", "canvasId": "f0baa511-d67e-40be-8e74-7e8d7dc1af80", "documentHash": "ddf1a903245419bd02c5b067d465bccd574bbace04b95fe17be665dfcae17c83", "revision": 2, "url": "http://127.0.0.1:4316/#/app/t/2438d7ca-a1ce-4d99-80d1-53ca25ae03d0/p/c7df6542-f8b8-46a6-8a7b-6dcf11fedbb7/production?scene=572ec38d-eed0-48c0-9a72-a9817f0b67cc&mode=canvas"}]};

  const out='output/playwright/2026-09-12-canvas-complete-fit', errors=[], results=[], writes=[];
  const ensure=(ok,message)=>{if(!ok)throw Error(message)};
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push({method:r.method(),path:r.url().split('?')[0],body:r.postData()})});
  await page.setViewportSize({width:1512,height:982});
  const read=async url=>page.evaluate(async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Actual read failed '+r.status);return r.json()},url);
  const waitSaved=async path=>{const deadline=Date.now()+30000;let saved;while(Date.now()<deadline){saved=await read(path);const zoom=await page.evaluate(()=>Number(document.querySelector('.react-flow__viewport')?.style.transform.match(/scale\(([^)]+)\)/)?.[1]));if(saved.viewport.zoom>0&&saved.viewport.zoom<0.1&&Math.abs(saved.viewport.zoom-zoom)<1e-6)return saved;await page.waitForTimeout(100)}throw Error('Actual preference not persisted '+JSON.stringify(saved))};
  const geometry=()=>page.evaluate(()=>{const pane=document.querySelector('.react-flow'),bounds=pane.getBoundingClientRect(),nodes=[...document.querySelectorAll('.react-flow__node')],rects=nodes.map(n=>{const r=n.getBoundingClientRect();return {id:n.getAttribute('data-id'),x:r.left,y:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}});const outside=rects.filter(r=>r.x<bounds.left-1||r.y<bounds.top-1||r.right>bounds.right+1||r.bottom>bounds.bottom+1);return {count:rects.length,edges:document.querySelectorAll('.react-flow__edge').length,viewport:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},transform:document.querySelector('.react-flow__viewport').style.transform,outside:outside.slice(0,4),first:rects[0],last:rects.at(-1),heap:performance.memory?.usedJSHeapSize}});
  for(const entry of fixture.cases){
    await page.goto(entry.url);await page.getByRole('button',{name:'适应内容',exact:true}).waitFor();
    const original=await read(`${fixture.path}/canvases/${entry.canvasId}`);
    const started=Date.now();await page.getByRole('button',{name:'适应内容',exact:true}).click();
    await page.waitForFunction(count=>{const pane=document.querySelector('.react-flow');if(!pane)return false;const p=pane.getBoundingClientRect(),nodes=[...document.querySelectorAll('.react-flow__node')];return nodes.length===count&&nodes.every(n=>{const r=n.getBoundingClientRect();return r.left>=p.left-1&&r.top>=p.top-1&&r.right<=p.right+1&&r.bottom<=p.bottom+1})},entry.count,{timeout:30000});
    const fitMs=Date.now()-started,fit=await geometry();ensure(fit.outside.length===0,'fit clipped bounds');
    const saved=await waitSaved(`${fixture.path}/scenes/${entry.sceneId}/workspace-preference`);ensure(saved.viewport.zoom>0&&saved.viewport.zoom<0.1,'actual preference did not save overview');
    await page.screenshot({path:`${out}/fit-${entry.count}-1512.png`,animations:'disabled'});
    await page.reload();await page.getByRole('button',{name:'适应内容',exact:true}).waitFor();
    await page.waitForFunction(count=>document.querySelectorAll('.react-flow__node').length===count,entry.count);
    const restored=await geometry();ensure(restored.outside.length===0,'refresh cropped restored view');ensure(Math.abs(Number(restored.transform.match(/scale\(([^)]+)\)/)[1])-saved.viewport.zoom)<1e-6,'refresh changed zoom');
    await page.getByRole('button',{name:'分镜',exact:true}).click();await page.getByRole('button',{name:'自由画布',exact:true}).click();await page.waitForFunction(count=>document.querySelectorAll('.react-flow__node').length===count,entry.count);ensure((await geometry()).outside.length===0,'mode return cropped overview');
    const flow=page.locator('.react-flow');const box=await flow.boundingBox();
    await page.getByRole('button',{name:'选择',exact:true}).click();await page.evaluate(()=>{window.__fitFrames=[];window.__fitTransforms=[];window.__fitActive=true;let last=performance.now();const step=now=>{if(!window.__fitActive)return;window.__fitFrames.push(now-last);last=now;window.__fitTransforms.push(document.querySelector('.react-flow__viewport')?.style.transform);requestAnimationFrame(step)};requestAnimationFrame(step)});
    const panStart=Date.now();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+80,box.y+box.height/2+30,{steps:20});await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:20});await page.mouse.up();
    const pan=await page.evaluate(()=>{window.__fitActive=false;return {samples:window.__fitFrames,changedTransforms:new Set(window.__fitTransforms).size}});pan.durationMs=Date.now()-panStart;ensure(pan.changedTransforms>1,'pan samples were idle');
    await page.getByRole('button',{name:'手形',exact:true}).click();await page.getByRole('button',{name:'画布缩放到百分之百',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.react-flow__viewport').style.transform.includes('scale(1)'));
    await page.getByRole('button',{name:'缩小画布',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.react-flow__viewport').style.transform.includes('scale(1)'));await page.getByRole('button',{name:'放大画布',exact:true}).click();
    await page.getByRole('button',{name:'适应内容',exact:true}).click();await page.waitForFunction(count=>document.querySelectorAll('.react-flow__node').length===count,entry.count);
    const after=await read(`${fixture.path}/canvases/${entry.canvasId}`);ensure(after.documentHash===original.documentHash&&after.revision===original.revision,'view action changed canvas content');
    results.push({count:entry.count,fitMs,fit,savedPreference:saved.viewport,restored,pan,contentUnchanged:true});
  }
  ensure(errors.length===0,'page errors '+JSON.stringify(errors));
  ensure(writes.every(w=>w.path.endsWith('/workspace-preference')||w.path.endsWith('/editing-presence')),'unexpected business mutation');
  return {actualApiAndPostgres:true,isolatedTechnicalIdentity:true,productionBuild:true,notCapacityP95Acceptance:true,notMediaOrProviderAcceptance:true,results,writes,errors};
}
