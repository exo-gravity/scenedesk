async page => {
  page.setDefaultTimeout(12000);
  const path='/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f/projects/1498c59a-a789-4087-8069-4c99ebcbd63f/canvases/379e96ec-f6a0-4cd2-8c85-5204065a7859';
  const ok=(v,m)=>{if(!v)throw new Error(m);};
  await page.reload();await page.getByRole('textbox',{name:'节点名称',exact:true}).waitFor();
  const title=await page.getByRole('textbox',{name:'节点名称',exact:true}).inputValue();
  const hint=async()=>page.evaluate(async()=>{
    const s=await (await fetch('/v1/session')).json();const channel=new BroadcastChannel('scenedesk-editing-access-v1');
    channel.postMessage({sender:'canvas-browser-verification',hint:{kind:'canvas',sessionId:s.id,userId:s.userId,tenantId:'b128e444-cd57-4087-bcfe-c403051bbd8f',projectId:'1498c59a-a789-4087-8069-4c99ebcbd63f',objectId:'379e96ec-f6a0-4cd2-8c85-5204065a7859'}});channel.close();
  });
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const hold=async r=>{if(r.request().method()==='GET')await gate;await r.continue();};
  await page.route(`**${path}`,hold);
  try {await hint();await page.getByRole('alert',{name:'正在核对当前访问',exact:true}).waitFor();ok(await page.getByRole('textbox',{name:'节点名称',exact:true}).count()===0&&await page.getByRole('article').count()===0,'canvas remained visible during access verification');release();await page.getByRole('textbox',{name:'节点名称',exact:true}).waitFor();ok(await page.getByRole('textbox',{name:'节点名称',exact:true}).inputValue()===title,'authorized recheck lost selection');}
  finally {release();await page.unroute(`**${path}`,hold);}
  const deny=async r=>r.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'FORBIDDEN',message:'技术验收：画布访问已撤回'})});
  await page.route(`**${path}`,deny);
  try {await hint();await page.getByRole('alert',{name:'画布访问已失效',exact:true}).waitFor();ok(await page.getByRole('article').count()===0,'revoked canvas still rendered');await page.screenshot({path:'output/playwright/scene-canvas/10-access-revoked.png'});}
  finally {await page.unroute(`**${path}`,deny);await page.reload();}
  return {hiddenUntilAuthorized:true,falseHintPreservesContent:true,deniedReadClearsVisibleCanvas:true,scope:'real production page and BroadcastChannel with controlled GET response; backend authorization separately covered by DB tests'};
}
