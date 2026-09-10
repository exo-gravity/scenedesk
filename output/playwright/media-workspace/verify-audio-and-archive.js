async(page)=>{
  page.setDefaultTimeout(30000);
  const base='http://127.0.0.1:4311/#/app/t/b128e444-cd57-4087-bcfe-c403051bbd8f/p/1498c59a-a789-4087-8069-4c99ebcbd63f/media';
  const title='48 kHz 单声道 · 规范文件';
  await page.goto(base+'?media=6e792715-a9f9-436c-af76-b8484e0e7224');
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2,{},{timeout:60000});
  await page.locator('media-play-button').click();
  await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.05&&!document.querySelector('video').paused);
  const audio=await page.evaluate(()=>{const v=document.querySelector('video');return {id:location.hash.split('media=')[1],playing:!v.paused,currentTime:v.currentTime,duration:v.duration,controllerIsAudio:document.querySelector('media-controller').hasAttribute('audio'),fullscreenButtons:document.querySelectorAll('media-fullscreen-button').length};});
  if(!audio.controllerIsAudio||audio.fullscreenButtons!==0)throw new Error('Wrong audio control surface');
  await page.screenshot({path:'output/playwright/media-workspace/06-audio.png'});
  const imageId='96debd35-9cd8-463e-bedd-bb617ba23623';
  await page.goto(base+'?media='+imageId);
  if(await page.getByRole('button',{name:'归档素材',exact:true}).isVisible()) {
  await page.getByRole('button',{name:'归档素材',exact:true}).click();
  await page.getByRole('dialog',{name:'归档这项素材？',exact:true}).getByRole('button',{name:'确认归档',exact:true}).click();
  }
  await page.getByText('图片 · 已归档',{exact:true}).waitFor();
  if(await page.getByRole('button',{name:'归档素材',exact:true}).count())throw new Error('Archived media still offers archive action');
  const archive=await page.evaluate(async imageId=>{
    const tenant=location.hash.split('?')[0].split('/')[3];
    const r=await fetch('/v1/tenants/'+tenant+'/media/'+imageId);
    const value=await r.json();return {id:value.id,status:value.status,sha256:value.sha256};
  },imageId);
  const event=page.waitForEvent('download');
  await page.getByRole('button',{name:'下载原文件',exact:true}).click();
  const download=await event;
  await download.saveAs('/Users/gandy/beyondgravity/scenedesk/.runtime/archived-media.png');
  await page.screenshot({path:'output/playwright/media-workspace/07-archived-image.png'});
  return {audio,archive,download:{filename:download.suggestedFilename(),failure:await download.failure()}};
}
