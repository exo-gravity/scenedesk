async page => {
  await page.goto('http://127.0.0.1:4314/');
  const errors = [], capture = error => errors.push(error.message); page.on('pageerror', capture);
  try {
    const result = await page.evaluate(async () => {
      const store = await import('/src/business/editing-local.ts');
      const {CutWorkController} = await import('/src/business/cut-work-controller.ts');
      const {CutWorkSessionRegistry} = await import('/src/business/cut-work-sessions.ts');
      const {editingCanonical} = await import('/@fs/Users/gandy/beyondgravity/scenedesk/packages/domain/src/editing-canonical.ts');
      const ok = (v,m) => { if (!v) throw new Error(m); }, wait = ms => new Promise(r => setTimeout(r,ms));
      const until = async (test,m) => { const start=Date.now(); while (!test()) { if (Date.now()-start>5000) throw new Error(m); await wait(10); } };
      const denied = async (fn, code) => { try { await fn(); } catch(e) { ok(!code || e.code===code, `expected ${code}, got ${e.code}`); return; } throw new Error('expected rejection'); };
      const deferred = () => { let resolve; const promise=new Promise(r=>resolve=r); return {resolve,promise}; };
      const user=crypto.randomUUID(), otherUser=crypto.randomUUID(), controllers=[], registries=[];
      const partition = () => ({userId:user,tenantId:crypto.randomUUID(),projectId:crypto.randomUUID(),kind:'cut_work_draft',objectId:crypto.randomUUID(),clientSessionId:crypto.randomUUID()});
      const document = () => ({timeline:{schemaVersion:'1',spec:{width:1080,height:1920,fpsNum:24,fpsDen:1,language:'zh-CN'},tracks:[],burnSubtitles:false},dramaBindings:[],timingOrigins:[],unresolvedEdits:[]});
      const hash = async d => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(editingCanonical(d)))),b=>b.toString(16).padStart(2,'0')).join('');
      const fixture = async () => {
        const scope=partition(), doc=document();
        let remote={cutId:scope.objectId,revision:0,baseCutRevision:1,currentCutRevision:1,document:doc,documentHash:await hash(doc),issues:[],baseChanged:false,hasUnappliedChanges:false}, saves=0;
        const transport={read:async()=>structuredClone(remote),save:async pending=>{saves++;remote={...remote,revision:remote.revision+1,document:pending.document,documentHash:await hash(pending.document),updatedAt:new Date().toISOString(),updatedBy:user,hasUnappliedChanges:true};return structuredClone(remote);}};
        return {scope,transport,get remote(){return remote;},get saves(){return saves;},value:()=>({base:structuredClone(remote),baseCutRevision:1,document:structuredClone(doc),buffers:{source:{value:'1.',valid:false}},pending:null})};
      };
      const make = f => { const c=new CutWorkController(f.scope,f.transport);controllers.push(c);return c; };
      const mutate = async (scope, change) => {
        await new Promise((resolve,reject)=>{const open=indexedDB.open('scenedesk-editing-recovery',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['metadata','copies'],'readwrite'),key=JSON.stringify([scope.userId,scope.tenantId,scope.projectId,scope.kind,scope.objectId,scope.clientSessionId]);change(tx,key);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};});
      };
      const cases=[];
      try {
        const foreign={...partition(),userId:otherUser};await store.saveEditingLocal(foreign,{text:'独立用户测试记录'},undefined);
        {
          const f=await fixture(), first=await store.saveEditingLocal(f.scope,f.value(),undefined);
          await mutate(f.scope,(tx,key)=>tx.objectStore('copies').put({...first,format:99},key));
          const c=make(f);await c.initialize();
          ok(c.getSnapshot().recoveryBlocked && !c.getSnapshot().recovery && c.getSnapshot().recoveryInspection,'unsupported body was exposed or unmanageable');
          const old=c.getSnapshot().recoveryInspection;
          const newer=await store.saveEditingLocal(f.scope,{...f.value(),buffers:{source:{value:'2.',valid:false}}},first.token);
          ok(!await c.discardDamagedLocal(old),'old damage consent deleted new copy');
          ok((await store.loadEditingLocal(f.scope)).token===newer.token,'new copy missing');
          await c.retryLocal();ok(c.getSnapshot().recovery.value.buffers.source.value==='2.','new record did not recover');
          await c.discardLocal();cases.push('unsupported body hidden; stale damage cleanup CAS retains newer input');
        }
        {
          const f=await fixture(), first=await store.saveEditingLocal(f.scope,f.value(),undefined);
          await mutate(f.scope,(tx,key)=>tx.objectStore('copies').delete(key));
          const c=make(f);await c.initialize();const observed=c.getSnapshot().recoveryInspection;
          const remove=IDBObjectStore.prototype.delete;let abort=true;
          IDBObjectStore.prototype.delete=function(...args){const r=remove.apply(this,args);if(abort&&this.name==='metadata'){abort=false;this.transaction.abort();}return r;};
          try{ok(!await c.discardDamagedLocal(observed),'aborted explicit cleanup succeeded');}finally{IDBObjectStore.prototype.delete=remove;}
          ok((await store.inspectEditingLocal(f.scope)).metadata.token===first.token&&c.getSnapshot().recoveryBlocked,'cleanup abort partially deleted body/header');
          ok(await c.discardDamagedLocal(observed),'explicit cleanup retry failed');
          ok(!await store.loadEditingLocal(f.scope)&&c.getSnapshot().phase==='ready'&&f.saves===0,'cleanup wrote a fake server revision');
          cases.push('missing body cleanup is atomic and retries without PUT');
        }
        {
          const f=await fixture();await store.saveEditingLocal(f.scope,{...f.value(),buffers:null},undefined);
          const c=make(f);await c.initialize();ok(c.getSnapshot().recoveryBlocked&&!c.getSnapshot().recovery,'invalid recovery wrapper was exposed');
          const original=structuredClone(f.remote),gate=deferred(),started=deferred();let reads=0;
          c.updateTransport({...f.transport,read:async()=>{if(reads++===0){started.resolve();await gate.promise;return original;}return f.transport.read();}});
          const cleaning=c.discardDamagedLocal(c.getSnapshot().recoveryInspection);await started.promise;
          const next=structuredClone(f.remote.document);next.timeline.burnSubtitles=true;
          await f.transport.save({document:next});await c.refresh();gate.resolve();
          ok(await cleaning,'reviewed damaged wrapper cleanup failed');
          const state=c.getSnapshot();ok(state.remote.revision===1&&state.local.base.revision===1&&state.local.document.timeline.burnSubtitles,'late cleanup read replaced newer authorized work');
          ok(f.saves===1&&!await store.loadEditingLocal(f.scope),'cleanup made an extra PUT or retained damaged body');
          cases.push('invalid wrapper hidden; late cleanup read preserves newer authorized version');
        }
        {
          const f=await fixture();await store.saveEditingLocal(f.scope,f.value(),undefined);
          await mutate(f.scope,(tx,key)=>tx.objectStore('metadata').delete(key));
          const c=make(f);await c.initialize();ok(c.getSnapshot().recoveryBlocked,'orphan body silently treated as no recovery');
          await denied(()=>store.saveEditingLocal(f.scope,f.value(),undefined),'corrupt');
          ok(await c.discardDamagedLocal(c.getSnapshot().recoveryInspection),'orphan cleanup failed');
          await store.saveEditingLocal(f.scope,f.value(),undefined);
          await mutate(f.scope,(tx,key)=>{const r=tx.objectStore('metadata').get(key);r.onsuccess=()=>tx.objectStore('metadata').put({...r.result,bytes:-1});});
          const catalog=await store.listEditingLocal(user),entry=catalog.entries.find(e=>e.partition.objectId===f.scope.objectId);
          ok(entry && entry.metadata===null,'bad header disappeared from management catalog');
          await denied(()=>store.saveEditingLocal(f.scope,f.value(),undefined),'corrupt');
          await store.discardInspectedEditingLocal(entry);
          cases.push('orphan body and malformed header remain explicit, repairable records');
        }
        {
          const f=await fixture(),c=make(f);await c.initialize();c.buffer('raw',{value:'1.',valid:false});
          await until(()=>c.getSnapshot().localSaved,'discard fixture not durable');
          const observed=c.localDiscardContext();c.buffer('raw',{value:'2.',valid:false});
          ok(!await c.discardLocal(observed)&&c.getSnapshot().local.buffers.raw.value==='2.','old discard consent erased subsequent input');
          const fresh=c.localDiscardContext();await c.refresh();ok(c.localDiscardContext()===fresh,'unchanged refresh invalidated local discard');
          ok(await c.discardLocal(fresh)&&!await store.loadEditingLocal(f.scope)&&f.saves===0,'reviewed local discard did not preserve server state');
          cases.push('local discard binds actual inputs; unchanged refresh preserves consent');
        }
        {
          const registry=new CutWorkSessionRegistry(2,1);registries.push(registry);
          const a=await fixture(),b=await fixture(),d=await fixture();
          const ca=(await registry.acquire('a',a.scope,a.transport)).controller,cb=(await registry.acquire('b',b.scope,b.transport)).controller;
          await ca.initialize();await cb.initialize();ca.resume();cb.resume();const offA=ca.subscribe(()=>{}),offB=cb.subscribe(()=>{});
          await denied(()=>registry.acquire('third',d.scope,d.transport),'unavailable');ok(registry.size===2,'registry exceeded hard cap');
          offA();await registry.release('a',ca);ok(registry.size===1&&ca.getSnapshot().local===null,'detached durable document not released');
          const cd=(await registry.acquire('third',d.scope,d.transport)).controller;await cd.initialize();cd.resume();cd.buffer('raw',{value:'1.',valid:false});await until(()=>cd.getSnapshot().localSaved,'raw buffer not durable');
          await registry.release('third',cd);ok(registry.size===1&&(await store.loadEditingLocal(d.scope)).value.buffers.raw.value==='1.','eviction deleted local input');
          const reopened=await registry.acquire('third',d.scope,d.transport);ok(!reopened.reopening,'retired object was reused');await reopened.controller.initialize();ok(reopened.controller.getSnapshot().recovery.value.buffers.raw.value==='1.','return did not offer exact recovery');
          offB();await registry.clearUser(user);cases.push('hard session cap, detached eviction, durable raw input on return');
        }
        {
          const registry=new CutWorkSessionRegistry(1,0);registries.push(registry);const f=await fixture(),gate=deferred(),sent=deferred();
          const transport={...f.transport,save:async pending=>{sent.resolve();await gate.promise;return f.transport.save(pending);}};
          const c=(await registry.acquire('pending',f.scope,transport)).controller;await c.initialize();c.resume();
          const next=structuredClone(c.getSnapshot().local.document);next.timeline.burnSubtitles=true;c.edit(next);
          const saving=c.save();await sent.promise;c.buffer('later',{value:'1.',valid:false});await registry.release('pending',c);
          await denied(()=>registry.acquire('other',partition(),f.transport),'unavailable');ok(registry.size===1,'inflight receipt owner was evicted');
          gate.resolve();await saving;await registry.release('pending',c);
          const kept=await store.loadEditingLocal(f.scope);ok(registry.size===0&&kept.value.buffers.later.value==='1.'&&!kept.value.pending&&f.saves===1,'late reply lost newer durable input');
          cases.push('inflight owner retained; later input survives receipt and eviction');
        }
        {
          const registry=new CutWorkSessionRegistry(1,0);registries.push(registry);const f=await fixture(),c=(await registry.acquire('failed',f.scope,f.transport)).controller;await c.initialize();
          const put=IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put=function(...args){const r=put.apply(this,args);if(this.name==='metadata')this.transaction.abort();return r;};
          try{c.buffer('unsafe',{value:'4.',valid:false});await until(()=>!!c.getSnapshot().storageError,'injected persistence failure missing');
            await registry.release('failed',c);await denied(()=>registry.acquire('other',partition(),f.transport),'unavailable');ok(c.getSnapshot().local.buffers.unsafe.value==='4.','undurable input evicted');
          }finally{IDBObjectStore.prototype.put=put;}
          await c.retryLocal();await registry.release('failed',c);ok(registry.size===0&&(await store.loadEditingLocal(f.scope)).value.buffers.unsafe.value==='4.','repaired input not retained');
          cases.push('storage failure prevents memory eviction until successfully retained');
        }
        {
          const registry=new CutWorkSessionRegistry(1,0);registries.push(registry);const f=await fixture();
          const pending=registry.acquire('queued',f.scope,f.transport);const clearing=registry.clearUser(user);
          await denied(()=>pending,'unavailable');await clearing;ok(registry.size===0,'queued pre-logout acquire created a new controller');
          ok((await store.loadEditingLocal(foreign)).value.text==='独立用户测试记录','user cleanup crossed identity');
          cases.push('queued acquisition invalidated by user cleanup; other identity retained');
        }
        return {cases,componentScope:'real IndexedDB and controllers; controlled transport',caseCount:cases.length};
      } finally {
        await Promise.all(controllers.map(c=>c.revoke()));await Promise.all(registries.map(r=>r.clearUser(user)));
        await store.clearEditingLocal(user);await store.clearEditingLocal(otherUser);
      }
    });
    if(errors.length)throw new Error(errors.join('; '));return {...result,pageErrors:errors.length};
  } finally {page.off('pageerror',capture);}
}
