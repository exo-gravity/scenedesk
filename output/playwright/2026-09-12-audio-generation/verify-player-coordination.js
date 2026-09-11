async (page) => {
  await page.unrouteAll({behavior:'ignoreErrors'});
  await page.route('**/__controlled__/video.mp4',route=>route.fulfill({path:'output/playwright/2026-09-11-video-generation/controlled-fixture.mp4',contentType:'video/mp4'}));
  await page.route('**/__controlled__/audio.wav',route=>route.fulfill({path:'output/playwright/2026-09-12-audio-generation/controlled-fixture.wav',contentType:'audio/wav'}));
  await page.goto('http://127.0.0.1:4316/player-check/player-check.html');
  await page.locator('video').first().waitFor();
  await page.getByText('受控测试：视频与音频两个实际 MediaPlayer 实例，不是模型输出。',{exact:true}).click();
  const result=await page.locator('video').evaluateAll(async elements=>{
    if(elements.length!==2)throw Error('Expected two actual players');
    const [a,b]=elements;const tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    for(const media of elements){media.loop=true;media.volume=0.2;if(media.readyState<2)await new Promise((resolve,reject)=>{media.addEventListener('loadeddata',resolve,{once:true});media.addEventListener('error',()=>reject(Error('Fixture decode failed')),{once:true});});}
    await a.play();await b.play();await tick();if(!a.paused||b.paused)throw Error('Two audible players remained active');
    a.muted=true;await a.play();await tick();if(a.paused||b.paused)throw Error('Muted preview unnecessarily paused a player');
    a.muted=false;await tick();if(a.paused||!b.paused)throw Error('Unmuting did not pause the other audible player');
    b.volume=0;await b.play();await tick();if(a.paused||b.paused)throw Error('Zero-volume preview unnecessarily paused a player');
    b.volume=0.2;await tick();if(!a.paused||b.paused)throw Error('Increasing volume did not coordinate audible playback');
    b.pause();a.muted=false;await a.play();await tick();a.pause();
    return {actualInstances:2,audioAndVideo:true,decoded:true,playExclusive:true,mutedPlaybackPreserved:true,unmuteExclusive:true,zeroVolumePreserved:true,volumeIncreaseExclusive:true};
  });
  await page.screenshot({path:'output/playwright/2026-09-12-audio-generation/mixed-players.png',fullPage:true,animations:'disabled'});
  const old=await page.locator('video').first().elementHandle();
  await page.getByRole('button',{name:'切换播放器挂载',exact:true}).click();
  await page.locator('video').first().waitFor({state:'detached'});
  if(!await old.evaluate(media=>media.paused&&!media.getAttribute('src')))throw Error('Unmount retained media source');
  await page.getByRole('button',{name:'切换播放器挂载',exact:true}).click();await page.locator('video').first().waitFor();
  await page.locator('video').evaluateAll(async ([a,b])=>{a.volume=0.2;b.volume=0.2;await a.play();await b.play();await new Promise(resolve=>requestAnimationFrame(resolve));if(!a.paused||b.paused)throw Error('Remounted players did not coordinate');b.pause();});
  if(await page.getByLabel('播放器错误数').textContent()!=='0')throw Error('Player reported errors');
  return {...result,unmountSourceReleased:true,remountCoordination:true,notRealProviderAcceptance:true};
}
