import type { components } from "@drama/contracts";
import { test as base, expect, startWorkspaceRuntime, type WorkspaceFixture } from "./fixture.js";
import { startShotMedia } from "./shot-media.js";

const test = base.extend({
  runtime: [async ({}, use) => {
    const media = await startShotMedia();
    try {
      const runtime = await startWorkspaceRuntime({ media: media.media });
      try { await use(runtime); } finally { await runtime.stop(); }
    } finally { await media.stop(); }
  }, { scope: "worker", timeout: 120_000 }],
});

type Schema<K extends keyof components["schemas"]> = components["schemas"][K];
async function addProject(w: WorkspaceFixture, name: string) {
  const members = await w.command<{ items: Schema<"Membership">[] }>("GET", `${w.tenantPath}/members`);
  return w.command<Schema<"Project">>("POST", `${w.tenantPath}/projects`, {
    name, leadMembershipId: members.items[0]!.id,
    spec: { width: 1920, height: 1080, fpsNum: 24000, fpsDen: 1001, language: "zh-CN" },
  });
}
const listUrl = (w: WorkspaceFixture) => `${w.runtime.origin}/#/app/t/${w.tenant.id}`;
const studioUrl = (w: WorkspaceFixture) => `${w.runtime.origin}${w.basePath}/studio`;

test("project entry: real status counts, search, poster geometry, settings and archived entry", async ({ page, workspace: w }, info) => {
  const long = await addProject(w, "E2E 山海之间的一封很长很长的未寄出的信");
  const archived = await addProject(w, "E2E 旧日来信");
  await w.command("POST", `${w.tenantPath}/projects/${archived.id}/archive`, undefined, archived.revision);
  await page.goto(listUrl(w));
  await expect(page.getByRole("tab", { name: "进行中2", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "已归档1", exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  const card = page.getByRole("article", { name: w.project.name, exact: true });
  await expect(card).toContainText("竖屏 · 9:16 · 24 fps");
  await expect(card.getByText("暂无预览", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: long.name, exact: true })).toContainText("横屏 · 16:9 · 23.976 fps");
  const poster = card.getByRole("link", { name: `进入项目 ${w.project.name}`, exact: true });
  const rect = await poster.boundingBox();
  expect(rect!.width).toBeGreaterThanOrEqual(216);
  expect(rect!.width).toBeLessThanOrEqual(248);
  expect(rect!.width / rect!.height).toBeCloseTo(3 / 4, 2);
  await page.screenshot({ path: info.outputPath("projects-1440.png"), animations: "disabled" });
  await card.getByRole("button", { name: `${w.project.name}的更多操作`, exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "项目设置", exact: true })).toHaveAttribute("href", w.basePath.slice(1));
  await page.keyboard.press("Escape");
  const search = page.getByRole("textbox", { name: "查找项目", exact: true });
  await search.fill("山海");
  await expect(page.getByRole("article")).toHaveCount(1);
  await search.fill("不存在");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("button", { name: "清空搜索", exact: true }).click();
  await page.getByRole("tab", { name: "已归档1", exact: true }).click();
  const old = page.getByRole("article", { name: archived.name, exact: true });
  await expect(old).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await old.getByRole("link", { name: "查看项目", exact: true }).click();
  await expect(page.getByRole("banner")).toContainText(archived.name);
  await page.getByRole("button", { name: "项目菜单", exact: true }).click();
  await expect(page.getByRole("menuitem").filter({ hasText: archived.name })).toContainText("已归档 · 只读");
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "返回项目列表", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  const narrow = await poster.boundingBox();
  expect(narrow!.x + narrow!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("projects-390.png"), animations: "disabled" });
});

test("project navigation: current context, keyboard, guarded switch and assistant draft retention", async ({ page, workspace: w }, info) => {
  const other = await addProject(w, "E2E 山海之间");
  const sceneUrl = `${studioUrl(w)}?scene=${w.scene.id}`;
  await page.goto(sceneUrl);
  await page.getByRole("button", { name: "创建场次创作台", exact: true }).click();
  const saved = page.getByRole("button", { name: "创作台保存状态：已保存", exact: true });
  await expect(saved).toBeVisible();
  const trigger = page.getByRole("button", { name: "项目菜单", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const current = page.getByRole("menuitem", { name: w.project.name, exact: true });
  await expect(current).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("textbox", { name: "搜索其他项目", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: info.outputPath("project-navigation-1440.png"), animations: "disabled" });
  await current.click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page).toHaveURL(sceneUrl);
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  await page.goto(studioUrl(w));
  await page.getByRole("button", { name: "创建项目创作台", exact: true }).click();
  await expect(saved).toBeVisible();
  await page.getByRole("button", { name: "助手", exact: true }).click();
  const draft = "项目切换前尚未发送的故事构思。";
  await page.getByRole("textbox", { name: "发送给画布助手", exact: true }).fill(draft);
  await trigger.click();
  await page.getByRole("menuitem", { name: other.name, exact: true }).click();
  await expect(page).toHaveURL(`${listUrl(w)}/p/${other.id}/studio`);
  await trigger.click();
  await page.getByRole("menuitem", { name: w.project.name, exact: true }).click();
  await expect(page).toHaveURL(studioUrl(w));
  await expect(saved).toBeVisible();
  await expect(page.getByRole("textbox", { name: "发送给画布助手", exact: true })).toHaveValue(draft);
  await page.getByRole("button", { name: "关闭助手", exact: true }).click();
  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const positions = await Promise.all([
      trigger.boundingBox(), page.getByRole("button", { name: /^切换画布：/ }).boundingBox(),
      saved.boundingBox(), page.getByRole("button", { name: "任务", exact: true }).boundingBox(),
      page.getByRole("button", { name: "助手", exact: true }).boundingBox(),
      page.getByRole("navigation", { name: "创作区视图", exact: true }).boundingBox(),
      page.getByRole("button", { name: "账号与退出登录", exact: true }).boundingBox(),
    ]);
    for (const rect of positions) {
      expect(rect).not.toBeNull();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
    }
    for (let a = 0; a < positions.length; a++) for (let b = a + 1; b < positions.length; b++) {
      const x = positions[a]!, y = positions[b]!;
      expect(x.x + x.width <= y.x || y.x + y.width <= x.x || x.y + x.height <= y.y || y.y + y.height <= x.y).toBe(true);
    }
    await trigger.click();
    await expect(page.getByRole("menu")).toHaveCSS("opacity", "1");
    const menu = await page.getByRole("menu").boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`project-navigation-${width}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "账号与退出登录", exact: true }).click();
  await page.getByRole("menuitem", { name: "切换深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "dark");
  await page.reload();
  await expect(saved).toBeVisible();
  await trigger.click();
  await expect(page.getByRole("menu")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: info.outputPath("project-navigation-dark.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "返回项目列表", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("projects-dark.png"), animations: "disabled" });
});

test("project navigation: searchable list and failed refresh conceal stale entries until retry", async ({ page, workspace: w }) => {
  for (let i = 1; i <= 6; i++) await addProject(w, `E2E 第${i}个故事`);
  await page.goto(studioUrl(w));
  const trigger = page.getByRole("button", { name: "项目菜单", exact: true });
  await trigger.click();
  const search = page.getByRole("textbox", { name: "搜索其他项目", exact: true });
  await search.fill("第3个");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "E2E 第3个故事", exact: true })).toBeFocused();
  await search.fill("不存在");
  await expect(page.getByText("没有匹配的项目", { exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "清空搜索", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: w.project.name, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.clock.install();
  await page.clock.fastForward(10_001);
  // Transport failure only; every successful business response still comes from the real API.
  await page.route(`**${w.tenantPath}/projects?*`, (route) => route.abort("failed"));
  await page.getByRole("link", { name: "返回项目列表", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.goBack();
  await trigger.click();
  await expect(page.getByText("项目列表暂不可用", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: w.project.name, exact: true })).toHaveCount(0);
  await page.unroute(`**${w.tenantPath}/projects?*`);
  await page.getByRole("menuitem", { name: "重新加载项目", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: w.project.name, exact: true })).toBeVisible();
});
