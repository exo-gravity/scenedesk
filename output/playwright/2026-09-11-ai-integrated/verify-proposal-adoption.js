async (page) => {
  const tenant = "b128e444-cd57-4087-bcfe-c403051bbd8f",
    project = "ff8f70f2-8075-45de-b2bc-c54bd62e2653";
  const base = `/v1/tenants/${tenant}`,
    path = `${base}/projects/${project}`;
  const jobId = "488e7fa9-e79b-4cdf-9e18-2b3ea18b5c82";
  const errors = [],
    serverErrors = [];
  let executionPosts = 0,
    editPuts = 0,
    applyPosts = 0;
  const onError = (e) => errors.push(e.message);
  const onResponse = (r) => {
    if (r.status() >= 500 && r.url().includes("/v1/"))
      serverErrors.push(r.status());
  };
  const onRequest = (req) => {
    if (
      req.method() === "POST" &&
      req.url().endsWith(`${base}/generation-jobs`)
    )
      executionPosts++;
    if (req.method() === "PUT" && req.url().includes(`${path}/proposals/`))
      editPuts++;
    if (
      req.method() === "POST" &&
      req.url().includes(`${path}/proposals/`) &&
      req.url().endsWith("/apply")
    )
      applyPosts++;
  };
  page.on("pageerror", onError);
  page.on("response", onResponse);
  page.on("request", onRequest);
  try {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.reload();
    const dock = page.getByRole("complementary", { name: "AI 创作助手" });
    await page.getByRole("button", { name: "AI 助手", exact: true }).waitFor();
    if (!(await dock.isVisible()))
      await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await dock
      .getByRole("button", { name: "编辑并采纳分镜提案", exact: true })
      .waitFor({ timeout: 45000 });
    const before = await page.evaluate(
      async ({ base, path, jobId }) => {
        const get = async (url) => {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`GET ${r.status}`);
          return r.json();
        };
        const job = await get(`${base}/generation-jobs/${jobId}`),
          tree = await get(`${path}/content`),
          proposal = await get(`${path}/proposals/${job.proposalId}`);
        return { job, shotCount: tree.shots.length, proposal };
      },
      { base, path, jobId },
    );
    if (
      before.job.status !== "succeeded" ||
      before.job.executionMode !== "test_fixture" ||
      before.shotCount !== 0 ||
      before.proposal.revision !== 1 ||
      before.proposal.status !== "proposed"
    )
      throw new Error("Result not durably separated from adoption");
    await dock
      .getByRole("button", { name: "编辑并采纳分镜提案", exact: true })
      .click();
    await page
      .getByRole("button", { name: "修改测试建议 01", exact: true })
      .first()
      .click();
    const manual = "人工修改：先看到犹豫，再切到手部；保持原台词。";
    await page
      .getByRole("textbox", { name: "叙事意图", exact: true })
      .fill(manual);
    await page
      .getByRole("button", { name: "保留本项修改", exact: true })
      .click();
    await page
      .getByRole("button", { name: "保存提案修订", exact: true })
      .click();
    const choice = page.getByRole("checkbox", {
      name: "采纳镜头 测试建议 01",
      exact: true,
    });
    await choice.check();
    await page
      .getByRole("button", { name: "检查采纳结果", exact: true })
      .click();
    await page
      .getByRole("button", { name: "确认采纳并创建", exact: true })
      .click();
    await page.getByText("本提案已采纳", { exact: true }).waitFor();
    const after = await page.evaluate(
      async ({ path, proposalId }) => {
        const get = async (url) => {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`GET ${r.status}`);
          return r.json();
        };
        const tree = await get(`${path}/content`),
          proposal = await get(`${path}/proposals/${proposalId}`),
          original = await get(
            `${path}/proposals/${proposalId}?revisionNumber=1`,
          );
        return { tree, proposal, original };
      },
      { path, proposalId: before.proposal.id },
    );
    if (
      after.tree.shots.length !== 1 ||
      after.tree.shots[0].spec.intent !== manual ||
      after.proposal.revision !== 2 ||
      after.proposal.status !== "applied" ||
      after.original.operations[0].proposed.spec.intent === manual
    )
      throw new Error("Manual revision or immutable original not preserved");
    if (
      after.proposal.sourceScriptRevisionId !==
        before.proposal.sourceScriptRevisionId ||
      after.proposal.sourceHash !== before.proposal.sourceHash
    )
      throw new Error("Adoption changed fixed provenance");
    await page.screenshot({
      path: "output/playwright/2026-09-11-ai-integrated/actual-proposal-applied-1512.png",
      fullPage: false,
    });
    await page.reload();
    await page.getByRole("button", { name: "AI 助手", exact: true }).waitFor();
    if (!(await dock.isVisible()))
      await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    await dock
      .getByRole("button", { name: "编辑并采纳分镜提案", exact: true })
      .click();
    await page.getByText("本提案已采纳", { exact: true }).waitFor();
    if (
      executionPosts !== 0 ||
      editPuts !== 1 ||
      applyPosts !== 1 ||
      errors.length ||
      serverErrors.length
    )
      throw new Error(
        JSON.stringify({
          executionPosts,
          editPuts,
          applyPosts,
          errors,
          serverErrors,
        }),
      );
    return {
      verification:
        "Actual same-origin API, restricted durable worker and PostgreSQL with explicit local fixture; no model service",
      jobId,
      proposalId: before.proposal.id,
      shotId: after.tree.shots[0].id,
      proposalRevision: after.proposal.revision,
      executionPosts,
      editPuts,
      applyPosts,
      originalModelRevisionPreserved: true,
      noShotBeforeExplicitAdoption: true,
      manualIntentPersisted: true,
      reloadRestoresAppliedProposal: true,
      pageErrors: errors.length,
      serverErrors: serverErrors.length,
    };
  } finally {
    page.off("pageerror", onError);
    page.off("response", onResponse);
    page.off("request", onRequest);
  }
}
