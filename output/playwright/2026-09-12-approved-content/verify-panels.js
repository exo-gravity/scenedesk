async (page) => {
  const writes = [];
  const observe = (req) => {
    if (req.url().includes("/v1/") && !["GET", "HEAD"].includes(req.method()))
      writes.push(req.method());
  };
  page.on("request", observe);
  try {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto(
      page.url().split("?")[0] + "?scene=55555555-5555-4555-8555-555555555555",
    );
    await page.reload();
    const dock = page.getByRole("complementary", { name: "剧本提案助手" }),
      doc = page.getByRole("region", { name: "剧本正文与版本" });
    await dock
      .getByRole("button", { name: "编辑并采纳分镜提案", exact: true })
      .click();
    await dock.getByText("本提案已采纳", { exact: true }).waitFor();
    const widths = [];
    for (const viewport of [
      { width: 1512, height: 982 },
      { width: 1366, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      const before = await doc.boundingBox(),
        box = await dock.boundingBox();
      const expected = viewport.width === 1512 ? 410 : 370;
      if (Math.abs(box.width - expected) > 1 || Math.abs(box.y - 90) > 1)
        throw Error("approved panel geometry mismatch");
      await dock.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      const after = await doc.boundingBox();
      if (Math.abs(before.y - after.y) > 1)
        throw Error("right panel scroll moves source document");
      await dock.evaluate((el) => {
        el.scrollTop = 0;
      });
      await doc.evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.screenshot({
        path: `output/playwright/2026-09-12-approved-content/final-proposal-${viewport.width}.png`,
        animations: "disabled",
      });
      widths.push({
        viewport: viewport.width,
        aside: box.width,
        top: box.y,
        independentScroll: true,
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await dock.scrollIntoViewIfNeeded();
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error("horizontal overflow");
    await page.screenshot({
      path: "output/playwright/2026-09-12-approved-content/final-proposal-390.png",
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1512, height: 982 });
    await dock.evaluate((el) => {
      el.scrollTop = 0;
    });
    await doc.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.getByRole("button", { name: "切换深色", exact: true }).click();
    await page.screenshot({
      path: "output/playwright/2026-09-12-approved-content/final-proposal-dark.png",
      animations: "disabled",
    });
    await page.getByRole("button", { name: "切换浅色", exact: true }).click();
    if (writes.length) throw Error("visual navigation wrote business data");
    return {
      productionBuild: true,
      controlledTransport: true,
      realBackendAcceptance: false,
      widths,
      mobileNoOverflow: true,
      darkTheme: true,
      writes: 0,
    };
  } finally {
    page.off("request", observe);
  }
};
