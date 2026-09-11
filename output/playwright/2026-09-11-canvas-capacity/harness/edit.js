async(page)=>{
 const data=__CASE__,samples=[],writes=[];
 if(await page.getByRole('button',{name:'手形',exact:true}).count())await page.getByRole('button',{name:'手形',exact:true}).click();
 await page.locator('summary').filter({hasText:'节点列表与键盘定位'}).click();await page.getByLabel('查找节点',{exact:true}).fill('CAP0003');await page.getByRole('button',{name:'CAP0003 文字来源',exact:true}).click();
 await page.getByLabel('文字内容',{exact:true}).waitFor();
 const original=await page.getByLabel('文字内容',{exact:true}).inputValue();
 page.on('request',request=>{if(request.method()==='PUT'&&request.url().split('?')[0].endsWith('/canvases/'+data.canvasId))writes.push({start:Date.now(),bytes:request.postDataBuffer()?.length})});
 for(let i=0;i<40;i++){
  const value=original+'\n浏览器容量编辑 '+String(i).padStart(2,'0');
  await page.evaluate(({id,value})=>{window.__sample=new Promise(resolve=>window.addEventListener('input',()=>{const start=performance.now();let checks=0;const check=()=>{const element=document.querySelector(`[data-id="${id}"] article`);if(element?.textContent.includes(value))requestAnimationFrame(()=>resolve({ms:performance.now()-start}));else if(++checks>300)resolve({failed:true,rendered:!!element});else requestAnimationFrame(check)};requestAnimationFrame(check)},{once:true,capture:true}))},{id:data.sourceTextId,value});
  await page.getByLabel('文字内容',{exact:true}).fill(value);samples.push(await page.evaluate(()=>window.__sample));
 }
 const saved=page.waitForResponse(response=>response.request().method()==='PUT'&&response.url().split('?')[0].endsWith('/canvases/'+data.canvasId)&&response.ok());await page.getByRole('button',{name:'保存画布',exact:true}).click();await saved;
 await page.getByRole('status').filter({hasText:'画布 · 已保存'}).waitFor();
 const persisted=await page.evaluate(async data=>{const response=await fetch(`/v1/tenants/${data.tenantId}/projects/${data.projectId}/canvases/${data.canvasId}`,{cache:'no-store'});const canvas=await response.json();const node=canvas.document.nodes.find(n=>n.id===data.sourceTextId);return{revision:canvas.revision,nodeCount:canvas.document.nodes.length,edgeCount:canvas.document.edges.length,text:node.content.text}},data);
 await page.reload();await page.getByLabel('文字内容',{exact:true}).waitFor();
 return {case:data.nodeCount,phase:'optimized',kind:'input event to matching visible node content + next RAF',samples,writes,persisted,reloadedValue:await page.getByLabel('文字内容',{exact:true}).inputValue()};
}
