import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect } from "./fixture.js";
import { docxFixture } from "../support/docx.js";

test("Feishu synthetic provider: preview fixed content, confirm and download exact exported original", async ({
  page,
  workspace,
}) => {
  const f = workspace.runtime.feishu;
  f.config.tenantId = workspace.tenant.id;
  f.config.sources = [{ projectId: workspace.project.id, url: f.wikiUrl }];
  const original = Buffer.from(f.state.bytes),
    count = (await workspace.scripts()).items.length;
  await page.goto(`${workspace.runtime.origin}${workspace.basePath}/script`);
  await page.getByRole("button", { name: "从飞书导入", exact: true }).click();
  await page.getByLabel("飞书文档链接").fill(f.wikiUrl);
  await page.getByRole("button", { name: "读取并预览", exact: true }).click();
  const preview = page.getByRole("region", { name: "飞书导入预览" });
  await expect(preview.getByText(/尚未导入/)).toBeVisible();
  await expect(preview.getByRole("article")).toContainText(
    "林夏：钥匙在哪里？😀",
  );
  await expect(preview.getByRole("table")).toContainText("咖啡馆");
  await expect(preview.getByRole("img")).toBeVisible();
  expect((await workspace.scripts()).items.length).toBe(count);
  f.state.bytes = docxFixture(
    "<w:p><w:r><w:t>外部后续新稿，不应替换刚才的预览</w:t></w:r></w:p>",
  );
  f.state.revision++;
  await preview.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("林夏：钥匙在哪里？😀");
  await page.reload();
  await expect(page.getByRole("article")).toContainText("林夏：钥匙在哪里？😀");
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载本次导出文件", exact: true })
    .click();
  const download = await downloading,
    location = await download.path();
  expect(location).not.toBeNull();
  expect(
    createHash("sha256")
      .update(await readFile(location!))
      .digest("hex"),
  ).toBe(createHash("sha256").update(original).digest("hex"));
  const scripts = (await workspace.scripts()).items;
  expect(scripts.length).toBe(count + 1);
  const saved = scripts.find((s) => s.source?.provider === "feishu")!;
  expect(saved.source?.sourceKind).toBe("wiki");
  expect(saved.source?.observedRevision).toBe(f.state.revision - 1);
});

test("Feishu synthetic provider: permissions fail closed, pending import survives refresh, lost commit resolves with one receipt", async ({
  page,
  workspace,
}) => {
  const f = workspace.runtime.feishu;
  f.config.tenantId = workspace.tenant.id;
  f.config.sources = [{ projectId: workspace.project.id, url: f.sourceUrl }];
  f.state.denied = false;
  const count = (await workspace.scripts()).items.length;
  await page.goto(`${workspace.runtime.origin}${workspace.basePath}/script`);
  await page.getByRole("button", { name: "从飞书导入", exact: true }).click();
  await page.getByLabel("飞书文档链接").fill(f.sourceUrl);
  await page.getByRole("button", { name: "读取并预览", exact: true }).click();
  let preview = page.getByRole("region", { name: "飞书导入预览" });
  await expect(preview.getByText(/尚未导入/)).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "恢复未提交内容", exact: true })
    .click();
  preview = page.getByRole("region", { name: "飞书导入预览" });
  await expect(preview.getByText(/尚未导入/)).toBeVisible();
  f.config.sources = [];
  await preview.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(preview.getByText(/此文档尚未授权给当前项目/)).toBeVisible();
  expect((await workspace.scripts()).items.length).toBe(count);
  f.config.sources = [{ projectId: workspace.project.id, url: f.sourceUrl }];
  f.state.denied = true;
  await preview.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(preview.getByText(/无法读取飞书文档/)).toBeVisible();
  f.state.denied = false;
  let posts = 0;
  await page.route("**/feishu-imports/*/confirm", async (route) => {
    posts++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await preview.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(preview.getByText(/连接中断/)).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "恢复未提交内容", exact: true })
    .click();
  await page.getByRole("button", { name: "核对导入结果", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  expect(posts).toBe(1);
  expect((await workspace.scripts()).items.length).toBe(count + 1);
  await page.unroute("**/feishu-imports/*/confirm");
});
