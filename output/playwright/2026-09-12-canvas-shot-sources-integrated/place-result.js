async page => {
 const f={
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
,jobId="73235f8a-e573-4a4c-9dd7-605cc10fc7f5",planId="91f7ba24-f520-4425-928c-b35d0af0f6da",out='output/playwright/2026-09-12-canvas-shot-sources-integrated';
 const ensure=(v,m)=>{if(!v)throw Error(m)},base=`${f.origin}/v1/tenants/${f.tenantId}`,path=`${base}/projects/${f.projectId}`;
 await page.reload();const panel=page.getByRole('region',{name:'画布生成与结果',exact:true}),toggle=page.getByRole('button',{name:'画布生成与结果',exact:true});await toggle.waitFor();if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
 await panel.getByRole('combobox',{name:'画布生成任务历史',exact:true}).selectOption(planId);await panel.getByRole('button',{name:'打开所选的固定图片任务',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'确认添加图片结果',exact:true});await dialog.waitFor();ensure((await dialog.innerText()).includes('将已归档的图片作为独立节点添加到画布。'),'final build placement copy missing');
 await page.waitForFunction(()=>{const e=document.querySelector('[role="dialog"]');return e&&getComputedStyle(e).opacity==='1';});await page.screenshot({path:`${out}/place-confirm-1512.png`,animations:'disabled'});
 const placedPromise=page.waitForResponse(r=>r.url().endsWith(`/canvases/${f.canvasId}/results`)&&r.request().method()==='POST',{timeout:60000});await dialog.getByRole('button',{name:'确认添加到画布',exact:true}).click();const placedResponse=await placedPromise,placed=await placedResponse.json();ensure(placedResponse.ok(),'explicit placement failed');await panel.getByText('已添加到画布',{exact:true}).waitFor();
 const job=await (await page.request.get(`${base}/generation-jobs/${jobId}`)).json(),media=await (await page.request.get(`${base}/media/${job.mediaIds[0]}`)).json();
 const canvas=await (await page.request.get(`${path}/canvases/${f.canvasId}`)).json();ensure(!canvas.document.nodes.some(n=>n.id===f.nodeId),'source was recreated');const resultNodes=canvas.document.nodes.filter(n=>n.content.type==='media'&&n.content.mediaId===media.id);ensure(resultNodes.length===1&&canvas.document.nodes.length===5,'expected exactly one independent result');
 const session=await (await page.request.get(`${f.origin}/v1/session`)).json();const grantResponse=await page.request.post(`${base}/media/${media.id}/access`,{headers:{origin:f.origin,'x-csrf-token':session.csrfToken},data:{variant:'original',disposition:'attachment'}});ensure(grantResponse.ok(),'original access failed');const grant=await grantResponse.json();const download=await page.request.get(grant.url);ensure(download.ok(),'original download failed');const bytes=await download.body();const sha256=await page.evaluate(async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(v=>v.toString(16).padStart(2,'0')).join(''),Array.from(bytes));ensure(sha256===f.expectedOutputSha256,'downloaded bytes differ');
 const image=panel.getByRole('img',{name:media.displayName,exact:true});await image.waitFor();await image.evaluate(async img=>{await img.decode();if(img.naturalWidth!==32||img.naturalHeight!==32)throw Error('actual preview dimensions differ');});await image.scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/archived-result-1512.png`,animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await image.scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/archived-result-390.png`,animations:'disabled'});ensure(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'result overflow');await page.setViewportSize({width:1512,height:982});
 const state=await (await page.request.get(`${f.origin}/__fixture/state`)).json();ensure(state.calls===1&&state.errors.length===0&&state.queueErrors.length===0,'unexpected additional submission');
 const history=await (await page.request.get(`${path}/canvases/${f.canvasId}/generation-plans`)).json();ensure(history.items.length===1&&history.items[0].plan.id===planId&&history.items[0].jobId===jobId,'history identity differs');
 return {actualApi:true,actualPostgres:true,actualQueueAndDecode:true,provider:'test_fixture',jobId,planId,mediaId:media.id,downloadedBytes:bytes.length,sha256,placements:placed.placements,canvasNodeCount:canvas.document.nodes.length,sourceStillDeleted:true,singleExplicitResult:true,previewDecoded:true,providerCalls:state.calls,errors:state.errors,queueErrors:state.queueErrors};
}
