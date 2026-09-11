async (page) => {
  page.setDefaultTimeout(12000);
  const tenant = 'b128e444-cd57-4087-bcfe-c403051bbd8f', project = '1498c59a-a789-4087-8069-4c99ebcbd63f', scene = 'c31f8ac4-a0f4-4b43-983a-6e3b09c05d1d';
  const base = `http://127.0.0.1:4311/#/app/t/${tenant}/p/${project}/production?scene=${scene}&mode=canvas`;
  const scenePath = `/v1/tenants/${tenant}/projects/${project}/scenes/${scene}/canvas`;
  const errors = [], statuses = [], cases = [], ok = (v,m) => { if (!v) throw new Error(m); };
  const onError = e => errors.push(e.message); page.on('pageerror', onError);
  await page.goto(base); await page.reload();
  await page.getByRole('textbox', {name:'本次提示词', exact:true}).waitFor();
  const id = await page.evaluate(async path => (await (await fetch(path)).json()).canvas.id, scenePath);
  const path = `/v1/tenants/${tenant}/projects/${project}/canvases/${id}`;
  const read = () => page.evaluate(async path => {const r = await fetch(path); if(!r.ok) throw new Error(`read ${r.status}`); return r.json();},path);
  const saved = () => page.getByRole('status').filter({hasText:/画布 · 已保存/}).waitFor();
  const original = await read(), draftId = original.document.nodes.find(n=>n.content.type==='draft').id;
  const editor = () => page.getByRole('textbox', {name:'本次提示词', exact:true});
  let release, intercepted = false;
  const gate = new Promise(resolve=>{release=resolve;});
  let arrived; const sent = new Promise(resolve=>{arrived=resolve;});
  const held = async r => {
    if(r.request().method()==='PUT' && !r.request().headers()['x-test-peer'] && !intercepted) {intercepted=true; arrived(); await gate;}
    await r.continue();
  };
  const responses = r => {if(r.request().method()==='PUT' && r.url().endsWith(path)) statuses.push(r.status());};
  page.on('response',responses); await page.route(`**${path}`,held);
  const localText = `本机画布恢复验证 ${Date.now()}`;
  const peerWrite = extra => page.evaluate(async ({path,draftId,extra})=>{
    const session = await (await fetch('/v1/session')).json(), current = await (await fetch(path)).json();
    const document = structuredClone(current.document);
    document.nodes.find(n=>n.id===draftId).content.prompt = '同伴也修改了提示';
    if(extra) document.nodes.push({id:crypto.randomUUID(), kind:'text', title:'同伴独立笔记', position:{x:80,y:80},width:320,content:{type:'text',text:'保留同伴独立内容'}});
    else document.nodes.filter(n=>n.title==='同伴独立笔记').at(-1).content.text = '同伴再次补充的内容';
    const r = await fetch(path,{method:'PUT',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken,'if-match':`"${current.revision}"`,'x-test-peer':'true'},body:JSON.stringify({schemaVersion:1,document})});
    if(!r.ok) throw new Error(`peer ${r.status}`); return (await r.json()).revision;
  },{path,draftId,extra});
  try {
    await editor().fill(localText); await sent;
    await page.getByRole('button',{name:'分镜',exact:true}).click();
    const peerRevision = await peerWrite(true); release();
    await page.getByRole('alert',{name:new RegExp(`保存冲突.*服务器 ${peerRevision}`)}).waitFor();
    await page.getByRole('button',{name:'自由画布',exact:true}).click();
    ok(await editor().inputValue()===localText,'mode switch lost pending input');
    const choice = page.getByRole('checkbox',{name:/节点 · 图片草稿 · 同伴也有修改/});
    await choice.check(); await peerWrite(false);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.getByText('比较之后内容又有变化，请读取最新版本后重新选择。刚才的勾选仍显示，尚未应用。',{exact:true}).waitFor();
    ok(await page.getByRole('button',{name:'重新应用选定修改',exact:true}).isDisabled(),'stale comparison allowed replay');
    await page.screenshot({path:'output/playwright/scene-canvas/05-frozen-conflict-v3.png',fullPage:true});
    const refreshed = page.waitForResponse(r=>r.request().method()==='GET' && r.url().endsWith(path));
    await page.getByRole('button',{name:'读取最新版本',exact:true}).click();
    await refreshed;
    await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='读取最新版本')?.hasAttribute('data-loading'));
    await choice.check();
    await page.getByRole('button',{name:'重新应用选定修改',exact:true}).click(); await saved();
    const merged = await read();
    ok(statuses.includes(412),'no actual CAS conflict');
    ok(merged.document.nodes.find(n=>n.id===draftId).content.prompt===localText,'selected edit not reapplied');
    ok(merged.document.nodes.some(n=>n.content.text==='同伴再次补充的内容'),'peer note lost');
    cases.push('actual API 412; mode switch keeps in-flight input; frozen comparison blocks stale replay; explicit replay retains peer changes');
  } finally {release(); await page.unroute(`**${path}`,held);}
  // Lose a response after a genuine server commit; GET must resolve without another PUT.
  let attempts=0;
  const lost = async r => {if(r.request().method()==='PUT'){attempts++; await r.fetch(); await r.abort('failed');} else await r.continue();};
  await page.route(`**${path}`,lost);
  const recoveredText = `${localText} · 回包丢失`;
  try {await editor().fill(recoveredText); await saved(); ok(attempts===1,'committed request resubmitted'); ok((await read()).document.nodes.find(n=>n.id===draftId).content.prompt===recoveredText,'lost reply content not saved'); cases.push('lost response after real commit resolves via GET without repeat PUT');}
  finally {await page.unroute(`**${path}`,lost);}
  // Preserve a locally durable request through reload, while rechecking authority.
  const offline = async r => r.abort('internetdisconnected');
  await page.route(`**${path}`,offline);
  const offlineText = `${localText} · 离线后刷新`;
  try {
    await editor().fill(offlineText);
    await page.getByRole('button',{name:'核对并重试保存',exact:true}).waitFor();
    await page.reload();
    await page.getByRole('button',{name:'核对并重试保存',exact:true}).waitFor();
    ok(await page.getByRole('textbox',{name:'本次提示词',exact:true}).count()===0,'local content disclosed before authorized read');
  } finally {await page.unroute(`**${path}`,offline);}
  await page.getByRole('button',{name:'核对并重试保存',exact:true}).click();
  await page.getByRole('button',{name:'恢复本机修改',exact:true}).click();
  await page.getByRole('button',{name:'核对并重试保存',exact:true}).click();
  await saved();
  ok((await read()).document.nodes.find(n=>n.id===draftId).content.prompt===offlineText,'reload recovery lost input');
  cases.push('offline request survives reload; fresh authority before disclosure; explicit retry saves original input');
  await page.getByRole('button',{name:'分镜',exact:true}).click();
  await page.getByRole('button',{name:'自由画布',exact:true}).click();
  ok(await editor().inputValue()===offlineText,'mode return lost restored draft');
  await page.getByRole('button',{name:'适应内容',exact:true}).click();
  await page.setViewportSize({width:1512,height:982});
  await page.screenshot({path:'output/playwright/scene-canvas/06-canvas-recovered-1512-v3.png',fullPage:true});
  page.off('response',responses); page.off('pageerror',onError);
  ok(errors.length===0,`page errors: ${errors.join(';')}`);
  return {cases, canvasId:id, finalRevision:(await read()).revision, pageErrors:errors.length, scope:'production build and real local API/DB with controlled network faults; local test identity; no model calls'};
}
