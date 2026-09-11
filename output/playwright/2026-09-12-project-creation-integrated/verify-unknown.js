async (page) => {
  const tenantId = 'b128e444-cd57-4087-bcfe-c403051bbd8f';
  const path = `http://127.0.0.1:4311/v1/tenants/${tenantId}/projects`;
  const name = `项目恢复实际验收 ${Date.now()}`;
  const errors = [];
  const received = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto(`http://127.0.0.1:4311/#/app/t/${tenantId}`);
  await page.reload();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill(name);
  await page.getByText('本标签页的项目草稿已保留；创建需明确提交。', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.reload();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('button', { name: '恢复项目创建记录', exact: true }).waitFor();
  if (await page.getByRole('textbox', { name: '项目名称', exact: true }).inputValue() !== name)
    throw Error('unsubmitted fields did not survive close and reload');
  await page.getByRole('button', { name: '恢复项目创建记录', exact: true }).click();
  await page.route(path, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const request = route.request();
    const response = await route.fetch();
    if (response.status() !== 201) throw Error(`actual create returned ${response.status()}`);
    const project = await response.json();
    received.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'], projectId: project.id });
    if (received.length !== 1) throw Error('unexpected automatic project submission');
    await route.abort('failed');
  });
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await page.getByRole('button', { name: '恢复原项目创建请求', exact: true }).waitFor();
  await page.getByText('连接中断，创建结果尚未确认。请保留并恢复原请求。', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('button', { name: '恢复项目创建记录', exact: true }).waitFor();
  if (received.length !== 1 || errors.length) throw Error(JSON.stringify({ received, errors }));
  if (await page.getByRole('textbox', { name: '项目名称', exact: true }).inputValue() !== name)
    throw Error('unknown original input missing');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw Error('desktop overflow');
  await page.screenshot({ path: 'output/playwright/2026-09-12-project-creation-integrated/unknown-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const narrowOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (narrowOverflow) throw Error('390px overflow');
  await page.screenshot({ path: 'output/playwright/2026-09-12-project-creation-integrated/unknown-mobile.png' });
  return { tenantId, name, request: received[0], actualCreatedProjects: 1, refreshAutomaticPosts: 0, draftPreserved: true, overflow, narrowOverflow, pageErrors: errors };
}
