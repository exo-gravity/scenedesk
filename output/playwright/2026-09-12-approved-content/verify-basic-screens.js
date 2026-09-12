async (page) => {
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto(page.url().split("?")[0]);
  await page.reload();
  await page.getByRole("textbox", { name: "剧本正文", exact: true }).waitFor();
  await page.screenshot({ path: "output/playwright/2026-09-12-approved-content/final-script-1512.png", animations: "disabled" });
  await page.getByRole("link", { name: "返回场次", exact: true }).click();
  await page.getByText("01 · 咖啡厅", { exact: true }).waitFor();
  await page.screenshot({ path: "output/playwright/2026-09-12-approved-content/final-scenes-1512.png", animations: "disabled" });
  return { finalProductionScreenshots: true };
}
