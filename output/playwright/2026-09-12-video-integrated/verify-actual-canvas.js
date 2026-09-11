async (page) => {
  const tenant = "b128e444-cd57-4087-bcfe-c403051bbd8f",
    project = "ff8f70f2-8075-45de-b2bc-c54bd62e2653",
    scene = "4fae9756-c2c0-4062-8597-42c08f6e45c3",
    canvasId = "28fa7bf3-4b46-4160-820d-3165e97a1cb8";
  const base = `/v1/tenants/${tenant}`,
    path = `${base}/projects/${project}`;
  const title = "实际视频链路·固定窗光",
    prompt = "画布手工提示：保留窗边人物与冷色光线。";
  const errors = [],
    failures = [];
  let planPosts = 0,
    executePosts = 0,
    placementPosts = 0,
    entry,
    job,
    placement,
    key,
    executeDone,
    placementDone;
  const executeReceipt = new Promise((resolve) => {
    executeDone = resolve;
  });
  const placementReceipt = new Promise((resolve) => {
    placementDone = resolve;
  });
  const onError = (error) => errors.push(error.message);
  const onResponse = (response) => {
    if (response.status() >= 400 && response.url().includes("/v1/"))
      failures.push(response.status());
  };
  const read = (endpoint) =>
    page.evaluate(async (endpoint) => {
      const response = await fetch(endpoint);
      if (!response.ok) throw Error(`GET ${response.status}`);
      return response.json();
    }, endpoint);
  page.on("pageerror", onError);
  page.on("response", onResponse);
  try {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.reload();
    await page.getByRole("button", { name: "自由画布", exact: true }).click();
    const existing = (
      await read(`${path}/canvases/${canvasId}`)
    ).document.nodes.find((node) => node.title === title);
    if (existing)
      await page.locator(`.react-flow__node[data-id="${existing.id}"]`).click();
    else
      await page.getByRole("button", { name: "视频草稿", exact: true }).click();
    await page
      .getByRole("textbox", { name: "节点名称", exact: true })
      .fill(title);
    await page
      .getByRole("textbox", { name: "本次提示词", exact: true })
      .fill(prompt);
    await page
      .getByRole("button", { name: "画布生成与结果", exact: true })
      .click();
    const panel = page.locator('[aria-label="生成单段视频"]');
    await panel
      .getByRole("combobox", { name: "视频生成模型", exact: true })
      .click();
    if (
      await page
        .getByRole("option", {
          name: "本地测试适配器（无真实模型）",
          exact: false,
        })
        .count()
    )
      throw Error("Description-only capability offered for execution");
    await page
      .getByRole("option", {
        name: "本地视频归档测试（无真实模型） · 受控测试",
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "保存画布", exact: true }).click();
    await page.getByText(/画布 · 已保存/).waitFor();
    await page.route(
      `**${path}/scenes/${scene}/canvas/generation-plans`,
      async (route) => {
        planPosts++;
        const response = await route.fetch();
        if (response.status() !== 201)
          throw Error(`Canvas plan ${response.status()}`);
        entry = await response.json();
        console.log(
          JSON.stringify({
            stage: "canvas-plan",
            planId: entry.plan.id,
            nodeId: entry.origin.nodeId,
          }),
        );
        await route.fulfill({ response });
      },
    );
    await panel
      .getByRole("button", { name: "查看视频生成计划", exact: true })
      .click();
    await panel.getByText("固定视频计划", { exact: true }).waitFor();
    const saved = (await read(`${path}/scenes/${scene}/canvas`)).canvas;
    const node = saved.document.nodes.find((node) => node.title === title);
    if (
      !node ||
      entry.origin.canvasId !== canvasId ||
      entry.origin.nodeId !== node.id ||
      entry.origin.canvasRevision !== saved.revision ||
      entry.plan.input.prompt !== prompt ||
      entry.plan.resolvedInput.output.resolution !== "256x144" ||
      entry.plan.resolvedInput.output.durationSeconds !== 2 ||
      entry.plan.resolvedInput.output.withAudio !== false
    )
      throw Error("Plan does not fix saved canvas input");
    await page.route(`**${base}/generation-jobs`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      executePosts++;
      const response = await route.fetch();
      if (response.status() !== 202)
        throw Error(`Canvas execute ${response.status()}`);
      job = await response.json();
      console.log(
        JSON.stringify({
          stage: "canvas-executed",
          planId: entry.plan.id,
          jobId: job.id,
        }),
      );
      await route.abort("failed");
      executeDone();
    });
    await panel
      .getByRole("button", { name: "确认执行视频生成", exact: true })
      .click();
    await executeReceipt;
    await page.reload();
    await page
      .getByRole("button", { name: "画布生成与结果", exact: true })
      .click();
    await panel
      .getByText("视频结果已归档", { exact: true })
      .waitFor({ timeout: 60000 });
    if (await panel.locator("video").count())
      throw Error("Canvas result decoder mounted before preview");
    await panel.getByRole("button", { name: "预览视频", exact: true }).click();
    await panel.locator("video").waitFor();
    await panel.locator("video").evaluate(async (video) => {
      await video.play();
      if (!video.videoWidth) throw Error("Actual canvas video did not decode");
      video.pause();
    });
    await panel
      .getByRole("button", { name: "关闭视频预览", exact: true })
      .click();
    if (executePosts !== 1) throw Error("Reload submitted a second generation");
    await page.route(
      `**${path}/canvases/${canvasId}/results`,
      async (route) => {
        placementPosts++;
        const requestKey = route.request().headers()["idempotency-key"];
        if (key && requestKey !== key)
          throw Error("Placement request identity changed");
        key = requestKey;
        const response = await route.fetch();
        if (response.status() !== 201)
          throw Error(`Canvas result ${response.status()}`);
        const received = await response.json();
        if (placement && JSON.stringify(received) !== JSON.stringify(placement))
          throw Error("Placement receipt changed");
        placement = received;
        console.log(
          JSON.stringify({
            stage: "canvas-placement",
            jobId: job.id,
            placements: placement.placements,
            placementPosts,
          }),
        );
        if (placementPosts === 1) {
          await route.abort("failed");
          placementDone();
        } else await route.fulfill({ response });
      },
    );
    await panel
      .getByRole("button", { name: "查看添加到画布的位置", exact: true })
      .click();
    await page
      .getByRole("button", { name: "确认添加到画布", exact: true })
      .click();
    await placementReceipt;
    await page.reload();
    await page
      .getByRole("button", { name: "画布生成与结果", exact: true })
      .click();
    await panel.getByText("添加结果待核对", { exact: true }).waitFor();
    if (placementPosts !== 1 || executePosts !== 1)
      throw Error("Reload repeated a mutation");
    await panel
      .getByRole("button", { name: "恢复本次添加", exact: true })
      .click();
    await panel.getByText("已添加到画布", { exact: true }).waitFor();
    const media = await read(`${base}/media/${job.id}`);
    if (
      media.kind !== "video" ||
      media.hasAudio !== false ||
      media.status !== "ready" ||
      media.sourceJobId !== job.id
    )
      throw Error("Silent video identity mismatch");
    const after = await read(`${path}/canvases/${canvasId}`),
      resultId = placement.placements[0].nodeId;
    const resultNodes = after.document.nodes.filter(
      (item) => item.id === resultId,
    );
    if (
      placementPosts !== 2 ||
      planPosts !== 1 ||
      executePosts !== 1 ||
      resultNodes.length !== 1 ||
      resultNodes[0].content.type !== "media" ||
      !after.document.nodes.some(
        (item) => item.id === node.id && item.content.prompt === prompt,
      )
    )
      throw Error("Result duplicated or draft lost");
    await panel
      .getByRole("button", { name: "定位视频结果", exact: true })
      .click();
    const resultNode = page.locator(`.react-flow__node[data-id="${resultId}"]`);
    if (await resultNode.locator("video").count())
      throw Error("Board decoder mounted before preview");
    await resultNode
      .getByRole("button", { name: "播放预览", exact: true })
      .click();
    await resultNode.locator("video").waitFor();
    await resultNode.locator("video").evaluate(async (video) => {
      await video.play();
      if (!video.videoWidth) throw Error("Board video did not decode");
      video.pause();
    });
    await page.getByRole("button", { name: "适应内容", exact: true }).click();
    await page.screenshot({
      path: "output/playwright/2026-09-12-video-integrated/canvas-result.png",
      animations: "disabled",
    });
    await resultNode
      .getByRole("button", { name: "收起播放器", exact: true })
      .click();
    await page.locator(`.react-flow__node[data-id="${node.id}"]`).click();
    await page.getByRole("button", { name: "移除节点", exact: true }).click();
    await page.getByRole("button", { name: "保存画布", exact: true }).click();
    await page.getByText(/画布 · 已保存/).waitFor();
    const deleted = await read(`${path}/canvases/${canvasId}`);
    if (
      deleted.document.nodes.some((item) => item.id === node.id) ||
      !deleted.document.nodes.some((item) => item.id === resultId)
    )
      throw Error("Explicit source removal changed result");
    await page.reload();
    await page
      .getByRole("button", { name: "画布生成与结果", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "画布生成任务历史", exact: true })
      .selectOption(entry.plan.id);
    await panel
      .getByRole("button", { name: "打开所选的固定视频任务", exact: true })
      .click();
    await panel.getByRole("button", { name: "预览视频", exact: true }).click();
    await panel.locator("video").waitFor();
    await panel.locator("video").evaluate(async (video) => {
      await video.play();
      if (!video.videoWidth) throw Error("History video did not decode");
      video.pause();
    });
    await panel.locator("video").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "output/playwright/2026-09-12-video-integrated/deleted-source-history.png",
      animations: "disabled",
    });
    if (errors.length || failures.length)
      throw Error(`Browser failures ${JSON.stringify({ errors, failures })}`);
    return {
      actualApiDatabaseWorkerStorage: true,
      explicitTechnicalFixture: true,
      realModelAcceptance: false,
      planId: entry.plan.id,
      jobId: job.id,
      mediaId: placement.placements[0].mediaId,
      nodeId: node.id,
      resultId,
      planPosts,
      executePosts,
      placementPosts,
      lostExecute202Recovered: true,
      lostPlacement201Recovered: true,
      samePlacementKey: true,
      draftPreservedBeforeExplicitRemoval: true,
      deletedSourceHistoryRecovered: true,
      canvasResultDecoded: true,
      video: {
        width: media.width,
        height: media.height,
        durationUs: media.durationUs,
        fpsNum: media.fpsNum,
        fpsDen: media.fpsDen,
        hasAudio: media.hasAudio,
      },
      errors,
      failures,
    };
  } finally {
    await page.unroute(`**${path}/scenes/${scene}/canvas/generation-plans`);
    await page.unroute(`**${base}/generation-jobs`);
    await page.unroute(`**${path}/canvases/${canvasId}/results`);
    page.off("pageerror", onError);
    page.off("response", onResponse);
  }
}
