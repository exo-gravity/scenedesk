import type { components } from "@drama/contracts";
import { test, expect, type WorkspaceFixture } from "./fixture.js";

type Schema<K extends keyof components["schemas"]> = components["schemas"][K];
test.use({ viewport: { width: 1920, height: 902 } });
const studio = (w: WorkspaceFixture) => `${w.runtime.origin}${w.basePath}/studio`;

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
  await expect(page.getByRole("menuitem", { name: "返回项目列表", exact: true })).toHaveAttribute("href", `#/app/t/${w.tenant.id}`);
  await expect(page.getByRole("menuitem", { name: "项目设置、成员与归档", exact: true })).toHaveAttribute("href", `#/app/t/${w.tenant.id}/p/${w.project.id}`);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "账号与退出登录", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "退出登录", exact: true })).toBeVisible();
  await expect(page.getByText("owner@example.test", { exact: true })).toBeVisible();
});
