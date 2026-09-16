import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { components } from "@drama/contracts";
import { test as base, expect, startWorkspaceRuntime } from "./fixture.js";
import { startShotMedia } from "./shot-media.js";
import { selectedScene } from "./selected-delivery-fixture.js";
import { readZip } from "../support/read-zip.js";

type Schema<K extends keyof components["schemas"]> = components["schemas"][K];
const test = base.extend({
  runtime: [
    async ({}, use) => {
      const storage = await startShotMedia();
      try {
        const runtime = await startWorkspaceRuntime({ media: storage.media });
        try {
          await use(runtime);
        } finally {
          await runtime.stop();
        }
      } finally {
        await storage.stop();
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],
});

test("CW-15: batch handoff downloads selected originals and exact ordered ranges, independently of focused preview", async ({
  page,
  workspace: w,
}, info) => {
  const seed = await selectedScene(w);
  await page.goto(`${w.runtime.origin}${w.basePath}/canvas`);
  await page.getByRole("button", { name: "镜头列表", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "镜头列表", exact: true });
  const takes = (await seed.takes()).items;
  await dialog.getByRole("combobox", { name: "预览候选", exact: true }).click();
  await page
    .getByRole("option", {
      name: `候选 ${takes.findIndex((item) => item.id === seed.alternative.id) + 1}`,
      exact: true,
    })
    .click();
  await dialog
    .getByRole("button", { name: "下载本场已选用", exact: true })
    .click();
  const list = dialog.getByRole("region", {
    name: "选用原片交接清单",
    exact: true,
  });
  await expect(list.getByText(/2 个已选用镜头/)).toBeVisible();
  await expect(list.getByText(/省略 0 个未选用、1 个已归档镜头/)).toBeVisible();
  const event = page.waitForEvent("download");
  await list
    .getByRole("button", { name: "确认下载原片包", exact: true })
    .click();
  const download = await event;
  const local = info.outputPath("synthetic-selected-originals.zip");
  await download.saveAs(local);
  const files = await readZip(await readFile(local));
  const manifest = JSON.parse(
    files.get("manifest.json")!.toString(),
  ) as Schema<"SelectedDeliveryManifest">;
  expect(manifest.entries.map((item) => item.takeId)).toEqual([
    seed.orangeTake.id,
    seed.take.id,
  ]);
  expect(manifest.entries.map((item) => item.range)).toEqual([
    { inUs: 0, outUs: 3000000 },
    { inUs: 500001, outUs: 2500001 },
  ]);
  for (const entry of manifest.entries) {
    const bytes = files.get(`originals/${entry.fileName}`)!;
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    expect(bytes).toEqual(
      entry.mediaId === seed.blue.id ? seed.blue.bytes : seed.orange.bytes,
    );
  }
  await expect(list.getByText(/原片包已交给浏览器下载/)).toBeVisible();
  await page.screenshot({
    path: info.outputPath("selected-delivery-confirmed.png"),
    animations: "disabled",
  });
});

test("CW-15: a changed selection refuses the old confirmation, retains it and succeeds after explicit refresh", async ({
  page,
  workspace: w,
}) => {
  const seed = await selectedScene(w);
  await page.goto(`${w.runtime.origin}${w.basePath}/canvas`);
  await page.getByRole("button", { name: "镜头列表", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "镜头列表", exact: true });
  await dialog
    .getByRole("button", { name: "下载本场已选用", exact: true })
    .click();
  const list = dialog.getByRole("region", {
    name: "选用原片交接清单",
    exact: true,
  });
  await expect(list.getByText(/2 个已选用镜头/)).toBeVisible();
  const current = await seed.selection();
  await w.command(
    "PUT",
    `${w.path}/shots/${seed.shot.id}/selection`,
    { takeId: seed.alternative.id },
    current.revision,
  );
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/selected-delivery/download") &&
      r.request().method() === "POST",
  );
  await list
    .getByRole("button", { name: "确认下载原片包", exact: true })
    .click();
  expect((await response).status()).toBe(409);
  await expect(dialog.getByText(/镜头顺序、说明或选用已变化/)).toBeVisible();
  await expect(list.getByText(/synthetic-orange.mp4/)).toBeVisible();
  await dialog
    .getByRole("button", { name: "重新查看交接清单", exact: true })
    .click();
  await expect(list.getByText(/synthetic-orange.mp4/)).toHaveCount(0);
  const event = page.waitForEvent("download");
  await list
    .getByRole("button", { name: "确认下载原片包", exact: true })
    .click();
  expect(await (await event).failure()).toBeNull();
});
