async page => {
  await page.goto('http://127.0.0.1:4314/');
  const errors=[], capture=e=>errors.push(e.message);page.on('pageerror',capture);
  try {
    const result=await page.evaluate(async()=>{
      const {CutWorkController}=await import('/src/business/cut-work-controller.ts');
      const {CutWorkSessionRegistry}=await import('/src/business/cut-work-sessions.ts');
      const {readEditingAccessHint}=await import('/src/business/editing-access.ts');
      const {ApiError}=await import('/src/business/api.tsx');
      const store=await import('/src/business/editing-local.ts');
      const {editingCanonical}=await import('/@fs/Users/gandy/beyondgravity/scenedesk/packages/domain/src/editing-canonical.ts');
      const ok=(v,m)=>{if(!v)throw new Error(m);}, wait=ms=>new Promise(r=>setTimeout(r,ms));
      const until=async(fn,m)=>{const start=Date.now();while(!fn()){if(Date.now()-start>5000)throw new Error(m);await wait(10);}};
      const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};};
      const hash=async d=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(editingCanonical(d)))),b=>b.toString(16).padStart(2,'0')).join('');
      const userId=crypto.randomUUID(),sessionId=crypto.randomUUID(),controllers=[],registries=[],cases=[];
      const fixture=async()=>{
        const scope={userId,tenantId:crypto.randomUUID(),projectId:crypto.randomUUID(),kind:'cut_work_draft',objectId:crypto.randomUUID(),clientSessionId:crypto.randomUUID()};
        const doc={timeline:{schemaVersion:'1',spec:{width:1080,height:1920,fpsNum:24,fpsDen:1,language:'zh-CN'},tracks:[],burnSubtitles:false},dramaBindings:[],timingOrigins:[],unresolvedEdits:[]};
        let remote={cutId:scope.objectId,revision:0,baseCutRevision:1,currentCutRevision:1,document:doc,documentHash:await hash(doc),issues:[],baseChanged:false,hasUnappliedChanges:false},puts=0;
        const transport={read:async()=>structuredClone(remote),save:async pending=>{puts++;remote={...remote,revision:remote.revision+1,document:pending.document,documentHash:await hash(pending.document),updatedAt:new Date().toISOString(),updatedBy:userId,hasUnappliedChanges:true};return structuredClone(remote);}};
        return{scope,transport,get remote(){return remote;},get puts(){return puts;}};
      };
      const make=async f=>{const c=new CutWorkController(f.scope,f.transport);controllers.push(c);await c.initialize();return c;};
      try {
        ok(readEditingAccessHint(null)===null&&readEditingAccessHint({kind:'cut',userId,sessionId})===null,'invalid hint accepted');
        const parsed=readEditingAccessHint({kind:'session',userId,sessionId,document:'must not propagate'});
        ok(parsed&&!('document' in parsed),'hint forwarded business content');cases.push('bounded identifiers and content-free parsed hint');
        {
          const f=await fixture(),c=await make(f);c.resume();c.buffer('raw',{value:'1.',valid:false});await until(()=>c.getSnapshot().localSaved,'raw input not retained');
          c.suspendAccess();c.buffer('raw',{value:'2.',valid:false});const changed=structuredClone(f.remote.document);changed.timeline.burnSubtitles=true;c.edit(changed);await c.save();
          ok(c.getSnapshot().accessChecking&&c.getSnapshot().local.buffers.raw.value==='1.'&&!c.getSnapshot().local.document.timeline.burnSubtitles&&f.puts===0,'suspended editor accepted input or PUT');
          await c.refresh();ok(!c.getSnapshot().accessChecking&&c.getSnapshot().local.buffers.raw.value==='1.'&&(await store.loadEditingLocal(f.scope)).value.buffers.raw.value==='1.','false hint lost authorized input');
          cases.push('suspension blocks edits and sends; authorized read preserves original input');
        }
        {
          const f=await fixture(),c=await make(f);c.buffer('raw',{value:'1.',valid:false});await until(()=>c.getSnapshot().localSaved,'offline fixture not retained');
          c.updateTransport({...f.transport,read:async()=>{throw new ApiError(0,'CONNECTION_LOST','technical offline');}});c.suspendAccess();await c.refresh();
          ok(c.getSnapshot().accessChecking&&c.getSnapshot().error&&await store.loadEditingLocal(f.scope),'network failure exposed or erased recovery');
          c.updateTransport(f.transport);await c.refresh();ok(!c.getSnapshot().accessChecking&&c.getSnapshot().local.buffers.raw.value==='1.','online authorization did not restore exact input');
          cases.push('network failure retains hidden work until successful authorization');
        }
        {
          const f=await fixture(),c=await make(f),delayed=gate();let reads=0;
          c.updateTransport({...f.transport,read:async()=>{if(reads++===0){await delayed.promise;throw new ApiError(403,'FORBIDDEN','old denial');}return f.transport.read();}});
          const old=c.refresh();c.suspendAccess();await c.refresh();delayed.resolve();await old;
          ok(!c.getSnapshot().accessChecking&&c.getSnapshot().phase!=='forbidden'&&c.getSnapshot().local,'older denial overrode newer authorization');
          const late=gate();c.updateTransport({...f.transport,read:async()=>{await late.promise;return f.transport.read();}});const before=c.refresh();c.suspendAccess();late.resolve();await before;
          ok(c.getSnapshot().accessChecking,'read started before hint reopened access');c.updateTransport(f.transport);await c.refresh();
          cases.push('older denial and pre-hint successful read cannot override later access check');
        }
        {
          const f=await fixture(),c=await make(f),started=gate(),reply=gate();
          c.updateTransport({...f.transport,save:async pending=>{started.resolve();await reply.promise;return f.transport.save(pending);}});
          const doc=structuredClone(f.remote.document);doc.timeline.burnSubtitles=true;c.edit(doc);const saving=c.save();await started.promise;
          c.buffer('later',{value:'1.',valid:false});c.suspendAccess();reply.resolve();await saving;
          ok(c.getSnapshot().accessChecking&&c.getSnapshot().local.buffers.later.value==='1.'&&f.puts===1,'late receipt reopened access or lost later input');
          c.updateTransport({...f.transport,read:async()=>{throw new ApiError(403,'FORBIDDEN','technical access revoked');}});await c.refresh();
          const revoked=c.getSnapshot(),remaining=await store.loadEditingLocal(f.scope);
          ok(revoked.phase==='forbidden'&&!revoked.local&&!remaining,`verified revocation did not clear content: ${JSON.stringify({phase:revoked.phase,checking:revoked.accessChecking,local:!!revoked.local,stored:!!remaining,error:revoked.error?.message,storageError:revoked.storageError?.message})}`);
          cases.push('inflight receipt remains hidden; verified revocation clears memory and local copy');
        }
        {
          const f=await fixture(),c=await make(f);c.updateTransport({...f.transport,save:async()=>{throw new ApiError(403,'CSRF_REJECTED','technical stale CSRF');}});
          const doc=structuredClone(f.remote.document);doc.timeline.burnSubtitles=true;c.edit(doc);await c.save();
          ok(c.getSnapshot().phase!=='forbidden'&&c.getSnapshot().local.pending&&await store.loadEditingLocal(f.scope)&&f.puts===0,'CSRF rejection erased input as revoked access');
          c.updateTransport(f.transport);await c.save();ok(f.puts===1&&!c.getSnapshot().local.pending,'explicit retry did not preserve the original request');
          cases.push('CSRF failure preserves pending work for session verification and explicit retry');
        }
        {
          const r=new CutWorkSessionRegistry();registries.push(r);const a=await fixture(),b=await fixture();
          const ca=(await r.acquire('a',a.scope,a.transport,sessionId)).controller,cb=(await r.acquire('b',b.scope,b.transport,sessionId)).controller;
          await ca.initialize();await cb.initialize();ca.buffer('raw',{value:'1.',valid:false});await until(()=>ca.getSnapshot().localSaved,'registry input missing');
          const hint={kind:'cut',sessionId,userId,tenantId:a.scope.tenantId,projectId:a.scope.projectId,objectId:a.scope.objectId};
          r.suspendAccess({...hint,sessionId:crypto.randomUUID()});ok(!ca.getSnapshot().accessChecking,'old session hint suspended new identity');
          r.suspendAccess(hint);ok(ca.getSnapshot().accessChecking&&!cb.getSnapshot().accessChecking,'cut hint crossed object boundary');await r.refreshAccess(hint);
          const sessionHint={kind:'session',sessionId,userId};const queued=r.acquire('queued',a.scope,a.transport,sessionId);const retiring=r.retireSession(sessionHint);
          let rejected=false;try{await queued;}catch{rejected=true;}await retiring;
          ok(rejected&&r.size===0&&(await store.loadEditingLocal(a.scope)).value.buffers.raw.value==='1.','same-user new-session transition erased recovery or revived retired session');
          const newId=crypto.randomUUID(),next=(await r.acquire('new',a.scope,a.transport,newId)).controller;await next.initialize();
          ok(next.getSnapshot().recovery.value.buffers.raw.value==='1.','fresh authorized session could not recover prior input');r.suspendAccess(sessionHint);ok(!next.getSnapshot().accessChecking,'late prior-session hint affected new session');
          cases.push('exact session and object scope; retired acquisition blocked; newer login recovery retained');
        }
        {
          const r=new CutWorkSessionRegistry();registries.push(r);const f=await fixture(),newSessionId=crypto.randomUUID();
          const old=(await r.acquire('old-session',f.scope,f.transport,sessionId)).controller;await old.initialize();old.buffer('raw',{value:'1.',valid:false});await until(()=>old.getSnapshot().localSaved,'old-session input missing');
          const current=(await r.acquire('new-session',f.scope,f.transport,newSessionId)).controller;await current.initialize();current.restore();current.buffer('raw',{value:'2.',valid:false});await until(()=>current.getSnapshot().localSaved,'new-session input missing');
          await r.clearUser(userId,sessionId);await store.clearEditingLocal(userId,{},sessionId);
          const header=await store.inspectEditingLocal(f.scope);
          ok(header.metadata.appSessionId===newSessionId&&(await store.loadEditingLocal(f.scope)).value.buffers.raw.value==='2.'&&current.getSnapshot().phase!=='forbidden'&&r.size===1,'late old-session cleanup erased newer session ownership');
          cases.push('late logout cleanup respects the newest writer session, including same partition');
        }
        return{cases,caseCount:cases.length,scope:'real IndexedDB and controllers with controlled transport'};
      } finally {await Promise.all(controllers.map(c=>c.revoke()));await Promise.all(registries.map(r=>r.clearUser(userId)));await store.clearEditingLocal(userId);}
    });
    if(errors.length)throw new Error(errors.join('; '));return{...result,pageErrors:errors.length};
  } finally {page.off('pageerror',capture);}
}
