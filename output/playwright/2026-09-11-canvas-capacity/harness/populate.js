async (page) => {
  const fixture = __FIXTURE__;
  return await page.evaluate(async ({ fixture, count }) => {
    const json = async (path, options = {}) => { const response = await fetch(path, { cache: 'no-store', ...options }); const body = await response.json(); if (!response.ok) throw new Error(path + ': ' + response.status + ' ' + body.code); return body; };
    const session = await json('/v1/session');
    const tenantPath = '/v1/tenants/' + fixture.tenantId;
    const path = tenantPath + '/projects/' + fixture.projectId;
    const media = [];
    for (const upload of fixture.imports) {
      const intent = await json(tenantPath + '/uploads/' + upload.intentId);
      if (intent.status !== 'accepted') throw new Error('Fixture media is not ready: ' + upload.fileName + ' ' + intent.status + ' ' + JSON.stringify(intent.issue));
      const item = await json(tenantPath + '/media/' + intent.mediaId);
      media.push({ id: item.id, kind: item.kind, status: item.status, derivatives: item.derivatives.map(d => ({ kind: d.kind, status: d.status })), bytes: upload.bytes });
    }
    const scenario = fixture.scenarios.find(s => s.nodeCount === count), halves = count / 2;
    const groups = Array.from({ length: count / 10 }, (_, index) => ({ id: crypto.randomUUID(), title: `技术分组 ${index + 1}` }));
    const nodes = Array.from({ length: count }, (_, index) => {
      const source = index % 2 === 0, ordinal = Math.floor(index / 2);
      const asset = source && ordinal % 20 === 0 ? media[Math.floor(ordinal / 20) % media.length] : undefined;
      return { id: crypto.randomUUID(), title: `CAP${String(index + 1).padStart(4, '0')} ${asset ? asset.kind + '素材' : source ? '文字来源' : '创作草稿'}`, kind: asset?.kind ?? (source ? 'text' : ['image', 'video', 'audio'][ordinal % 3]), width: 320, position: { x: (index % 20) * 380, y: Math.floor(index / 20) * 280 }, groupId: groups[Math.floor(index / 10)].id, content: asset ? { type: 'media', mediaId: asset.id } : source ? { type: 'text', text: '容量技术夹具：参考空间、角色动作与画面关系。保留固定来源，先编辑和保存，再明确执行。\n'.repeat(3) } : { type: 'draft', prompt: '容量技术夹具：保持固定参考，根据当前场次准备新尝试；此处不是已经生成的媒体。'.repeat(2), output: {} } };
    });
    const edges = Array.from({ length: scenario.edgeCount }, (_, index) => { const target = index % halves, order = Math.floor(index / halves), source = nodes[2 * ((target + order * 7) % halves)]; return { id: crypto.randomUUID(), sourceNodeId: source.id, targetNodeId: nodes[target * 2 + 1].id, enabled: true, position: order, purpose: source.kind === 'text' ? 'prompt' : source.kind === 'audio' ? 'voice' : 'composition' }; });
    const canvas = await json(path + '/canvases/' + scenario.canvasId);
    const envelope = { schemaVersion: 1, document: { nodes, edges, groups } };
    const body = JSON.stringify(envelope), start = performance.now();
    const saved = await json(path + '/canvases/' + scenario.canvasId, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken, 'If-Match': `"${canvas.revision}"` }, body });
    const saveDurationMs = performance.now() - start;
    const preferencePath = path + '/scenes/' + scenario.sceneId + '/workspace-preference';
    const preference = await json(preferencePath);
    await json(preferencePath, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken, 'If-Match': `"${preference.revision}"` }, body: JSON.stringify({ mode: 'canvas', selectedShotId: null, selectedNodeIds: [], viewport: { x: 32, y: 32, zoom: 0.8 }, assetPanelOpen: false, assistantOpen: false }) });
    return { ...scenario, projectId: fixture.projectId, tenantId: fixture.tenantId, nodeCount: saved.document.nodes.length, edgeCount: saved.document.edges.length, groupCount: saved.document.groups.length, bodyBytes: new TextEncoder().encode(body).length, saveDurationMs, media, firstNodeIds: nodes.slice(0, 10).map(node => node.id), sourceTextId: nodes[2].id, imageNodeId: nodes[0].id, videoNodeId: nodes[40].id, audioNodeId: nodes[80].id, lastNodeId: nodes.at(-1).id };
  }, { fixture, count: __COUNT__ });
}
