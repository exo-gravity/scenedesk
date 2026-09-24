import { test, expect } from "./fixture.js";

// The LibTV reference frames are 1920 px wide; the side-by-side review uses the same frame.
test.use({ viewport: { width: 1920, height: 902 } });

test("ST-00: the studio entry opens as a full-screen frame, and the old canvas address opens it too", async ({ page, workspace: w }, info) => {
  await page.goto(`${w.runtime.origin}${w.basePath}/studio`);
  await expect(page).toHaveTitle(`${w.project.name} · 创作台 · SceneDesk`);
  const board = page.getByRole("main", { name: "创作台", exact: true });
  await expect(board).toBeVisible();
  const bar = page.getByRole("banner");
  await expect(bar).toContainText(w.project.name);
  const views = bar.getByRole("navigation", { name: "创作区视图", exact: true });
  await expect(views).toHaveText(/^剧本创作台镜头整理$/);
  await expect(views.locator("[aria-current=page]")).toHaveText("创作台");
  await expect(bar.getByText("未连接真实模型")).toBeVisible();
  // No studio rail, context header or project navigation: the studio owns the viewport.
  await expect(page.getByRole("navigation", { name: "项目导航", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "工作室导航", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "SceneDesk", exact: true })).toHaveCount(0);
  const shot = info.outputPath("studio-entry-1920.png");
  await page.screenshot({ path: shot });
  await info.attach("studio-entry-1920", { path: shot, contentType: "image/png" });

  // The old canvas address opens the studio; nothing of the retired entry is left.
  await page.goto(`${w.runtime.origin}${w.basePath}/canvas`);
  await expect(page).toHaveURL(`${w.runtime.origin}${w.basePath}/studio`);
  await expect(page).toHaveTitle(`${w.project.name} · 创作台 · SceneDesk`);
  await expect(page.getByRole("navigation", { name: "项目导航", exact: true })).toHaveCount(0);
  // Portaled menus must honor the declared icon size outside the studio root.
  await page.getByRole("button", { name: "项目菜单", exact: true }).click();
  const backIcon = page.getByRole("menuitem", { name: "返回项目列表", exact: true }).locator("svg");
  await expect(backIcon).toHaveCSS("width", "14px");
  await expect(backIcon).toHaveCSS("height", "14px");
});
