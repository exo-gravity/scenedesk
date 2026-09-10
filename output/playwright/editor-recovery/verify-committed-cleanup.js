async (page) => {
  page.setDefaultTimeout(15000);
  const ok = (value, message) => { if (!value) throw new Error(message); };
  const path = '/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f/projects/1498c59a-a789-4087-8069-4c99ebcbd63f';
  const sceneId = '9a49e855-1dac-49b9-8359-8ba9d5c7e753';
  const url = 'http://127.0.0.1:4311/?editor-recovery=1#/app/t/b128e444-cd57-4087-bcfe-c403051bbd8f/p/1498c59a-a789-4087-8069-4c99ebcbd63f/content';
  const installFailure = () => {
    if (globalThis.__draftDeletePatched) return;
    globalThis.__draftDeletePatched = true;
    const original = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function(key) {
      const request = original.call(this, key);
      if (this.name === 'drafts' && sessionStorage.getItem('scenedesk-test-delete-failure') === '1') this.transaction.abort();
      return request;
    };
  };
  await page.addInitScript(installFailure);
  await page.goto(url);
  await page.reload();
  await page.setViewportSize({width:320,height:740});
  ok(await page.evaluate(() => Array.from(document.scripts).some(s => s.src.includes('/assets/index-'))), 'Expected production build');
  await page.evaluate(installFailure);
  const scene = () => page.evaluate(async ({path, sceneId}) => (await (await fetch(`${path}/content`)).json()).scenes.find(s => s.id === sceneId), {path, sceneId});
  const editor = () => page.getByRole('dialog', {name:'编辑场次',exact:true});
  const open = () => page.getByRole('button', {name:'编辑01 · 旧公寓重逢',exact:true}).click();
  await page.getByRole('heading', {level:1}).waitFor();
  const before = await scene();
  const text = `${before.summary}\n本地清理失败验收 ${Date.now()}`;
  let writes = 0;
  const requests = request => { if (request.method() === 'PUT' && request.url().endsWith(`/scenes/${sceneId}`)) writes++; };
  const errors = [], capture = error => errors.push(error.message);
  page.on('request', requests); page.on('pageerror', capture);
  try {
    await open();
    await editor().getByRole('textbox', {name:'场次梗概',exact:true}).fill(text);
    await editor().getByText('修改已保存在本标签页，尚未提交。', {exact:true}).waitFor();
    await page.evaluate(() => sessionStorage.setItem('scenedesk-test-delete-failure','1'));
    await editor().getByRole('button', {name:'保存修改',exact:true}).click();
    await editor().getByRole('button', {name:'重试清理本地草稿',exact:true}).waitFor();
    ok((await scene()).summary === text, 'Server did not commit input');
    ok(writes === 1, 'Expected one business command');
    ok(await editor().getByRole('button', {name:'保存修改',exact:true}).count() === 0, 'Committed editor still offers resubmission');
    await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect&&Number.isFinite(a.effect.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:'output/playwright/editor-recovery/01-cleanup-failed.png'});
    ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth), 'Completion panel overflows viewport');
    await page.reload(); await open();
    await editor().getByRole('button', {name:'重试清理本地草稿',exact:true}).waitFor();
    ok(await editor().getByRole('button', {name:'恢复未提交内容',exact:true}).count() === 0, 'Reload recovered an already committed draft');
    await page.evaluate(() => sessionStorage.removeItem('scenedesk-test-delete-failure'));
    await editor().getByRole('button', {name:'重试清理本地草稿',exact:true}).click();
    await editor().getByRole('textbox', {name:'场次梗概',exact:true}).waitFor();
    ok(await editor().getByRole('textbox', {name:'场次梗概',exact:true}).inputValue() === text, 'Recovered editor is not based on committed server data');
    ok(writes === 1, 'Cleanup retry resubmitted content');
    ok((await scene()).revision === before.revision + 1, 'Cleanup created another scene revision');
    const receipts = await page.evaluate(sceneId => Object.keys(sessionStorage).filter(k => k.startsWith('scenedesk-draft-committed:') && k.includes(`/scene/${sceneId}`)), sceneId);
    ok(receipts.length === 0, 'Cleanup left a receipt');
    await editor().getByRole('button', {name:'关闭弹窗',exact:true}).click();
    await open();
    await editor().getByText('修改后可保存；关闭面板会保留本地草稿。', {exact:true}).waitFor();
    ok(await editor().getByRole('button', {name:'恢复未提交内容',exact:true}).count() === 0, 'Stale draft survived successful cleanup');
    await editor().getByRole('button', {name:'关闭弹窗',exact:true}).click();
    ok(errors.length === 0, errors.join('; '));
    return {productionBuild:true,viewport:320,sceneRevision:before.revision+1, businessWrites:writes, transactionAbortHandled:true, reloadReceiptHonored:true, cleanupRetriedWithoutResubmit:true, pageErrors:errors};
  } finally {
    await page.evaluate(() => sessionStorage.removeItem('scenedesk-test-delete-failure'));
    page.off('request', requests); page.off('pageerror', capture);
  }
}
