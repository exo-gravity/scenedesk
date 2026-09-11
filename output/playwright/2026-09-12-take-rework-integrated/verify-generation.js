async (page) => {
  const base = "/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f";
  const path = `${base}/projects/ff8f70f2-8075-45de-b2bc-c54bd62e2653`;
  const reviewId = "8074afa1-96be-42fd-960b-64b6fafea995", commentId = "100d449a-ac63-4a27-8b42-ae302c1192e7";
  const panel = page.locator('[aria-label="按意见准备修改"]');
  let plan, job, planPosts = 0, executePosts = 0, released;
  const receipt = new Promise(resolve => { released = resolve; });
  const errors = [], serverErrors = [];
  const onError = error => errors.push(error.message);
  const onResponse = response => { if (response.status() >= 500 && response.url().includes("/v1/")) serverErrors.push(response.status()); };
  const onRequest = request => { if (request.method() !== "POST") return; if (request.url().endsWith("/generation-plans")) planPosts++; if (request.url().endsWith("/generation-jobs")) executePosts++; };
  page.on("pageerror", onError); page.on("response", onResponse); page.on("request", onRequest);
  try {
    await panel.getByRole("textbox", { name: "本次提示", exact: true }).fill("修改输入手工原文：保持造型与机位。");
    await panel.getByRole("button", { name: "AI 准备提示", exact: true }).click();
    await panel.getByRole("combobox", { name: "准备提示的模型", exact: true }).click();
    await page.getByRole("option", { name: /本地测试适配器（无真实模型）/ }).click();
    await panel.getByRole("combobox", { name: "提示将用于哪项能力", exact: true }).click();
    await page.getByRole("option", { name: /本地视频归档测试（无真实模型）/ }).click();
    await panel.getByRole("textbox", { name: "本次准备要求", exact: true }).fill("把固定候选意见整理为下一次视频尝试的提示和保留／修改要求。");
    await page.route(`**${base}/generation-plans`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      if (response.status() !== 201) throw Error(`Rework plan ${response.status()}: ${await response.text()}`);
      plan = await response.json();
      await route.fulfill({ response });
    });
    await panel.getByRole("button", { name: "查看固定计划", exact: true }).click();
    await panel.getByText("固定生成计划", { exact: true }).waitFor();
    if (plan.executionMode !== "test_fixture" || plan.input.assistance.kind !== "prepare_rework" || plan.resolvedInput.resolverVersion !== "creative-rework/1" || plan.resolvedInput.feedbackSnapshot.commentRevision !== 2 || plan.resolvedInput.feedbackSnapshot.commentId !== commentId || plan.resolvedInput.shots[0].shotRevisionId !== "bd8fa74c-3f39-48cd-a9ce-84ecae9a84d6")
      throw Error("Plan failed to fix the selected old Take and comment r2");
    await page.route(`**${base}/generation-jobs`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      if (response.status() !== 202) throw Error(`Rework execution ${response.status()}`);
      job = await response.json();
      await route.abort("failed"); released();
    });
    await panel.getByRole("button", { name: "明确执行提示准备", exact: true }).click();
    await receipt;
    await page.reload();
    await panel.getByRole("button", { name: "AI 准备提示", exact: true }).click();
    await panel.getByRole("button", { name: "打开提示建议", exact: true }).waitFor({ timeout: 45000 });
    await panel.getByRole("button", { name: "打开提示建议", exact: true }).click();
    const suggestion = await panel.getByRole("textbox", { name: "建议提示", exact: true }).inputValue();
    if (!suggestion.includes("显式测试 fixture") || !suggestion.includes("固定意见 r2") || !suggestion.includes("看向门口后再多停半拍"))
      throw Error("Fixture output did not use the real fixed feedback");
    const actual = await page.evaluate(async ({ base, path, jobId }) => {
      const job = await (await fetch(`${base}/generation-jobs/${jobId}`)).json();
      const artifact = await (await fetch(`${path}/assistance-artifacts/${job.assistanceArtifactId}`)).json();
      return { job, artifact };
    }, { base, path, jobId: job.id });
    if (actual.job.status !== "succeeded" || actual.artifact.request.feedback.commentRevision !== 2 || planPosts !== 1 || executePosts !== 1 || errors.length || serverErrors.length)
      throw Error("Rework recovery or durable artifact check failed");
    return { actualApiDatabaseWorker: true, realModelAcceptance: false, reviewId, commentId,
      planId: plan.id, jobId: job.id, artifactId: actual.artifact.id, artifactRevision: actual.artifact.revision,
      fixedCommentRevision: 2, originalSuggestion: suggestion, planPosts, executePosts,
      executionReplyDroppedAfter202: true, recoveredByGet: true, automaticReexecute: false,
      errors, serverErrors };
  } finally {
    await page.unroute(`**${base}/generation-plans`); await page.unroute(`**${base}/generation-jobs`);
    page.off("pageerror", onError); page.off("response", onResponse); page.off("request", onRequest);
  }
}
