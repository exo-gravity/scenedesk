async page => {
  page.setDefaultTimeout(15000);
  const tenant='b128e444-cd57-4087-bcfe-c403051bbd8f',project='1498c59a-a789-4087-8069-4c99ebcbd63f',scene='56d6d043-dce7-4151-8718-be664965b7ba';
  const path=`/v1/tenants/${tenant}/projects/${project}`,base=`http://127.0.0.1:4311/#/app/t/${tenant}/p/${project}`,nonce=Date.now();
  const ok=(v,m)=>{if(!v)throw new Error(m);};
  await page.goto(`${base}/content`);await page.reload();await page.setViewportSize({width:1366,height:900});
  const request=(method,url,body,version)=>page.evaluate(async({method,url,body,version})=>{const session=await(await fetch('/v1/session')).json();const r=await fetch(url,{method,headers:{'content-type':'application/json','x-csrf-token':session.csrfToken,'idempotency-key':crypto.randomUUID(),...(version===undefined?{}:{'if-match':`"${version}"`})},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw new Error(`${method} ${r.status} ${JSON.stringify(await r.json())}`);return r.json();},{method,url,body,version});
  const read=url=>request('GET',url),until=async(fn,m)=>{const start=Date.now();while(!await fn()){if(Date.now()-start>15000)throw new Error(m);await page.waitForTimeout(100);}};
  const newCut=label=>request('POST',`${path}/cuts`,{sceneId:scene,name:`${label} ${nonce}`});
  const target=await newCut('容量满时的未完成工作'),subject=await newCut('待清理技术副本'),filler=await newCut('容量填充技术副本');
  const template=(await read(`${path}/cuts/0f0c05b3-d322-45a8-b6f0-843cd81abfc3/work-draft`)).document;
  let targetWork=await request('PUT',`${path}/cuts/${target.id}/work-draft`,{baseCutRevision:1,document:template},0);
  const subjectWork=await read(`${path}/cuts/${subject.id}/work-draft`),fillerWork=await read(`${path}/cuts/${filler.id}/work-draft`),projectInfo=await read(path);
  const errors=[],capture=e=>errors.push(e.message);page.on('pageerror',capture);let second;
  const seed=await page.evaluate(async({tenant,project,subjectWork,fillerWork})=>{
    const session=await(await fetch('/v1/session')).json();
    return new Promise((resolve,reject)=>{const open=indexedDB.open('scenedesk-editing-recovery',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{
      const db=open.result,tx=db.transaction(['metadata','copies'],'readwrite'),metadata=tx.objectStore('metadata'),list=metadata.index('user').getAll(session.userId),keys=[];let first,foreign;
      list.onsuccess=()=>{
        const retained=list.result.filter(r=>!Number.isSafeInteger(r.savedAt)||r.savedAt>=Date.now()-7*86400000);
        if(retained.length>=20){tx.abort();return;}
        for(let i=0;i<20-retained.length;i++){
          const work=i===0?subjectWork:fillerWork,partition={userId:session.userId,tenantId:tenant,projectId:project,kind:'cut_work_draft',objectId:work.cutId,clientSessionId:crypto.randomUUID()};
          const key=JSON.stringify(Object.values(partition)),value={base:work,baseCutRevision:1,document:work.document,buffers:{technicalNote:{value:`尚未同步的技术副本 ${i}`,valid:false}},pending:null};
          const copy={format:1,version:1,token:crypto.randomUUID(),savedAt:Date.now()-i*1000,value},row={...partition,key,version:copy.version,token:copy.token,savedAt:copy.savedAt,bytes:new TextEncoder().encode(JSON.stringify(value)).length};
          tx.objectStore('copies').put(copy,key);metadata.put(row);keys.push(key);if(i===0)first={key,token:copy.token};
        }
        const row={...JSON.parse(keys[0]).reduce((a,v,i)=>({...a,[['userId','tenantId','projectId','kind','objectId','clientSessionId'][i]]:v}),{}),userId:crypto.randomUUID()};
        const key=JSON.stringify([row.userId,row.tenantId,row.projectId,row.kind,row.objectId,row.clientSessionId]);foreign=key;
        metadata.put({...row,key,version:1,token:crypto.randomUUID(),savedAt:Date.now(),bytes:4});tx.objectStore('copies').put({format:1,version:1,value:{text:'另一个用户的独立技术记录'}},key);
      };
      tx.oncomplete=()=>{db.close();resolve({keys,first,foreign,userId:session.userId});};tx.onabort=()=>{db.close();reject(tx.error??new Error('existing recovery quota full; fixture did not alter existing copies'));};
    };});
  },{tenant,project,subjectWork,fillerWork});
  const mutate=(key,operation)=>page.evaluate(async({key,operation})=>new Promise((resolve,reject)=>{const open=indexedDB.open('scenedesk-editing-recovery',1);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['metadata','copies'],'readwrite'),m=tx.objectStore('metadata').get(key),b=tx.objectStore('copies').get(key);let result;
    const change=()=>{if(m.readyState!=='done'||b.readyState!=='done')return;result={metadata:m.result,copy:b.result};if(operation==='new-token'){const token=crypto.randomUUID();tx.objectStore('metadata').put({...m.result,token,version:m.result.version+1});tx.objectStore('copies').put({...b.result,token,version:b.result.version+1},key);result.token=token;}if(operation==='damage'){tx.objectStore('copies').put({...b.result,format:99},key);}};m.onsuccess=change;b.onsuccess=change;tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(tx.error);};};open.onerror=()=>reject(open.error);}),{key,operation});
  try {
    const route=`${base}/editing?scene=${scene}&cut=${target.id}`,workPath=`${path}/cuts/${target.id}/work-draft`;
    await page.goto(route);await page.getByRole('button',{name:'片段设置',exact:true}).click();
    await page.getByRole('textbox',{name:'放置起点（秒）',exact:true}).fill('1.');
    await page.getByText('本用户已有 20 份本机恢复副本，请检查并清理不再需要的副本后重试。',{exact:true}).waitFor();
    ok((await read(workPath)).revision===1,'quota failure submitted a non-durable write');
    await page.getByRole('button',{name:'本机恢复管理',exact:true}).click();
    const row=()=>page.getByText(`${projectInfo.name} / ${subject.name}`,{exact:true}).locator('..');
    await row().getByRole('button',{name:'核对并清理这份副本',exact:true}).click();
    await row().getByRole('button',{name:'确认清理已核对副本',exact:true}).waitFor();
    const changed=await mutate(seed.first.key,'new-token');
    await row().getByRole('button',{name:'确认清理已核对副本',exact:true}).click();
    await page.getByText('这份本机副本已有更新，请重新查看后再决定是否清理。',{exact:true}).waitFor();
    ok((await mutate(seed.first.key,'read')).metadata.token===changed.token,'stale catalog cleanup removed newer input');
    await page.getByRole('button',{name:'刷新本机副本',exact:true}).click();
    await row().getByRole('button',{name:'核对并清理这份副本',exact:true}).click();
    await row().getByRole('button',{name:'确认清理已核对副本',exact:true}).click();
    await row().waitFor({state:'hidden'});
    await page.getByRole('button',{name:'片段设置',exact:true}).click();
    ok(await page.getByRole('textbox',{name:'放置起点（秒）',exact:true}).inputValue()==='1.','capacity recovery discarded raw input');
    await page.getByRole('textbox',{name:'放置起点（秒）',exact:true}).fill('0');
    await page.getByRole('textbox',{name:'源起点（秒）',exact:true}).fill('0.125001');
    await until(async()=> (await read(workPath)).revision===2,'editing did not resume after capacity cleanup');
    targetWork=await read(workPath);ok(targetWork.document.timeline.tracks[0].items[0].range.inUs===125001,'exact input changed');
    await page.getByRole('button',{name:'片段设置',exact:true}).click();
    const targetTab=await page.evaluate(()=>sessionStorage.getItem('scenedesk-content-tab'));
    await until(async()=>!(await mutate(JSON.stringify([seed.userId,tenant,project,'cut_work_draft',target.id,targetTab]),'read')).metadata,'completed field buffer did not release its local copy');
    // An actual second page holds its tab identity while retaining raw input.
    const live=await newCut('仍在其他标签页使用的副本');second=await page.context().newPage();second.on('pageerror',capture);
    await second.goto(`${base}/editing?scene=${scene}&cut=${live.id}`);
    await second.getByRole('button',{name:'加入片段',exact:true}).click();await second.getByRole('button',{name:'添加空白字幕条目',exact:true}).click();await second.getByRole('button',{name:'片段设置',exact:true}).click();
    await second.getByRole('textbox',{name:'字幕时长（秒）',exact:true}).fill('1.');
    const liveTab=await second.evaluate(()=>sessionStorage.getItem('scenedesk-content-tab'));
    const liveKey=JSON.stringify([seed.userId,tenant,project,'cut_work_draft',live.id,liveTab]);
    await until(async()=>!!(await mutate(liveKey,'read')).metadata,'second page draft not retained');
    await page.getByRole('button',{name:'本机恢复管理',exact:true}).click();
    await page.getByRole('button',{name:'刷新本机副本',exact:true}).click();
    const liveRow=()=>page.getByText(`${projectInfo.name} / ${live.name}`,{exact:true}).locator('..');
    await liveRow().getByText('另一标签页仍在使用',{exact:true}).waitFor();
    ok(await liveRow().getByRole('button',{name:'核对并清理这份副本',exact:true}).isDisabled(),'live tab copy could be cleared');
    await second.close();second=undefined;await page.getByRole('button',{name:'刷新本机副本',exact:true}).click();
    await liveRow().getByText('原标签页已关闭',{exact:true}).waitFor();
    await page.screenshot({path:'output/playwright/editing-work/07-local-recovery-management.png'});
    await liveRow().getByRole('button',{name:'核对并清理这份副本',exact:true}).click();await liveRow().getByRole('button',{name:'确认清理已核对副本',exact:true}).click();await liveRow().waitFor({state:'hidden'});
    ok((await mutate(seed.foreign,'read')).copy.value.text==='另一个用户的独立技术记录','management erased another user');
    // The current tab can explicitly remove an unreadable body using its exact observed header.
    const damaged=await newCut('损坏恢复记录技术验收'),damagedWork=await read(`${path}/cuts/${damaged.id}/work-draft`);
    const damagedKey=await page.evaluate(async({tenant,project,work,userId})=>{
      const tab=sessionStorage.getItem('scenedesk-content-tab'),partition={userId,tenantId:tenant,projectId:project,kind:'cut_work_draft',objectId:work.cutId,clientSessionId:tab},key=JSON.stringify(Object.values(partition));
      await new Promise((resolve,reject)=>{const r=indexedDB.open('scenedesk-editing-recovery',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction(['metadata','copies'],'readwrite'),token=crypto.randomUUID(),savedAt=Date.now(),value={base:work,baseCutRevision:1,document:work.document,buffers:{damaged:{value:'隐藏的技术输入',valid:false}},pending:null};tx.objectStore('copies').put({format:99,version:1,token,savedAt,value},key);tx.objectStore('metadata').put({...partition,key,version:1,token,savedAt,bytes:1000});tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};});return key;
    },{tenant,project,work:damagedWork,userId:seed.userId});
    await page.goto(`${base}/editing?scene=${scene}&cut=${damaged.id}`);
    await page.getByRole('button',{name:'核对并清理异常副本',exact:true}).click();
    ok(!await page.getByText('隐藏的技术输入',{exact:true}).isVisible(),'malformed recovery body was displayed');
    await page.getByRole('button',{name:'确认清理这份异常副本',exact:true}).waitFor();
    await mutate(damagedKey,'new-token');await page.getByRole('button',{name:'确认清理这份异常副本',exact:true}).click();
    await page.getByText('这份本机副本已有更新，请重新查看后再决定是否清理。',{exact:true}).waitFor();
    await page.getByRole('button',{name:'重试本机保留／清理',exact:true}).click();
    await page.getByRole('button',{name:'核对并清理异常副本',exact:true}).click();
    await page.screenshot({path:'output/playwright/editing-work/08-damaged-recovery.png'});
    await page.getByRole('button',{name:'确认清理这份异常副本',exact:true}).click();
    await page.getByText('工作稿已保存',{exact:true}).waitFor();
    ok(!(await mutate(damagedKey,'read')).metadata&&(await read(`${path}/cuts/${damaged.id}/work-draft`)).revision===0,'damage cleanup created a fake server save');
    await page.getByRole('button',{name:'加入片段',exact:true}).click();await page.getByRole('button',{name:'添加空白字幕条目',exact:true}).click();await page.getByRole('button',{name:'片段设置',exact:true}).click();
    await page.getByRole('textbox',{name:'字幕时长（秒）',exact:true}).fill('1.');
    await page.getByRole('button',{name:'核对并放弃本机修改',exact:true}).click();
    await page.getByRole('textbox',{name:'字幕时长（秒）',exact:true}).fill('2.');
    ok(await page.getByRole('button',{name:'确认放弃本机副本',exact:true}).isDisabled(),'old discard consent could remove newer raw input');
    await page.getByRole('button',{name:'继续保留',exact:true}).click();await page.getByRole('button',{name:'核对并放弃本机修改',exact:true}).click();await page.getByRole('button',{name:'确认放弃本机副本',exact:true}).click();
    await page.getByText('工作稿已保存',{exact:true}).waitFor();
    ok((await read(`${path}/cuts/${damaged.id}/work-draft`)).revision===0,'local discard wrote a fake shared revision');
    await page.setViewportSize({width:320,height:740});ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'recovery workspace overflows narrow viewport');await page.setViewportSize({width:1366,height:900});
    ok(errors.length===0,errors.join('; '));
    return {productionBuild:true,targetCutId:target.id,targetWorkRevision:2,damagedCutId:damaged.id,quotaPreservedRawInput:true,staleCatalogCleanupRejected:true,liveTabProtected:true,closedTabCleanup:true,otherUserRetained:true,damagedBodyHidden:true,staleDamageCleanupRejected:true,damageCleanupWithoutPut:true,staleDiscardRejected:true,smallViewportOverflow:false,pageErrors:errors.length};
  } finally {
    if(second)await second.close();page.off('pageerror',capture);
    // Only deliberately seeded test records are removed; existing user copies stay untouched.
    await page.evaluate(async keys=>new Promise((resolve,reject)=>{const r=indexedDB.open('scenedesk-editing-recovery',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction(['metadata','copies'],'readwrite');for(const key of keys){tx.objectStore('copies').delete(key);tx.objectStore('metadata').delete(key);}tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};}),[...seed.keys,seed.foreign]);
  }
}
