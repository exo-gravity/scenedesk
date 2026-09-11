async page => {
  await page.goto('http://127.0.0.1:4314/');
  return page.evaluate(async () => {
    const {CanvasController} = await import('/src/business/canvas-controller.ts');
    const {ApiError} = await import('/src/business/api.tsx');
    const local = await import('/src/business/editing-local.ts');
    const {editingCanonical} = await import('/@fs/Users/gandy/beyondgravity/scenedesk/packages/domain/src/editing-canonical.ts');
    const ok=(v,m)=>{if(!v)throw new Error(m);}, cases=[], controllers=[];
    const userId=crypto.randomUUID();
    const hash=async d=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(editingCanonical(d)))),b=>b.toString(16).padStart(2,'0')).join('');
    const setup=async()=>{
      const partition={userId,tenantId:crypto.randomUUID(),projectId:crypto.randomUUID(),objectId:crypto.randomUUID(),kind:'canvas',clientSessionId:crypto.randomUUID()};
      const document={nodes:[{id:crypto.randomUUID(),kind:'text',title:'参考',width:320,position:{x:0,y:0},content:{type:'text',text:'共同基线'}}],edges:[],groups:[]};
      let remote={id:partition.objectId,projectId:partition.projectId,revision:1,schemaVersion:1,document,documentHash:await hash(document),updatedAt:new Date().toISOString()}, behavior, writes=0;
      const commit=async d=>{remote={...remote,revision:remote.revision+1,document:structuredClone(d),documentHash:await hash(d),updatedAt:new Date().toISOString()};return structuredClone(remote);};
      const transport={read:async()=>structuredClone(remote),save:async p=>{writes++;if(behavior)return behavior(p);if(p.version!==remote.revision)throw new ApiError(412,'CANVAS_VERSION_CONFLICT','版本冲突');return commit(p.document);}};
      const make=()=>{const c=new CanvasController(partition,transport);controllers.push(c);return c;};
      return {partition,transport,make,commit,get remote(){return remote;},get writes(){return writes;},set behavior(v){behavior=v;}};
    };
    const edit=(c,text,group)=>{const d=structuredClone(c.getSnapshot().local.document);d.nodes[0].content.text=text;c.change(d,group);};
    try {
      const f=await setup(),c=f.make(); await c.initialize();
      let visibleUndo=false; c.subscribe(()=>{visibleUndo=c.canUndo;});
      edit(c,'第一笔'); ok(visibleUndo,'undo unavailable to synchronous subscriber');
      await c.save();await c.refresh();ok(c.canUndo,'same saved GET erased undo');c.undo();ok(c.getSnapshot().local.document.nodes[0].content.text==='共同基线','undo after refresh failed');c.redo();ok(c.getSnapshot().local.document.nodes[0].content.text==='第一笔','redo failed');
      edit(c,'连续输入甲','typing');edit(c,'连续输入乙','typing');c.undo();ok(c.getSnapshot().local.document.nodes[0].content.text==='第一笔','typing did not coalesce');c.redo();await c.save();
      cases.push('synchronous undo state; saved refresh preserves history; grouped edits undo and redo');
      const key=`node:${c.getSnapshot().local.document.nodes[0].id}:x`;
      c.change(c.getSnapshot().local.document,'number',{[key]:{value:'12.',valid:false}});await c.save();ok(c.getSnapshot().hasInvalidInput,'incomplete number lost');const writes=f.writes;
      c.pause(); const r=f.make();await r.initialize();ok(r.getSnapshot().recovery.value.buffers[key].value==='12.','incomplete number not recovered');r.restore();await r.save();ok(f.writes===writes,'incomplete number submitted');r.undo(); // Restored copies start a fresh undo session.
      ok(r.getSnapshot().hasInvalidInput,'restore invented undo history');
      await r.discardLocal(); cases.push('raw numeric input persisted and restored; invalid value cannot reach transport');
      const g=await setup(),a=g.make();await a.initialize();g.behavior=async p=>{await g.commit(p.document);throw new ApiError(0,'CONNECTION_LOST','回包丢失');};edit(a,'已提交但没回包');await a.save();ok(g.writes===1&&!a.getSnapshot().dirty&&!a.getSnapshot().local.pending,'lost receipt repeated or unresolved');cases.push('canvas envelope and content hash reconcile committed unknown write');
      const h=await setup(),b=h.make();await b.initialize();edit(b,'我的说明');const peer=structuredClone(h.remote.document);peer.nodes[0].title='同伴标题';await h.commit(peer);await b.save();ok(b.getSnapshot().phase==='conflict','canvas CAS not retained');const viewed=b.getSnapshot().remote.revision;peer.nodes[0].position.x=20;await h.commit(peer);await b.refresh();await b.merge(b.getSnapshot().local.document,viewed);ok(b.getSnapshot().phase==='conflict'&&b.getSnapshot().local.document.nodes[0].content.text==='我的说明','second conflict lost merge');cases.push('canvas CAS and stale replay retain local edit');
      await b.revoke();ok(b.getSnapshot().local===null&&!await local.loadEditingLocal(h.partition),'revoked canvas still disclosed');cases.push('revocation clears canvas memory and own recovery');
      return {cases,scope:'real browser IndexedDB and actual CanvasController with controlled transport; no real provider'};
    } finally {controllers.forEach(c=>c.pause());await Promise.all(controllers.map(c=>c.revoke()));await local.clearEditingLocal(userId);}
  });
}
