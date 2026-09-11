async(page)=>{
 const data=__CASE__;const input=page.getByLabel('文字内容',{exact:true});await input.waitFor();const original=await input.inputValue();
 const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start');
 for(let i=0;i<8;i++){await input.fill(original+'\n性能诊断 '+i);await page.waitForTimeout(50)}
 const result=await cdp.send('Profiler.stop');await cdp.detach();const profile=result.profile;return {case:data.nodeCount,intervalMicroseconds:1000,profile,top:profile.nodes.filter(n=>n.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,25).map(n=>({frame:n.callFrame,hits:n.hitCount}))};
}
