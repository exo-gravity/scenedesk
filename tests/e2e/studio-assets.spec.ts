import { test, expect } from "./continuous-workspace-fixture.js";

test.use({ viewport: { width: 1920, height: 902 } });

test("ST-05: the assets panel lists, searches and drags media onto the board; the library stays its own page", async ({ page, continuous: f }, info) => {
  await page.goto(`${f.origin}/#/app/t/${f.tenant.id}/p/${f.project.id}/studio`);
  const status = page.getByRole("button", { name: "创作台保存状态：已保存", exact: true });
  await expect(status).toBeVisible();
  const board = page.getByRole("main", { name: "创作台", exact: true });
  const toggle = page.getByRole("button", { name: "资产", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  const panel = page.getByRole("region", { name: "资产面板", exact: true });
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByRole("link", { name: "管理资产", exact: true })).toHaveAttribute("href", `#/app/t/${f.tenant.id}/p/${f.project.id}/assets`);
  const item = panel.locator("[aria-label='合成参考图 · 图片']");
  await expect(item).toBeVisible();
  await expect.poll(async () => (await f.ok("GET", `${f.path}/workspace-preference`)).assetPanelOpen).toBe(true);
  const shot = info.outputPath("studio-assets-1920.png");
  await page.screenshot({ path: shot, animations: "disabled" });
  await info.attach("studio-assets-1920", { path: shot, contentType: "image/png" });

  // Search narrows both lists; clearing brings them back.
  const search = panel.getByRole("textbox", { name: "搜索资产与素材", exact: true });
  await search.fill("不存在的名字");
  await expect(panel.getByText("没有匹配的素材", { exact: true })).toBeVisible();
  await expect(item).toHaveCount(0);
  await search.fill("");
  await expect(item).toBeVisible();

  // Dragging a media row onto the board makes a media card at the drop point.
  const before = await f.ok("GET", `${f.path}/canvases/${f.canvas.id}`);
  expect(before.document.nodes).toHaveLength(2);
  await item.dragTo(board, { targetPosition: { x: 1300, y: 600 } });
  await expect(board.getByRole("article", { name: "合成参考图 · 图片", exact: true })).toHaveCount(2);
  await expect(status).toBeVisible();
  const after = await f.ok("GET", `${f.path}/canvases/${f.canvas.id}`);
  expect(after.document.nodes).toHaveLength(3);
  const placed = after.document.nodes[2];
  expect(placed.content).toEqual({ type: "media", mediaId: f.canvas.document.nodes[0].content.mediaId });
  expect(placed.kind).toBe("image");
  expect((await f.ok("GET", `${f.path}/takes`)).items).toHaveLength(0);

  // One press adds it too, at the centre of the view.
  await item.hover();
  await panel.getByRole("button", { name: "加入创作台：合成参考图", exact: true }).click();
  await expect(board.getByRole("article", { name: "合成参考图 · 图片", exact: true })).toHaveCount(3);
  // Let the autosave land before leaving; reloading earlier would rightly offer local recovery.
  await expect.poll(async () => (await f.ok("GET", `${f.path}/canvases/${f.canvas.id}`)).document.nodes.length).toBe(4);
  await expect(status).toBeVisible();

  // The panel stays open across a reload, and closes from its own corner.
  await page.reload();
  await expect(status).toBeVisible();
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "关闭资产面板", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect.poll(async () => (await f.ok("GET", `${f.path}/workspace-preference`)).assetPanelOpen).toBe(false);
});

test("project posters: authorized image fills the poster and failed media stays distinct from an empty project", async ({ page, continuous: f }, info) => {
  await page.goto(`${f.origin}/#/app/t/${f.tenant.id}`);
  const card = page.getByRole("article", { name: f.project.name, exact: true });
  const image = card.locator("img");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  await expect(image).toHaveCSS("object-fit", "cover");
  const cover = card.getByRole("link", { name: `进入项目 ${f.project.name}`, exact: true });
  const frame = await cover.boundingBox(), picture = await image.boundingBox();
  expect(frame!.width / frame!.height).toBeCloseTo(3 / 4, 2);
  expect(picture!.width).toBeCloseTo(frame!.width - 2, 0);
  expect(picture!.height).toBeCloseTo(frame!.height - 2, 0);
  const mediaOrigin = new URL((await image.getAttribute("src"))!).origin;
  await page.route((url) => url.origin === mediaOrigin, (route) => route.abort("failed"));
  await page.reload();
  await expect(card.getByText("预览暂不可用", { exact: true })).toBeVisible();
  await expect(card.getByText("暂无预览", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("project-preview-unavailable.png"), animations: "disabled" });
  await cover.click();
  await expect(page).toHaveURL(`${f.origin}/#/app/t/${f.tenant.id}/p/${f.project.id}/studio`);
});
