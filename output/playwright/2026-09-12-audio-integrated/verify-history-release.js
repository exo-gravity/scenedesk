async (page) => {
  let writes = 0;
  const errors = [];
  const request = (r) => {
    if (
      r.method() === "POST" &&
      /\/(generation-(plans|jobs)|results)$/.test(r.url())
    )
      writes++;
  };
  const response = (r) => {
    if (r.url().includes("/v1/") && r.status() >= 400) errors.push(r.status());
  };
  page.on("request", request);
  page.on("response", response);
  try {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.reload();
    const accordion = page.getByRole("button", {
      name: "画布生成与结果",
      exact: true,
    });
    if ((await accordion.getAttribute("aria-expanded")) !== "true")
      await accordion.click();
    await page
      .getByRole("combobox", { name: "画布生成任务历史", exact: true })
      .selectOption("8a59519b-48dc-4d72-ba2b-6d783207afb5");
    const panel = page.locator('[aria-label="生成单段音频"]');
    await panel
      .getByRole("button", { name: "打开所选的固定音频任务", exact: true })
      .click();
    await panel
      .getByText("结果以独立音频节点保存。", { exact: false })
      .waitFor();
    if (await panel.getByText("原草稿仍保留", { exact: false }).count())
      throw Error("Deleted source claimed present");
    await panel.locator('[aria-label="独立音频结果"]').scrollIntoViewIfNeeded();
    await panel.getByRole("button", { name: "预览音频", exact: true }).click();
    await panel.locator("video").waitFor({ state: "attached" });
    await panel.locator("video").evaluate(async (el) => {
      await el.play();
      if (!Number.isFinite(el.duration) || el.videoWidth !== 0)
        throw Error("History audio failed decode");
      el.pause();
    });
    await panel.locator("media-controller").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "output/playwright/2026-09-12-audio-integrated/deleted-source-history.png",
      animations: "disabled",
    });
    const element = await panel.locator("video").elementHandle();
    await page
      .getByRole("button", { name: "分镜", exact: true })
      .scrollIntoViewIfNeeded();
    await panel.locator("video").waitFor({ state: "detached" });
    const released = await element.evaluate(
      (el) => el.paused && !el.getAttribute("src"),
    );
    if (!released || writes || errors.length)
      throw Error(
        `History release failed ${JSON.stringify({ released, writes, errors })}`,
      );
    return {
      historySamePlan: true,
      sourceDeleted: true,
      historyCopyAccurate: true,
      audioDecoded: true,
      offscreenDecoderReleased: true,
      businessWrites: writes,
      errors,
    };
  } finally {
    page.off("request", request);
    page.off("response", response);
  }
}
