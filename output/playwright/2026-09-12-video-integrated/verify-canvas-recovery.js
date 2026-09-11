async (page) => {
  const base = "/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f",
    path = base + "/projects/ff8f70f2-8075-45de-b2bc-c54bd62e2653",
    canvasId = "28fa7bf3-4b46-4160-820d-3165e97a1cb8",
    planId = "2bcc2a71-a295-4105-b173-0f77356cb923",
    jobId = "e7775247-5571-42c7-b7e6-391d1e454e07",
    sourceId = "667236bc-c02f-408c-9706-812be2e94aeb",
    resultId = "d4d4a897-d6f3-4283-8f65-eb66e647a61d";
  const errors = [],
    failures = [];
  let executionPosts = 0,
    resultPosts = 0,
    canvasWrites = 0;
  const error = (e) => errors.push(e.message),
    response = (r) => {
      if (r.status() >= 400 && r.url().includes("/v1/"))
        failures.push({
          status: r.status(),
          operation: r.url().split("?")[0].split("/").pop(),
        });
    },
    request = (r) => {
      if (r.method() === "POST" && r.url().endsWith("/generation-jobs"))
        executionPosts++;
      if (r.method() === "POST" && r.url().endsWith("/results")) resultPosts++;
      if (r.method() === "PUT" && r.url().endsWith("/canvases/" + canvasId))
        canvasWrites++;
    };
  const read = (url) =>
    page.evaluate(async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw Error("GET " + r.status);
      return r.json();
    }, url);
  page.on("pageerror", error);
  page.on("response", response);
  page.on("request", request);
  try {
    await page.getByRole("button", { name: "保存画布", exact: true }).click();
    await page.getByText(/画布 · 已保存/).waitFor({ timeout: 30000 });
    const pref = page.getByRole("button", {
      name: "重新保存本页视图",
      exact: true,
    });
    if (await pref.isVisible()) await pref.click();
    const saved = await read(path + "/canvases/" + canvasId);
    if (
      saved.document.nodes.some((n) => n.id === sourceId) ||
      saved.document.nodes.filter((n) => n.id === resultId).length !== 1
    )
      throw Error("Source removal or stable result identity failed");
    await page.reload();
    await page
      .getByRole("button", { name: "画布生成与结果", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "画布生成任务历史", exact: true })
      .selectOption(planId);
    const panel = page.locator('[aria-label="生成单段视频"]');
    await panel
      .getByRole("button", { name: "打开所选的固定视频任务", exact: true })
      .click();
    await panel.getByText("视频结果已归档", { exact: true }).waitFor();
    await panel.getByRole("button", { name: "预览视频", exact: true }).click();
    await panel.locator("video").waitFor();
    await panel.locator("video").evaluate(async (v) => {
      await v.play();
      if (!v.videoWidth) throw Error("Recovered video failed decode");
      v.pause();
    });
    await panel.locator("video").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "output/playwright/2026-09-12-video-integrated/deleted-source-history.png",
      animations: "disabled",
    });
    const old = await panel.locator("video").elementHandle();
    await page
      .getByRole("button", { name: "分镜", exact: true })
      .scrollIntoViewIfNeeded();
    await panel.locator("video").waitFor({ state: "detached" });
    if (!(await old.evaluate((v) => v.paused && !v.getAttribute("src"))))
      throw Error("Offscreen player retained source");
    const job = await read(base + "/generation-jobs/" + jobId),
      media = await read(base + "/media/" + jobId),
      plan = await read(base + "/generation-plans/" + planId);
    if (
      job.status !== "succeeded" ||
      job.mediaIds.length !== 1 ||
      job.mediaIds[0] !== media.id ||
      media.hasAudio !== false ||
      media.durationUs !== 2000000 ||
      plan.input.prompt !== "画布手工提示：保留窗边人物与冷色光线。"
    )
      throw Error("Recovered fixed identities mismatch");
    if (errors.length || failures.length || executionPosts || resultPosts)
      throw Error(
        "Recovery repeated execution/placement or had errors " +
          JSON.stringify({ errors, failures, executionPosts, resultPosts }),
      );
    return {
      actualApiDatabaseWorkerStorage: true,
      explicitTechnicalFixture: true,
      realModelAcceptance: false,
      planId,
      jobId,
      mediaId: media.id,
      sourceId,
      resultId,
      canvasWrites,
      executionPosts,
      resultPosts,
      sourceRemovalRecovered: true,
      deletedSourceHistoryRecovered: true,
      offscreenPlayerReleased: true,
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
    page.off("pageerror", error);
    page.off("response", response);
    page.off("request", request);
  }
}
