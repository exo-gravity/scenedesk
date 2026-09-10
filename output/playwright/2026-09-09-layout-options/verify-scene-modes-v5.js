async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.reload();
  await page.getByRole('heading', { name: '同一场戏，两种制作模式' }).waitFor();
  const choices = page.getByRole('group', { name: '查看制作模式效果图', exact: true });
  if (await choices.getByRole('button').count() !== 2) throw new Error('Expected exactly two scene modes');
  const variants = [
    ['分镜模式', 'scene-storyboard-v5.png'],
    ['自由画布', 'scene-canvas-v5.png'],
  ];
  const loaded = [];
  for (const [name, file] of variants) {
    await choices.getByRole('button', { name, exact: true }).click();
    const result = await page.getByRole('img', { name: new RegExp('^' + name + '效果图') }).evaluate(async image => {
      await image.decode();
      return { src: image.src, width: image.naturalWidth, height: image.naturalHeight };
    });
    if (!result.src.endsWith(file) || result.width < 1500 || result.height < 900) throw new Error(JSON.stringify(result));
    if (await choices.getByRole('button', { name, exact: true }).getAttribute('aria-pressed') !== 'true') throw new Error('Mode selection was not reflected');
    loaded.push(result);
  }
  await page.getByRole('button', { name: '全屏查看与切换', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '场次双模式 · 全屏效果图' });
  await dialog.waitFor();
  for (const [name, file] of variants) {
    await dialog.getByRole('button', { name, exact: true }).click();
    const fit = await dialog.getByRole('img', { name: new RegExp('^' + name + '完整效果图') }).evaluate(async image => {
      await image.decode();
      const r = image.getBoundingClientRect();
      return { src: image.src, contained: getComputedStyle(image).objectFit === 'contain' && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
    });
    if (!fit.contained || !fit.src.endsWith(file)) throw new Error(JSON.stringify(fit));
    if (!(await dialog.getByRole('link', { name: '查看原图' }).getAttribute('href'))?.endsWith(file)) throw new Error('Original image link mismatch');
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'output/playwright/2026-09-09-layout-options/' + file.replace('.png', '-fullscreen.png') });
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.textContent === '全屏查看与切换');
  await page.screenshot({ path: 'output/playwright/2026-09-09-layout-options/scene-modes-v5-gallery.png', fullPage: true });
  const responsive = [];
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name] of variants) {
      await choices.getByRole('button', { name, exact: true }).click();
      await page.getByRole('img', { name: new RegExp('^' + name + '效果图') }).evaluate(image => image.decode());
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      if (overflow) throw new Error('Horizontal overflow at ' + width + ', ' + name);
      responsive.push({ width, mode: name, noHorizontalOverflow: true });
    }
  }
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.getByRole('button', { name: '返回视觉规范', exact: true }).click();
  await page.getByRole('button', { name: '场次双模式效果图', exact: true }).click();
  await page.getByRole('heading', { name: '同一场戏，两种制作模式' }).waitFor();
  if (errors.length) throw new Error(errors.join('; '));
  return { loaded, responsive, fullscreenSwitching: true, fullscreenContainment: true, escapeFocus: true, designEntry: true, runtimeErrors: errors };
}
