async(page)=>{
  const downloadEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'下载原文件',exact:true}).click();
  const download=await downloadEvent;
  await download.saveAs('/Users/gandy/beyondgravity/scenedesk/.runtime/media-download.mp4');
  return {filename:download.suggestedFilename(),failure:await download.failure(),saved:true};
}
