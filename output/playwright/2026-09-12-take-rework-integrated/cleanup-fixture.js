async page => {
 const cleanup=await page.evaluate(async()=>{
  const path='/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f/projects/ff8f70f2-8075-45de-b2bc-c54bd62e2653';
  const tree=await(await fetch(path+'/content')).json();
  const shot=tree.shots.find(s=>s.id==='ba153ce6-bfa0-4560-a5a3-43def46f74a3');
  const original=tree.shots.find(s=>s.id==='a9f4d414-2467-43bb-a56d-4be7fe13e651');
  if(shot.label!=='候选意见验收 · 独立技术夹具' || original.specRevisionId!=='9522ed5a-d2e3-4ba0-a678-7aab55c495a2') throw Error('Fixture scope changed');
  if(shot.status==='active'){
   const session=await(await fetch('/v1/session')).json();
   const r=await fetch(path+'/shots/'+shot.id,{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'If-Match':'"'+shot.revision+'"'},body:JSON.stringify({sceneId:shot.sceneId,label:shot.label,position:shot.position,status:'archived',spec:shot.spec})});
   if(r.status!==200) throw Error('Fixture archival '+r.status);
  }
  const after=await(await fetch(path+'/content')).json();
  if(JSON.stringify(after.shots.find(s=>s.id===original.id))!==JSON.stringify(original)) throw Error('Original trial shot changed');
  return {isolatedFixtureShotArchived:after.shots.find(s=>s.id===shot.id).status==='archived',originalTrialShotUnchanged:true,activeShots:after.shots.filter(s=>s.status==='active').length};
 });
 await page.setViewportSize({width:1512,height:982});
 await page.goto('http://127.0.0.1:4311/#/app/t/b128e444-cd57-4087-bcfe-c403051bbd8f/p/ff8f70f2-8075-45de-b2bc-c54bd62e2653/content');
 return cleanup;
}
