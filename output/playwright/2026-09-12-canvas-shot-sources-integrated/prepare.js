async page => {
  const f = {
  "origin": "http://127.0.0.1:4319",
  "tenantId": "18dcee52-a98a-431b-b585-3edf36efae12",
  "projectId": "35a7bc00-f944-4dc8-807f-6ad9d6135baa",
  "sceneId": "f3cf0c48-511a-4a8c-a0a1-ac996b5b09f4",
  "otherSceneId": "b533a30c-e5ae-4f7a-b93d-b1e7759f3d83",
  "canvasId": "2e8f154d-a091-48c0-8744-7c1bbcd8f148",
  "nodeId": "3bb02f4d-b8c5-4f63-9cde-127532051e3a",
  "alternateNodeId": "0c39d073-81a6-4e00-b848-415f18ac2267",
  "scriptRevisionId": "ef672d69-4437-486d-834b-6002e5489aad",
  "selectedA": {
    "shotId": "56ea456c-fb2a-4b11-9703-5ac9feb5189d",
    "shotRevisionId": "153cb9c0-0d95-498d-852e-c389323db7be",
    "number": 2
  },
  "selectedB": {
    "shotId": "6ebca2c3-0131-4e2c-8e77-6e1c4a8f55a3",
    "shotRevisionId": "1e2ecb33-6616-4487-9e2d-42597d678948",
    "number": 1
  },
  "initialCurrentA": "1c5be608-b8bb-4f89-b08c-650ae6628093",
  "referenceA": "6cf8474c-a31b-49fa-ae71-021df369a5b8",
  "referenceB": "5526847c-89fe-4df2-a760-e6d820d468ce",
  "capabilityId": "c95bbad5-566a-44a6-9ec8-6899c23e39c9",
  "expectedOutputSha256": "90df114133da3c93c1f5eb9143b008825470bf003edcd1e2faee39faf2586f5c",
  "executionMode": "test_fixture",
  "paidProvidersEnabled": false
}
;
  const out = 'output/playwright/2026-09-12-canvas-shot-sources-integrated';
  const ensure = (condition, message) => { if (!condition) throw Error(message); };
  const panel = page.getByRole('region', {name:'画布生成与结果',exact:true});
  const open = async () => { const b=page.getByRole('button',{name:'画布生成与结果',exact:true});await b.waitFor();if(await b.getAttribute('aria-expanded')!=='true')await b.click(); };
  await page.locator('[aria-label="已选来源 1"]').getByText('B要求：保持窗边反应',{exact:true}).first().waitFor();
  await page.locator('[aria-label="已选来源 2"]').getByText('旧要求：先看门口再看钥匙',{exact:true}).first().waitFor();
  await page.locator('[aria-label="本次镜头来源"]').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/selected-actual-1512.png`,animations:'disabled'});
  const advanced=await page.request.post(`${f.origin}/__fixture/control`,{data:{action:'advance-shot-a'}});
  ensure(advanced.ok(),'fixture source update failed');
  let plan, dropped=false; const requests=[];
  await page.route('**/canvas/generation-plans',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    const r=route.request();requests.push({body:r.postDataJSON(),key:r.headers()['idempotency-key'],version:r.headers()['if-match']});
    if(!dropped){
      dropped=true;const response=await route.fetch();
      ensure(response.status()===201,`actual plan failed ${response.status()}: ${await response.text()}`);
      plan=await response.json();await route.abort('failed');
    }else { ensure(JSON.stringify(requests[0])===JSON.stringify(requests[1]),'recovery changed fixed request identity');await route.continue(); }
  });
  await panel.getByRole('button',{name:'查看图片生成计划',exact:true}).click();
  await panel.getByRole('button',{name:'恢复原图片计划请求',exact:true}).waitFor({timeout:60000});
  ensure(plan?.plan,'no actual saved plan');
  const p=plan.plan, expected=[f.selectedB,f.selectedA].map(({shotId,shotRevisionId})=>({shotId,shotRevisionId}));
  ensure(JSON.stringify(p.input.shotSources)===JSON.stringify(expected),'wrong selected revisions/order');
  ensure(p.resolvedInput.shots[1].spec.intent==='旧要求：先看门口再看钥匙','current spec replaced old revision');
  ensure(p.resolvedInput.shots[1].entryState.spatialNotes==='旧起点：门边','wrong old entry state');
  ensure(JSON.stringify(p.resolvedInput.references.map(r=>r.reference.mediaId))===JSON.stringify([f.referenceB,f.referenceA]),'inherited reference order differs');
  const prompt=p.resolvedInput.prompt;
  ensure(prompt.indexOf('第一段画布文字')<prompt.indexOf('第二段画布文字')&&!prompt.includes('停用文字'),'canvas text order/disabled edge differs');
  await page.reload();await open();await panel.getByRole('button',{name:'恢复原图片计划请求',exact:true}).waitFor();
  ensure(requests.length===1,'refresh automatically reposted');
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/canvas/generation-plans')&&r.request().method()==='POST');
  await panel.getByRole('button',{name:'恢复原图片计划请求',exact:true}).click();
  const recovered=await (await responsePromise).json();
  ensure(recovered.plan.id===p.id,'recovery created another plan');
  await panel.getByText('固定图片计划',{exact:true}).waitFor();
  await panel.locator('summary').filter({hasText:'固定镜头来源（2 个）'}).click();
  await panel.locator('[aria-label="计划原镜头来源"]').getByText('旧要求：先看门口再看钥匙',{exact:true}).first().waitFor();
  await page.setViewportSize({width:390,height:844});
  await panel.locator('[aria-label="计划原镜头来源"]').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/fixed-plan-actual-390.png`,animations:'disabled'});
  ensure(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'narrow overflow');
  await page.setViewportSize({width:1512,height:982});
  await page.unroute('**/canvas/generation-plans');
  return {actualApi:true,provider:'test_fixture',plan:p,origin:plan.origin,requests,sourceAdvanced:true,refreshNoAutomaticPost:true,originalPlanRecovered:true};
}
