async (page) => {
  page.setDefaultTimeout(15000);
  const ok=(v,m)=>{if(!v)throw new Error(m);};
  const path='/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f/projects/1498c59a-a789-4087-8069-4c99ebcbd63f';
  const shotId='d16cf12a-00ab-4564-b535-ffa39f2c9a8a',oldId='168865c2-d00b-49a7-8385-1cff76e4cd06';
  const dialog=page.getByRole('dialog',{name:'01A · 入屋 · 要求历史',exact:true});
  const versions=await page.evaluate(async({path,shotId,oldId})=>{
    const tree=await(await fetch(`${path}/content`)).json(),shot=tree.shots.find(s=>s.id===shotId);
    const old=await(await fetch(`${path}/shots/${shotId}/revisions/${oldId}`)).json(),current=await(await fetch(`${path}/shots/${shotId}/revisions/${shot.specRevisionId}`)).json();
    return {old:{id:old.id,number:old.number,references:old.spec.references.length},current:{id:current.id,number:current.number}};
  },{path,shotId,oldId});
  await dialog.getByRole('combobox',{name:'镜头要求版本',exact:true}).click();
  await page.getByRole('option',{name:`第 ${versions.old.number} 版`,exact:true}).click();
  ok(versions.old.references===0,'Historical test baseline changed');
  ok(await dialog.getByRole('link',{name:'在新标签页核对固定版',exact:true}).count()===0,'Old requirements acquired current fixed references');
  await dialog.getByRole('combobox',{name:'镜头要求版本',exact:true}).click();
  await page.getByRole('option',{name:`第 ${versions.current.number} 版 · 当前`,exact:true}).click();
  await dialog.getByText('林晚 · 共享声音设定 · v2 · 草稿',{exact:true}).waitFor();
  await dialog.getByText('造型：晚礼服 · 酒红 · 修订 3',{exact:true}).waitFor();
  await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect && Number.isFinite(a.effect.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));});
  await page.screenshot({path:'output/playwright/creative-bindings/02-shot-fixed-history.png'});
  await dialog.getByRole('button',{name:'关闭弹窗',exact:true}).click();
  await page.getByRole('link',{name:'项目资产',exact:true}).click();
  await page.getByRole('link',{name:/林晚 · 固定版本复核/}).click();
  await page.getByText('有权查看的直接使用位置',{exact:true}).click();
  await page.getByRole('link',{name:`01A · 入屋 · 镜头要求 v${versions.current.number}`,exact:true}).click();
  await page.getByRole('dialog',{name:'01A · 入屋 · 要求历史',exact:true}).getByText('林晚 · 共享声音设定 · v2 · 草稿',{exact:true}).waitFor();
  ok((await page.getByRole('combobox',{name:'镜头要求版本',exact:true}).inputValue()).startsWith(`第 ${versions.current.number} 版`),'Usage navigation opened a different requirements version');
  return {historicalRequirements:versions.old,currentRequirements:versions.current,usageNavigatedToExactRevision:true};
}
