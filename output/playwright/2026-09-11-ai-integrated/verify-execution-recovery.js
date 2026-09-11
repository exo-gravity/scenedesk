async (page) => {
  const tenant = "b128e444-cd57-4087-bcfe-c403051bbd8f";
  const project = "ff8f70f2-8075-45de-b2bc-c54bd62e2653";
  const sceneId = "4fae9756-c2c0-4062-8597-42c08f6e45c3";
  const base = `/v1/tenants/${tenant}`,
    path = `${base}/projects/${project}`;
  const errors = [],
    serverErrors = [];
  const onError = (e) => errors.push(e.message);
  const onResponse = (r) => {
    if (r.status() >= 500 && r.url().includes("/v1/"))
      serverErrors.push(r.status());
  };
  page.on("pageerror", onError);
  page.on("response", onResponse);
  let planPosts = 0,
    executionPosts = 0,
    acceptedJob,
    finishReceipt,
    rejectReceipt;
  const receiptDone = new Promise((resolve, reject) => {
    finishReceipt = resolve;
    rejectReceipt = reject;
  });
  const onRequest = (req) => {
    if (req.method() !== "POST") return;
    if (req.url().endsWith(`${base}/generation-plans`)) planPosts++;
    if (req.url().endsWith(`${base}/generation-jobs`)) executionPosts++;
  };
  page.on("request", onRequest);
  const pattern = `**${base}/generation-jobs`;
  const dropReceipt = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    try {
      const response = await route.fetch();
      if (response.status() !== 202)
        throw new Error(`Execution did not commit: ${response.status()}`);
      acceptedJob = await response.json();
      if (
        acceptedJob.executionMode !== "test_fixture" ||
        acceptedJob.status !== "queued"
      )
        throw new Error("Expected explicit fixture queued without worker");
      await route.abort("failed");
      finishReceipt();
    } catch (error) {
      rejectReceipt(error);
    }
  };
  await page.route(pattern, dropReceipt);
  try {
    await page.setViewportSize({ width: 1512, height: 982 });
    const dock = page.getByRole("complementary", { name: "AI 创作助手" });
    if (!(await dock.isVisible()))
      await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await dock.getByRole("combobox", { name: "来源剧本", exact: true }).click();
    await page
      .getByRole("option", { name: "剧本第 1 版 · 当前", exact: true })
      .click();
    const source = dock.getByRole("textbox", {
      name: "选择要分析的原文",
      exact: true,
    });
    await source.evaluate((el) => {
      el.focus();
      el.setSelectionRange(2, 27);
      el.dispatchEvent(new Event("select", { bubbles: true }));
    });
    await dock.getByRole("button", { name: "使用选区", exact: true }).click();
    const prompt = "真实 API 技术验证：保留原对白与动作，先建议再人工采纳。";
    await dock
      .getByRole("textbox", { name: "分镜要求", exact: true })
      .fill(prompt);
    await dock
      .getByRole("checkbox", { name: "附带本场摘要与连续性设定", exact: true })
      .check();
    await dock
      .getByRole("combobox", { name: "分镜分析模型", exact: true })
      .click();
    await page
      .getByRole("option", {
        name: "本地测试适配器（无真实模型）",
        exact: false,
      })
      .click();
    await page.getByRole("button", { name: "分镜", exact: true }).click();
    if (
      (await dock
        .getByRole("textbox", { name: "分镜要求", exact: true })
        .inputValue()) !== prompt
    )
      throw new Error("Mode switch lost input");
    await page.getByRole("button", { name: "自由画布", exact: true }).click();
    await dock
      .getByRole("button", { name: "查看分镜分析计划", exact: true })
      .click();
    await dock.getByRole("region", { name: "固定生成计划" }).waitFor();
    await dock
      .getByRole("button", { name: "确认执行测试计划", exact: true })
      .click();
    await receiptDone;
    await dock.getByText("提交待核对", { exact: true }).first().waitFor();
    if (!acceptedJob) throw new Error("No actual committed job receipt");
    await page.screenshot({
      path: "output/playwright/2026-09-11-ai-integrated/lost-execution-receipt-1512.png",
      fullPage: false,
    });
    await page.reload();
    await page.getByRole("button", { name: "AI 助手", exact: true }).waitFor();
    if (!(await dock.isVisible()))
      await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await dock
      .getByRole("region", { name: "本次分镜任务" })
      .getByText("排队中", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "分镜", exact: true }).click();
    await page.getByRole("button", { name: "自由画布", exact: true }).click();
    const evidence = await page.evaluate(
      async ({ base, path, jobId }) => {
        const get = async (url) => {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`GET ${r.status}`);
          return r.json();
        };
        const job = await get(`${base}/generation-jobs/${jobId}`),
          plan = await get(`${base}/generation-plans/${job.planId}`),
          tree = await get(`${path}/content`);
        return { job, plan, shotCount: tree.shots.length };
      },
      { base, path, jobId: acceptedJob.id },
    );
    if (
      planPosts !== 1 ||
      executionPosts !== 1 ||
      evidence.job.id !== acceptedJob.id ||
      evidence.job.status !== "queued" ||
      evidence.shotCount !== 0
    )
      throw new Error("Recovery changed business identity or applied output");
    if (
      evidence.plan.resolvedInput.contextSnapshots.length !== 1 ||
      evidence.plan.resolvedInput.contextSnapshots[0].source.objectId !==
        sceneId ||
      !evidence.plan.resolvedInput.sourceExcerpt.quote.startsWith("😀")
    )
      throw new Error("Server did not pin explicit Unicode input");
    for (const size of [
      { width: 1512, height: 982 },
      { width: 1366, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await dock.scrollIntoViewIfNeeded();
      const bounds = await dock.boundingBox();
      if (!bounds || bounds.x < 0 || bounds.x + bounds.width > size.width + 1)
        throw new Error("Assistant exceeds viewport");
      await page.screenshot({
        path: `output/playwright/2026-09-11-ai-integrated/recovered-queued-${size.width}.png`,
        fullPage: false,
      });
    }
    if (errors.length || serverErrors.length)
      throw new Error(JSON.stringify({ errors, serverErrors }));
    return {
      verification:
        "Actual same-origin API and PostgreSQL; explicit fixture capability; worker intentionally not started",
      projectId: project,
      sceneId,
      jobId: acceptedJob.id,
      planId: acceptedJob.planId,
      planPosts,
      executionPosts,
      refreshAndModeOnlyRead: true,
      unicodeSelectionAndContextFixed: true,
      noAutomaticShotCreation: true,
      pageErrors: errors.length,
      serverErrors: serverErrors.length,
    };
  } finally {
    await page.unroute(pattern, dropReceipt);
    page.off("pageerror", onError);
    page.off("response", onResponse);
    page.off("request", onRequest);
  }
}
