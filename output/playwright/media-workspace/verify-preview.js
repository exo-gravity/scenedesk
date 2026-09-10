async (page) => {
  page.setDefaultTimeout(15000);
  const mediaId='5b647e08-c985-4946-aa2a-33231c778aca';
  const route='http://127.0.0.1:4311/#/app/t/b128e444-cd57-4087-bcfe-c403051bbd8f/p/1498c59a-a789-4087-8069-4c99ebcbd63f/media?media='+mediaId;
  const accessPattern='**/v1/tenants/*/media/'+mediaId+'/access';
  const storagePattern='http://127.0.0.1:55440/**';
  let firstUrl, grants=0, interrupted=0;
  const errors=[];
  const captureError=e=>errors.push(e.message);
  page.on('pageerror',captureError);
  await page.route(accessPattern,async r=>{
    const response=await r.fetch();
    const body=await response.json();
    if(r.request().postDataJSON().variant==='proxy') {
      grants++;
      if(grants===1) {firstUrl=body.url;body.expiresAt='2020-01-01T00:00:00Z';}
    }
    await r.fulfill({response,json:body});
  });
  await page.route(storagePattern,async r=>{
    if(r.request().url()===firstUrl && !interrupted){interrupted++;await r.abort('failed');}
    else await r.continue();
  });
  try {
    await page.goto(route);
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
    if(grants!==2||interrupted!==1)throw new Error('Expired preview was not renewed exactly once');
    await page.locator('media-play-button').click();
    await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.2&&!document.querySelector('video').paused);
    await page.evaluate(()=>{const video=document.querySelector('video');video.pause();video.currentTime=2;});
    await page.waitForFunction(()=>Math.abs(document.querySelector('video').currentTime-2)<0.05);
    // A decode/network error after metadata load exercises explicit reload without changing server facts.
    await page.evaluate(()=>document.querySelector('video').dispatchEvent(new Event('error',{bubbles:true})));
    await page.getByRole('button',{name:'重新加载预览',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2&&Math.abs(document.querySelector('video').currentTime-2)<0.1);
    const result=await page.evaluate(()=>{const video=document.querySelector('video');return{currentTime:video.currentTime,duration:video.duration,width:video.videoWidth,height:video.videoHeight,error:video.error?.code??null};});
    if(errors.length)throw new Error('Unexpected page errors: '+errors.join(';'));
    await page.screenshot({path:'output/playwright/media-workspace/05-renewed-video.png'});
    return {automaticExpiryRenewal:true,explicitReloadPreservedPosition:true,grants,interrupted,pageErrors:errors.length,...result};
  } finally {await page.unroute(accessPattern);await page.unroute(storagePattern);page.off('pageerror',captureError);}
}
