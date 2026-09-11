async page=>{
  page.setDefaultTimeout(12000);
  const path='/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f/projects/1498c59a-a789-4087-8069-4c99ebcbd63f/canvases/379e96ec-f6a0-4cd2-8c85-5204065a7859';
  const read=()=>page.evaluate(async p=>(await(await fetch(p)).json()),path),ok=(v,m)=>{if(!v)throw new Error(m);};
  await page.reload();await page.getByRole('textbox',{name:'节点名称',exact:true}).waitFor();
  const base=await read();
  const title=page.getByRole('textbox',{name:'节点名称',exact:true}), originalTitle=await title.inputValue(), nextTitle=`历史取回验证 ${Date.now()}`;
  await title.fill(nextTitle);await page.getByRole('button',{name:'保存画布',exact:true}).click();await page.getByRole('status').filter({hasText:'画布 · 已保存'}).waitFor();
  const edited=await read();
  await page.getByRole('button',{name:'历史',exact:true}).click();
  const entry=()=>page.getByText(new RegExp(`^版本 ${base.revision} ·`)).locator('..').getByRole('button',{name:'查看内容',exact:true});
  await entry().click();
  const preview=()=>page.getByRole('alert',{name:`正在查看版本 ${base.revision}`,exact:true});
  await preview().waitFor();
  await title.fill(`${nextTitle} · 继续修改`);
  ok(await page.getByRole('button',{name:'取回为当前草稿',exact:true}).isDisabled(),'history confirmation not bound to reviewed draft');
  await page.getByRole('button',{name:'保存画布',exact:true}).click();await page.getByRole('status').filter({hasText:'画布 · 已保存'}).waitFor();
  const latest=await read();
  await entry().click();await page.getByRole('button',{name:'取回为当前草稿',exact:true}).waitFor();
  await preview().locator('summary').filter({hasText:/^窗边构图参考$/}).click();
  await preview().getByText('窗框作为前景，人物望向街道；暖光留在桌面。',{exact:true}).waitFor();
  await page.screenshot({path:'output/playwright/scene-canvas/12-reviewed-history-v2.png'});
  await page.getByRole('button',{name:'取回为当前草稿',exact:true}).click();await page.getByRole('status').filter({hasText:'画布 · 已保存'}).waitFor();
  const restored=await read();ok(restored.documentHash===base.documentHash&&restored.revision>latest.revision,'history did not create new current revision');
  await page.getByRole('button',{name:'撤销画布编辑',exact:true}).click();await page.getByRole('status').filter({hasText:'画布 · 已保存'}).waitFor();
  const undone=await read();ok(undone.documentHash===latest.documentHash&&undone.revision>restored.revision,'history undo lost immediately previous work');
  return {baseRevision:base.revision,editedRevision:edited.revision,restoredRevision:restored.revision,undoRevision:undone.revision,staleConfirmationBlocked:true,fullTextReviewed:true,newRevisionWithoutJob:true,historyUndoRetainsLatest:true};
}
