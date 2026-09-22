import { createHash } from "node:crypto";
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
test.use({ viewport: { width: 1920, height: 902 } });

test("ST-07: a board video becomes a fixed candidate, is explicitly selected, shows in the table, downloads exactly and reorders", async ({ page, workspace: w }, info) => {
  const seeded = await seedShotList(w);
  const studio = `${w.runtime.origin}${w.basePath}/studio`;
  // The board's "登记为镜头候选" arrives here with the video; opening a shot offers the candidate.
  await page.goto(`${studio}/shots?media=${seeded.blue.id}&shot=${seeded.shot.id}`);
  await expect(page).toHaveTitle(`${w.project.name} · 镜头整理 · SceneDesk`);
  const table = page.getByRole("table", { name: "镜头列表", exact: true });
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table.getByRole("row").nth(3)).toContainText("已归档");
  const drawer = page.getByRole("dialog", { name: "镜头 01 推门", exact: true });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "从所选画布视频建立候选", exact: true }).click();
  await drawer.getByRole("textbox", { name: "入点（秒）", exact: true }).fill("0.5");
  await drawer.getByRole("textbox", { name: "出点（秒）", exact: true }).fill("2.5");
  await drawer.getByRole("textbox", { name: "候选说明", exact: true }).fill("受控蓝片，半秒到两秒半。未执行真实模型。");
  await drawer.getByRole("button", { name: "归档为候选", exact: true }).click();
  await expect(drawer.getByRole("button", { name: /^采用候选 \d+$/ }).first()).toBeEnabled();
  const takes = (await seeded.takes()).items;
  const blueTake = takes.find((t) => t.mediaId === seeded.blue.id)!;
  expect(blueTake.range).toEqual({ inUs: 500000, outUs: 2500000 });
  expect((await seeded.selection()).currentSelection).toBeUndefined();
  const blueIndex = takes.findIndex((t) => t.id === blueTake.id) + 1;
  await drawer.getByRole("button", { name: `采用候选 ${blueIndex}`, exact: true }).click();
  await drawer.getByRole("textbox", { name: "采用理由（可选）", exact: true }).fill("这版动作更清楚。");
  await drawer.getByRole("button", { name: "确认采用", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "下载已选用原片", exact: true })).toBeVisible();
  expect((await seeded.selection()).currentSelection!.takeId).toBe(blueTake.id);
  // Downloading is the fixed selection, whatever is being previewed.
  const orangeIndex = takes.findIndex((t) => t.id === seeded.orangeTake.id) + 1;
  await drawer.getByRole("button", { name: `预览候选 ${orangeIndex}`, exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await drawer.getByRole("button", { name: "下载已选用原片", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(seeded.blue.name);
  expect(createHash("sha256").update(await readFile((await download.path())!)).digest("hex")).toBe(seeded.blue.sha);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  // The table shows the fact: selected, two seconds, from the blue original.
  const first = table.getByRole("row").nth(1);
  await expect(first).toContainText("01 推门");
  await expect(first).toContainText("2.0 s");
  await expect(first).toContainText("已选用");
  await expect(first).toContainText(seeded.blue.name);
  const shot = info.outputPath("studio-shots-1920.png");
  await page.screenshot({ path: shot, animations: "disabled" });
  await info.attach("studio-shots-1920", { path: shot, contentType: "image/png" });
  // Candidate → board: the selected take's original is found on the project board.
  await first.getByRole("button", { name: "在创作台定位 01 推门 的选用来源", exact: true }).click();
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
  await expect(table.getByRole("row").nth(1)).toContainText("02 阅读");
  expect((await w.content()).shots.sort((a, b) => a.position - b.position).map((s) => s.id)).toEqual([seeded.second.id, seeded.shot.id, seeded.archived.id]);
  await page.reload();
  await expect(table.getByRole("row").nth(1)).toContainText("02 阅读");
  await expect(table.getByRole("row").nth(2)).toContainText("已选用");
});

test("ST-07: the scene handoff packs only the explicit selections in order, whatever is being previewed", async ({ page, workspace: w }, info) => {
  const seed = await selectedScene(w);
  await page.goto(`${w.runtime.origin}${w.basePath}/studio/shots?shot=${seed.shot.id}`);
  const drawer = page.getByRole("dialog", { name: "镜头 01 推门", exact: true });
  const takes = (await seed.takes()).items;
  await drawer.getByRole("button", { name: `预览候选 ${takes.findIndex((item) => item.id === seed.alternative.id) + 1}`, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await page.getByRole("button", { name: "下载本场已选用", exact: true }).click();
  const list = page.getByRole("region", { name: "选用原片交接清单", exact: true });
  await expect(list.getByText(/2 个已选用镜头/)).toBeVisible();
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
