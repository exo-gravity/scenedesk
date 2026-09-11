async (page) => {
  const tenant = "b128e444-cd57-4087-bcfe-c403051bbd8f";
  const project = "ff8f70f2-8075-45de-b2bc-c54bd62e2653";
  const sceneId = "4fae9756-c2c0-4062-8597-42c08f6e45c3";
  const shotId = "a9f4d414-2467-43bb-a56d-4be7fe13e651";
  const base = `/v1/tenants/${tenant}`,
    path = `${base}/projects/${project}`;
  const errors = [],
    serverErrors = [];
  let planPosts = 0,
    executePosts = 0,
    editPuts = 0,
    plan,
    job,
    saved;
  let executionDone, editDone;
  const executionReceipt = new Promise((resolve) => {
    executionDone = resolve;
  });
  const editReceipt = new Promise((resolve) => {
    editDone = resolve;
  });
  const onError = (error) => errors.push(error.message);
  const onResponse = (response) => {
    if (response.status() >= 500 && response.url().includes("/v1/"))
      serverErrors.push(response.status());
  };
  const onRequest = (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith(`${base}/generation-plans`)
    )
      planPosts++;
    if (
      request.method() === "POST" &&
      request.url().endsWith(`${base}/generation-jobs`)
    )
      executePosts++;
    if (
      request.method() === "PUT" &&
      request.url().includes(`${path}/assistance-artifacts/`)
    )
      editPuts++;
  };
  page.on("pageerror", onError);
  page.on("response", onResponse);
  page.on("request", onRequest);
  const readState = () =>
    page.evaluate(
      async ({ path, shotId }) => {
        const response = await fetch(`${path}/content`);
        if (!response.ok) throw Error(`Content GET ${response.status}`);
        const tree = await response.json();
        return {
          shotCount: tree.shots.length,
          shot: tree.shots.find((shot) => shot.id === shotId),
        };
      },
      { path, shotId },
    );
  try {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.reload();
    const composer = page
      .locator('[aria-label="本次创作输入"]')
      .filter({
        has: page.getByRole("textbox", { name: "本次提示", exact: true }),
      });
    const prompt = composer.getByRole("textbox", {
      name: "本次提示",
      exact: true,
    });
    await prompt.waitFor();
    const before = await readState();
    if (!before.shot) throw Error("Actual fixed shot missing");
    const manual = "手工原文：保留人物造型。计划后继续手工编辑。";
    const revisionText = "人工修订建议：先停顿，再缓慢推进。";
    await prompt.fill("手工原文：保留人物造型。");
    await composer
      .getByRole("button", { name: "AI 准备提示", exact: true })
      .click();
    for (const name of ["准备提示的模型", "提示将用于哪项能力"]) {
      await composer.getByRole("combobox", { name, exact: true }).click();
      await page
        .getByRole("option", {
          name: "本地测试适配器（无真实模型）",
          exact: false,
        })
        .click();
    }
    await composer
      .getByRole("textbox", { name: "本次准备要求", exact: true })
      .fill("重点安排动作与运镜。明确测试输入 🌌。");
    await page.route(`**${base}/generation-plans`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      if (response.status() !== 201)
        throw Error(`Plan POST ${response.status()}`);
      plan = await response.json();
      await route.fulfill({ response });
    });
    await composer
      .getByRole("button", { name: "查看固定计划", exact: true })
      .click();
    await composer.getByText("固定生成计划", { exact: true }).waitFor();
    if (
      plan.executionMode !== "test_fixture" ||
      plan.status !== "ready" ||
      plan.resolvedInput.shots[0].shotRevisionId !==
        before.shot.specRevisionId ||
      JSON.stringify(plan.resolvedInput.shots[0].spec) !==
        JSON.stringify(before.shot.spec)
    )
      throw Error("Plan did not fix actual shot input");
    await prompt.fill(manual);
    await page.route(`**${base}/generation-jobs`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      if (response.status() !== 202)
        throw Error(`Execute POST ${response.status()}`);
      job = await response.json();
      await route.abort("failed");
      executionDone();
    });
    await composer
      .getByRole("button", { name: "明确执行提示准备", exact: true })
      .click();
    await executionReceipt;
    await page.reload();
    await composer
      .getByRole("button", { name: "AI 准备提示", exact: true })
      .click();
    await composer
      .getByRole("button", { name: "打开提示建议", exact: true })
      .waitFor({ timeout: 45000 });
    if (executePosts !== 1 || (await prompt.inputValue()) !== manual)
      throw Error("Execution recovery resubmitted or lost manual input");
    await composer
      .getByRole("button", { name: "打开提示建议", exact: true })
      .click();
    const suggestion = composer.getByRole("textbox", {
      name: "建议提示",
      exact: true,
    });
    await suggestion.waitFor();
    const original = await suggestion.inputValue();
    if (!original.includes("显式测试 fixture"))
      throw Error("Result is not explicit worker fixture output");
    await suggestion.fill(revisionText);
    await composer
      .getByRole("textbox", { name: "保留要求（每行一项）", exact: true })
      .fill("人物造型\n服装");
    await page.route(`**${path}/assistance-artifacts/*`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      if (route.request().headers()["if-match"] !== '"1"')
        throw Error("Edit did not preserve base revision");
      const response = await route.fetch();
      if (response.status() !== 200)
        throw Error(`Artifact PUT ${response.status()}`);
      saved = await response.json();
      await route.abort("failed");
      editDone();
    });
    await composer
      .getByRole("button", { name: "保存建议修订", exact: true })
      .click();
    await editReceipt;
    await composer.getByText("保存结果待核对", { exact: true }).waitFor();
    if (
      !(await composer
        .getByRole("button", { name: "按原修订重试保存", exact: true })
        .isDisabled())
    )
      throw Error("Unknown save permits unchecked replay");
    await page.reload();
    await composer
      .getByRole("button", { name: "AI 准备提示", exact: true })
      .click();
    await composer.getByText("保存结果待核对", { exact: true }).waitFor();
    await composer
      .getByRole("button", { name: "核对建议修订", exact: true })
      .click();
    await composer
      .getByRole("button", { name: "追加到本次提示…", exact: true })
      .waitFor();
    await composer
      .getByRole("combobox", { name: "查看已保存的建议历史", exact: true })
      .click();
    await page
      .getByRole("option", { name: "r1 · 原始建议", exact: true })
      .click();
    await composer.getByText(original, { exact: true }).waitFor();
    if (
      (await suggestion.inputValue()) !== revisionText ||
      saved.revision !== 2
    )
      throw Error("History overwrote current edited revision");
    await composer
      .getByRole("button", { name: "追加到本次提示…", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "确认追加到本次提示", exact: true })
      .waitFor();
    await page.screenshot({
      path: "output/playwright/2026-09-11-prompt-integrated/confirm.png",
      fullPage: false,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "确认追加，保留原文", exact: true })
      .click();
    await composer.getByText("本次输入已应用建议", { exact: true }).waitFor();
    const expected = `${manual}\n\n${revisionText}`;
    if ((await prompt.inputValue()) !== expected)
      throw Error("Append did not preserve original manual text");
    await page.reload();
    await prompt.waitFor();
    if ((await prompt.inputValue()) !== expected)
      throw Error("Applied input failed reload recovery");
    for (const size of [
      { width: 1512, height: 982 },
      { width: 1366, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await composer.scrollIntoViewIfNeeded();
      const bounds = await composer.boundingBox();
      if (!bounds || bounds.x < 0 || bounds.x + bounds.width > size.width + 1)
        throw Error("Composer exceeds viewport");
      await page.screenshot({
        path: `output/playwright/2026-09-11-prompt-integrated/applied-${size.width}.png`,
        fullPage: false,
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.getByRole("button", { name: "自由画布", exact: true }).click();
    const dock = page.getByRole("complementary", { name: "AI 创作助手" });
    if (!(await dock.isVisible()))
      await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await dock.getByText("准备提示", { exact: true }).click();
    await dock
      .getByRole("combobox", { name: "选择本次提示的镜头来源", exact: true })
      .click();
    await page
      .getByRole("option", { name: before.shot.label, exact: true })
      .click();
    await dock.getByText("本次输入已应用建议", { exact: true }).waitFor();
    await page.getByRole("button", { name: "分镜", exact: true }).click();
    const after = await readState();
    if (JSON.stringify(after) !== JSON.stringify(before))
      throw Error("Prompt assistance changed persisted shot or count");
    const durable = await page.evaluate(
      async ({ base, path, jobId, artifactId }) => {
        const get = async (url) => {
          const response = await fetch(url);
          if (!response.ok) throw Error(`GET ${response.status}`);
          return response.json();
        };
        const [job, current, r1, r2] = await Promise.all([
          get(`${base}/generation-jobs/${jobId}`),
          get(`${path}/assistance-artifacts/${artifactId}`),
          get(`${path}/assistance-artifacts/${artifactId}/revisions/1`),
          get(`${path}/assistance-artifacts/${artifactId}/revisions/2`),
        ]);
        return {
          jobId: job.id,
          planId: job.planId,
          status: job.status,
          executionMode: job.executionMode,
          artifactId: current.id,
          currentRevision: current.revision,
          r1Prompt: r1.body.prompt,
          r2Prompt: r2.body.prompt,
        };
      },
      { base, path, jobId: job.id, artifactId: saved.id },
    );
    if (
      durable.status !== "succeeded" ||
      durable.r1Prompt !== original ||
      durable.r2Prompt !== revisionText ||
      planPosts !== 1 ||
      executePosts !== 1 ||
      editPuts !== 1 ||
      errors.length ||
      serverErrors.length
    )
      throw Error(
        "Durable result, mutation count or browser error check failed",
      );
    return {
      actualApi: true,
      actualPostgreSql: true,
      actualRestrictedWorker: true,
      paidCalls: 0,
      notRealModelAcceptance: true,
      projectId: project,
      shotId,
      fixedShotRevisionId: before.shot.specRevisionId,
      ...durable,
      planPosts,
      executePosts,
      editPuts,
      executionRecovery: "Real 202 lost; GET same job after reload",
      editRecovery: "Real PUT 200 lost; GET confirms r2 without replay",
      manualInputPreserved: true,
      shotUnchanged: true,
      modeRecovery: true,
      viewportWidths: [1512, 1366, 390],
      pageErrors: errors,
      api5xx: serverErrors,
    };
  } finally {
    await page.unroute(`**${base}/generation-plans`);
    await page.unroute(`**${base}/generation-jobs`);
    await page.unroute(`**${path}/assistance-artifacts/*`);
    page.off("pageerror", onError);
    page.off("response", onResponse);
    page.off("request", onRequest);
  }
}
