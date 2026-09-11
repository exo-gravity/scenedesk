async (page) => {
  const tenant = "b128e444-cd57-4087-bcfe-c403051bbd8f";
  const project = "ff8f70f2-8075-45de-b2bc-c54bd62e2653";
  const shotId = "a9f4d414-2467-43bb-a56d-4be7fe13e651";
  const base = `/v1/tenants/${tenant}`,
    path = `${base}/projects/${project}`;
  const errors = [],
    serverErrors = [];
  let plan,
    job,
    planPosts = 0,
    executePosts = 0,
    done;
  const receipt = new Promise((resolve) => {
    done = resolve;
  });
  const onError = (error) => errors.push(error.message);
  const onResponse = (response) => {
    if (response.status() >= 500 && response.url().includes("/v1/"))
      serverErrors.push(response.status());
  };
  const onRequest = (request) => {
    if (request.method() !== "POST") return;
    if (request.url().endsWith(`${base}/generation-plans`)) planPosts++;
    if (request.url().endsWith(`${base}/generation-jobs`)) executePosts++;
  };
  page.on("pageerror", onError);
  page.on("response", onResponse);
  page.on("request", onRequest);
  const read = (endpoint) =>
    page.evaluate(async (endpoint) => {
      const response = await fetch(endpoint);
      if (!response.ok) throw Error(`Read failed ${response.status}`);
      return response.json();
    }, endpoint);
  try {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.reload();
    const close = page.getByRole("button", { name: "收起", exact: true });
    if (await close.isVisible()) await close.click();
    const composer = page.locator('[aria-label="本次创作输入"]');
    const prompt = composer.getByRole("textbox", {
      name: "本次提示",
      exact: true,
    });
    await prompt.waitFor();
    const manual = await prompt.inputValue();
    if (!manual.includes("人工修订建议"))
      throw Error("Existing explicit advice input missing");
    const before = await read(`${path}/content`);
    const shot = before.shots.find((item) => item.id === shotId);
    await composer
      .getByRole("button", { name: "生成图片", exact: true })
      .click();
    const panel = composer.locator('[aria-label="生成单张图片"]');
    await panel
      .getByRole("combobox", { name: "图片生成模型", exact: true })
      .click();
    await page
      .getByRole("option", {
        name: "本地图片归档测试（无真实模型） · 受控测试",
        exact: true,
      })
      .click();
    await page.route(`**${base}/generation-plans`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      if (response.status() !== 201)
        throw Error(`Plan failed ${response.status()}`);
      plan = await response.json();
      await route.fulfill({ response });
    });
    await panel
      .getByRole("button", { name: "查看图片生成计划", exact: true })
      .click();
    await panel.getByText("固定图片计划", { exact: true }).waitFor();
    if (
      plan.executionMode !== "test_fixture" ||
      plan.status !== "ready" ||
      plan.input.prompt !== manual ||
      plan.input.assistanceSource?.revision !== 2 ||
      plan.resolvedInput.shots[0].shotRevisionId !== shot.specRevisionId ||
      plan.resolvedInput.output.resolution !== "256x256"
    )
      throw Error(
        "Fixed shot, explicit advice provenance or fixture output mismatch",
      );
    const continued = `${manual}\n图片计划后手工续写：保留窗外光线。`;
    await prompt.fill(continued);
    await page.route(`**${base}/generation-jobs`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      if (response.status() !== 202)
        throw Error(`Execute failed ${response.status()}`);
      job = await response.json();
      await route.abort("failed");
      done();
    });
    await panel
      .getByRole("button", { name: "确认执行图片生成", exact: true })
      .click();
    await receipt;
    await page.reload();
    await composer
      .getByRole("button", { name: "生成图片", exact: true })
      .click();
    await panel
      .getByText("图片结果已归档", { exact: true })
      .waitFor({ timeout: 60000 });
    await panel.locator("img").waitFor();
    await panel.locator("img").evaluate(async (image) => {
      await image.decode();
      if (!image.naturalWidth) throw Error("Image did not decode");
    });
    const finalJob = await read(`${base}/generation-jobs/${job.id}`);
    const media = await read(`${base}/media/${finalJob.mediaIds[0]}`);
    const after = await read(`${path}/content`);
    if (
      finalJob.status !== "succeeded" ||
      finalJob.mediaIds.length !== 1 ||
      media.kind !== "image" ||
      media.status !== "ready" ||
      media.sourceJobId !== job.id ||
      media.width !== 256 ||
      media.height !== 256
    )
      throw Error("Actual archived image identity mismatch");
    if (
      planPosts !== 1 ||
      executePosts !== 1 ||
      (await prompt.inputValue()) !== continued ||
      JSON.stringify(before) !== JSON.stringify(after)
    )
      throw Error("Recovery resubmitted or changed manual input/content");
    await panel
      .getByText("图片结果已归档", { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "output/playwright/2026-09-11-image-integrated/shot-1512.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.locator("img").scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    if (geometry.document > geometry.viewport)
      throw Error("Narrow view overflows");
    await page.screenshot({
      path: "output/playwright/2026-09-11-image-integrated/shot-390.png",
    });
    if (errors.length || serverErrors.length)
      throw Error(`Browser errors ${JSON.stringify({ errors, serverErrors })}`);
    console.log(
      JSON.stringify({
        actualApiDatabaseWorkerStorage: true,
        explicitTechnicalFixture: true,
        realModelAcceptance: false,
        planId: plan.id,
        jobId: job.id,
        mediaId: media.id,
        planPosts,
        executePosts,
        executionReplyDroppedAfter202: true,
        restoredSameJob: true,
        adviceRevision: 2,
        manualInputPreserved: true,
        contentTreeUnchanged: true,
        image: {
          width: media.width,
          height: media.height,
          status: media.status,
        },
        geometry,
        errors,
        serverErrors,
      }),
    );
  } finally {
    await page.unroute(`**${base}/generation-plans`);
    await page.unroute(`**${base}/generation-jobs`);
    page.off("pageerror", onError);
    page.off("response", onResponse);
    page.off("request", onRequest);
  }
}
