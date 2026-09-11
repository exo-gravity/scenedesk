async (page) => {
  const tenantId = 'b128e444-cd57-4087-bcfe-c403051bbd8f';
  const path = `http://127.0.0.1:4311/v1/tenants/${tenantId}/projects`;
  const name = await page.getByRole('textbox', { name: '项目名称', exact: true }).inputValue();
  const received = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.unroute(path);
  await page.route(path, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const request = route.request(), response = await route.fetch();
    if (response.status() !== 201) throw Error(`actual recovery returned ${response.status()}`);
    const project = await response.json();
    received.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'], projectId: project.id });
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '恢复项目创建记录', exact: true }).click();
  await page.getByRole('button', { name: '恢复原项目创建请求', exact: true }).click();
  await page.getByRole('heading', { name, exact: true }).waitFor();
  if (received.length !== 1) throw Error('recovery must explicitly send once');
  const projectId = received[0].projectId;
  if (!page.url().endsWith(`/p/${projectId}/content`)) throw Error('wrong recovered project navigation');
  const projectResponse = await page.request.get(`${path}/${projectId}`);
  if (projectResponse.status() !== 200) throw Error('created project cannot be read');
  const project = await projectResponse.json();
  if (project.name !== name || project.status !== 'active' || project.revision !== 1)
    throw Error('recovered project representation changed');
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.screenshot({ path: 'output/playwright/2026-09-12-project-creation-integrated/recovered-desktop.png' });
  // Archive only this newly created technical fixture, through the actual UI.
  await page.getByRole('link', { name: '项目设定', exact: true }).click();
  await page.getByRole('button', { name: '归档项目', exact: true }).click();
  await page.getByRole('button', { name: '确认归档', exact: true }).click();
  await page.getByRole('button', { name: '恢复项目', exact: true }).waitFor();
  await page.getByRole('link', { name: '工作室项目', exact: true }).click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByText('本标签页的项目草稿已保留；创建需明确提交。', { exact: true }).waitFor();
  if (await page.getByRole('textbox', { name: '项目名称', exact: true }).inputValue() !== '')
    throw Error('completed creation restored an old request');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  if (received.length !== 1 || errors.length) throw Error(JSON.stringify({ received, errors }));
  await page.unroute(path);
  await page.goto(`http://127.0.0.1:4311/#/app/t/${tenantId}/p/ff8f70f2-8075-45de-b2bc-c54bd62e2653/content`);
  await page.getByRole('button', { name: '剧本与历史', exact: true }).waitFor();
  return { tenantId, request: received[0], explicitRecoveryPosts: 1, reopenedFormEmpty: true, fixtureArchived: true, originalTrialProjectRestored: true, pageErrors: errors };
}
