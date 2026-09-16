import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixture.js";

const initialFile = fileURLToPath(
  new URL("../fixtures/scripts/initial-draft.docx", import.meta.url),
);
const updatedFile = fileURLToPath(
  new URL("../fixtures/scripts/updated-draft.docx", import.meta.url),
);
const invalidFile = fileURLToPath(
  new URL("../fixtures/scripts/invalid-draft.docx", import.meta.url),
);
const readBody = { name: "剧本阅读正文", exact: true };

test("CW-03: real Word upload previews before import, preserves original, updates and reads fixed history", async ({
  page,
  workspace: w,
}, info) => {
  await page.goto(`${w.runtime.origin}${w.basePath}/script`);
  await expect(page.getByText("修改后可保存", { exact: true })).toHaveCount(0);
  await page.locator('input[type="file"]').setInputFiles(initialFile);
  const preview = page.getByRole("region", {
    name: "Word 导入预览",
    exact: true,
  });
  await expect(
    preview.getByRole("heading", { name: "第一集 · 旧钥匙", exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole("cell", { name: "咖啡馆", exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole("img", { name: "Word 原文中的图片", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "核对本次导入结果", exact: true }),
  ).toHaveCount(0);
  const imageBox = await preview
    .getByRole("img", { name: "Word 原文中的图片", exact: true })
    .boundingBox();
  expect(imageBox!.width).toBeLessThanOrEqual(1);
  expect(imageBox!.height).toBeLessThanOrEqual(1);
  expect((await w.scripts()).items).toHaveLength(2);
  expect((await w.content()).currentScriptRevisionId).toBe(w.current.id);
  await page.screenshot({ path: info.outputPath("docx-preview.png") });
  await page
    .getByRole("button", { name: "确认导入为新版本", exact: true })
    .click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole("article", readBody)).toContainText(
    "林夏：钥匙在哪里？😀",
  );
  const imported = (await w.scripts()).items.find((r) => r.number === 3)!;
  expect(imported.sourceFormat).toBe("docx");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载原件", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("initial-draft.docx");
  const downloaded = await readFile((await download.path())!);
  expect(createHash("sha256").update(downloaded).digest("hex")).toBe(
    imported.sha256,
  );
  expect(downloaded.equals(await readFile(initialFile))).toBe(true);
  await page.reload();
  await expect(page.getByRole("article", readBody)).toContainText(
    "林夏：钥匙在哪里？😀",
  );
  await expect(
    page.getByRole("button", { name: "恢复未提交内容", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("docx-reading.png") });
  await page.locator('input[type="file"]').setInputFiles(updatedFile);
  await expect(preview.getByRole("article", readBody)).toContainText(
    "林夏：钥匙在窗边。😀",
  );
  expect((await w.scripts()).items).toHaveLength(3);
  await page
    .getByRole("button", { name: "确认导入为新版本", exact: true })
    .click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole("article", readBody)).toContainText(
    "林夏：钥匙在窗边。😀",
  );
  expect((await w.scripts()).items).toHaveLength(4);
  await page.goto(
    `${w.runtime.origin}${w.basePath}/script?revision=${imported.id}`,
  );
  await page.reload();
  await expect(page.getByRole("article", readBody)).toContainText(
    "林夏：钥匙在哪里？😀",
  );
  await expect(page.getByRole("article", readBody)).not.toContainText(
    "钥匙在窗边",
  );
  expect((await w.content()).currentScriptRevisionId).not.toBe(imported.id);
});

test("CW-03: malformed file remains recoverable after failed preview and navigation", async ({
  page,
  workspace: w,
}) => {
  await page.goto(`${w.runtime.origin}${w.basePath}/script`);
  await page.locator('input[type="file"]').setInputFiles(invalidFile);
  await expect(
    page.getByRole("alert").filter({ hasText: "文件不是有效的 .docx 压缩包" }),
  ).toBeVisible();
  await expect(
    page.getByText("invalid-draft.docx", { exact: true }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", {
    name: "项目导航",
    exact: true,
  });
  await navigation.getByRole("link", { name: "项目资产", exact: true }).click();
  await navigation.getByRole("link", { name: "剧本", exact: true }).click();
  await page
    .getByRole("button", { name: "恢复未提交内容", exact: true })
    .click();
  await expect(
    page.getByText("invalid-draft.docx", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新解析预览", exact: true }),
  ).toBeEnabled();
  expect((await w.scripts()).items).toHaveLength(2);
  await page.getByRole("button", { name: "放弃本次导入", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Word 导入预览", exact: true }),
  ).toHaveCount(0);
});

test("CW-03 fault injection: committed Word response is lost, refresh recovers through read-only receipt", async ({
  page,
  workspace: w,
}) => {
  await page.goto(`${w.runtime.origin}${w.basePath}/script`);
  await page.locator('input[type="file"]').setInputFiles(initialFile);
  await expect(
    page.getByRole("button", { name: "确认导入为新版本", exact: true }),
  ).toBeEnabled();
  let submissions = 0;
  await page.route(`**${w.path}/scripts/import-docx`, async (route) => {
    submissions++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    // Explicit transport fault after the real transaction committed; never a fake success payload.
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "确认导入为新版本", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "连接中断" }),
  ).toBeVisible();
  expect((await w.scripts()).items).toHaveLength(3);
  const fixed = (await w.content()).currentScriptRevisionId;
  await page.reload();
  await page
    .getByRole("button", { name: "恢复未提交内容", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "项目内容已更新" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "核对本次导入结果", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Word 导入预览", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("article", readBody)).toContainText(
    "林夏：钥匙在哪里？😀",
  );
  expect(submissions).toBe(1);
  expect((await w.scripts()).items).toHaveLength(3);
  expect((await w.content()).currentScriptRevisionId).toBe(fixed);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "恢复未提交内容", exact: true }),
  ).toHaveCount(0);
});

test("CW-03: concurrent content change preserves Word preview and creates a new intent only after review", async ({
  page,
  workspace: w,
}) => {
  await page.goto(`${w.runtime.origin}${w.basePath}/script`);
  await page.locator('input[type="file"]').setInputFiles(initialFile);
  await expect(
    page.getByRole("button", { name: "确认导入为新版本", exact: true }),
  ).toBeEnabled();
  await w.command(
    "POST",
    `${w.path}/scripts`,
    { text: "另一位作者更新的正文", parentRevisionId: w.current.id },
    (await w.content()).revision,
  );
  await page
    .getByRole("button", { name: "确认导入为新版本", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "项目内容已更新" }),
  ).toBeVisible();
  const review = page.getByRole("button", {
    name: "已核对最新版本，继续导入",
    exact: true,
  });
  await expect(review).toBeDisabled();
  await page
    .getByRole("button", { name: "核对本次导入结果", exact: true })
    .click();
  await expect(review).toBeEnabled();
  await review.click();
  await page
    .getByRole("button", { name: "确认导入为新版本", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Word 导入预览", exact: true }),
  ).toHaveCount(0);
  const scripts = (await w.scripts()).items;
  expect(scripts).toHaveLength(4);
  const other = scripts.find((s) => s.number === 3)!;
  expect(other.text).toBe("另一位作者更新的正文");
  expect(scripts.find((s) => s.number === 4)?.parentRevisionId).toBe(other.id);
});

test("CW-03 fault injection: an old delayed receipt cannot clear a replacement Word draft after navigation", async ({
  page,
  workspace: w,
}) => {
  await page.goto(`${w.runtime.origin}${w.basePath}/script`);
  await page.locator('input[type="file"]').setInputFiles(initialFile);
  await expect(
    page.getByRole("button", { name: "确认导入为新版本", exact: true }),
  ).toBeEnabled();
  await page.route(`**${w.path}/scripts/import-docx`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "确认导入为新版本", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "连接中断" }),
  ).toBeVisible();
  let release!: () => void, observed!: () => void;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    received = new Promise<void>((resolve) => {
      observed = resolve;
    });
  await page.route(`**${w.path}/script-imports/*`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    observed();
    await held;
    await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "核对本次导入结果", exact: true })
    .click();
  await received;
  await expect(
    page.getByRole("button", { name: "放弃本次导入", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "确认导入为新版本", exact: true }),
  ).toBeDisabled();
  const navigation = page.getByRole("navigation", {
    name: "项目导航",
    exact: true,
  });
  await navigation.getByRole("link", { name: "项目资产", exact: true }).click();
  await navigation.getByRole("link", { name: "剧本", exact: true }).click();
  await page
    .getByRole("button", { name: "恢复未提交内容", exact: true })
    .click();
  await page.getByRole("button", { name: "放弃本次导入", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Word 导入预览", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "导入 Word 初稿 / 更新版本",
      exact: true,
    }),
  ).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles(updatedFile);
  const preview = page.getByRole("region", {
    name: "Word 导入预览",
    exact: true,
  });
  await expect(preview.getByRole("article", readBody)).toContainText(
    "林夏：钥匙在窗边。😀",
  );
  await expect(
    page.getByText("修改已保存在本标签页，尚未提交。", { exact: true }),
  ).toBeVisible();
  const delivered = page.waitForResponse((response) =>
    response.url().includes(`${w.path}/script-imports/`),
  );
  release();
  await (await delivered).finished();
  // User-visible navigation lets the old completion settle before re-opening the retained draft.
  await navigation.getByRole("link", { name: "项目资产", exact: true }).click();
  await navigation.getByRole("link", { name: "剧本", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "恢复未提交内容", exact: true })
    .click();
  await expect(
    preview.getByText("updated-draft.docx", { exact: true }),
  ).toBeVisible();
  await expect(preview.getByRole("article", readBody)).toContainText(
    "林夏：钥匙在窗边。😀",
  );
  expect((await w.scripts()).items).toHaveLength(3);
});
