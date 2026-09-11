async page=>{
  page.setDefaultTimeout(12000);
  await page.reload();const field=()=>page.getByRole('textbox',{name:'节点名称',exact:true});await field().waitFor();
  const before=await field().inputValue();await field().fill('');await page.getByRole('status').filter({hasText:'有待完成输入'}).waitFor();
  await page.getByRole('button',{name:'分镜',exact:true}).click();await page.getByRole('button',{name:'自由画布',exact:true}).click();
  if(await field().inputValue()!=='')throw new Error('mode discarded blank name');
  await page.reload();await page.getByRole('button',{name:'恢复本机修改',exact:true}).click();
  await page.getByRole('status').filter({hasText:'有待完成输入'}).waitFor();
  if(await field().inputValue()!=='')throw new Error('reload discarded blank name');
  await field().fill(before);await page.getByRole('button',{name:'保存画布',exact:true}).click();await page.getByRole('status').filter({hasText:'画布 · 已保存'}).waitFor();
  return {blankNamePreservedAcrossModeAndReload:true,restoredFocusedNode:true,correctedAndSaved:true};
}
