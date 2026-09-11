async (page) => {
  const base = "/v1/tenants/2c50d284-7bec-4934-a136-96a8a76170e8";
  const projectId = "c9736281-644e-455a-a420-25abf89a32e4";
  // A third paused fixture job was opened only to capture a stable confirmation frame.
  const dialog = page.getByRole("dialog", { name: "确认请求取消" });
  await dialog.getByRole("button", { name: "确认请求取消", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "AI 创作助手" });
  await panel.getByText("原任务已确认取消。", { exact: true }).waitFor();
  await page.reload();
  await panel.getByText("原任务已确认取消。", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.locator('[aria-label="本次分镜任务"]').scrollIntoViewIfNeeded();
  const layering = await panel.evaluate(el => {
    const header = [...el.children].find(child => getComputedStyle(child).position === "sticky");
    if (!header) throw Error("Sticky header missing");
    const headerRect = header.getBoundingClientRect();
    const candidates = [...el.querySelectorAll("[class]")].filter(child => getComputedStyle(child).isolation === "isolate");
    const sample = document.elementFromPoint(headerRect.x + headerRect.width / 2, headerRect.y + headerRect.height / 2);
    return { isolatedContentCount: candidates.length, headingTop: headerRect.top, headingBottom: headerRect.bottom, topmostIsHeader: !!sample && header.contains(sample), headerText: header.textContent, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  if (!layering.isolatedContentCount || !layering.topmostIsHeader || layering.overflow) throw Error("Sticky heading layer still obscured");
  await page.screenshot({ path: "output/playwright/2026-09-12-async-generation-integrated/final-heading-390.png", animations: "disabled" });
  const actual = await page.evaluate(async ({ base, projectId }) => {
    const jobs = await (await fetch(`${base}/generation-jobs?scope=project&projectId=${projectId}`)).json();
    const content = await (await fetch(`${base}/projects/${projectId}/content`)).json();
    const external = await (await fetch("/__fixture/state")).json();
    return { jobs: jobs.items.map(j => ({ id:j.id,planId:j.planId,status:j.status,cancelStatus:j.cancelStatus,providerJobId:j.providerJobId,proposalId:j.proposalId })), shots:content.shots.length, external };
  }, { base, projectId });
  if (actual.jobs.length !== 3 || actual.jobs.filter(j => j.status === "succeeded").length !== 1 || actual.jobs.filter(j => j.status === "cancelled").length !== 2 || actual.shots !== 0 || actual.external.jobs.length !== 1 || actual.external.workerErrors.length) throw Error("Unexpected final fixture state");
  return { status:"passed", ...layering, actualJobs:actual.jobs, originalShotCount:actual.shots, providerSubmitPosts:actual.external.requests.filter(r=>r.operation==="submit").length, providerCancelPosts:actual.external.requests.filter(r=>r.operation==="cancel").length, workerErrors:actual.external.workerErrors };
}
