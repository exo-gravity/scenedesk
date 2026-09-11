async (page) => {
  page.setDefaultTimeout(15000);
  const tenant = 'b128e444-cd57-4087-bcfe-c403051bbd8f', project = '1498c59a-a789-4087-8069-4c99ebcbd63f';
  const scene = '56d6d043-dce7-4151-8718-be664965b7ba', sourceCut = '0f0c05b3-d322-45a8-b6f0-843cd81abfc3';
  const path = `/v1/tenants/${tenant}/projects/${project}`, base = `http://127.0.0.1:4311/#/app/t/${tenant}/p/${project}`;
  const ok = (v, m) => { if (!v) throw new Error(m); };
  await page.goto(`${base}/content`); await page.reload(); await page.setViewportSize({ width: 1366, height: 900 });
  const request = (method, url, body, version, peer = false) => page.evaluate(async ({ method, url, body, version, peer }) => {
    const session = await (await fetch('/v1/session')).json();
    const response = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken, 'idempotency-key': crypto.randomUUID(), ...(version === undefined ? {} : { 'if-match': `"${version}"` }), ...(peer ? { 'x-test-peer': 'true' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`${method} ${response.status} ${JSON.stringify(await response.json())}`);
    return response.json();
  }, { method, url, body, version, peer });
  const read = url => request('GET', url);
  const until = async (check, m) => { const start = Date.now(); while (!await check()) { if (Date.now() - start > 15000) throw new Error(m); await page.waitForTimeout(100); } };
  const template = (await read(`${path}/cuts/${sourceCut}/work-draft`)).document;
  const cut = await request('POST', `${path}/cuts`, { sceneId: scene, name: `历史取回技术验收 ${Date.now()}` });
  const workPath = `${path}/cuts/${cut.id}/work-draft`, route = `${base}/editing?scene=${scene}&cut=${cut.id}`;
  let work = await read(workPath), first, last;
  for (let i = 1; i <= 34; i++) {
    const document = JSON.parse(JSON.stringify(template));
    document.timeline.tracks.find(t => t.kind === 'subtitle').items[0].text = `历史取回技术文字 ${i}`;
    work = await request('PUT', workPath, { baseCutRevision: 1, document }, work.revision);
    if (i === 1) first = work;
    last = work;
  }
  const errors = [], capture = e => errors.push(e.message); page.on('pageerror', capture);
  const selectHistory = async number => {
    await page.getByRole('combobox', { name: '保留版本', exact: true }).click();
    await page.getByRole('option').filter({ hasText: new RegExp(`^r${number} ·`) }).click();
    await page.getByText(`r${number} · 3 条轨道 · 3 个片段`, { exact: true }).waitFor();
  };
  const confirm = page.getByRole('checkbox', { name: '以此历史替换当前本机工作内容，再作为新修改保存', exact: true });
  try {
    await page.goto(route);
    await page.getByRole('button', { name: '恢复历史', exact: true }).click();
    await page.getByRole('button', { name: '加载更早的保留历史', exact: true }).click();
    await selectHistory(1);
    await confirm.check();
    const refreshed = page.waitForResponse(r => r.url().endsWith(workPath) && r.request().method() === 'GET');
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await refreshed;
    await page.waitForTimeout(100);
    ok(await confirm.isChecked(), 'an unchanged authorized refresh invalidated restore consent');
    await page.getByRole('navigation', { name: '剪辑轨道与片段' }).getByRole('checkbox', { name: '整轨静音／隐藏', exact: true }).first().check();
    await page.getByRole('alert', { name: '取回确认已失效', exact: true }).waitFor();
    ok(!await confirm.isChecked() && await page.getByRole('button', { name: '取回 r1 的内容', exact: true }).isDisabled(), 'stale restore consent survived new local edits');
    await until(async () => (await read(workPath)).revision === 35, 'new local track setting did not save');
    ok((await read(workPath)).document.timeline.tracks[0].muted, 'stale confirmation discarded newer local setting');
    await page.screenshot({ path: 'output/playwright/editing-work/06-history-confirmation.png' });
    await confirm.check();
    await page.getByRole('button', { name: '取回 r1 的内容', exact: true }).click();
    await until(async () => (await read(workPath)).revision === 36, 'history restore did not append');
    work = await read(workPath);
    ok(JSON.stringify(work.document) === JSON.stringify(first.document), 'restore changed historical body');
    ok((await read(`${path}/cuts/${cut.id}`)).revision === 1, 'history restore rewound confirmed Cut');
    ok((await read(`${workPath}/revisions/35`)).document.timeline.tracks[0].muted, 'pre-restore body was overwritten');
    // The server commits once, then the actual browser loses the receipt.
    let lostWrites = 0;
    const drop = async route => {
      if (route.request().method() === 'PUT') { lostWrites++; await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    };
    await page.route(`**${workPath}`, drop);
    try {
      await selectHistory(34); await confirm.check();
      await page.getByRole('button', { name: '取回 r34 的内容', exact: true }).click();
      await until(async () => (await read(workPath)).revision === 37, 'lost restore did not actually commit');
      await page.getByText('工作稿已保存', { exact: true }).waitFor();
      ok(lostWrites === 1 && JSON.stringify((await read(workPath)).document) === JSON.stringify(last.document), 'unknown restore duplicated or lost body');
    } finally { await page.unroute(`**${workPath}`, drop); }
    // A peer writes after the restore request is fixed but before it reaches CAS.
    let release, arrived, intercepted = false, statuses = [];
    const gate = new Promise(resolve => { release = resolve; }), waiting = new Promise(resolve => { arrived = resolve; });
    const hold = async route => {
      if (route.request().method() === 'PUT' && !route.request().headers()['x-test-peer'] && !intercepted) { intercepted = true; arrived(); await gate; }
      await route.continue();
    };
    const response = r => { if (r.request().method() === 'PUT' && r.url().endsWith(workPath)) statuses.push(r.status()); };
    page.on('response', response); await page.route(`**${workPath}`, hold);
    try {
      await selectHistory(1); await confirm.check();
      await page.getByRole('button', { name: '取回 r1 的内容', exact: true }).click(); await waiting;
      const current = await read(workPath), document = JSON.parse(JSON.stringify(current.document));
      document.timeline.tracks[0].items[0].gainDb = -6;
      const subtitle = document.timeline.tracks.find(t => t.kind === 'subtitle').items[0]; subtitle.text = '同伴在历史取回期间改写';
      const peer = await request('PUT', workPath, { baseCutRevision: current.baseCutRevision, document }, current.revision, true);
      release();
      await page.getByText(`比较工作稿 · 本机基线 r37 / 服务器 r${peer.revision}`, { exact: true }).waitFor();
      ok(statuses.includes(412), 'history restore did not meet actual CAS');
      await page.getByRole('checkbox', { name: `片段 · ${subtitle.id.slice(0, 8)} · 同伴也有修改：重放我的变化`, exact: true }).check();
      await page.getByRole('button', { name: '按以上选择继续工作稿', exact: true }).click();
      await page.getByText('工作稿已保存', { exact: true }).waitFor();
      work = await read(workPath);
      ok(work.document.timeline.tracks.find(t => t.kind === 'subtitle').items[0].text === '历史取回技术文字 1' && work.document.timeline.tracks[0].items[0].gainDb === -6, 'history conflict lost selected restore or peer gain');
    } finally { release(); await page.unroute(`**${workPath}`, hold); page.off('response', response); }
    await page.reload();
    await page.getByText('工作稿已保存', { exact: true }).waitFor();
    ok((await read(workPath)).revision === 39 && (await read(`${workPath}/revisions/1`)).document.timeline.tracks.find(t => t.kind === 'subtitle').items[0].text === '历史取回技术文字 1', 'reload or history rewrote immutable versions');
    ok(errors.length === 0, errors.join('; '));
    return { productionBuild: true, cutId: cut.id, workRevision: 39, historyPagination: true, stableRefreshRetainsConsent: true, staleConsentRejected: true, actualRestoreAppend: true, cutRevision: 1, lostReceiptResolvedWithoutSecondPut: true, actualHistoryCAS412: true, peerGainPreserved: true, refreshAndImmutableHistory: true, pageErrors: errors.length };
  } finally { page.off('pageerror', capture); }
}
