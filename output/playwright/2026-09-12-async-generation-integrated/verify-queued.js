async (page) => {
  const base = "/v1/tenants/2c50d284-7bec-4934-a136-96a8a76170e8";
  const panel = page.getByRole("complementary", { name: "AI 创作助手" });
  let job, plan, planPosts = 0, executePosts = 0, cancelPosts = 0;
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on("pageerror", onError);
  const onRequest = request => { if (request.method() === "POST" && request.url().endsWith("/cancel")) cancelPosts++; };
  page.on("request", onRequest);
  await page.route(`**${base}/generation-plans`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    planPosts++; const response = await route.fetch();
    if (response.status() !== 201) throw Error(`Plan ${response.status()}`);
    plan = await response.json(); await route.fulfill({ response });
  });
  await page.route(`**${base}/generation-jobs`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    executePosts++; const response = await route.fetch();
    if (response.status() !== 202) throw Error(`Execution ${response.status()}`);
    job = await response.json(); await route.fulfill({ response });
  });
  try {
    await page.evaluate(async () => { const r = await fetch("/__fixture/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pause" }) }); if (!r.ok) throw Error("Pause failed"); });
    await page.setViewportSize({ width: 1512, height: 982 });
    await panel.getByRole("button", { name: "准备另一份提案", exact: true }).click();
    const prompt = panel.getByRole("textbox", { name: "分镜要求", exact: true });
    if (!(await prompt.inputValue()).startsWith("保留手工要求：")) throw Error("Prior input lost");
    await prompt.fill("排队取消技术验收：保留钥匙位置与手工输入。");
    await panel.getByRole("button", { name: "查看分镜分析计划", exact: true }).click();
    await panel.getByRole("button", { name: "确认执行测试计划", exact: true }).click();
    const jobPanel = panel.locator('[aria-label="本次分镜任务"]');
    await jobPanel.getByText("排队中", { exact: true }).waitFor();
    await jobPanel.getByRole("button", { name: "请求取消任务", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "确认请求取消" });
    await dialog.waitFor();
    await page.waitForFunction(() => { const el = document.querySelector('[role="dialog"]'); return el && getComputedStyle(el).opacity === "1"; });
    await page.screenshot({ path: "output/playwright/2026-09-12-async-generation-integrated/queued-confirm-1512.png", fullPage: true, animations: "disabled" });
    await dialog.getByRole("button", { name: "确认请求取消", exact: true }).click();
    await jobPanel.getByText("原任务已确认取消。", { exact: true }).waitFor();
    await page.reload();
    await jobPanel.getByText("原任务已确认取消。", { exact: true }).waitFor();
    const actual = await page.evaluate(async ({ base, id }) => ({ job: await (await fetch(`${base}/generation-jobs/${id}`)).json(), external: await (await fetch("/__fixture/state")).json() }), { base, id: job.id });
    if (actual.job.status !== "cancelled" || actual.job.cancelStatus !== "confirmed" || actual.job.providerJobId || actual.external.jobs.length !== 1 || planPosts !== 1 || executePosts !== 1 || cancelPosts !== 1 || errors.length) throw Error("Queued cancellation did not prevent dispatch");
    await panel.getByRole("button", { name: "准备另一份提案", exact: true }).click();
    if ((await prompt.inputValue()) !== "排队取消技术验收：保留钥匙位置与手工输入。") throw Error("Cancelled input lost");
    await prompt.fill("下一次手工输入仍然独立：尚未准备或执行。");
    await page.setViewportSize({ width: 390, height: 844 });
    await prompt.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "output/playwright/2026-09-12-async-generation-integrated/queued-next-input-390.png", fullPage: true, animations: "disabled" });
    return { status: "passed", jobId: job.id, planId: plan.id, planPosts, executePosts, cancelPosts, queuedCancelledBeforeDispatch: true, newProviderJobs: 0, originalProviderJobs: actual.external.jobs.length, originalInputPreserved: true, nextInputEditable: true, errors };
  } finally { await page.unroute(`**${base}/generation-plans`); await page.unroute(`**${base}/generation-jobs`); page.off("pageerror", onError); page.off("request", onRequest); }
}
