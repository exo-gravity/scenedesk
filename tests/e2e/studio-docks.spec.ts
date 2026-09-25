import type { components } from "@drama/contracts";
import { test, expect, type WorkspaceFixture } from "./fixture.js";

type Schema<K extends keyof components["schemas"]> = components["schemas"][K];
test.use({ viewport: { width: 1920, height: 902 } });
const studio = (w: WorkspaceFixture) => `${w.runtime.origin}${w.basePath}/studio`;

test("compact studio keeps tools and panels inside the viewport and offers one assistant close control", async ({ page, workspace: w }, info) => {
  await page.goto(studio(w));
  await page.getByRole("button", { name: "创建项目创作台", exact: true }).click();
  await expect(page.getByRole("button", { name: "创作台保存状态：已保存", exact: true })).toBeVisible();
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const toolbar = page.getByRole("toolbar", { name: "创作台工具", exact: true });
    const assets = page.getByRole("button", { name: "资产", exact: true });
    const a = (await toolbar.boundingBox())!, b = (await assets.boundingBox())!;
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x + a.width).toBeLessThanOrEqual(width);
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    await assets.click();
    const panel = page.getByRole("region", { name: "资产面板", exact: true });
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(b.y);
    const search = panel.getByRole("textbox", { name: "搜索资产与素材", exact: true });
    await search.focus();
    await expect(search).toHaveCSS("outline-style", "solid");
    await page.screenshot({ path: info.outputPath(`studio-assets-${width}.png`), animations: "disabled" });
    await panel.getByRole("button", { name: "关闭资产面板", exact: true }).click();
    await page.getByRole("button", { name: "助手", exact: true }).click();
    const assistant = page.getByRole("region", { name: "助手", exact: true });
    await expect(assistant.getByRole("textbox", { name: "发送给画布助手", exact: true })).toBeVisible();
    await expect(assistant.getByRole("button", { name: "收起 AI 助手", exact: true })).toHaveCount(0);
    await expect(assistant.getByRole("button", { name: "关闭助手", exact: true })).toHaveCount(1);
    const dock = (await assistant.boundingBox())!;
    expect(dock.x).toBeGreaterThanOrEqual(0);
    expect(dock.x + dock.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`studio-assistant-${width}.png`), animations: "disabled" });
    await assistant.getByRole("button", { name: "关闭助手", exact: true }).click();
  }
});

test("ST-08: the assistant and task docks, the canvas switch to a scene canvas, the project menu and the account", async ({ page, workspace: w }, info) => {
  await page.goto(studio(w));
  await page.getByRole("button", { name: "创建项目创作台", exact: true }).click();
  const status = page.getByRole("button", { name: "创作台保存状态：已保存", exact: true });
  await expect(status).toBeVisible();

  // Assistant: opens docked, keeps its draft while closed and across a reload; can float.
  const assistantToggle = page.getByRole("button", { name: "助手", exact: true });
  await assistantToggle.click();
  const assistant = page.getByRole("region", { name: "助手", exact: true });
  await expect(assistant).toBeVisible();
  await expect(assistant).toHaveAttribute("data-mode", "docked");
  const draft = "尚未发送：帮我讨论这个故事的色彩方向。";
  await assistant.getByRole("textbox", { name: "发送给画布助手", exact: true }).fill(draft);
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await expect(page.getByRole("region", { name: "任务", exact: true })).toBeVisible();
  await expect(assistant).toHaveCount(0);
  await expect(assistantToggle).toHaveAttribute("aria-pressed", "false");
  await assistantToggle.click();
  await expect(page.getByRole("region", { name: "任务", exact: true })).toHaveCount(0);
  await expect(assistant.getByRole("textbox", { name: "发送给画布助手", exact: true })).toHaveValue(draft);
  await assistant.getByRole("button", { name: "改为浮窗", exact: true }).click();
  await expect(assistant).toHaveAttribute("data-mode", "floating");
  const shot = info.outputPath("studio-docks-1920.png");
  await page.screenshot({ path: shot, animations: "disabled" });
  await info.attach("studio-docks-1920", { path: shot, contentType: "image/png" });
  await assistant.getByRole("button", { name: "关闭助手", exact: true }).click();
  await expect(assistant).toHaveCount(0);
  await expect.poll(async () => (await w.command<Schema<"ProjectWorkspacePreference">>("GET", `${w.path}/workspace-preference`)).assistantOpen).toBe(false);
  await assistantToggle.click();
  await expect(assistant.getByRole("textbox", { name: "发送给画布助手", exact: true })).toHaveValue(draft);
  await expect.poll(async () => (await w.command<Schema<"ProjectWorkspacePreference">>("GET", `${w.path}/workspace-preference`)).assistantOpen).toBe(true);
  await page.reload();
  await expect(status).toBeVisible();
  await expect(assistant).toBeVisible();
  await expect(assistant.getByRole("textbox", { name: "发送给画布助手", exact: true })).toHaveValue(draft);
  await assistant.getByRole("button", { name: "关闭助手", exact: true }).click();

  // Tasks: the canvas's attempts and the file imports, in one dock.
  await page.getByRole("button", { name: "任务", exact: true }).click();
  const tasks = page.getByRole("region", { name: "任务", exact: true });
  await expect(tasks).toBeVisible();
  await expect(tasks.getByText("还没有固定尝试", { exact: false })).toBeVisible();
  await tasks.getByRole("tab", { name: "文件导入", exact: true }).click();
  await expect(tasks.getByText("没有需要处理的文件导入。", { exact: true })).toBeVisible();
  await tasks.getByRole("button", { name: "关闭任务", exact: true }).click();
  await expect(tasks).toHaveCount(0);

  // Canvas switch: the seeded scene gets its own canvas, addressed by ?scene=.
  await page.getByRole("button", { name: /^切换画布：/ }).click();
  await page.getByRole("dialog", { name: /^切换画布/ }).getByRole("button", { name: `${w.episode.title} · ${w.scene.title}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/studio\\?scene=${w.scene.id}$`));
  await expect(page.getByText(`${w.episode.title} · ${w.scene.title} 创作台还没有内容`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "创建场次创作台", exact: true }).click();
  await expect(status).toBeVisible();
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("menuitem", { name: "文字", exact: true }).click();
  await page.getByRole("textbox", { name: "文字内容", exact: true }).fill("本场的第一张画面。");
  await page.keyboard.press("Escape");
  await expect(status).toBeVisible();
  await expect.poll(async () => (await w.command<Schema<"SceneCanvas">>("GET", `${w.path}/scenes/${w.scene.id}/canvas`)).canvas.document.nodes.length).toBe(1);
  expect((await w.command<Schema<"ProjectCanvas">>("GET", `${w.path}/canvas`)).canvas.document.nodes).toHaveLength(0);
  // The scene canvas keeps its own view preference: its selected card is written there, never to the project's.
  const sceneNode = (await w.command<Schema<"SceneCanvas">>("GET", `${w.path}/scenes/${w.scene.id}/canvas`)).canvas.document.nodes[0]!.id;
  await expect.poll(async () => (await w.command<Schema<"SceneWorkspacePreference">>("GET", `${w.path}/scenes/${w.scene.id}/workspace-preference`)).selectedNodeIds).toContain(sceneNode);
  expect((await w.command<Schema<"ProjectWorkspacePreference">>("GET", `${w.path}/workspace-preference`)).selectedNodeIds ?? []).not.toContain(sceneNode);
  await page.getByRole("button", { name: /^切换画布：/ }).click();
  await page.getByRole("dialog", { name: /^切换画布/ }).getByRole("button", { name: "项目画布", exact: true }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await expect(status).toBeVisible();

  // Project menu and account.
  await page.getByRole("button", { name: "项目菜单", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "所有项目", exact: true })).toHaveAttribute("href", `#/app/t/${w.tenant.id}`);
  await expect(page.getByRole("menuitem", { name: "项目设置", exact: true })).toHaveAttribute("href", `#/app/t/${w.tenant.id}/p/${w.project.id}`);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "账号与退出登录", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "退出登录", exact: true })).toBeVisible();
  await expect(page.getByText("owner@example.test", { exact: true })).toBeVisible();
});
