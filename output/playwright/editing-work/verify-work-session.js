async (page) => {
  await page.goto('http://127.0.0.1:4314/');
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const result = await page.evaluate(async () => {
    const { CutWorkController } = await import('/src/business/cut-work-controller.ts');
    const { ApiError } = await import('/src/business/api.tsx');
    const local = await import('/src/business/editing-local.ts');
    const { editingCanonical } = await import('/@fs/Users/gandy/beyondgravity/scenedesk/packages/domain/src/editing-canonical.ts');
    const ok = (value, label) => { if (!value) throw new Error(label); };
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async (test, label, limit = 4000) => {
      const start = performance.now();
      while (!test()) { if (performance.now() - start > limit) throw new Error(label); await wait(10); }
    };
    const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
    const userId = crypto.randomUUID(), controllers = [], cases = [];
    const partition = () => ({ userId, tenantId: crypto.randomUUID(), projectId: crypto.randomUUID(), objectId: crypto.randomUUID(), kind: 'cut_work_draft', clientSessionId: crypto.randomUUID() });
    const empty = () => ({ timeline: { schemaVersion: '1', spec: { width: 1080, height: 1920, fpsNum: 24, fpsDen: 1, language: 'zh-CN' }, tracks: [], burnSubtitles: false }, dramaBindings: [], unresolvedEdits: [], timingOrigins: [] });
    const withText = (document, text) => {
      const copy = structuredClone(document);
      if (!copy.timeline.tracks.length) copy.timeline.tracks.push({ id: crypto.randomUUID(), kind: 'subtitle', muted: false, items: [{ id: crypto.randomUUID(), kind: 'subtitle', text, timelineStartUs: 0, durationUs: 1_000_000 }] });
      else copy.timeline.tracks[0].items[0].text = text;
      return copy;
    };
    const textOf = document => document.timeline.tracks[0]?.items[0]?.text;
    const hash = async document => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(editingCanonical(document)))), b => b.toString(16).padStart(2, '0')).join('');
    const setup = async () => {
      const scope = partition(), document = empty();
      let remote = { cutId: scope.objectId, revision: 0, baseCutRevision: 1, currentCutRevision: 1, document, documentHash: await hash(document), issues: [], baseChanged: false, hasUnappliedChanges: false };
      let reads = 0, saves = 0, behavior;
      const commit = async (document, baseCutRevision = 1) => {
        remote = { ...remote, revision: remote.revision + 1, document, documentHash: await hash(document), baseCutRevision, updatedAt: new Date().toISOString(), updatedBy: userId, hasUnappliedChanges: true };
        return structuredClone(remote);
      };
      const transport = { read: async () => { reads++; return structuredClone(remote); }, save: async pending => {
        saves++;
        if (behavior) return behavior(pending);
        if (pending.version !== remote.revision) throw new ApiError(412, 'WORK_DRAFT_VERSION_CONFLICT', '版本冲突');
        return commit(pending.document, pending.baseCutRevision);
      } };
      const make = () => { const controller = new CutWorkController(scope, transport); controllers.push(controller); return controller; };
      return { scope, transport, make, commit, get remote() { return remote; }, get reads() { return reads; }, get saves() { return saves; }, set behavior(value) { behavior = value; } };
    };
    try {
      // Fresh authority must precede recovery disclosure, and loading cannot edit.
      {
        const f = await setup(), gate = deferred(), c = f.make();
        const value = { base: f.remote, baseCutRevision: 1, document: withText(f.remote.document, '有权后才能查看的恢复文字'), buffers: { source: { value: '1.', valid: false } }, pending: null };
        await local.saveEditingLocal(f.scope, value, undefined);
        c.updateTransport({ ...f.transport, read: () => gate.promise });
        let loadingProbed = false;
        c.subscribe(() => {
          if (!loadingProbed && c.getSnapshot().phase === 'loading' && c.getSnapshot().local) {
            loadingProbed = true;
            c.edit(withText(f.remote.document, '不能抢先覆盖'));
            ok(!c.getSnapshot().dirty, 'editing opened before recovery load completed');
          }
        });
        const opening = c.initialize();
        await wait(50);
        ok(c.getSnapshot().local === null && c.getSnapshot().recovery === null, 'recovery disclosed before authorized read');
        gate.resolve(f.remote); await opening;
        ok(loadingProbed && textOf(c.getSnapshot().recovery.value.document) === '有权后才能查看的恢复文字', 'original recovery missing');
        c.restore();
        ok(c.getSnapshot().hasInvalidInput && c.getSnapshot().local.buffers.source.value === '1.', 'invalid raw input did not restore');
        await c.save(); ok(f.saves === 0, 'invalid raw input submitted');
        await c.discardLocal();
        cases.push('authorized recovery, loading gate, invalid raw input');
      }
      // The view can leave while the request owns a fixed snapshot.
      {
        const f = await setup(), gate = deferred(), sent = deferred(), c = f.make();
        await c.initialize();
        c.edit(withText(f.remote.document, '已发出的甲稿'));
        f.behavior = async pending => { sent.resolve(); await gate.promise; return f.commit(pending.document); };
        const writing = c.save(); await sent.promise;
        c.edit(withText(c.getSnapshot().local.document, '请求之后的新乙稿'));
        c.pause(); gate.resolve(); await writing;
        ok(textOf(c.getSnapshot().local.document) === '请求之后的新乙稿' && textOf(c.getSnapshot().local.base.document) === '已发出的甲稿', 'late reply replaced newer input');
        ok(textOf((await local.loadEditingLocal(f.scope)).value.document) === '请求之后的新乙稿', 'unmounted reply failed to retain newer input');
        const reopened = f.make(); await reopened.initialize(); reopened.restore();
        f.behavior = undefined; await reopened.save();
        ok(textOf(f.remote.document) === '请求之后的新乙稿' && f.saves === 2 && !reopened.getSnapshot().dirty, 'reopen did not continue exact new draft');
        cases.push('late save, edit during request, leave and reopen');
      }
      {
        const f = await setup(), c = f.make(); await c.initialize();
        f.behavior = async pending => { await f.commit(pending.document); throw new ApiError(0, 'CONNECTION_LOST', '回包丢失'); };
        c.edit(withText(f.remote.document, '服务器已保存但回包丢失'));
        await c.save();
        ok(f.saves === 1 && f.reads === 2 && c.getSnapshot().phase === 'ready' && !c.getSnapshot().dirty && !c.getSnapshot().local.pending, 'unknown committed write resubmitted or not resolved');
        cases.push('unknown reply resolved by content and version without resubmit');
      }
      {
        const f = await setup(), c = f.make(); await c.initialize();
        f.behavior = async () => { throw new ApiError(0, 'CONNECTION_LOST', '没有回执'); };
        c.edit(withText(f.remote.document, '待核对甲稿')); await c.save();
        const id = c.getSnapshot().local.pending.id;
        c.edit(withText(c.getSnapshot().local.document, '尚未发送的新乙稿'));
        await c.discardLocal();
        ok(c.getSnapshot().local.pending.id === id && f.saves === 1, 'unknown write was silently discarded or auto retried');
        f.behavior = async pending => { ok(pending.id === id && textOf(pending.document) === '待核对甲稿', 'retry changed immutable request'); return f.commit(pending.document); };
        await c.save();
        ok(c.getSnapshot().dirty && textOf(c.getSnapshot().local.document) === '尚未发送的新乙稿' && textOf(f.remote.document) === '待核对甲稿', 'retry erased new unsent edits');
        await c.discardLocal();
        cases.push('unknown uncommitted request retains identity and newer input');
      }
      {
        const f = await setup(), c = f.make(); await c.initialize();
        c.edit(withText(f.remote.document, '本机修改'));
        f.behavior = async () => { await f.commit(withText(f.remote.document, '同伴修改')); throw new ApiError(412, 'WORK_DRAFT_VERSION_CONFLICT', '版本冲突'); };
        await c.save();
        ok(c.getSnapshot().phase === 'conflict' && textOf(c.getSnapshot().local.document) === '本机修改', '412 lost original input');
        const viewedRevision = c.getSnapshot().remote.revision;
        await f.commit(withText(f.remote.document, '同伴再次修改')); await c.refresh();
        await c.merge(withText(c.getSnapshot().local.document, '已手动整理的合并稿'), {}, viewedRevision, 1);
        ok(c.getSnapshot().phase === 'conflict' && textOf(c.getSnapshot().local.document) === '已手动整理的合并稿' && f.saves === 1, 'second comparison overwrote remote or lost manual merge');
        f.behavior = undefined;
        await c.merge(c.getSnapshot().local.document, {}, c.getSnapshot().remote.revision, 1); await c.save();
        ok(textOf(f.remote.document) === '已手动整理的合并稿' && c.getSnapshot().phase === 'ready', 'reviewed revision merge failed');
        cases.push('412 and second conflict preserve manual merge');
      }
      {
        const f = await setup(), c = f.make(); await c.initialize();
        c.edit(withText(f.remote.document, '提交已成功，清理被中断'));
        const remove = IDBObjectStore.prototype.delete;
        let abort = true;
        IDBObjectStore.prototype.delete = function (...args) {
          const result = remove.apply(this, args);
          if (abort && this.name === 'metadata') { abort = false; const tx = this.transaction; queueMicrotask(() => tx.abort()); }
          return result;
        };
        try { await c.save(); } finally { IDBObjectStore.prototype.delete = remove; }
        ok(!abort && c.getSnapshot().storageError && !c.getSnapshot().local.pending && !c.getSnapshot().dirty && f.saves === 1, 'cleanup failure became uncertain commit');
        ok((await local.loadEditingLocal(f.scope)).value.pending, 'failed cleanup lost persisted request');
        const reopened = f.make(); await reopened.initialize();
        ok(!reopened.getSnapshot().recovery && !reopened.getSnapshot().storageError && f.saves === 1 && !await local.loadEditingLocal(f.scope), 'reopen did not reconcile committed request');
        cases.push('post-commit IndexedDB cleanup abort and recovery without repeat PUT');
      }
      {
        const f = await setup(), c = f.make(); await c.initialize();
        c.edit(withText(f.remote.document, '必须先持久化保存请求'));
        await c.retryLocal();
        const put = IDBObjectStore.prototype.put;
        let abort = true;
        IDBObjectStore.prototype.put = function (...args) {
          const result = put.apply(this, args);
          if (abort && this.name === 'metadata') { abort = false; this.transaction.abort(); }
          return result;
        };
        try { await c.save(); } finally { IDBObjectStore.prototype.put = put; }
        ok(!abort && f.saves === 0 && c.getSnapshot().storageError && c.getSnapshot().dirty, 'write escaped before pending persistence');
        await c.retryLocal(); await c.save();
        ok(f.saves === 1 && !c.getSnapshot().dirty, 'local failure did not recover');
        cases.push('pre-submit storage failure prevents transport');
      }
      {
        const f = await setup(), c = f.make(), gate = deferred(), sent = deferred(); await c.initialize();
        f.behavior = async pending => { sent.resolve(); await gate.promise; return f.commit(pending.document); };
        c.edit(withText(f.remote.document, '失去权限后不可继续显示'));
        const writing = c.save(); await sent.promise;
        await c.revoke(); gate.resolve(); await writing;
        ok(c.getSnapshot().phase === 'forbidden' && c.getSnapshot().local === null && !await local.loadEditingLocal(f.scope), 'late reply repopulated revoked data');
        cases.push('revocation clears memory and local copy before late response');
      }
      {
        const f = await setup(), c = f.make(); await c.initialize(); c.resume();
        c.setComposing(true); c.edit(withText(f.remote.document, '输入法组字'));
        await wait(950); ok(f.saves === 0, 'composition auto submitted');
        c.setComposing(false);
        await until(() => f.saves === 1 && !c.getSnapshot().dirty, 'composition completion did not schedule');
        const start = performance.now(); let i = 0;
        const timer = setInterval(() => c.edit(withText(c.getSnapshot().local.document, `持续编辑 ${++i}`)), 100);
        try { await until(() => f.saves >= 2, 'continuous edits postponed beyond max interval', 5700); }
        finally { clearInterval(timer); c.pause(); }
        const elapsed = performance.now() - start;
        ok(elapsed >= 4800 && elapsed <= 5600, `continuous save cadence ${elapsed}ms`);
        await until(() => c.getSnapshot().phase !== 'saving', 'last auto save incomplete');
        await c.discardLocal();
        cases.push('IME suspension, 800ms debounce and 5s maximum continuous interval');
      }
      return { cases, scope: 'real browser, IndexedDB and production controller with controlled API transport; actual API/page validation remains separate' };
    } finally {
      controllers.forEach(c => c.pause());
      await Promise.all(controllers.map(c => c.revoke()));
      await local.clearEditingLocal(userId);
    }
  });
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
  return { ...result, pageErrors: errors.length };
}
