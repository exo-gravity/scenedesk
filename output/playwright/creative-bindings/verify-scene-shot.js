async (page) => {
  page.setDefaultTimeout(15000);
  const ok=(value,message)=>{if(!value)throw new Error(message);};
  const failures=[]; const capture=e=>failures.push(e.message);page.on('pageerror',capture);
  const tenant='b128e444-cd57-4087-bcfe-c403051bbd8f',project='1498c59a-a789-4087-8069-4c99ebcbd63f';
  const base=`/v1/tenants/${tenant}`,path=`${base}/projects/${project}`;
  const character='b6095818-3b79-47ea-ad5a-52ff517146fa',firstCharacter='43aa2ebd-9a86-4f22-95b0-1db7e135d9aa',currentCharacter='972c2207-23f1-4060-b70c-e4910a4067f5';
  const voice1='d2dc183f-6566-4b3a-a19c-3302c355bc6f',voice2='26251849-08a5-4afa-ab25-ce3c011c46c6';
  const read=()=>page.evaluate(async(path)=>await(await fetch(`${path}/content`)).json(),path);
  // Setup a relational test asset through the authenticated API. The interactions
  // under test below bind it through the actual UI; no model or paid call occurs.
  const prop=await page.evaluate(async({base,project})=>{
    const found=await(await fetch(`${base}/assets?scope=project&kind=prop&projectId=${project}&q=${encodeURIComponent('旧钥匙 · 场镜引用验收')}`)).json();
    if(found.items?.[0]?.currentRevisionId)return {id:found.items[0].id,revisionId:found.items[0].currentRevisionId};
    const session=await(await fetch('/v1/session')).json();
    const send=async(url,body,version)=>{
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'Idempotency-Key':crypto.randomUUID(),...(version?{'If-Match':`"${version}"`}:{})},body:JSON.stringify(body)});
      const data=await response.json();if(!response.ok)throw new Error(`${response.status}: ${data.code}`);return data;
    };
    const asset=await send(`${base}/assets`,{scope:'project',projectId:project,kind:'prop',name:'旧钥匙 · 场镜引用验收'});
    const r=await send(`${base}/assets/${asset.id}/revisions`,{definition:{description:'手工设定：黄铜旧钥匙，齿口磨损。色块仅作引用链技术验收，不是钥匙照片。',references:[{mediaId:'f2739951-cd07-4fa3-91e7-7f4ba17218c0',purpose:'prop'}]}},1);
    return {id:asset.id,revisionId:r.id};
  },{base,project});
  const chooseIdentity=async(label,name)=>{
    await page.getByRole('button',{name:label,exact:true}).click();
    const picker=page.getByRole('dialog',{name:label,exact:true});
    await picker.getByRole('textbox',{name:'查找资产',exact:true}).fill(name);
    await picker.getByRole('button',{name:'关联身份',exact:true}).click();
    await picker.waitFor({state:'hidden'});
  };
  const chooseFixed=async(label,name,version,shared=false)=>{
    await page.getByRole('button',{name:label,exact:true}).click();
    const picker=page.getByRole('dialog',{name:label,exact:true});
    if(shared){await picker.getByRole('combobox',{name:'资产范围',exact:true}).click();await page.getByRole('option',{name:'工作室共享',exact:true}).click();}
    const search=picker.getByRole('textbox',{name:'查找资产',exact:true});
    if(name){await search.fill(name);await picker.getByText(new RegExp('^'+name+' ·')).locator('..').getByRole('button',{name:'选择固定版',exact:true}).click();}
    await picker.getByRole('button',{name:`${shared?'引入并使用':'使用'} v${version} 固定版`,exact:true}).click();
    await picker.waitFor({state:'hidden'});
  };
  try {
    const before=await read(),beforeScene=before.scenes.find(s=>s.title==='01 · 旧公寓重逢'),beforeShot=before.shots.find(s=>s.label==='01A · 入屋');
    ok(beforeScene && beforeShot,'Named fixture scene or shot missing');
    ok(!beforeScene.state.characters?.length,'Fixture already has bindings; inspect before re-running this creation scenario');
    await page.getByRole('button',{name:'编辑01 · 旧公寓重逢',exact:true}).click();
    const sceneDialog=page.getByRole('dialog',{name:'编辑场次',exact:true});
    await chooseIdentity('场次状态 · 添加角色','林晚 · 固定版本复核');
    await sceneDialog.getByRole('button',{name:'选择此处角色造型',exact:true}).click();
    await page.getByRole('dialog',{name:'选择此处角色造型',exact:true}).getByRole('button',{name:/^使用 v1 · 日常服/}).click();
    await sceneDialog.getByRole('textbox',{name:'情绪',exact:true}).fill('克制，听到钥匙声后停顿。');
    await chooseFixed('选择角色声音覆盖固定版','林晚 · 共享声音设定',1,true);
    await chooseIdentity('场次状态 · 添加道具','旧钥匙 · 场镜引用验收');
    await chooseFixed('选择此处道具固定版','',1);
    await sceneDialog.getByRole('button',{name:'明确无人持有',exact:true}).click();
    await sceneDialog.getByRole('combobox',{name:'持握方式',exact:true}).click();await page.getByRole('option',{name:'未持握',exact:true}).click();
    await sceneDialog.getByRole('textbox',{name:'道具位置',exact:true}).fill('门口桌面');
    await sceneDialog.getByRole('textbox',{name:'道具状态',exact:true}).fill('齿口磨损');
    await chooseFixed('添加默认资产固定版','林晚 · 固定版本复核',1);
    await sceneDialog.getByRole('button',{name:'保存修改',exact:true}).click();
    await sceneDialog.waitFor({state:'hidden'});
    const afterScene=await read(),scene=afterScene.scenes.find(s=>s.id===beforeScene.id);
    ok(scene.revision===beforeScene.revision+1,'Scene did not advance exactly once');
    ok(scene.state.characters[0].characterAssetId===character&&scene.state.characters[0].lookAssetRevisionId===firstCharacter,'Scene did not retain selected old character version');
    ok(scene.state.characters[0].voiceAssetRevisionId===voice1,'Scene voice not pinned');
    ok(scene.state.props[0].holderCharacterAssetId===null&&scene.state.props[0].propAssetRevisionId===prop.revisionId,'Prop explicit no-holder or fixed version lost');
    ok(scene.defaultAssetRevisionIds[0]===firstCharacter,'Scene default not fixed');
    await page.getByText('查看场次角色、道具与默认资产',{exact:true}).click();
    await page.getByText('场次预期状态',{exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:'output/playwright/creative-bindings/01-scene-bindings.png'});
    await page.getByRole('button',{name:'编辑01A · 入屋',exact:true}).click();
    const shotDialog=page.getByRole('dialog',{name:'编辑镜头',exact:true});
    await chooseFixed('从资产固定版选择参考','林晚 · 固定版本复核',1);
    const reference=page.getByRole('dialog',{name:'选择固定版中的参考',exact:true});
    await reference.getByRole('button',{name:'使用这项固定版参考',exact:true}).first().click();
    await chooseIdentity('入口状态 · 添加角色','林晚 · 固定版本复核');
    await shotDialog.getByRole('button',{name:'选择此处角色造型',exact:true}).click();
    await page.getByRole('dialog',{name:'选择此处角色造型',exact:true}).getByRole('button',{name:/^使用 v5 · 晚礼服/}).click();
    await shotDialog.getByRole('textbox',{name:'情绪',exact:true}).fill('警觉，注意桌面折痕。');
    await chooseIdentity('出口状态 · 添加道具','旧钥匙 · 场镜引用验收');
    await chooseIdentity('指定道具持有人','林晚 · 固定版本复核');
    await shotDialog.getByRole('combobox',{name:'持握方式',exact:true}).click();await page.getByRole('option',{name:'右手',exact:true}).click();
    await shotDialog.getByRole('textbox',{name:'道具位置',exact:true}).fill('右手握住钥匙，手臂自然下垂。');
    await chooseIdentity('选择第 1 句说话人','林晚 · 固定版本复核');
    await chooseFixed('选择第 1 句声音覆盖固定版','林晚 · 共享声音设定',2,true);
    await shotDialog.getByRole('button',{name:'保存修改',exact:true}).click();
    await shotDialog.waitFor({state:'hidden'});
    const after=await read(),shot=after.shots.find(s=>s.id===beforeShot.id),sceneAgain=after.scenes.find(s=>s.id===scene.id);
    ok(shot.revision===beforeShot.revision+1&&shot.specRevisionId!==beforeShot.specRevisionId,'Shot did not append one fixed requirements version');
    ok(shot.spec.references[0].assetRevisionId===firstCharacter&&shot.spec.references[0].subjectAssetId===character,'Reference lost fixed source or subject');
    ok(shot.spec.entryState.characters[0].lookAssetRevisionId===currentCharacter,'Shot did not retain selected evening look parent');
    ok(shot.spec.exitState.props[0].holderCharacterAssetId===character&&shot.spec.exitState.props[0].hand==='right','Exit prop state lost');
    ok(shot.spec.dialogue[0].voiceAssetRevisionId===voice2&&shot.spec.dialogue[0].characterAssetId===character,'Dialogue voice or speaker lost');
    ok(sceneAgain.state.characters[0].voiceAssetRevisionId===voice1,'Dialogue override silently changed scene voice');
    ok(JSON.stringify(shot.spec.sourceExcerpts)===JSON.stringify(beforeShot.spec.sourceExcerpts),'Editing bindings changed original script evidence');
    await page.getByRole('button',{name:'要求历史',exact:true}).first().click();
    await page.getByRole('dialog',{name:/要求历史/}).waitFor();
    await page.screenshot({path:'output/playwright/creative-bindings/02-shot-fixed-history.png'});
    ok(failures.length===0,failures.join(';'));
    return {sceneId:scene.id,sceneRevision:scene.revision,shotId:shot.id,shotRevision:shot.revision,previousSpecRevisionId:beforeShot.specRevisionId,specRevisionId:shot.specRevisionId,prop,sceneVoice:voice1,dialogueVoice:voice2,sourceEvidencePreserved:true,pageErrors:failures};
  } finally {page.off('pageerror',capture);}
}
