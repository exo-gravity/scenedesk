async (page) => {
 const url="http://127.0.0.1:4316/#/app/t/2438d7ca-a1ce-4d99-80d1-53ca25ae03d0/p/c7df6542-f8b8-46a6-8a7b-6dcf11fedbb7/production?scene=d484ea13-209a-4eb4-af3d-80864219225c&mode=canvas";
 const path="/v1/tenants/2438d7ca-a1ce-4d99-80d1-53ca25ae03d0/projects/c7df6542-f8b8-46a6-8a7b-6dcf11fedbb7/scenes/d484ea13-209a-4eb4-af3d-80864219225c/workspace-preference";
 await page.setViewportSize({width:1512,height:982});await page.goto(url);await page.reload();await page.getByRole('button',{name:'适应内容',exact:true}).waitFor();
 await page.getByText('节点列表与键盘定位',{exact:true}).click();
 const before=await page.evaluate(async p=>(await fetch(p)).json(),path);
 const responsePromise=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/workspace-preference'));
 await page.getByRole('button',{name:'左上合法边界',exact:true}).click();
 const response=await responsePromise;
 const result={status:response.status(),request:response.request().postDataJSON(),response:await response.json(),before,after:await page.evaluate(async p=>(await fetch(p)).json(),path),transform:await page.evaluate(()=>document.querySelector('.react-flow__viewport').style.transform)};
 await page.screenshot({path:'output/playwright/2026-09-12-canvas-complete-fit/focus-boundary-before.png',animations:'disabled'});
 return result;
}