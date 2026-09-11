async (page) => {
  page.setDefaultTimeout(15000);
  const tenant = 'b128e444-cd57-4087-bcfe-c403051bbd8f', project = '1498c59a-a789-4087-8069-4c99ebcbd63f', scene = 'd106e167-dc0b-40c3-abe1-0a77e83355c9';
  const cut = '1c801df8-d048-4749-994b-7fbc60f2242e', path = `/v1/tenants/${tenant}/projects/${project}/cuts/${cut}/work-draft`;
  const base = `http://127.0.0.1:4311/#/app/t/${tenant}/p/${project}/editing?scene=${scene}&cut=${cut}`;
  const ok = (v, message) => { if (!v) throw new Error(message); };
  const localText = `本机核对后重写的字幕 ${Date.now()}`;
  await page.goto(base); await page.reload();
  const read = () => page.evaluate(async path => { const response = await fetch(path); if (!response.ok) throw new Error(`read ${response.status}`); return response.json(); }, path);
  const original = await read(), originalSubtitle = original.document.timeline.tracks.find(t => t.kind === 'subtitle').items[0];
  await page.goto(`${base}&clip=${originalSubtitle.id}`);
  const restore = page.getByRole('button', { name: '恢复并核对本机工作', exact: true });
  await page.getByRole('button', { name: '片段设置', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '字幕文字', exact: true });
  await editor.waitFor();
  if (await restore.isVisible()) await restore.click();
  let held, release, intercepted = false, statuses = [];
  const arrived = new Promise(resolve => { held = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const route = async request => {
    if (request.request().method() === 'PUT' && !request.request().headers()['x-test-peer'] && !intercepted) { intercepted = true; held(); await gate; }
    await request.continue();
  };
  const onResponse = r => { if (r.request().method() === 'PUT' && r.url().endsWith(path)) statuses.push(r.status()); };
  page.on('response', onResponse);
  await page.route(`**${path}`, route);
  try {
    await editor.fill(localText);
    await arrived;
    const peer = await page.evaluate(async ({ path, subtitleId }) => {
      const session = await (await fetch('/v1/session')).json(), current = await (await fetch(path)).json();
      const document = structuredClone(current.document);
      document.timeline.tracks.find(t => t.kind === 'video').items[0].gainDb = -3;
      const track = document.timeline.tracks.find(t => t.kind === 'subtitle');
      track.items.find(c => c.id === subtitleId).text = '同伴也修改了这条字幕';
      const added = { ...track.items[0], id: crypto.randomUUID(), text: '同伴独立增加的字幕', timelineStartUs: 1100000, durationUs: 100000 };
      track.items.push(added);
      const response = await fetch(path, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken, 'if-match': `"${current.revision}"`, 'x-test-peer': 'true' }, body: JSON.stringify({ baseCutRevision: current.baseCutRevision, document }) });
      if (!response.ok) throw new Error(`peer ${response.status}`);
      return { revision: (await response.json()).revision, addedId: added.id };
    }, { path, subtitleId: originalSubtitle.id });
    release();
    await page.getByText(`比较工作稿 · 本机基线 r${original.revision} / 服务器 r${peer.revision}`, { exact: true }).waitFor();
    await page.getByRole('checkbox', { name: `片段 · ${originalSubtitle.id.slice(0, 8)} · 同伴也有修改：重放我的变化`, exact: true }).check();
    await page.screenshot({ path: 'output/playwright/editing-work/03-work-conflict.png' });
    await page.getByRole('button', { name: '按以上选择继续工作稿', exact: true }).click();
    await page.getByText('工作稿已保存', { exact: true }).waitFor();
    const result = await read(), subtitles = result.document.timeline.tracks.find(t => t.kind === 'subtitle').items;
    ok(statuses.includes(412), 'browser did not meet actual API CAS conflict');
    ok(subtitles.find(c => c.id === originalSubtitle.id).text === localText, 'selected local clip not replayed');
    ok(subtitles.find(c => c.id === peer.addedId).text === '同伴独立增加的字幕' && result.document.timeline.tracks[0].items[0].gainDb === -3, 'unselected peer edits were overwritten');
    return { actualCAS412: true, peerRevision: peer.revision, mergedRevision: result.revision, explicitLocalReplay: true, unselectedPeerEditsRetained: true };
  } finally { release(); await page.unroute(`**${path}`, route); page.off('response', onResponse); }
}
