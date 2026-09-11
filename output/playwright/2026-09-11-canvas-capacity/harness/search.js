async(page)=>{
 const data=__CASE__,search=[],focus=[];if(await page.getByRole('button',{name:'手形',exact:true}).count())await page.getByRole('button',{name:'手形',exact:true}).click();
 const details=page.locator('details').filter({has:page.locator('summary').filter({hasText:'节点列表与键盘定位'})});if(!await details.getAttribute('open')){if(!await page.getByLabel('查找节点',{exact:true}).isVisible())await details.locator('summary').click()}
 for(let i=0;i<20;i++){
  const ordinal=i%2?3:data.nodeCount,query='CAP'+String(ordinal).padStart(4,'0'),id=i%2?data.sourceTextId:data.lastNodeId;
  await page.evaluate(query=>{window.__sample=new Promise(resolve=>window.addEventListener('input',()=>{const start=performance.now();let checks=0;const check=()=>{const d=[...document.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='节点列表与键盘定位');const bs=[...d.querySelectorAll('button')];if(bs.length===1&&bs[0].textContent.includes(query))requestAnimationFrame(()=>resolve({ms:performance.now()-start}));else if(++checks>300)resolve({failed:true});else requestAnimationFrame(check)};requestAnimationFrame(check)},{once:true,capture:true}))},query);
  await page.getByLabel('查找节点',{exact:true}).fill(query);search.push(await page.evaluate(()=>window.__sample));
  await page.evaluate(id=>{window.__sample=new Promise(resolve=>window.addEventListener('click',()=>{const start=performance.now();let checks=0;const check=()=>{const el=document.querySelector(`[data-id="${id}"] article[data-selected="true"]`),flow=document.querySelector('.react-flow').getBoundingClientRect(),b=el?.getBoundingClientRect();if(b&&b.right>flow.left&&b.left<flow.right&&b.bottom>flow.top&&b.top<flow.bottom)requestAnimationFrame(()=>resolve({ms:performance.now()-start,id}));else if(++checks>600)resolve({failed:true,id,rendered:!!el});else requestAnimationFrame(check)};requestAnimationFrame(check)},{once:true,capture:true}))},id);
  await details.getByRole('button').click();const sample=await page.evaluate(()=>window.__sample);focus.push(sample);if(sample.failed)break;
 }
 await page.locator('.react-flow').scrollIntoViewIfNeeded();await page.screenshot({path:`output/playwright/2026-09-11-canvas-capacity/${data.nodeCount}-optimized-search.png`,fullPage:true});
 return {case:data.nodeCount,phase:'optimized',search,focus};
}
