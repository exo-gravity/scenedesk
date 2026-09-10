async (page) => {
  page.setDefaultTimeout(10000);
  const ok = (value,message) => {if(!value)throw new Error(message);};
  const title = '钥匙参考 · 恢复验收';
  const correctFile = '/Users/gandy/beyondgravity/scenedesk/apps/web/public/demo/workspace-v2/key-reference.png';
  const wrongFile = '/Users/gandy/beyondgravity/scenedesk/apps/web/public/demo/technical-preview.mp4';
  const choose = async (label,file) => {
    const input = label==='选择文件'
      ? page.getByRole('region',{name:'文件导入与恢复'}).locator('input[type="file"]').first()
      : page.getByRole('article',{name:'导入记录 '+title,exact:true}).locator('input[type="file"]');
    await input.setInputFiles(file);
  };
  let lostId, lostKey, creates=0, replayKey;
  const pattern = '**/v1/tenants/*/uploads';
  const handler = async route => {
    if(route.request().method()!=='POST'){await route.continue();return;}
    creates++;
    if(creates===1){lostKey=route.request().headers()['idempotency-key'];const response=await route.fetch();ok(response.status()===201,'Server did not create the initial upload');lostId=(await response.json()).id;await route.abort('failed');}
    else {replayKey=route.request().headers()['idempotency-key'];await route.continue();}
  };
  await page.route(pattern,handler);
  try {
    if(await page.getByRole('button',{name:'导入与恢复',exact:true}).isVisible()) await page.getByRole('button',{name:'导入与恢复',exact:true}).click();
    await choose('选择文件',correctFile);
    await page.getByRole('textbox',{name:'素材名称',exact:true}).fill(title);
    await page.getByRole('button',{name:'开始导入',exact:true}).click();
    await page.getByText('连接中断。请保留当前内容，恢复连接后重试。',{exact:true}).waitFor();
    ok(lostId && creates===1,'Response loss did not leave one server intent');
    await page.reload();
    await page.getByRole('button',{name:'导入与恢复',exact:true}).click();
    const record=page.getByRole('article',{name:'导入记录 '+title,exact:true});
    await record.waitFor();
    await choose('重新选择原文件',wrongFile);
    await record.getByRole('button',{name:'继续本次导入',exact:true}).click();
    await page.getByText('所选文件与本次上传的原声明不同，请选择原文件；更换内容应新建导入。',{exact:true}).waitFor();
    ok(creates===1,'Wrong file created another server intent');
    await page.screenshot({path:'output/playwright/media-workspace/04-recovery-wrong-file.png'});
    await choose('重新选择原文件',correctFile);
    await record.getByRole('button',{name:'继续本次导入',exact:true}).click();
    await record.getByRole('link',{name:'查看素材',exact:true}).waitFor();
    const link=await record.getByRole('link',{name:'查看素材',exact:true}).getAttribute('href');
    const mediaId=link.split('media=')[1];
    const result=await page.evaluate(async ({lostId,mediaId})=>{
      const tenant=location.hash.split('?')[0].split('/')[3];
      const upload=await(await fetch('/v1/tenants/'+tenant+'/uploads/'+lostId)).json();
      const media=await(await fetch('/v1/tenants/'+tenant+'/media/'+mediaId)).json();
      const records=await new Promise((resolve,reject)=>{const request=indexedDB.open('scenedesk-media-imports',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('imports','readonly');const read=tx.objectStore('imports').getAll();tx.oncomplete=()=>{db.close();resolve(read.result);};};});
      return {uploadId:upload.id,mediaId:upload.mediaId,actualSource:media.sourceUploadId,status:upload.status,localKeys:records.filter(record=>record.intentId===lostId).map(record=>Object.keys(record)),containsUploadCredentials:JSON.stringify(records).includes('formFields')||JSON.stringify(records).includes('uploadUrl')};
    },{lostId,mediaId});
    ok(creates===2 && lostKey===replayKey,'Create recovery did not replay the durable request identity');
    ok(result.uploadId===lostId && result.mediaId===mediaId && result.actualSource===lostId,'Recovery changed the business upload identity');
    ok(!result.containsUploadCredentials,'Upload credentials were persisted locally');
    return {lostResponseRecovered:true,wrongFileRejectedBeforeCreate:true,sameRequestIdentityReplayed:true,...result};
  } finally {await page.unroute(pattern,handler);}
}
