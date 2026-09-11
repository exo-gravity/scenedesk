async (page) => {
  // Run after verify-controlled-image.js in the same controlled browser session.
  await page.getByRole('button', { name: '自由画布', exact: true }).click();
  const node = page.locator('.react-flow__node').filter({ hasText: '已归档图片结果' });
  await node.locator('img').waitFor();
  await node.locator('img').evaluate(img => {
    if (!img.complete || !img.naturalWidth) throw Error('Original fallback did not decode');
  });
  await page.getByRole('application').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/playwright/2026-09-11-image-generation/canvas-original-fallback.png', fullPage: false, animations: 'disabled' });
  return { readyOriginal: true, posterAbsent: true, canvasNodeDecoded: true };
}
