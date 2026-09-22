import type { components } from "@drama/contracts";
import { test, expect, type WorkspaceFixture } from "./fixture.js";

type Schema<K extends keyof components["schemas"]> = components["schemas"][K];

test.use({ viewport: { width: 1920, height: 902 } });

function studio(w: WorkspaceFixture) {
  const path = `${w.tenantPath}/projects/${w.project.id}`;
  return {
    url: `${w.runtime.origin}${w.basePath}/studio`,
    path,
    canvas: () => w.command<Schema<"ProjectCanvas">>("GET", `${path}/canvas`),
  };
}

async function drag(page: import("@playwright/test").Page, from: import("@playwright/test").Locator, to: import("@playwright/test").Locator) {
  const a = await from.boundingBox(), b = await to.boundingBox();
  if (!a || !b) throw new Error("port not on screen");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test("ST-02: references are made from the ⊕ and by dragging ports, then disabled and removed", async ({ page, workspace: w }, info) => {
  const s = studio(w);
  const crashes: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") console.log("CONSOLE", message.text().replace(/\s+/g, " ").slice(0, 900));
  });
  page.on("pageerror", (error) => {
    crashes.push(error.message);
    console.log("PAGEERROR", error.message, error.stack?.split("\n").slice(0, 40).join(" | "));
  });
  await page.goto(s.url);
  await page.getByRole("button", { name: "创建项目创作台", exact: true }).click();
  const status = page.getByRole("button", { name: "创作台保存状态：已保存", exact: true });
  await expect(status).toBeVisible();
  const board = page.getByRole("main", { name: "创作台", exact: true });

  // A text card with something in it can feed a draft: the ⊕ appears once it is selected.
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("menuitem", { name: "文字", exact: true }).click();
  const input = page.getByRole("textbox", { name: "文字内容", exact: true });
  await expect(input).toBeFocused();
  await input.fill("手从白帆布包中取出青柠气泡水罐的特写。");
  await page.keyboard.press("Escape");
  const text = board.getByRole("article", { name: "文字 1 · 文字", exact: true });
  // Purpose badges of a text card sit in its label row, beside the title.
  const textCard = text.locator("xpath=..");
  await text.click();
  await page.getByRole("button", { name: "继续创作", exact: true }).click();
  // The ⊕ menu has no 文字 item; the toolbar's add menu does.
  const plusMenu = page.getByRole("menu").filter({ hasNot: page.getByRole("menuitem", { name: "文字", exact: true }) });
  await expect(plusMenu).toBeVisible();
  await plusMenu.getByRole("menuitem", { name: "视频", exact: true }).click();
  const video = board.getByRole("article", { name: "新的视频草稿 · 视频", exact: true });
  await expect(video).toBeVisible();
  await expect(video.locator("xpath=..")).toHaveAttribute("data-selected", "true");
  await expect(textCard.getByText("提示", { exact: true })).toBeVisible();
  await expect(status).toBeVisible();
  let canvas = (await s.canvas()).canvas;
  expect(canvas.document.edges).toHaveLength(1);
  expect(canvas.document.edges[0]).toMatchObject({ purpose: "prompt", enabled: true, position: 0 });
  expect(canvas.document.nodes[1]).toMatchObject({ kind: "video", content: { type: "draft", prompt: "" } });
  // A draft cannot be a source: no ⊕ for it, and no continue from the menu.
  await expect(page.getByRole("button", { name: "继续创作", exact: true })).toHaveCount(0);
  await video.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /^继续创作/ })).toBeDisabled();
  await page.keyboard.press("Escape");

  // Drag from the text card's port to a new image draft's port.
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("menuitem", { name: "图片", exact: true }).click();
  const image = board.getByRole("article", { name: "图片 1 · 图片", exact: true });
  await expect(image).toBeVisible();
  await text.click();
  await drag(page, text.locator("xpath=..").getByLabel("作为参考", { exact: true }), image.locator("xpath=..").getByLabel("接收参考", { exact: true }));
  expect(crashes).toEqual([]);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await expect(status).toBeVisible();
  canvas = (await s.canvas()).canvas;
  expect(canvas.document.edges).toHaveLength(2);
  const toImage = canvas.document.edges.find((edge) => edge.targetNodeId === canvas.document.nodes[2]!.id);
  expect(toImage).toMatchObject({ purpose: "prompt", enabled: true, position: 0 });
  // The same source and purpose cannot be added twice.
  await drag(page, text.locator("xpath=..").getByLabel("作为参考", { exact: true }), image.locator("xpath=..").getByLabel("接收参考", { exact: true }));
  await expect(page.getByText("这份来源和用途已在参考中", { exact: false })).toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  const shot = info.outputPath("studio-references-1920.png");
  await page.screenshot({ path: shot, animations: "disabled" });
  await info.attach("studio-references-1920", { path: shot, contentType: "image/png" });

  // Disable the first reference from its menu; the badge says so; the document records it.
  await page.mouse.click(300, 700);
  await expect(page.getByRole("button", { name: "继续创作", exact: true })).toHaveCount(0);
  const first = page.locator('.react-flow__edge[aria-label="提示"]').first();
  await first.click({ button: "right", force: true });
  await page.getByRole("menuitem", { name: "停用", exact: true }).click();
  await expect(textCard.getByText("已停用", { exact: true })).toBeVisible();
  await expect(page.locator('.react-flow__edge[aria-label="提示 · 已停用"]')).toHaveCount(1);
  await expect(status).toBeVisible();
  canvas = (await s.canvas()).canvas;
  expect(canvas.document.edges.filter((edge) => !edge.enabled).map((edge) => edge.targetNodeId)).toEqual([canvas.document.nodes[1]!.id]);

  // Select that reference and delete it with the key; only that reference goes.
  await page.locator('.react-flow__edge[aria-label="提示 · 已停用"]').click({ force: true });
  await page.keyboard.press("Delete");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(status).toBeVisible();
  canvas = (await s.canvas()).canvas;
  expect(canvas.document.edges).toHaveLength(1);
  expect(canvas.document.edges[0]!.targetNodeId).toBe(canvas.document.nodes[2]!.id);
  expect(canvas.document.nodes).toHaveLength(3);
});
