async (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 982 });
  const viewport = () =>
    page
      .locator(".react-flow__viewport")
      .evaluate((el) => getComputedStyle(el).transform);
  // Allow the explicit fit to finish before making a separate manual zoom.
  const targets = page.getByRole("button", {
    name: "定位镜头节点",
    exact: true,
  });
  if (!(await targets.count()))
    await page
      .getByRole("button", { name: "本场镜头与探索", exact: true })
      .click();
  await targets.click();
  await page.waitForTimeout(300);
  await page
    .getByRole("button", { name: "画布缩放到百分之百", exact: true })
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("p")].some((p) =>
      p.textContent.includes("缩放 100%"),
    ),
  );
  const before = await viewport();
  await page.getByRole("button", { name: "分镜", exact: true }).click();
  await page.getByRole("button", { name: "自由画布", exact: true }).click();
  await page.locator(".react-flow__viewport").waitFor();
  // This bounded observation detects a stale focus command after remount.
  await page.waitForTimeout(600);
  const afterMode = await viewport();
  if (before !== afterMode)
    throw Error(
      "Mode replayed consumed focus: " + JSON.stringify({ before, afterMode }),
    );
  await page.getByRole("button", { name: "定位当前内容", exact: true }).click();
  await page.waitForTimeout(300);
  await page
    .getByRole("button", { name: "画布缩放到百分之百", exact: true })
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("p")].some((p) =>
      p.textContent.includes("缩放 100%"),
    ),
  );
  const beforeNarrow = await viewport();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".react-flow__viewport").waitFor({ state: "detached" });
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.locator(".react-flow__viewport").waitFor();
  await page.waitForTimeout(600);
  const afterNarrow = await viewport();
  if (beforeNarrow !== afterNarrow)
    throw Error(
      "Narrow view replayed consumed focus: " +
        JSON.stringify({ beforeNarrow, afterNarrow }),
    );
  if (errors.length) throw Error(JSON.stringify(errors));
  return {
    consumedShotFocusKeepsManualViewport: true,
    consumedToolbarFocusSurvivesNarrowView: true,
    before,
    afterMode,
    beforeNarrow,
    afterNarrow,
    pageErrors: 0,
    scope: "production browser with actual canvas; view-only checks",
  };
}
