import { randomUUID } from "node:crypto";
import type { components } from "@drama/contracts";
import { test, expect, type WorkspaceFixture } from "./fixture.js";

type Schema<K extends keyof components["schemas"]> = components["schemas"][K];

// The LibTV reference frames are 1920 px wide; the side-by-side review uses the same frame.
test.use({ viewport: { width: 1920, height: 902 } });

function studio(w: WorkspaceFixture) {
  const path = `${w.tenantPath}/projects/${w.project.id}`;
  return {
    url: `${w.runtime.origin}${w.basePath}/studio`,
    path,
    canvas: () => w.command<Schema<"ProjectCanvas">>("GET", `${path}/canvas`),
    preference: () =>
      w.command<Schema<"ProjectWorkspacePreference">>("GET", `${path}/workspace-preference`),
  };
}

test("ST-01: the board creates, edits, renames, saves and restores cards through the engine", async ({ page, workspace: w }, info) => {
  const s = studio(w);
  await page.goto(s.url);
  await page.getByRole("button", { name: "创建项目创作台", exact: true }).click();
  const status = page.getByRole("button", { name: "创作台保存状态：已保存", exact: true });
  await expect(status).toBeVisible();
  const board = page.getByRole("main", { name: "创作台", exact: true });

  // Add a text card from the bottom toolbar; it opens in place for typing.
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("menuitem", { name: "文字", exact: true }).click();
  const note = "雨夜街角，人物停步回望。\n同一文字卡承载场景描述和镜头意图。";
  const input = page.getByRole("textbox", { name: "文字内容", exact: true });
  await expect(input).toBeFocused();
  await input.fill(note);
  await expect(board.getByText("文字 1", { exact: true })).toBeVisible();
  const textShot = info.outputPath("studio-text-edit-1920.png");
  await page.screenshot({ path: textShot, animations: "disabled" });
  await info.attach("studio-text-edit-1920", { path: textShot, contentType: "image/png" });
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(board.getByText(note.split("\n")[0]!, { exact: false })).toBeVisible();
  // The engine autosaves; the public read must hold the text.
  await expect(status).toBeVisible();
  await expect.poll(async () => (await s.canvas()).canvas.document.nodes[0]?.content).toEqual({ type: "text", text: note });

  // An image draft: empty frame, selected on creation, ports visible.
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("menuitem", { name: "图片", exact: true }).click();
  const image = board.getByRole("article", { name: "图片 1 · 图片", exact: true });
  await expect(image).toBeVisible();
  await expect(image.locator("xpath=..")).toHaveAttribute("data-selected", "true");
  const selectedShot = info.outputPath("studio-image-selected-1920.png");
  await page.screenshot({ path: selectedShot, animations: "disabled" });
  await info.attach("studio-image-selected-1920", { path: selectedShot, contentType: "image/png" });

  // Rename by double-clicking the label.
  await board.getByText("图片 1", { exact: true }).dblclick();
  const name = page.getByRole("textbox", { name: "卡片名称", exact: true });
  await expect(name).toBeFocused();
  await name.fill("首帧");
  await name.press("Enter");
  await expect(board.getByRole("article", { name: "首帧 · 图片", exact: true })).toBeVisible();
  await expect.poll(async () => (await s.canvas()).canvas.document.nodes.map((node) => node.title)).toEqual(["文字 1", "首帧"]);

  // Shortcuts overview lists only what exists.
  await page.getByRole("button", { name: "快捷键", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "快捷键", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("适应内容", { exact: true })).toBeVisible();
  const shortcutsShot = info.outputPath("studio-shortcuts-1920.png");
  await page.screenshot({ path: shortcutsShot, animations: "disabled" });
  await info.attach("studio-shortcuts-1920", { path: shortcutsShot, contentType: "image/png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Zoom is a view preference and survives a reload, as does the document.
  const zoom = page.getByRole("button", { name: "创作台缩放", exact: true });
  await expect(zoom).toHaveText("100%");
  await zoom.click();
  await page.getByRole("menuitem", { name: "缩小", exact: true }).click();
  // One step out is 1/1.2; the label settles when the animation ends.
  const zoomLabel = "83%";
  await expect(zoom).toHaveText(zoomLabel);
  await expect.poll(async () => `${Math.round((await s.preference()).viewport.zoom * 100)}%`).toBe(zoomLabel);
  await page.reload();
  await expect(status).toBeVisible();
  await expect(board.getByText(note.split("\n")[0]!, { exact: false })).toBeVisible();
  await expect(board.getByRole("article", { name: "首帧 · 图片", exact: true })).toBeVisible();
  await expect(zoom).toHaveText(zoomLabel);

  // Delete with the key, bring it back with undo; delete again from the context menu.
  await board.getByRole("article", { name: "首帧 · 图片", exact: true }).click();
  await page.keyboard.press("Delete");
  await expect(board.getByRole("article", { name: "首帧 · 图片", exact: true })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(board.getByRole("article", { name: "首帧 · 图片", exact: true })).toBeVisible();
  await board.getByRole("article", { name: "首帧 · 图片", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(board.getByRole("article", { name: "首帧 · 图片", exact: true })).toHaveCount(0);
  await expect.poll(async () => (await s.canvas()).canvas.document.nodes.map((node) => node.title)).toEqual(["文字 1"]);
});

test("ST-01: an archived project shows its board read-only and keeps its revision", async ({ page, workspace: w }) => {
  const s = studio(w);
  const ensured = await w.runtime.request<Schema<"ProjectCanvas">>(w.owner, "POST", `${s.path}/canvas`);
  expect(ensured.status).toBe(200);
  const original = ensured.value.canvas;
  const node = { id: randomUUID(), kind: "text", title: "归档记录", position: { x: 240, y: 200 }, width: 280,
    content: { type: "text", text: "归档前已固定的创作内容。" } };
  const saved = await w.command<Schema<"Canvas">>("PUT", `${s.path}/canvases/${original.id}`, {
    schemaVersion: 1, document: { nodes: [node], edges: [], groups: [] },
  }, original.revision);
  const project = await w.command<Schema<"Project">>("GET", s.path);
  await w.command("POST", `${s.path}/archive`, undefined, project.revision);
  await page.goto(s.url);
  await expect(page.getByText("项目已归档，可继续查看原有创作台。", { exact: true })).toBeVisible();
  await expect(page.getByText(node.content.text, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "添加", exact: true })).toBeDisabled();
  await page.getByText(node.content.text, { exact: true }).dblclick();
  await expect(page.getByRole("textbox", { name: "文字内容", exact: true })).toHaveCount(0);
  expect((await s.canvas()).canvas.revision).toBe(saved.revision);
});

test("ST-01: a revoked collaborator cannot reopen the cached board or read its document", async ({ page, context, workspace: w }) => {
  const s = studio(w);
  const ensured = await w.runtime.request<Schema<"ProjectCanvas">>(w.owner, "POST", `${s.path}/canvas`);
  expect(ensured.status).toBe(200);
  const collaborator = await w.runtime.identity("board-collaborator"), membershipId = randomUUID();
  await w.runtime.database.admin.query(
    `INSERT INTO "${w.runtime.database.schema}".memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')`,
    [membershipId, w.tenant.id, collaborator.userId],
  );
  const grant = await w.command<{ revision: number }>("POST", `${s.path}/members`, { membershipId });
  await context.clearCookies();
  await context.addCookies([{ name: "session", value: collaborator.token, url: w.runtime.origin, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(s.url);
  await expect(page.getByRole("button", { name: "创作台保存状态：已保存", exact: true })).toBeVisible();
  const views = page.getByRole("navigation", { name: "创作区视图", exact: true });
  await views.getByRole("link", { name: "剧本", exact: true }).click();
  await expect(page).toHaveURL(`${s.url}/script`);
  await w.command("DELETE", `${s.path}/members/${membershipId}`, undefined, grant.revision);
  await views.getByRole("link", { name: "创作台", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "操作未完成" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^创作台保存状态：/ })).toHaveCount(0);
  await expect(page.getByText(w.project.name, { exact: true })).toHaveCount(0);
  await expect(page).not.toHaveTitle(new RegExp(w.project.name));
  expect((await w.runtime.request(collaborator, "GET", `${s.path}/canvas`)).status).toBe(404);
  expect((await w.runtime.request(collaborator, "GET", `${s.path}/canvases/${ensured.value.canvas.id}`)).status).toBe(404);
});
