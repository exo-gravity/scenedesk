async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4314/');
  const frame = page.frames().find(item => item.parentFrame());
  await frame.locator('#scene-layout-options').waitFor();
  await frame.evaluate(() => {
    globalThis.Tweak = class {
      constructor({ onChange }) { this.onChange = onChange; globalThis.layoutProbe = this; }
      addSelect(state, property, options) { this.state = state; this.property = property; this.options = options.options; }
      addToggle() {}
    };
    const root = document.getElementById('scene-layout-options');
    root.replaceWith(root.cloneNode(true));
    const source = [...document.scripts].find(script => script.textContent.includes("const root = document.getElementById('scene-layout-options')"));
    (0, eval)(source.textContent);
  });
  const checks = [];
  for (const width of [1056, 768, 392, 352]) {
    await page.setViewportSize({ width, height: 1400 });
    for (const layout of ['overview', 'focus', 'canvas', 'chat']) {
      await frame.evaluate(value => {
        globalThis.layoutProbe.state.layout = value;
        globalThis.layoutProbe.onChange();
      }, layout);
      await page.waitForTimeout(70);
      const measure = await frame.evaluate(() => {
        const root = document.getElementById('scene-layout-options');
        return { width: innerWidth, scroll: document.documentElement.scrollWidth, sections: [...root.querySelectorAll('main > section')].filter(el => !el.hidden).length };
      });
      if (measure.scroll > measure.width + 1 || measure.sections !== 1) throw new Error(JSON.stringify({ layout, measure }));
      checks.push({ layout, width: measure.width, overflow: false });
      if (width === 1056) await frame.locator('#scene-layout-options').screenshot({ path: 'output/playwright/2026-09-09-layout-options/' + layout + '-1024.png' });
    }
  }
  await frame.getByRole('button', { name: '在画布查看生成方案 →' }).click();
  if (!(await frame.locator('#pc-chat-plan-detail').isVisible())) throw new Error('Chat to canvas selection did not update');
  await frame.evaluate(() => { globalThis.layoutProbe.state.layout = 'focus'; globalThis.layoutProbe.onChange(); });
  await frame.locator('#pc-candidate-row [data-pc-candidate="A"]').click();
  if (!(await frame.locator('[data-pc-viewing]').textContent()).includes('A · 已采用')) throw new Error('Candidate selection did not update');
  if (errors.length) throw new Error(errors.join('; '));
  return { checks, interactions: ['chat locates proposal on canvas', 'candidate selection updates preview'], runtimeErrors: errors };
}
