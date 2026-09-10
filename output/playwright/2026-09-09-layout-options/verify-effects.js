async (page) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const choices = ['01 · 聚焦制作', '02 · 精简总览', '03 · 画布＋对话'];
  const files = ['focus-v3.png', 'overview-v3.png', 'chat-v3.png'];
  const evidence = [];
  await page.goto('http://127.0.0.1:4313/#/layouts/');
  await page.reload();
  await page.getByRole('heading', { name: '三种更轻的创作布局' }).waitFor();
  await page.setViewportSize({ width: 1512, height: 982 });
  for (let i = 0; i < choices.length; i++) {
    await page.getByRole('group', { name: '选择效果图方案', exact: true }).getByRole('button', { name: choices[i], exact: true }).click();
    const media = page.getByRole('main').getByRole('img', { name: new RegExp(choices[i] + '效果图') });
    const size = await media.evaluate(async (image) => { await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight, source: image.src }; });
    if (size.width !== 1586 || size.height !== 992 || !size.source.endsWith(files[i])) throw new Error('Incorrect or missing image: ' + JSON.stringify(size));
    evidence.push({ scheme: choices[i], imageLoaded: true });
  }
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'output/playwright/2026-09-09-layout-options/effects-gallery-1512.png', fullPage: true });
  await page.getByRole('button', { name: '全屏查看与切换', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '布局效果图 · 全屏对比' });
  await dialog.waitFor();
  for (let i = 0; i < choices.length; i++) {
    await dialog.getByRole('button', { name: choices[i], exact: true }).click();
    const image = dialog.getByRole('img', { name: new RegExp(choices[i] + '完整效果图') });
    const view = await image.evaluate(async (node) => { await node.decode(); const rect = node.getBoundingClientRect(); return { src: node.src, fit: getComputedStyle(node).objectFit, right: rect.right, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight }; });
    if (!view.src.endsWith(files[i]) || view.fit !== 'contain' || view.right > view.viewportWidth + 1 || view.bottom > view.viewportHeight + 1) throw new Error('Fullscreen sizing failed: ' + JSON.stringify(view));
  }
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'output/playwright/2026-09-09-layout-options/effects-fullscreen-1512.png' });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.textContent === '全屏查看与切换');
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error('Horizontal overflow at ' + width);
  }
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.getByRole('button', { name: '返回视觉规范', exact: true }).click();
  await page.getByRole('button', { name: '布局方案对比', exact: true }).click();
  await page.getByRole('heading', { name: '三种更轻的创作布局' }).waitFor();
  await page.goto('http://127.0.0.1:4311/#/layouts/');
  await page.getByRole('heading', { name: '三种更轻的创作布局' }).waitFor();
  const devMedia = page.getByRole('main').getByRole('img', { name: /01 · 聚焦制作效果图/ });
  await devMedia.evaluate(async (image) => { await image.decode(); if (image.naturalWidth !== 1586) throw new Error('Development asset did not load'); });
  if (errors.length) throw new Error(errors.join('; '));
  return { evidence, fullscreenSwitching: true, fullscreenContainment: true, escapeAndFocusRestoration: true, responsiveNoOverflow: [1366, 390], designPageEntry: true, developmentAssetRoute: true, runtimeErrors: errors };
}
