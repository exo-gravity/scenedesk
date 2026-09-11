async (page) => {
 const url="http://127.0.0.1:4316/#/app/t/2438d7ca-a1ce-4d99-80d1-53ca25ae03d0/p/c7df6542-f8b8-46a6-8a7b-6dcf11fedbb7/production?scene=d484ea13-209a-4eb4-af3d-80864219225c&mode=canvas";
 const path="/v1/tenants/2438d7ca-a1ce-4d99-80d1-53ca25ae03d0/projects/c7df6542-f8b8-46a6-8a7b-6dcf11fedbb7/scenes/d484ea13-209a-4eb4-af3d-80864219225c/workspace-preference";
 await page.setViewportSize({width:1512,height:982});await page.goto(url);await page.reload();await page.getByRole('button',{name:'适应内容',exact:true}).waitFor();
 await page.getByText('节点列表与键盘定位',{exact:true}).click();
 const before=await page.evaluate(async p=>(await fetch(p)).json(),path);
 const responsePromise=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/workspace-preference'));
 await page.getByRole('button',{name:'左上合法边界',exact:true}).click();
 const response=await responsePromise;if(response.status()!==200)throw Error('Expected successful legal preference '+response.status());
 const result={status:response.status(),request:response.request().postDataJSON(),response:await response.json(),before,after:await page.evaluate(async p=>(await fetch(p)).json(),path),transform:await page.evaluate(()=>document.querySelector('.react-flow__viewport').style.transform)};
 await page.screenshot({path:'output/playwright/2026-09-12-canvas-complete-fit/focus-boundary-after.png',animations:'disabled'});
 if(result.request.viewport.x!==1000000||result.request.viewport.y!==1000000||result.request.viewport.zoom!==1)throw Error('boundary not clamped');
 await page.waitForTimeout(1100);
 await page.reload();await page.getByRole('button',{name:'适应内容',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.react-flow__node[data-id=\"dd387e77-d6c6-4531-b374-36e527c94ae2\"]'));
 const restored=await page.evaluate(()=>{const p=document.querySelector('.react-flow').getBoundingClientRect(),r=document.querySelector('.react-flow__node[data-id=\"dd387e77-d6c6-4531-b374-36e527c94ae2\"]').getBoundingClientRect();return {transform:document.querySelector('.react-flow__viewport').style.transform,inside:r.left>=p.left-1&&r.top>=p.top-1&&r.right<=p.right+1&&r.bottom<=p.bottom+1}});
 if(!restored.inside||!restored.transform.includes('scale(1)'))throw Error('restored boundary not visible');
 return {...result,restored,heldBeyondDebounce:true};
}