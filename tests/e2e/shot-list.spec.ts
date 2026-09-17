import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { components } from "@drama/contracts";
import { test as base, expect, startWorkspaceRuntime } from "./fixture.js";
import { startShotMedia } from "./shot-media.js";
import { seedShotList } from "./shot-list-fixture.js";

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

test("CW-13: switching shots keeps the viewer still through loading and confines scrolling to its panels", async ({
  page,
  workspace: w,
}, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const seeded = await seedShotList(w);
  await page.goto(`${w.runtime.origin}${w.basePath}/canvas`);
  await page.getByRole("button", { name: "镜头列表", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "镜头列表", exact: true });
  const focus = dialog.getByRole("region", { name: "镜头专注预览" });
  const order = dialog.getByRole("navigation", { name: "镜头顺序" });
  await expect
    .poll(() =>
      dialog
        .locator("video")
        .evaluateAll(
          (nodes) =>
            nodes.length === 1 &&
            (nodes[0] as HTMLVideoElement).readyState >= 2,
        ),
    )
    .toBe(true);
  const geometry = async () =>
    Promise.all(
      [dialog, order, focus].map((area) =>
        area.evaluate((node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return [x, y, width, height].map(Math.round);
        }),
      ),
    );
  const before = await geometry();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**${w.path}/takes?shotId=${seeded.second.id}*`,
    async (route) => {
      const response = await route.fetch();
      await held;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  try {
    await order.getByRole("button", { name: /^2\. 02 阅读/ }).click();
    await expect(
      dialog.getByLabel("正在读取镜头候选", { exact: true }),
    ).toBeVisible();
    const during = await geometry();
    await info.attach("shot-switch-geometry", {
      body: JSON.stringify({ before, during }),
      contentType: "application/json",
    });
    expect(
      during,
      "dialog, list and focus bounds must not collapse while the next shot loads",
    ).toEqual(before);
    await expect(focus.locator("video")).toHaveCount(0);
  } finally {
    release();
  }
  await expect(
    focus.getByRole("heading", { name: "02 阅读", exact: true }),
  ).toBeVisible();
  expect(await geometry()).toEqual(before);
  await order.getByRole("button", { name: /^1\. 01 推门/ }).click();
  await expect(focus.locator("video")).toHaveCount(1);
  expect(await geometry()).toEqual(before);
  // A long real shot list scrolls independently; neither the preview nor the
  // enclosing modal moves as a consequence of reaching the last row.
  for (let index = 4; index <= 12; index++) {
    await w.command(
      "POST",
      `${w.path}/shots`,
      {
        sceneId: w.scene.id,
        label: `${index} 延续镜头`,
        position: index - 1,
        status: "active",
        spec: { intent: "可滚动列表中的完整镜头说明。", references: [] },
      },
      (await w.content()).revision,
    );
  }
  await dialog.getByRole("button", { name: "刷新列表", exact: true }).click();
  await expect(
    order.getByRole("button", { name: /^12\. 12 延续镜头/ }),
  ).toHaveCount(1);
  expect(
    await order.evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  await order.hover();
  await page.mouse.wheel(0, 1200);
  await expect
    .poll(() => order.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
  expect(await geometry()).toEqual(before);
  expect(await dialog.evaluate((node) => node.scrollTop)).toBe(0);
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 820, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        dialog.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return (
            box.top >= 0 &&
            box.bottom <= innerHeight &&
            box.left >= 0 &&
            box.right <= innerWidth &&
            node.scrollHeight <= node.clientHeight + 1 &&
            node.scrollWidth <= node.clientWidth + 1
          );
        }),
      )
      .toBe(true);
    await expect(
      dialog.getByRole("button", { name: "选用当前预览…", exact: true }),
    ).toBeInViewport();
    await expect(
      dialog.getByRole("button", { name: "关闭弹窗", exact: true }),
    ).toBeInViewport();
    await dialog
      .getByRole("button", { name: "选用当前预览…", exact: true })
      .click();
    const restore = dialog.getByRole("button", {
      name: "恢复未提交内容",
      exact: true,
    });
    if (viewport.width !== 1366) {
      await expect(restore).toBeVisible();
      await restore.click();
      await expect(
        dialog.getByRole("textbox", { name: "采用理由（可选）", exact: true }),
      ).toHaveValue(`保留草稿 ${viewport.width === 820 ? 1366 : 820}`);
    }
    await dialog
      .getByRole("textbox", { name: "采用理由（可选）", exact: true })
      .fill(`保留草稿 ${viewport.width}`);
    await expect(
      dialog.getByRole("button", { name: "确认采用", exact: true }),
    ).toBeInViewport();
    await dialog.getByRole("button", { name: "暂不操作", exact: true }).click();
    await expect(focus.locator("video")).toHaveCount(1);
    await page.screenshot({
      path: info.outputPath(`shot-viewer-${viewport.width}.png`),
      animations: "disabled",
    });
  }
});

test("CW-13/15: canvas video becomes a fixed candidate; compare, explicitly select, reorder and download the exact original", async ({
  page,
  workspace: w,
}, info) => {
  const seeded = await seedShotList(w);
  await page.goto(`${w.runtime.origin}${w.basePath}/canvas`);
  await expect(
    page.getByRole("button", { name: "画布保存状态：已保存", exact: true }),
  ).toBeVisible();
  await page.getByLabel("合成蓝片 · video", { exact: true }).click();
  await page.getByRole("button", { name: "镜头列表", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "镜头列表", exact: true });
  await dialog
    .getByRole("button", { name: "从所选画布视频建立候选", exact: true })
    .click();
  await expect(
    dialog.getByText(/固定要求.*v[0-9]|精确制作副本|剪辑时生成/),
  ).toHaveCount(0);
  await dialog
    .getByRole("textbox", { name: "入点（秒）", exact: true })
    .fill("0.5");
  await dialog
    .getByRole("textbox", { name: "出点（秒）", exact: true })
    .fill("2.5");
  await dialog
    .getByRole("textbox", { name: "候选说明", exact: true })
    .fill("受控蓝片，半秒到两秒半。未执行真实模型。");
  await dialog.getByRole("button", { name: "归档为候选", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "选用当前预览…", exact: true }),
  ).toBeEnabled();
  const takes = (await seeded.takes()).items,
    blueTake = takes.find((t) => t.mediaId === seeded.blue.id)!;
  expect(blueTake.range).toEqual({ inUs: 500000, outUs: 2500000 });
  expect((await seeded.selection()).currentSelection).toBeUndefined();
  await dialog
    .getByRole("button", { name: "选用当前预览…", exact: true })
    .click();
  await expect(dialog.getByText(/修改版本 [0-9]|不表示审阅通过/)).toHaveCount(
    0,
  );
  await dialog
    .getByRole("textbox", { name: "采用理由（可选）", exact: true })
    .fill("这版动作更清楚。");
  await dialog.getByRole("button", { name: "确认采用", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "下载已选用原片", exact: true }),
  ).toBeVisible();
  const selected = (await seeded.selection()).currentSelection!;
  expect(selected.takeId).toBe(blueTake.id);
  const orangeIndex = takes.findIndex((t) => t.id === seeded.orangeTake.id) + 1;
  await dialog.getByRole("combobox", { name: "比较候选", exact: true }).click();
  await page
    .getByRole("option", {
      name: `候选 ${orangeIndex} · ${seeded.orangeTake.id.slice(0, 8)}`,
      exact: true,
    })
    .click();
  await expect(dialog.locator("video")).toHaveCount(2);
  await expect
    .poll(() =>
      dialog
        .locator("video")
        .evaluateAll((nodes) =>
          nodes.every(
            (n) =>
              (n as HTMLVideoElement).readyState >= 1 &&
              (n as HTMLVideoElement).duration === 4,
          ),
        ),
    )
    .toBe(true);
  await dialog
    .getByRole("button", { name: /^(play|播放)$/i })
    .first()
    .click();
  await expect
    .poll(() =>
      dialog
        .locator("video")
        .first()
        .evaluate((video) => (video as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(0.6);
  await expect
    .poll(() =>
      dialog
        .locator("video")
        .first()
        .evaluate((video) => (video as HTMLVideoElement).paused),
    )
    .toBe(true);
  expect(
    await dialog
      .locator("video")
      .first()
      .evaluate((video) => (video as HTMLVideoElement).currentTime),
  ).toBeLessThanOrEqual(2.51);
  const screenshot = info.outputPath("shot-list-comparison.png");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("shot-list-comparison", {
    path: screenshot,
    contentType: "image/png",
  });
  // Preview a different candidate; explicit selection and original download must remain blue.
  await dialog.getByRole("combobox", { name: "预览候选", exact: true }).click();
  await page
    .getByRole("option", { name: `候选 ${orangeIndex}`, exact: true })
    .click();
  const downloadEvent = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "下载已选用原片", exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(seeded.blue.name);
  const bytes = await readFile((await download.path())!);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    seeded.blue.sha,
  );
  expect((await seeded.selection()).currentSelection?.id).toBe(selected.id);
  await dialog
    .getByRole("button", { name: "下移 01 推门", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "保存镜头顺序", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "保存镜头顺序", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("heading", { name: "01 推门", exact: true }),
  ).toBeVisible();
  expect(
    (await w.content()).shots
      .sort((a, b) => a.position - b.position)
      .map((s) => s.id),
  ).toEqual([seeded.second.id, seeded.shot.id, seeded.archived.id]);
  await page.reload();
  await page.getByRole("button", { name: "镜头列表", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "镜头顺序", exact: true }),
  ).toContainText("03 旧镜");
  expect((await seeded.selection()).currentSelection?.takeId).toBe(blueTake.id);
});

test("CW-13: failed reorder retains local order through close and refresh, including archived children", async ({
  page,
  workspace: w,
}, info) => {
  const seeded = await seedShotList(w);
  await page.goto(`${w.runtime.origin}${w.basePath}/canvas`);
  await page.getByRole("button", { name: "镜头列表", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "镜头列表", exact: true });
  await dialog
    .getByRole("button", { name: "下移 02 阅读", exact: true })
    .click();
  await page.route(
    `**${w.path}/content/reorder`,
    async (route) => {
      await route.abort("connectionfailed");
    },
    { times: 1 },
  );
  await dialog
    .getByRole("button", { name: "保存镜头顺序", exact: true })
    .click();
  await expect(
    dialog.getByRole("alert").filter({ hasText: "操作未完成" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "镜头列表", exact: true }).click();
  await dialog
    .getByRole("button", { name: "恢复未提交内容", exact: true })
    .click();
  await expect(
    dialog.getByRole("navigation", { name: "镜头顺序", exact: true }),
  ).toContainText("2. 03 旧镜");
  await dialog
    .getByRole("button", { name: "保存镜头顺序", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "保存镜头顺序", exact: true }),
  ).toBeDisabled();
  expect(
    (await w.content()).shots
      .sort((a, b) => a.position - b.position)
      .map((s) => s.id),
  ).toEqual([seeded.shot.id, seeded.archived.id, seeded.second.id]);
  await page.setViewportSize({ width: 390, height: 844 });
  const screenshot = info.outputPath("shot-list-narrow.png");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("shot-list-narrow", {
    path: screenshot,
    contentType: "image/png",
  });
  await w.command("POST", `${w.path}/archive`, undefined, w.project.revision);
  await page.reload();
  await page.getByRole("button", { name: "镜头列表", exact: true }).click();
  await expect(
    dialog.getByText(
      "此项目或场次已归档，可查看固定候选及下载已选用原片；恢复后再整理。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "新增镜头", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "选用当前预览…", exact: true }),
  ).toBeDisabled();
});

test("CW-13: concurrent selection retains reason for explicit recheck; revoked collaborator cannot display cached list", async ({
  page,
  context,
  workspace: w,
}) => {
  const seeded = await seedShotList(w);
  const other = await w.command<Schema<"Take">>("POST", `${w.path}/takes`, {
    shotId: seeded.shot.id,
    shotRevisionId: seeded.shot.specRevisionId,
    mediaId: seeded.blue.id,
    range: { inUs: 500000, outUs: 2500000 },
  });
  const collaborator = await w.runtime.identity("shot-collaborator"),
    membershipId = randomUUID();
  await w.runtime.database.admin.query(
    `INSERT INTO ${w.runtime.database.schema}.memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')`,
    [membershipId, w.tenant.id, collaborator.userId],
  );
  const grant = await w.command<{ revision: number }>(
    "POST",
    `${w.path}/members`,
    { membershipId },
  );
  await context.clearCookies();
  await context.addCookies([
    {
      name: "session",
      value: collaborator.token,
      url: w.runtime.origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(`${w.runtime.origin}${w.basePath}/canvas`);
  await page.getByRole("button", { name: "镜头列表", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "镜头列表", exact: true });
  const takes = (await seeded.takes()).items;
  const previewed = takes[0]!;
  await dialog
    .getByRole("button", { name: "选用当前预览…", exact: true })
    .click();
  const reason = dialog.getByRole("textbox", {
    name: "采用理由（可选）",
    exact: true,
  });
  await reason.fill("并发修改后仍应保留的选择理由。");
  const serverChoice = previewed.id === other.id ? seeded.orangeTake : other;
  await w.command(
    "PUT",
    `${w.path}/shots/${seeded.shot.id}/selection`,
    { takeId: serverChoice.id },
    seeded.shot.revision,
  );
  await dialog.getByRole("button", { name: "确认采用", exact: true }).click();
  await expect(dialog.getByText("镜头已被修改", { exact: true })).toBeVisible();
  await expect(reason).toHaveValue("并发修改后仍应保留的选择理由。");
  expect((await seeded.selection()).currentSelection?.takeId).toBe(
    serverChoice.id,
  );
  await dialog
    .getByRole("button", { name: "已核对，使用最新修改版本", exact: true })
    .click();
  await dialog.getByRole("button", { name: "确认采用", exact: true }).click();
  await expect(reason).toHaveCount(0);
  expect((await seeded.selection()).currentSelection?.takeId).toBe(
    previewed.id,
  );
  await w.command(
    "DELETE",
    `${w.path}/members/${membershipId}`,
    undefined,
    grant.revision,
  );
  await dialog.getByRole("button", { name: "刷新列表", exact: true }).click();
  await expect(
    dialog.getByRole("alert").filter({ hasText: "操作未完成" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("navigation", { name: "镜头顺序", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await w.runtime.request(
        collaborator,
        "GET",
        `${w.path}/shots/${seeded.shot.id}/selection`,
      )
    ).status,
  ).toBe(404);
});
