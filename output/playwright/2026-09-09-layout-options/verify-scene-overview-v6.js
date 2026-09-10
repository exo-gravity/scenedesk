async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.reload();
  await page.getByRole('heading', { name: '同一场戏，两种制作模式' }).waitFor();
  const choices = page.getByRole('group', { name: '查看制作模式效果图', exact: true });
  if (await choices.getByRole('button').count() !== 2) throw new Error('Expected exactly two business modes');
  const loaded = [];
  async function verifyImage(container, name, file, fullscreen = false) {
    const result = await container.getByRole('img', { name: new RegExp('^' + name + (fullscreen ? '完整效果图' : '效果图')) }).evaluate(async image => {
      await image.decode();
      const r = image.getBoundingClientRect();
      return { src: image.src, width: image.naturalWidth, height: image.naturalHeight,
        contained: getComputedStyle(image).objectFit === 'contain' && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
    });
    if (!result.src.endsWith(file) || result.width < 1500 || result.height < 900) throw new Error(JSON.stringify(result));
    if (fullscreen && !result.contained) throw new Error('Fullscreen image clipped: ' + JSON.stringify(result));
    loaded.push({ file, fullscreen, ...result });
  }
  async function setRange(container, label) {
    await container.getByRole('combobox', { name: '画布效果图查看范围', exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
  }
  await verifyImage(page, '分镜模式', 'scene-storyboard-v5.png');
  await choices.getByRole('button', { name: '自由画布', exact: true }).click();
  if (await page.getByRole('combobox', { name: '画布效果图查看范围' }).inputValue() !== '全场总览') throw new Error('Canvas should first show overview');
  await verifyImage(page, '自由画布', 'scene-canvas-overview-v6.png');
  await setRange(page, '局部制作 · SH04');
  await verifyImage(page, '自由画布', 'scene-canvas-v5.png');
  await choices.getByRole('button', { name: '分镜模式', exact: true }).click();
  if (await page.getByRole('combobox', { name: '画布效果图查看范围' }).count()) throw new Error('Canvas range leaked to storyboard mode');
  await choices.getByRole('button', { name: '自由画布', exact: true }).click();
  await verifyImage(page, '自由画布', 'scene-canvas-v5.png');
  await setRange(page, '全场总览');
  await page.getByRole('button', { name: '全屏查看与切换', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '场次双模式 · 全屏效果图' });
  await dialog.waitFor();
  await dialog.evaluate(async element => {
    const animations = [];
    for (let current = element; current; current = current.parentElement) animations.push(...current.getAnimations());
    await Promise.all(animations.filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
  await verifyImage(dialog, '自由画布', 'scene-canvas-overview-v6.png', true);
  await page.screenshot({ path: 'output/playwright/2026-09-09-layout-options/scene-canvas-overview-v6-fullscreen.png', animations: 'disabled' });
  await setRange(dialog, '局部制作 · SH04');
  await verifyImage(dialog, '自由画布', 'scene-canvas-v5.png', true);
  if (!(await dialog.getByRole('link', { name: '查看原图' }).getAttribute('href')).endsWith('scene-canvas-v5.png')) throw new Error('Detail link mismatch');
  await dialog.getByRole('button', { name: '分镜模式', exact: true }).click();
  await verifyImage(dialog, '分镜模式', 'scene-storyboard-v5.png', true);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.textContent === '全屏查看与切换');
  const responsive = [];
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ['分镜模式', '自由画布']) {
      await choices.getByRole('button', { name, exact: true }).click();
      if (name === '自由画布') await setRange(page, '全场总览');
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Horizontal overflow: ' + width + ' ' + name);
      responsive.push({ width, mode: name, noHorizontalOverflow: true });
    }
  }
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.screenshot({ path: 'output/playwright/2026-09-09-layout-options/scene-overview-v6-gallery.png', fullPage: true });
  await page.getByRole('button', { name: '返回视觉规范', exact: true }).click();
  await page.getByRole('button', { name: '场次双模式效果图', exact: true }).click();
  await page.getByRole('heading', { name: '同一场戏，两种制作模式' }).waitFor();
  if (errors.length) throw new Error(errors.join('; '));
  return { result: 'PASS', loaded, responsive, twoModes: true, canvasRangeState: true, fullscreenSwitching: true, escapeFocus: true, designEntry: true, runtimeErrors: errors };
}
