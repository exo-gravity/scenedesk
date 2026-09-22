import { randomUUID } from "node:crypto";
import type { components } from "@drama/contracts";
import { test, expect, type WorkspaceFixture } from "./fixture.js";

type Schema<K extends keyof components["schemas"]> = components["schemas"][K];
test.use({ viewport: { width: 1920, height: 902 } });
const base = (w: WorkspaceFixture) => `${w.runtime.origin}${w.basePath}`;

test("ST-09: the studio is the only creative entry: old addresses open it, the project and content pages lead to it, and an archived project stays readable", async ({ page, workspace: w }, info) => {
  const studio = `${base(w)}/studio`;
  const href = `${w.basePath.slice(1)}/studio`;

  // Old addresses live on in history and receipts; each opens the same thing in the studio.
  await page.goto(`${base(w)}/canvas`);
  await expect(page).toHaveURL(studio);
  await expect(page).toHaveTitle(`${w.project.name} · 创作台 · SceneDesk`);
  await page.goto(`${base(w)}/production?scene=${w.scene.id}&mode=canvas`);
  await expect(page).toHaveURL(`${studio}?scene=${w.scene.id}`);
  await expect(page.getByText(`${w.episode.title} · ${w.scene.title} 创作台还没有内容`, { exact: true })).toBeVisible();
  await page.goto(`${base(w)}/script?revision=${w.first.id}`);
  await expect(page).toHaveURL(`${studio}/script?revision=${w.first.id}`);
  await expect(page.getByRole("article", { name: "剧本阅读正文", exact: true })).toContainText("第一稿：林在雨夜发现一封没有署名的信。");
  // A scene that is not in this project is a wrong address, not lost access: the project stays open.
  await page.goto(`${studio}?scene=00000000-0000-4000-8000-000000000000`);
  await expect(page.getByText("这个项目里没有这一场", { exact: true })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText(w.project.name);
  await expect(page.getByRole("alert")).toHaveCount(0);
  // The story settings tab of the old script page now lives on the project page.
  await page.goto(`${base(w)}/script?tab=settings`);
  await expect(page).toHaveURL(base(w));
  await page.getByRole("button", { name: "查看剧目设定", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "剧目设定", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // The project card opens the studio.
  await page.goto(`${w.runtime.origin}/#/app/t/${w.tenant.id}`);
  await page.locator(`a[href="${href}"]`).first().click();
  await expect(page).toHaveURL(studio);
  await expect(page.getByRole("main", { name: "创作台", exact: true })).toBeVisible();
  const shot = info.outputPath("studio-switch-1920.png");
  await page.screenshot({ path: shot, animations: "disabled" });
  await info.attach("studio-switch-1920", { path: shot, contentType: "image/png" });

  // The content page keeps the directory and leads to the scene canvas and the shot organiser; the project rail is gone.
  await page.goto(`${base(w)}/content`);
  await expect(page.getByRole("navigation", { name: "项目导航", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "返回创作台", exact: true })).toHaveAttribute("href", href);
  const row = page.getByRole("article").filter({ hasText: w.scene.title }).first();
  await expect(row.getByRole("link", { name: "打开创作台", exact: true })).toHaveAttribute("href", `${href}?scene=${w.scene.id}`);
  await expect(row.getByRole("link", { name: /镜头 · \d+ 已选用$/ })).toHaveAttribute("href", `${href}/shots?scene=${w.scene.id}`);

  // An archived project stays readable in the studio and refuses new edits.
  const ensured = await w.runtime.request<Schema<"ProjectCanvas">>(w.owner, "POST", `${w.path}/canvas`);
  expect(ensured.status).toBe(200);
  const original = ensured.value.canvas;
  const node = {
    id: randomUUID(), kind: "text", title: "归档记录", position: { x: 0, y: 0 }, width: 280,
    content: { type: "text", text: "归档前已固定的创作内容。" },
  };
  const saved = await w.command<Schema<"Canvas">>(
    "PUT", `${w.path}/canvases/${original.id}`,
    { schemaVersion: 1, document: { nodes: [node], edges: [], groups: [] } },
    original.revision,
  );
  const project = await w.command<Schema<"Project">>("GET", w.path);
  await w.command("POST", `${w.path}/archive`, undefined, project.revision);
  await page.goto(studio);
  await expect(page.getByText("项目已归档，可继续查看原有创作台。", { exact: true })).toBeVisible();
  await expect(page.getByText(node.content.text, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "添加", exact: true })).toBeDisabled();
  expect((await w.runtime.request(w.owner, "PUT", `${w.path}/canvases/${original.id}`, { schemaVersion: 1, document: saved.document }, saved.revision)).status).toBe(409);
  expect((await w.command<Schema<"ProjectCanvas">>("GET", `${w.path}/canvas`)).canvas.revision).toBe(saved.revision);
});
