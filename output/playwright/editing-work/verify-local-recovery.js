async (page) => {
  await page.goto('http://127.0.0.1:4314/');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const setup = await page.evaluate(async () => {
    const store = await import('/src/business/editing-local.ts');
    const ok = (value, label) => { if (!value) throw new Error(label); };
    const { browserContractCompiler } = await import('/src/business/contract-validation.ts');
    const { validateContract } = await browserContractCompiler();
    const document = { timeline: { schemaVersion: '1', spec: { width: 1080, height: 1920, fpsNum: 24, fpsDen: 1, language: 'zh-CN' }, tracks: [], burnSubtitles: false }, dramaBindings: [], unresolvedEdits: [], timingOrigins: [] };
    ok(validateContract('CutWorkDocument', document).valid, 'browser rejected valid work schema');
    const invalid = { ...document, unexpected: true }, invalidBefore = JSON.stringify(invalid);
    ok(!validateContract('CutWorkDocument', invalid).valid && JSON.stringify(invalid) === invalidBefore, 'browser compiler stripped unknown fields');
    const scope = { userId: crypto.randomUUID(), tenantId: crypto.randomUUID(), projectId: crypto.randomUUID(), kind: 'cut_work_draft', objectId: crypto.randomUUID(), clientSessionId: crypto.randomUUID() };
    const other = { ...scope, userId: crypto.randomUUID() };
    const denied = async (operation, code) => {
      try { await operation(); } catch (error) { ok(error.code === code, `Expected ${code}, got ${error.code}`); return; }
      throw new Error(`Expected ${code} rejection`);
    };
    const first = await store.saveEditingLocal(scope, { text: '初稿', pending: { documentHash: 'fixed-request' } }, undefined);
    const second = await store.saveEditingLocal(scope, { text: '请求在途时的新输入', pending: { documentHash: 'fixed-request' } }, first.token);
    await denied(() => store.removeEditingLocal(scope, first.token), 'conflict');
    ok((await store.loadEditingLocal(scope)).value.text === '请求在途时的新输入', 'late cleanup erased new edits');
    await store.removeEditingLocal(scope, second.token);
    const recreated = await store.saveEditingLocal(scope, { text: '同对象重新编辑' }, undefined);
    ok(recreated.version === first.version && recreated.token !== first.token, 'generation token must survive ABA');
    await denied(() => store.removeEditingLocal(scope, first.token), 'conflict');
    const races = await Promise.allSettled(['甲', '乙'].map(text => store.saveEditingLocal(scope, { text }, recreated.token)));
    ok(races.filter(r => r.status === 'fulfilled').length === 1, 'local CAS admitted two writers');
    ok(races.filter(r => r.status === 'rejected' && r.reason.code === 'conflict').length === 1, 'local CAS did not report conflict');
    const tab = { ...scope, clientSessionId: crypto.randomUUID() };
    await store.saveEditingLocal(tab, { text: '另一个标签页' }, undefined);
    await store.saveEditingLocal(other, { text: '另一个用户' }, undefined);
    ok((await store.listEditingLocal(scope.userId)).copies.length === 2, 'tab partition missing');
    ok((await store.loadEditingLocal(other)).value.text === '另一个用户', 'user partition missing');
    const current = await store.loadEditingLocal(scope);
    const put = IDBObjectStore.prototype.put;
    let abort = true;
    IDBObjectStore.prototype.put = function (...args) {
      const result = put.apply(this, args);
      if (abort && this.name === 'metadata') { abort = false; this.transaction.abort(); }
      return result;
    };
    let aborted = false;
    try { await store.saveEditingLocal(scope, { text: '不应部分写入' }, current.token); }
    catch { aborted = true; }
    finally { IDBObjectStore.prototype.put = put; }
    ok(aborted, 'injected transaction abort did not reject');
    ok((await store.loadEditingLocal(scope)).token === current.token, 'body/header transaction was not atomic');
    const retried = await store.saveEditingLocal(scope, { text: '重试已保留' }, current.token);
    const remove = IDBObjectStore.prototype.delete;
    abort = true; aborted = false;
    IDBObjectStore.prototype.delete = function (...args) {
      const result = remove.apply(this, args);
      if (abort && this.name === 'metadata') { abort = false; const tx = this.transaction; queueMicrotask(() => tx.abort()); }
      return result;
    };
    try { await store.removeEditingLocal(scope, retried.token); }
    catch { aborted = true; }
    finally { IDBObjectStore.prototype.delete = remove; }
    ok(aborted && (await store.loadEditingLocal(scope)).token === retried.token, 'failed cleanup lost recovery');
    while ((await store.listEditingLocal(scope.userId)).copies.length < 20)
      await store.saveEditingLocal({ ...scope, objectId: crypto.randomUUID() }, { text: '仍未同步的恢复副本' }, undefined);
    await denied(() => store.saveEditingLocal({ ...scope, objectId: crypto.randomUUID() }, { text: '第21份' }, undefined), 'capacity');
    ok((await store.loadEditingLocal(scope)).value.text === '重试已保留', 'quota silently evicted unsent edits');
    const before = await store.listEditingLocal(scope.userId);
    const expired = before.copies.find(copy => copy.objectId !== scope.objectId);
    await new Promise((resolve, reject) => {
      const opened = indexedDB.open('scenedesk-editing-recovery', 1);
      opened.onerror = () => reject(opened.error);
      opened.onsuccess = () => {
        const db = opened.result, tx = db.transaction(['metadata', 'copies'], 'readwrite');
        const date = Date.now() - 8 * 86400000;
        const body = tx.objectStore('copies').get(expired.key);
        body.onsuccess = () => tx.objectStore('copies').put({ ...body.result, savedAt: date }, expired.key);
        tx.objectStore('metadata').put({ ...expired, savedAt: date });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    ok(await store.loadEditingLocal(expired) === undefined, 'expired copy offered as recoverable');
    await store.saveEditingLocal({ ...scope, objectId: crypto.randomUUID() }, { text: '释放过期容量后写入' }, undefined);
    const usage = await store.listEditingLocal(scope.userId);
    ok(usage.copies.length === 20 && usage.bytes > 0, 'combined quota accounting incorrect');
    return { scope, other, bytes: usage.bytes, cases: ['shared browser/API schema without coercion', 'user and tab isolation', 'local CAS', 'late cleanup and delete/recreate ABA', 'transaction abort/retry', 'cleanup abort', '20-copy quota preserves unsent drafts', '7-day expiration'] };
  });
  await page.reload();
  const result = await page.evaluate(async ({ scope, other }) => {
    const store = await import('/src/business/editing-local.ts');
    const restored = await store.loadEditingLocal(scope);
    if (restored?.value.text !== '重试已保留') throw new Error('refresh lost persisted input');
    await store.clearEditingLocal(scope.userId, { projectId: scope.projectId });
    if ((await store.listEditingLocal(scope.userId)).copies.length !== 0) throw new Error('revocation did not clear project partition');
    if ((await store.loadEditingLocal(other))?.value.text !== '另一个用户') throw new Error('clearing one user erased another user');
    await store.clearEditingLocal(other.userId);
    return { refreshRestored: true, scopedClear: true };
  }, setup);
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
  return { ...result, testedCases: setup.cases, accountedBytes: setup.bytes, pageErrors: errors.length, scope: 'local storage component; editing page is not yet implemented' };
}
