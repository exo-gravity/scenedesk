async (page) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto('http://127.0.0.1:4311/#/app/t/b128e444-cd57-4087-bcfe-c403051bbd8f/p/ff8f70f2-8075-45de-b2bc-c54bd62e2653/content');
  await page.reload();
  await page.getByRole('button', { name: '剧本与历史', exact: true }).waitFor();
  await page.getByRole('button', { name: '新建单集', exact: true }).waitFor();
  const navigation = await page.getByRole('complementary', { name: '工作室导航' }).innerText();
  if (/成员与设置|新建工作室|费用|运营/.test(navigation)) throw Error('deferred navigation returned');
  if (await page.getByRole('button', { name: '分工与任务', exact: true }).count()) throw Error('deferred task entry returned');
  const body = await page.locator('body').innerText();
  if (!body.includes('本地测试身份')) throw Error('local identity boundary missing');
  const health = await page.request.get('http://127.0.0.1:4311/health/ready');
  const readiness = await health.json();
  if (!readiness.businessReady || readiness.completeMvp !== false) throw Error('readiness boundary changed');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow || errors.length) throw Error(JSON.stringify({overflow,errors}));
  await page.screenshot({ path: 'output/playwright/2026-09-12-private-trial/ready-desktop.png' });
  return { localBusinessReady: true, completeMvp: false, localTestIdentityLabel: true, privateNavigation: true, viewport: 1512, overflow, pageErrors: errors, mutationsRequestedByScript: 0 };
}
