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
    if (response.status() >= 400 && response.url().includes("/v1/"))
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
    await page.goto(
      `http://127.0.0.1:4311/#/app/t/${tenant}/p/${project}/production?scene=4fae9756-c2c0-4062-8597-42c08f6e45c3&mode=storyboard`,
    );
    await page.reload();
    await page.getByRole("button", { name: "分镜", exact: true }).click();
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
      .getByRole("button", { name: "生成音频", exact: true })
      .click();
    const panel = composer.locator('[aria-label="生成单段音频"]');
    await panel
      .getByRole("combobox", { name: "音频生成模型", exact: true })
      .click();
    await page
      .getByRole("option", {
        name: "本地音频归档测试（无真实模型） · 受控测试",
        exact: true,
      })
      .click();
    await page.route(`**${base}/generation-plans`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      if (response.status() !== 201)
        throw Error(`Plan failed ${response.status()}`);
      plan = await response.json();
      console.log(JSON.stringify({ stage: "plan", planId: plan.id }));
      await route.fulfill({ response });
    });
    await panel
      .getByRole("button", { name: "查看音频生成计划", exact: true })
      .click();
    await panel.getByText("固定音频计划", { exact: true }).waitFor();
    if (
      plan.executionMode !== "test_fixture" ||
      plan.status !== "ready" ||
      plan.input.prompt !== manual ||
      plan.input.assistanceSource?.revision !== 2 ||
      plan.resolvedInput.shots[0].shotRevisionId !== shot.specRevisionId ||
      plan.resolvedInput.output.durationSeconds !== 2 ||
      ["resolution", "aspectRatio", "withAudio"].some(
        (key) => key in plan.resolvedInput.output,
      )
    )
      throw Error(
        "Fixed shot, explicit advice provenance or fixture output mismatch",
      );
    const continued = `${manual}\n音频计划后手工续写：保留门外脚步。`;
    await prompt.fill(continued);
    await page.route(`**${base}/generation-jobs`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      if (response.status() !== 202)
        throw Error(`Execute failed ${response.status()}`);
      job = await response.json();
      console.log(
        JSON.stringify({ stage: "executed", planId: plan.id, jobId: job.id }),
      );
      await route.abort("failed");
      done();
    });
    await panel
      .getByRole("button", { name: "确认执行音频生成", exact: true })
      .click();
    await receipt;
    await page.reload();
    await composer
      .getByRole("button", { name: "生成音频", exact: true })
      .click();
    await panel
      .getByText("音频结果已归档", { exact: true })
      .waitFor({ timeout: 60000 });
    if (await panel.locator("video").count())
      throw Error("Decoder mounted before explicit preview");
    await panel.getByRole("button", { name: "预览音频", exact: true }).click();
    await panel.locator("video").waitFor({ state: "attached" });
    await panel.locator("video").evaluate(async (audio) => {
      await audio.play();
      if (!Number.isFinite(audio.duration) || audio.duration <= 0)
        throw Error("Actual audio did not decode");
      audio.pause();
    });
    const finalJob = await read(`${base}/generation-jobs/${job.id}`);
    const media = await read(`${base}/media/${finalJob.mediaIds[0]}`);
    const after = await read(`${path}/content`);
    if (
      finalJob.status !== "succeeded" ||
      finalJob.mediaIds.length !== 1 ||
      media.kind !== "audio" ||
      media.status !== "ready" ||
      media.sourceJobId !== job.id ||
      media.width !== undefined ||
      media.height !== undefined ||
      media.hasAudio !== true ||
      media.durationUs !== 2000000
    )
      throw Error("Actual archived audio identity mismatch");
    if (
      planPosts !== 1 ||
      executePosts !== 1 ||
      (await prompt.inputValue()) !== continued ||
      JSON.stringify(before) !== JSON.stringify(after)
    )
      throw Error("Recovery resubmitted or changed manual input/content");
    await panel.locator("media-controller").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "output/playwright/2026-09-12-audio-integrated/shot-1512.png",
    });
    await panel
      .getByRole("button", { name: "关闭音频预览", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.getByRole("button", { name: "预览音频", exact: true }).click();
    await panel.locator("video").waitFor({ state: "attached" });
    await panel.locator("video").evaluate(async (audio) => {
      await audio.play();
      audio.pause();
    });
    await panel.locator("media-controller").scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    if (geometry.document > geometry.viewport)
      throw Error("Narrow view overflows");
    await page.screenshot({
      path: "output/playwright/2026-09-12-audio-integrated/shot-390.png",
    });
    if (errors.length || serverErrors.length)
      throw Error(`Browser errors ${JSON.stringify({ errors, serverErrors })}`);
    return {
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
      audio: {
        status: media.status,
        durationUs: media.durationUs,
        hasAudio: media.hasAudio,
      },
      geometry,
      errors,
      serverErrors,
    };
  } finally {
    await page.unroute(`**${base}/generation-plans`);
    await page.unroute(`**${base}/generation-jobs`);
    page.off("pageerror", onError);
    page.off("response", onResponse);
    page.off("request", onRequest);
  }
}
