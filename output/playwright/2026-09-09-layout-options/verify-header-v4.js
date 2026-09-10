async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.reload();
  await page.getByRole('heading', { name: '三种更轻的创作布局' }).waitFor();
  const variants = [
    ['01 · 聚焦制作', 'focus-v4.png'],
    ['02 · 精简总览', 'overview-v4.png'],
    ['03 · 画布＋对话', 'chat-v4.png'],
  ];
  const loaded = [];
  for (const [name, file] of variants) {
    await page.getByRole('group', { name: '选择效果图方案', exact: true }).getByRole('button', { name, exact: true }).click();
    const result = await page.getByRole('img', { name: new RegExp(name + '效果图') }).evaluate(async image => {
      await image.decode();
      return { src: image.src, width: image.naturalWidth, height: image.naturalHeight };
    });
    if (!result.src.endsWith(file) || result.width !== 1586 || result.height !== 992) throw new Error(JSON.stringify(result));
    loaded.push(result);
  }
  await page.getByRole('button', { name: '全屏查看与切换', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '布局效果图 · 全屏对比' });
  await dialog.waitFor();
  for (const [name, file] of variants) {
    await dialog.getByRole('button', { name, exact: true }).click();
    const fit = await dialog.getByRole('img', { name: new RegExp(name + '完整效果图') }).evaluate(async image => {
      await image.decode();
      const r = image.getBoundingClientRect();
      return { src: image.src, contained: getComputedStyle(image).objectFit === 'contain' && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
    });
    if (!fit.contained || !fit.src.endsWith(file)) throw new Error(JSON.stringify(fit));
  }
  await dialog.getByRole('button', { name: variants[0][0], exact: true }).click();
  await dialog.getByRole('img', { name: /01 · 聚焦制作完整效果图/ }).evaluate(image => image.decode());
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'output/playwright/2026-09-09-layout-options/header-v4-fullscreen.png' });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.textContent === '全屏查看与切换');
  await page.screenshot({ path: 'output/playwright/2026-09-09-layout-options/header-v4-gallery.png', fullPage: true });
  if (errors.length) throw new Error(errors.join('; '));
  return { loaded, fullscreenSwitching: true, fullscreenContainment: true, escapeFocus: true, runtimeErrors: errors };
}
