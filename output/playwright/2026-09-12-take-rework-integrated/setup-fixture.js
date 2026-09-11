async (page) => {
  // Setup uses real authenticated APIs and a previously archived local video
  // fixture. The changed shot is isolated from the original trial shot.
  return await page.evaluate(async () => {
    const tenantId = "b128e444-cd57-4087-bcfe-c403051bbd8f";
    const projectId = "ff8f70f2-8075-45de-b2bc-c54bd62e2653";
    const sceneId = "4fae9756-c2c0-4062-8597-42c08f6e45c3";
    const mediaId = "f7807eec-fe1b-4243-987f-0fda188d7e26";
    const base = `/v1/tenants/${tenantId}`;
    const path = `${base}/projects/${projectId}`;
    const label = "候选意见验收 · 独立技术夹具";
    const read = async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw Error(`Setup GET ${response.status}`);
      return response.json();
    };
    const session = await read("/v1/session");
    const write = async (url, method, body, version, key) => {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": key,
          ...(version ? { "If-Match": `"${version}"` } : {}),
        },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(`Setup ${method} ${response.status}: ${result.code}`);
      return result;
    };
    const media = await read(`${base}/media/${mediaId}`);
    if (media.kind !== "video" || media.status !== "ready" || media.durationUs < 1250000)
      throw Error("Expected actual local video fixture unavailable");
    const before = await read(`${path}/content`);
    const originalShot = before.shots.find((shot) => shot.id === "a9f4d414-2467-43bb-a56d-4be7fe13e651");
    let shot = before.shots.find((item) => item.label === label);
    if (!shot)
      shot = await write(`${path}/shots`, "POST", {
        sceneId, label, position: 1, status: "active",
        spec: { intent: "技术夹具原要求：保留停顿，再看向门口。", action: "旧候选的固定要求。", references: [] },
      }, before.revision, "b45bdb2d-6e0c-4077-921f-c47b5169dc12");
    const takes = await read(`${path}/takes?shotId=${shot.id}`);
    let take = takes.items.find((item) => item.mediaId === mediaId);
    if (!take)
      take = await write(`${path}/takes`, "POST", {
        shotId: shot.id, shotRevisionId: shot.specRevisionId, mediaId,
        range: { inUs: 250000, outUs: 1250000 },
        note: "仅作候选意见与修改建议的真实持久化验收。无真实模型。",
      }, undefined, "e9d4031c-1a2b-45b7-a3bc-de674b6fe3f7");
    if (shot.specRevisionId === take.shotRevisionId)
      shot = await write(`${path}/shots/${shot.id}`, "PUT", {
        sceneId, label, position: 1, status: "active",
        spec: { intent: "技术夹具新要求：先拍空门口。", action: "此新要求不得覆盖旧候选输入。", references: [] },
      }, shot.revision, "5ee78da8-d6ce-48a7-881f-ff45e1956fc6");
    const after = await read(`${path}/content`);
    if (JSON.stringify(after.shots.find((s) => s.id === originalShot.id)) !== JSON.stringify(originalShot))
      throw Error("Original trial shot changed during isolated fixture setup");
    if (shot.specRevisionId === take.shotRevisionId || shot.currentTakeId)
      throw Error("Fixture must retain an unadopted candidate against older shot requirements");
    return {
      explicitTechnicalFixture: true, actualApi: true, tenantId, projectId,
      sceneId, mediaId, shotId: shot.id, takeId: take.id,
      takeShotRevisionId: take.shotRevisionId,
      latestShotRevisionId: shot.specRevisionId, range: take.range,
      originalTrialShotUnchanged: true,
      href: `http://127.0.0.1:4311/#/app/t/${tenantId}/p/${projectId}/production?scene=${sceneId}&shot=${shot.id}&take=${take.id}&mode=storyboard`,
    };
  });
}
