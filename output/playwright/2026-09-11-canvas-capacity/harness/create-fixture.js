async (page) => {
  await page.goto('http://127.0.0.1:4311/#/app');
  const result = await page.evaluate(async () => {
    const json = async (path, options = {}) => {
      const response = await fetch(path, { cache: 'no-store', ...options });
      const body = await response.json();
      if (!response.ok) throw new Error(`${path}: ${response.status} ${body.code} ${body.message}`);
      return body;
    };
    const session = await json('/v1/session');
    const tenants = await json('/v1/tenants?limit=100');
    const tenant = tenants.items[0];
    const tenantPath = `/v1/tenants/${tenant.id}`;
    const members = await json(tenantPath + '/members?limit=100');
    const own = members.items.find(member => member.userId === session.userId);
    const command = (path, method, body, revision) => json(path, { method, headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(revision === undefined ? {} : { 'If-Match': `"${revision}"` }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const project = await command(tenantPath + '/projects', 'POST', { name: '画布容量技术夹具 ' + Date.now(), leadMembershipId: own.id, spec: { width: 1920, height: 1080, fpsNum: 24, fpsDen: 1, language: 'zh-CN' } });
    const path = tenantPath + '/projects/' + project.id;
    const revision = async () => (await json(path + '/content')).revision;
    const episode = await command(path + '/episodes', 'POST', { title: '容量技术验证', position: 0, status: 'active' }, await revision());
    const scenarios = [];
    for (const [nodeCount, edgeCount] of [[300, 500], [2000, 5000]]) {
      const scene = await command(path + '/scenes', 'POST', { episodeId: episode.id, title: `${nodeCount}节点/${edgeCount}引用`, position: scenarios.length, summary: '仅技术测量，不是实际创作项目或模型输出。', state: {}, status: 'active' }, await revision());
      const canvas = (await command(path + '/scenes/' + scene.id + '/canvas', 'POST')).canvas;
      scenarios.push({ nodeCount, edgeCount, sceneId: scene.id, canvasId: canvas.id });
    }
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d'); context.fillStyle = '#495057'; context.fillRect(0, 0, 320, 180); context.fillStyle = '#ced4da'; context.fillRect(24, 24, 160, 100);
    const poster = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const chunks = [], stream = canvas.captureStream(10), recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const recording = new Promise(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' })); });
    recorder.start();
    for (let i = 0; i < 10; i++) { context.fillStyle = '#495057'; context.fillRect(0, 0, 320, 180); context.fillStyle = '#ced4da'; context.fillRect(24 + i * 4, 24, 160, 100); await new Promise(resolve => setTimeout(resolve, 100)); }
    recorder.stop(); const video = await recording; stream.getTracks().forEach(track => track.stop());
    const wav = new ArrayBuffer(44 + 48000 * 2), view = new DataView(wav);
    const word = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    word(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 48000, true); view.setUint32(28, 96000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, wav.byteLength - 44, true);
    for (let i = 0; i < 48000; i++) view.setInt16(44 + i * 2, Math.sin(i * Math.PI * 440 / 48000) * 1200, true);
    const imports = [];
    for (const [name, blob] of [['capacity-poster.png', poster], ['capacity-motion.webm', video], ['capacity-tone.wav', new Blob([wav], { type: 'audio/wav' })]]) {
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      const declaration = { scope: 'project', projectId: project.id, fileName: name, displayName: name, mime: blob.type, bytes: blob.size, sha256 };
      const intent = await command(tenantPath + '/uploads', 'POST', declaration);
      const grant = await json(tenantPath + '/uploads/' + intent.id);
      const form = new FormData(); for (const [key, value] of Object.entries(grant.formFields)) form.append(key, value);
      form.append('file', blob, name);
      const transfer = await fetch(grant.uploadUrl, { method: 'POST', body: form });
      if (!transfer.ok) throw new Error('Fixture transfer failed: ' + transfer.status);
      await command(tenantPath + '/uploads/' + intent.id + '/complete', 'POST', { bytes: blob.size, sha256 });
      imports.push({ fileName: name, intentId: intent.id, bytes: blob.size });
    }
    return { tenantId: tenant.id, projectId: project.id, episodeId: episode.id, scenarios, imports };
  });
  return result;
}
