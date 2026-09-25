import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { components } from "@drama/contracts";
import { test as base, expect, startWorkspaceRuntime } from "./fixture.js";
import { startShotMedia } from "./shot-media.js";
import { seedShotList } from "./shot-list-fixture.js";
import { selectedScene } from "./selected-delivery-fixture.js";
import { readZip } from "../support/read-zip.js";

type Schema<K extends keyof components["schemas"]> = components["schemas"][K];
const test = base.extend({
  runtime: [
    async ({}, use) => {
      const storage = await startShotMedia();
      try {
        const runtime = await startWorkspaceRuntime({ media: storage.media });
        try { await use(runtime); } finally { await runtime.stop(); }
      } finally { await storage.stop(); }
    },
    { scope: "worker", timeout: 120_000 },
  ],
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

test.use({ viewport: { width: 1920, height: 902 } });

test("empty shots offer a direct start and keep the scene when continuing to the canvas", async ({ page, workspace: w }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`${w.runtime.origin}${w.basePath}/studio/shots?scene=${w.scene.id}`);
  const empty = page.getByRole("region", { name: "本场还没有镜头", exact: true });
  await expect(empty).toBeVisible();
  const download = page.getByRole("button", { name: "下载本场已选用", exact: true });
  await expect(download).toBeDisabled();
  await expect(page.getByRole("button", { name: "调整顺序", exact: true })).toBeDisabled();
  await download.locator("..").hover();
  await expect(page.getByRole("tooltip")).toHaveText("先明确选用至少一个镜头");
  await page.mouse.move(700, 700);
  await page.screenshot({ path: info.outputPath("shots-empty-light.png"), animations: "disabled" });
  await page.getByRole("button", { name: "账号与退出登录", exact: true }).click();
  await page.getByRole("menuitem", { name: "切换深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "dark");
  await page.screenshot({ path: info.outputPath("shots-empty-dark.png"), animations: "disabled" });
  await empty.getByRole("button", { name: "新增镜头", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新增镜头", exact: true });
  const name = dialog.getByRole("textbox", { name: "镜头名称", exact: true });
  await expect(name).toBeFocused();
  await name.fill("01 门口停步");
  await dialog.getByRole("button", { name: "创建镜头", exact: true }).click();
  const detail = page.getByRole("region", { name: "镜头 01 门口停步", exact: true });
  await expect(detail).toContainText("这个镜头还没有视频候选");
  await page.screenshot({ path: info.outputPath("shot-no-candidates-dark.png"), animations: "disabled" });
  await detail.getByRole("button", { name: "前往本场创作台", exact: true }).click();
  await expect(page).toHaveURL(`${w.runtime.origin}${w.basePath}/studio?scene=${w.scene.id}`);
  await expect(page.getByRole("button", { name: "创建场次创作台", exact: true })).toBeVisible();
  expect((await w.runtime.request(w.owner, "GET", `${w.path}/scenes/${w.scene.id}/canvas`)).status).toBe(404);
});

test("ST-07: a board video becomes a fixed candidate, is explicitly selected, shows in the list, downloads exactly and reorders", async ({ page, workspace: w }, info) => {
  const seeded = await seedShotList(w);
  const studio = `${w.runtime.origin}${w.basePath}/studio`;
  // The board's "登记为镜头候选" arrives here with the video; opening a shot offers the candidate.
  await page.goto(`${studio}/shots?media=${seeded.blue.id}&shot=${seeded.shot.id}`);
  await expect(page).toHaveTitle(`${w.project.name} · 镜头整理 · SceneDesk`);
  const list = page.getByRole("list", { name: "镜头列表", exact: true });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list.getByRole("listitem").nth(2)).toContainText("已归档");
  const detail = page.getByRole("region", { name: "镜头 01 推门", exact: true });
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "从所选画布视频建立候选", exact: true }).click();
  await detail.getByRole("textbox", { name: "入点（秒）", exact: true }).fill("0.5");
  await detail.getByRole("textbox", { name: "出点（秒）", exact: true }).fill("2.5");
  await detail.getByRole("textbox", { name: "候选说明", exact: true }).fill("受控蓝片，半秒到两秒半。未执行真实模型。");
  await detail.getByRole("button", { name: "归档为候选", exact: true }).click();
  await expect(detail.getByRole("button", { name: /^采用候选 \d+$/ }).first()).toBeEnabled();
  const takes = (await seeded.takes()).items;
  const blueTake = takes.find((t) => t.mediaId === seeded.blue.id)!;
  expect(blueTake.range).toEqual({ inUs: 500000, outUs: 2500000 });
  expect((await seeded.selection()).currentSelection).toBeUndefined();
  const blueIndex = takes.findIndex((t) => t.id === blueTake.id) + 1;
  await detail.getByRole("button", { name: `采用候选 ${blueIndex}`, exact: true }).click();
  await detail.getByRole("textbox", { name: "采用理由（可选）", exact: true }).fill("这版动作更清楚。");
  await detail.getByRole("button", { name: "确认采用", exact: true }).click();
  await expect(detail.getByRole("button", { name: "下载已选用原片", exact: true })).toBeVisible();
  expect((await seeded.selection()).currentSelection!.takeId).toBe(blueTake.id);
  // Downloading is the fixed selection, whatever is being previewed.
  const orangeIndex = takes.findIndex((t) => t.id === seeded.orangeTake.id) + 1;
  await detail.getByRole("button", { name: `预览候选 ${orangeIndex}`, exact: true }).click();
  await expect(detail.getByRole("button", { name: /^采用候选 \d+$/ })).toHaveCount(1);
  await expect(detail.getByRole("status").filter({ hasText: "正在预览" })).toHaveText(`正在预览 · 候选 ${orangeIndex}`);
  const downloadEvent = page.waitForEvent("download");
  await detail.getByRole("button", { name: "下载已选用原片", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(seeded.blue.name);
  expect(createHash("sha256").update(await readFile((await download.path())!)).digest("hex")).toBe(seeded.blue.sha);
  // The list shows the fact: selected, two seconds, from the selected blue original.
  const first = list.getByRole("listitem").nth(0);
  await expect(first).toContainText("01 推门");
  await expect(first).toContainText("2.0 s");
  await expect(first).toContainText("已选用");
  await expect(detail).toContainText(seeded.orange.name);
  const shot = info.outputPath("studio-shots-1920.png");
  await page.screenshot({ path: shot, animations: "disabled" });
  await info.attach("studio-shots-1920", { path: shot, contentType: "image/png" });
  // Candidate → board: the selected take's original is found on the project board.
  await detail.getByRole("button", { name: `预览候选 ${blueIndex}，已选用`, exact: true }).click();
  await detail.getByRole("button", { name: "在创作台查看此素材", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\?node=/);
  await expect(page.getByRole("main", { name: "创作台", exact: true }).getByRole("article", { name: "合成蓝片 · 视频", exact: true })).toBeVisible();
  // Reordering submits the whole scene, archived shots included, and survives a reload.
  await page.goto(`${studio}/shots`);
  await page.getByRole("button", { name: "调整顺序", exact: true }).click();
  const order = page.getByRole("dialog", { name: "调整镜头顺序", exact: true });
  await order.getByRole("button", { name: "下移 01 推门", exact: true }).click();
  await order.getByRole("button", { name: "保存镜头顺序", exact: true }).click();
  await expect(order.getByRole("button", { name: "保存镜头顺序", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(list.getByRole("listitem").nth(0)).toContainText("02 阅读");
  await expect(page.getByRole("region", { name: "镜头 01 推门", exact: true })).toBeVisible();
  expect((await w.content()).shots.sort((a, b) => a.position - b.position).map((s) => s.id)).toEqual([seeded.second.id, seeded.shot.id, seeded.archived.id]);
  await page.reload();
  await expect(list.getByRole("listitem").nth(0)).toContainText("02 阅读");
  await expect(list.getByRole("listitem").nth(1)).toContainText("已选用");
});

test("leaving a mobile preview or opening a dialog cancels a pending source jump", async ({ page, workspace: w }) => {
  const seed = await selectedScene(w);
  const studio = `${w.runtime.origin}${w.basePath}/studio/shots`;
  for (const narrow of [false, true]) {
    await page.setViewportSize(narrow ? { width: 390, height: 844 } : { width: 1366, height: 768 });
    await page.goto(`${studio}?shot=${seed.shot.id}`);
    const takes = (await seed.takes()).items;
    await page.getByRole("button", { name: `预览候选 ${takes.findIndex(t => t.id === seed.alternative.id) + 1}`, exact: true }).click();
    const locate = page.getByRole("button", { name: "在创作台查看此素材", exact: true });
    await expect(locate).toBeVisible();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**${w.path}/canvas`, async route => {
      const response = await route.fetch();
      await held;
      await route.fulfill({ response });
    }, { times: 1 });
    const completed = page.waitForResponse(response => new URL(response.url()).pathname === `${w.path}/canvas`);
    try {
      await locate.click();
      await expect(page.getByRole("button", { name: "正在定位…", exact: true })).toBeVisible();
      if (narrow) {
        await page.getByRole("button", { name: "返回镜头列表", exact: true }).click();
        await expect(page.locator("video")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "查看镜头 01 推门", exact: true })).toBeFocused();
      } else {
        await page.getByRole("button", { name: "新增镜头", exact: true }).click();
        await page.getByRole("textbox", { name: "镜头名称", exact: true }).fill("保留当前创建输入");
      }
    } finally { release(); }
    await (await completed).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (narrow) {
      await expect(page).toHaveURL(studio);
      await page.reload();
      await expect(page.getByRole("list", { name: "镜头列表", exact: true })).toBeVisible();
      await expect(page.locator("video")).toHaveCount(0);
    } else {
      await expect(page.getByRole("button", { name: "正在定位…", exact: true, includeHidden: true })).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "新增镜头", exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "镜头名称", exact: true })).toHaveValue("保留当前创建输入");
      await page.getByRole("button", { name: "取消", exact: true }).click();
    }
  }
});

test("changing populated scenes focuses that scene's first shot and reordering preserves shot identity", async ({ page, workspace: w }) => {
  const seed = await seedShotList(w);
  const other = await w.command<Schema<"Scene">>("POST", `${w.path}/scenes`, {
    episodeId: w.episode.id, title: "第二场", position: 1, summary: "第二场说明", state: {}, status: "active",
  }, (await w.content()).revision);
  const nextShot = await w.command<Schema<"Shot">>("POST", `${w.path}/shots`, {
    sceneId: other.id, label: "另一场的镜头", position: 0, status: "active", spec: { intent: "第二场说明", references: [] },
  }, (await w.content()).revision);
  await page.goto(`${w.runtime.origin}${w.basePath}/studio/shots`);
  await expect(page.getByRole("region", { name: `镜头 ${seed.shot.label}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "调整顺序", exact: true }).click();
  const order = page.getByRole("dialog", { name: "调整镜头顺序", exact: true });
  await order.getByRole("button", { name: "下移 01 推门", exact: true }).click();
  await order.getByRole("button", { name: "保存镜头顺序", exact: true }).click();
  await expect(order.getByRole("button", { name: "保存镜头顺序", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: `镜头 ${seed.shot.label}`, exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "镜头列表", exact: true }).getByRole("listitem").first()).toContainText(seed.second.label);
  expect((await w.content()).shots.sort((a, b) => a.position - b.position).filter(shot => shot.sceneId === w.scene.id).map(shot => shot.id)).toEqual([seed.second.id, seed.shot.id, seed.archived.id]);
  await page.getByRole("combobox", { name: "查看场次", exact: true }).click();
  await page.getByRole("option", { name: `${w.episode.title} · ${other.title}`, exact: true }).click();
  await expect(page.getByRole("region", { name: `镜头 ${nextShot.label}`, exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(`${w.runtime.origin}${w.basePath}/studio/shots?scene=${w.scene.id}&shot=${seed.shot.id}`);
  await expect(page.getByRole("region", { name: `镜头 ${seed.shot.label}`, exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("region", { name: `镜头 ${nextShot.label}`, exact: true })).toBeVisible();
});

test("ST-07: the scene handoff packs only the explicit selections in order, whatever is being previewed", async ({ page, workspace: w }, info) => {
  const seed = await selectedScene(w);
  await page.goto(`${w.runtime.origin}${w.basePath}/studio/shots?shot=${seed.shot.id}`);
  const detail = page.getByRole("region", { name: "镜头 01 推门", exact: true });
  const takes = (await seed.takes()).items;
  await detail.getByRole("button", { name: `预览候选 ${takes.findIndex((item) => item.id === seed.alternative.id) + 1}`, exact: true }).click();
  await page.getByRole("button", { name: "账号与退出登录", exact: true }).click();
  await page.getByRole("menuitem", { name: "切换深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "dark");
  await page.screenshot({ path: info.outputPath("shot-preview-dark.png"), animations: "disabled" });
  const before = await detail.boundingBox();
  await page.getByRole("button", { name: "下载本场已选用", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "下载本场已选用", exact: true })).toBeVisible();
  expect(await detail.boundingBox()).toEqual(before);
  const list = page.getByRole("region", { name: "选用原片交接清单", exact: true });
  await expect(list.getByText(/2 个已选用镜头/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("shot-delivery-dark.png"), animations: "disabled" });
  await expect(list.getByText(/省略 0 个未选用、1 个已归档镜头/)).toBeVisible();
  const event = page.waitForEvent("download");
  await list.getByRole("button", { name: "确认下载原片包", exact: true }).click();
  const download = await event;
  const local = info.outputPath("studio-selected-originals.zip");
  await download.saveAs(local);
  const files = await readZip(await readFile(local));
  const manifest = JSON.parse(files.get("manifest.json")!.toString()) as Schema<"SelectedDeliveryManifest">;
  expect(manifest.entries.map((item) => item.takeId)).toEqual([seed.orangeTake.id, seed.take.id]);
  expect(manifest.entries.map((item) => item.range)).toEqual([{ inUs: 0, outUs: 3000000 }, { inUs: 500001, outUs: 2500001 }]);
  for (const entry of manifest.entries) {
    const bytes = files.get(`originals/${entry.fileName}`)!;
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
  }
  await expect(list.getByText(/原片包已交给浏览器下载/)).toBeVisible();
});

test("ST-07: a concurrent selection keeps the reason for an explicit recheck, and a revoked collaborator cannot display the cached list", async ({ page, context, workspace: w }) => {
  const seeded = await seedShotList(w);
  const other = await w.command<Schema<"Take">>("POST", `${w.path}/takes`, {
    shotId: seeded.shot.id, shotRevisionId: seeded.shot.specRevisionId, mediaId: seeded.blue.id,
    range: { inUs: 500000, outUs: 2500000 },
  });
  const collaborator = await w.runtime.identity("shot-collaborator"), membershipId = randomUUID();
  await w.runtime.database.admin.query(
    `INSERT INTO ${w.runtime.database.schema}.memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')`,
    [membershipId, w.tenant.id, collaborator.userId],
  );
  const grant = await w.command<{ revision: number }>("POST", `${w.path}/members`, { membershipId });
  await context.clearCookies();
  await context.addCookies([{ name: "session", value: collaborator.token, url: w.runtime.origin, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(`${w.runtime.origin}${w.basePath}/studio/shots?shot=${seeded.shot.id}`);
  const detail = page.getByRole("region", { name: "镜头 01 推门", exact: true });
  await expect(detail).toBeVisible();
  const takes = (await seeded.takes()).items;
  const previewed = takes[0]!, previewedIndex = takes.findIndex((t) => t.id === previewed.id) + 1;
  await detail.getByRole("button", { name: `采用候选 ${previewedIndex}`, exact: true }).click();
  const reason = detail.getByRole("textbox", { name: "采用理由（可选）", exact: true });
  await reason.fill("并发修改后仍应保留的选择理由。");
  const serverChoice = previewed.id === other.id ? seeded.orangeTake : other;
  await w.command("PUT", `${w.path}/shots/${seeded.shot.id}/selection`, { takeId: serverChoice.id }, seeded.shot.revision);
  await detail.getByRole("button", { name: "确认采用", exact: true }).click();
  await expect(detail.getByText("镜头已被修改", { exact: true })).toBeVisible();
  await expect(reason).toHaveValue("并发修改后仍应保留的选择理由。");
  expect((await seeded.selection()).currentSelection?.takeId).toBe(serverChoice.id);
  await detail.getByRole("button", { name: "已核对，使用最新修改版本", exact: true }).click();
  await detail.getByRole("button", { name: "确认采用", exact: true }).click();
  await expect(reason).toHaveCount(0);
  expect((await seeded.selection()).currentSelection?.takeId).toBe(previewed.id);
  // Revoked: a refresh shows the access notice and no cached shot list or project name.
  await w.command("DELETE", `${w.path}/members/${membershipId}`, undefined, grant.revision);
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "操作未完成" }).first()).toBeVisible();
  await expect(page.getByRole("list", { name: "镜头列表", exact: true })).toHaveCount(0);
  await expect(page.getByText(w.project.name, { exact: true })).toHaveCount(0);
  expect((await w.runtime.request(collaborator, "GET", `${w.path}/shots/${seeded.shot.id}/selection`)).status).toBe(404);
});

test("shot review keeps a scrollable list and bounded portrait preview through loading, comparison and narrow screens", async ({ page, workspace: w }, info) => {
  const seed = await selectedScene(w);
  for (let i = 4; i <= 12; i++) await w.command("POST", `${w.path}/shots`, {
    sceneId: w.scene.id, label: `${i} 受控镜头`, position: i, status: "active",
    spec: { intent: "用于滚动验证的合成镜头", references: [] },
  }, (await w.content()).revision);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`${w.runtime.origin}${w.basePath}/studio/shots?shot=${seed.shot.id}`);
  const list = page.getByRole("list", { name: "镜头列表", exact: true });
  const focus = page.getByRole("region", { name: "镜头专注预览", exact: true });
  await expect(focus.locator("video")).toHaveCount(1);
  await expect(focus.getByRole("button", { name: "下载已选用原片", exact: true })).toBeInViewport({ ratio: 1 });
  const before = { list: await list.boundingBox(), focus: await focus.boundingBox() };
  expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  const takes = (await seed.takes()).items;
  const otherIndex = takes.findIndex(t => t.id === seed.alternative.id) + 1;
  await focus.getByRole("button", { name: `对比候选 ${otherIndex}`, exact: true }).click();
  await expect(focus.locator("video")).toHaveCount(2);
  expect(await focus.boundingBox()).toEqual(before.focus);
  await page.screenshot({ path: info.outputPath("shot-review-comparison-1366.png"), animations: "disabled" });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${w.path}/shots/${seed.second.id}/selections`, async route => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  }, { times: 1 });
  try {
    await list.getByRole("button", { name: "查看镜头 02 阅读", exact: true }).click();
    await expect(focus.getByLabel("正在读取镜头候选", { exact: true })).toBeVisible();
    await expect(focus.locator("video")).toHaveCount(0);
    expect(await list.boundingBox()).toEqual(before.list);
    expect(await focus.boundingBox()).toEqual(before.focus);
  } finally { release(); }
  await expect(focus.locator("video")).toHaveCount(1);
  expect(await focus.boundingBox()).toEqual(before.focus);
  for (const viewport of [{ width: 820, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(focus.getByRole("button", { name: "下载已选用原片", exact: true })).toBeInViewport({ ratio: 1 });
    const video = focus.locator("video");
    expect(await video.evaluate(el => getComputedStyle(el).objectFit)).toBe("contain");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`shot-review-${viewport.width}.png`), animations: "disabled" });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await list.getByRole("button", { name: "查看镜头 01 推门", exact: true }).click();
  await focus.getByRole("button", { name: `对比候选 ${otherIndex}`, exact: true }).click();
  for (const viewport of [{ width: 820, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(focus.locator("video")).toHaveCount(2);
    await expect(focus.getByRole("region", { name: "视频播放器", exact: true })).toHaveCount(2);
    for (const player of await focus.getByRole("region", { name: "视频播放器", exact: true }).all()) {
      const bounds = await player.boundingBox();
      const play = await player.getByRole("button", { name: "播放", exact: true }).boundingBox();
      const full = await player.getByRole("button", { name: "进入全屏", exact: true }).boundingBox();
      expect(play!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(full!.x + full!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
    }
    await page.screenshot({ path: info.outputPath(`shot-review-comparison-${viewport.width}.png`), animations: "disabled" });
  }
  await page.getByRole("button", { name: "返回镜头列表", exact: true }).click();
  await expect(list).toBeVisible();
  await list.getByRole("button", { name: "查看镜头 12 受控镜头", exact: true }).click();
  await expect(page.getByRole("region", { name: "镜头 12 受控镜头", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回镜头列表", exact: true }).click();
  await expect(list.getByRole("button", { name: "查看镜头 12 受控镜头", exact: true })).toBeInViewport();
});

test("source location follows the previewed candidate and finds a scene canvas without a project canvas", async ({ page, workspace: w }) => {
  const seed = await seedShotList(w, false);
  const canvas = await w.runtime.request<Schema<"SceneCanvas">>(w.owner, "POST", `${w.path}/scenes/${w.scene.id}/canvas`);
  expect(canvas.status).toBe(200);
  const nodeId = randomUUID();
  await w.command("PUT", `${w.path}/canvases/${canvas.value.canvas.id}`, {
    schemaVersion: 1, document: { nodes: [{ id: nodeId, kind: "video", title: "本场橙片", position: { x: 0, y: 0 }, width: 320, content: { type: "media", mediaId: seed.orange.id } }], edges: [], groups: [] },
  }, canvas.value.canvas.revision);
  await page.goto(`${w.runtime.origin}${w.basePath}/studio/shots?shot=${seed.shot.id}`);
  await page.getByRole("button", { name: "在创作台查看此素材", exact: true }).click();
  await expect(page).toHaveURL(`${w.runtime.origin}${w.basePath}/studio?scene=${w.scene.id}&node=${nodeId}`);
  await expect(page.getByRole("article", { name: "本场橙片 · 视频", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("region", { name: "镜头 01 推门", exact: true })).toBeVisible();
  expect((await seed.selection()).currentSelection).toBeUndefined();
});

test("missing canvases and removed media are local unavailable states, while network failures remain retryable", async ({ page, workspace: w }) => {
  const seed = await seedShotList(w, false);
  await page.goto(`${w.runtime.origin}${w.basePath}/studio/shots?shot=${seed.shot.id}`);
  await expect(page.getByText("素材不在本场或项目创作台上", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "在创作台查看此素材", exact: true })).toHaveCount(0);
  const canvas = await w.runtime.request<Schema<"SceneCanvas">>(w.owner, "POST", `${w.path}/scenes/${w.scene.id}/canvas`);
  const node = { id: randomUUID(), kind: "video", title: "暂存橙片", position: { x: 0, y: 0 }, width: 320, content: { type: "media", mediaId: seed.orange.id } };
  const saved = await w.command<Schema<"Canvas">>("PUT", `${w.path}/canvases/${canvas.value.canvas.id}`, {
    schemaVersion: 1, document: { nodes: [node], edges: [], groups: [] },
  }, canvas.value.canvas.revision);
  await page.reload();
  const locate = page.getByRole("button", { name: "在创作台查看此素材", exact: true });
  await expect(locate).toBeVisible();
  await w.command("PUT", `${w.path}/canvases/${canvas.value.canvas.id}`, {
    schemaVersion: 1, document: { nodes: [], edges: [], groups: [] },
  }, saved.revision);
  await locate.click();
  await expect(page.getByText("素材不在本场或项目创作台上", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/studio\/shots\?/);
  let offline = true;
  await page.route(`**${w.path}/scenes/${w.scene.id}/canvas`, route => offline ? route.abort("failed") : route.continue());
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible();
  offline = false;
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByText("素材不在本场或项目创作台上", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
