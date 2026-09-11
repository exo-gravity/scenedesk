async (page) => {
 const url="http://127.0.0.1:4316/#/app/t/2438d7ca-a1ce-4d99-80d1-53ca25ae03d0/p/c7df6542-f8b8-46a6-8a7b-6dcf11fedbb7/production?scene=d484ea13-209a-4eb4-af3d-80864219225c&mode=canvas";
 const prefPath="/v1/tenants/2438d7ca-a1ce-4d99-80d1-53ca25ae03d0/projects/c7df6542-f8b8-46a6-8a7b-6dcf11fedbb7/scenes/d484ea13-209a-4eb4-af3d-80864219225c/workspace-preference";
 const ensure=(ok,msg)=>{if(!ok)throw Error(msg)};
 await page.goto(url);await page.getByRole('button',{name:'适应内容',exact:true}).waitFor();
 await page.getByText('节点列表与键盘定位',{exact:true}).click();
 await page.getByRole('button',{name:'左上合法边界',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.react-flow__viewport').style.transform.includes('scale(1)'));
 const single=await page.evaluate(()=>document.querySelector('.react-flow__viewport').style.transform);
 await page.getByRole('button',{name:'右下合法边界',exact:true}).click({modifiers:['Shift']});
 const geometry=()=>page.evaluate(()=>{const p=document.querySelector('.react-flow').getBoundingClientRect();const nodes=[...document.querySelectorAll('.react-flow__node')];return {count:nodes.length,allInside:nodes.length===2&&nodes.every(n=>{const r=n.getBoundingClientRect();return r.left>=p.left-1&&r.top>=p.top-1&&r.right<=p.right+1&&r.bottom<=p.bottom+1}),transform:document.querySelector('.react-flow__viewport').style.transform}});
 const deadline=Date.now()+20000;let g;while(Date.now()<deadline){g=await geometry();if(g.allInside)break;await page.waitForTimeout(100)}ensure(g.allInside,'multi focus clips legal endpoints');
 await page.getByRole('button',{name:'定位当前内容',exact:true}).click();
 await page.getByRole('button',{name:'定位当前内容',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:'output/playwright/2026-09-12-canvas-complete-fit/multi-focus-1512.png',animations:'disabled'});
 let saved;const due=Date.now()+20000;while(Date.now()<due){saved=await page.evaluate(async path=>(await fetch(path,{cache:'no-store'})).json(),prefPath);if(saved.selectedNodeIds.length===2&&saved.viewport.zoom<0.1)break;await page.waitForTimeout(100)}ensure(saved.selectedNodeIds.length===2&&saved.viewport.zoom<0.1,'focus preference not saved');
 await page.setViewportSize({width:390,height:844});await page.getByText('窄屏以列表查看内容；完整空间制作请使用桌面宽度。',{exact:true}).waitFor();
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);ensure(!overflow,'narrow overflow');
 await page.screenshot({path:'output/playwright/2026-09-12-canvas-complete-fit/list-390.png',animations:'disabled'});
 return {single,multi:g,savedPreference:saved,overflow,narrowUsesList:true};
}