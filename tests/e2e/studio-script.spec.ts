import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { components } from "@drama/contracts";
import { randomUUID } from "node:crypto";
import { test, expect, type WorkspaceFixture } from "./fixture.js";
import { docxFixture } from "../support/docx.js";

type Schema<K extends keyof components["schemas"]> = components["schemas"][K];
const initialFile = fileURLToPath(new URL("../fixtures/scripts/initial-draft.docx", import.meta.url));
const paper = { name: "剧本阅读正文", exact: true };
test.use({ viewport: { width: 1920, height: 902 } });
const studio = (w: WorkspaceFixture) => `${w.runtime.origin}${w.basePath}/studio`;

test("ST-06: the script view reads the current and a fixed earlier manuscript, and imports a real Word file", async ({ page, workspace: w }, info) => {
  await page.goto(`${studio(w)}/script`);
  await expect(page).toHaveTitle(`${w.project.name} · 剧本 · SceneDesk`);
  const views = page.getByRole("navigation", { name: "创作区视图", exact: true });
  await expect(views.getByRole("link", { name: "剧本", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("article", paper)).toContainText("定稿：林推开咖啡店的门。");
  const history = page.getByRole("combobox", { name: "查阅历史剧本", exact: true });
  await expect(history).toHaveValue("第 2 稿 · 当前稿");
  await expect(page.getByText("纯文本", { exact: true })).toBeVisible();
  const shot = info.outputPath("studio-script-1920.png");
  await page.screenshot({ path: shot, animations: "disabled" });
  await info.attach("studio-script-1920", { path: shot, contentType: "image/png" });

  // A fixed earlier revision is read-only and addressed, so a reload keeps it.
  await history.click();
  await page.getByRole("option", { name: /^第 1 稿/ }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/script\\?revision=${w.first.id}$`));
  await expect(page.getByRole("article", paper)).toContainText("第一稿：林在雨夜发现一封没有署名的信。");
  await expect(history).toHaveValue("第 1 稿");
  await expect(page.getByText("历史稿 · 只读", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("article", paper)).toContainText("第一稿：林在雨夜发现一封没有署名的信。");
  await page.getByRole("button", { name: "返回当前稿", exact: true }).click();
  await expect(page.getByRole("article", paper)).toContainText("定稿：林推开咖啡店的门。");
  expect((await w.content()).currentScriptRevisionId).toBe(w.current.id);

  // Word: a real upload previews first, then imports as a new current revision whose original is kept.
  await page.locator('input[type="file"]').setInputFiles(initialFile);
  const preview = page.getByRole("region", { name: "Word 导入预览", exact: true });
  await expect(preview.getByRole("heading", { name: "第一集 · 旧钥匙", exact: true })).toBeVisible();
  expect((await w.scripts()).items).toHaveLength(2);
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole("article", paper)).toContainText("林夏：钥匙在哪里？😀");
  await expect(history).toHaveValue("第 3 稿 · 当前稿");
  await expect(page.getByText("initial-draft.docx", { exact: true })).toBeVisible();
  const imported = (await w.scripts()).items.find((r) => r.number === 3)!;
  expect(imported.sourceFormat).toBe("docx");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "文档更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "下载原件", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("initial-draft.docx");
  const downloaded = await readFile((await download.path())!);
  expect(createHash("sha256").update(downloaded).digest("hex")).toBe(imported.sha256);
});

test("ST-06: a selected passage becomes a fixed excerpt card on the board, read-only, with a way back to its source", async ({ page, workspace: w }) => {
  const script = await w.command<Schema<"ScriptRevision">>("POST", `${w.path}/scripts`, { text: "她😀推开门。\n夜雨落在肩上。" }, (await w.content()).revision);
  await page.goto(`${studio(w)}/script`);
  await expect(page.getByRole("article", paper)).toContainText("她😀推开门。");
  await page.getByRole("button", { name: "选文带入画布", exact: true }).click();
  const source = page.getByRole("textbox", { name: "当前稿原文", exact: true });
  await expect(source).toHaveValue(script.text);
  await source.focus();
  await source.press("ControlOrMeta+A");
  await expect(page.getByRole("alert").filter({ hasText: "选中的原文" })).toContainText(script.text);
  await page.getByRole("button", { name: "添加选文到项目画布", exact: true }).click();
  await expect(page.getByText("选文已添加到画布", { exact: true })).toBeVisible();
  const canvas = (await w.command<Schema<"ProjectCanvas">>("GET", `${w.path}/canvas`)).canvas;
  expect(canvas.document.nodes).toHaveLength(1);
  const node = canvas.document.nodes[0]!;
  expect(node.content).toEqual({
    type: "text", text: script.text,
    sourceExcerpt: { scriptRevisionId: script.id, range: { startOffset: 0, endOffset: Array.from(script.text).length }, quote: script.text },
  });

  // "进入画布" opens the studio board on that card, selected and in view; it cannot be edited.
  await page.getByRole("button", { name: "进入画布", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/studio\\?node=${node.id}$`));
  await expect(page.getByRole("button", { name: "创作台保存状态：已保存", exact: true })).toBeVisible();
  const board = page.getByRole("main", { name: "创作台", exact: true });
  const card = board.getByRole("article", { name: `${node.title} · 固定摘录`, exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText("她😀推开门。");
  await expect(card.locator("xpath=..")).toHaveAttribute("data-selected", "true");
  await card.dblclick();
  await expect(page.getByRole("textbox", { name: "文字内容", exact: true })).toHaveCount(0);
  // The excerpt can feed a draft like any text; its source stays reachable.
  await page.getByRole("button", { name: "继续创作", exact: true }).click();
  const plusMenu = page.getByRole("menu").filter({ hasNot: page.getByRole("menuitem", { name: "文字", exact: true }) });
  await plusMenu.getByRole("menuitem", { name: "视频", exact: true }).click();
  await expect(board.getByRole("article", { name: "新的视频草稿 · 视频", exact: true })).toBeVisible();
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "回看剧本来源", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/script\\?revision=${script.id}$`));
  await expect(page.getByRole("article", paper)).toContainText("她😀推开门。");
});

// Cases carried over from the retired script page: the Word and Feishu import
// modules and the excerpt module are the same code, mounted in the studio.

test("ST-06: a lost Word commit is recovered through a read-only receipt after a refresh, without a second import", async ({ page, workspace: w }) => {
  await page.goto(`${studio(w)}/script`);
  await page.locator('input[type="file"]').setInputFiles(initialFile);
  await expect(page.getByRole("button", { name: "确认导入", exact: true })).toBeEnabled();
  let submissions = 0;
  await page.route(`**${w.path}/scripts/import-docx`, async (route) => {
    submissions++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    // Explicit transport fault after the real transaction committed; never a fake success payload.
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "连接中断" })).toBeVisible();
  expect((await w.scripts()).items).toHaveLength(3);
  const fixed = (await w.content()).currentScriptRevisionId;
  await page.reload();
  await page.getByRole("button", { name: "恢复未提交内容", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "项目内容已更新" })).toBeVisible();
  await page.getByRole("button", { name: "核对本次导入结果", exact: true }).click();
  await expect(page.getByRole("region", { name: "Word 导入预览", exact: true })).toHaveCount(0);
  await expect(page.getByRole("article", paper)).toContainText("林夏：钥匙在哪里？😀");
  expect(submissions).toBe(1);
  expect((await w.scripts()).items).toHaveLength(3);
  expect((await w.content()).currentScriptRevisionId).toBe(fixed);
  await page.reload();
  await expect(page.getByRole("button", { name: "恢复未提交内容", exact: true })).toHaveCount(0);
});

test("ST-06: a lost excerpt reply recovers the original card after a reload without another POST", async ({ page, workspace: w }) => {
  await page.goto(`${studio(w)}/script`);
  await page.getByRole("button", { name: "选文带入画布", exact: true }).click();
  const source = page.getByRole("textbox", { name: "当前稿原文", exact: true });
  await expect(source).toHaveValue(w.current.text);
  await source.focus();
  await source.press("ControlOrMeta+A");
  await expect(page.getByRole("alert").filter({ hasText: "选中的原文" })).toContainText(w.current.text);
  let posts = 0;
  await page.route("**/canvases/*/script-excerpts", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    await route.fetch(); // The real API commits before the client loses the receipt.
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "添加选文到项目画布", exact: true }).click();
  await expect(page.getByRole("button", { name: "核对原选文添加结果", exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "操作未完成" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "选文带入画布", exact: true }).click();
  await page.getByRole("button", { name: "恢复创建记录", exact: true }).click();
  await page.getByRole("button", { name: "核对原选文添加结果", exact: true }).click();
  await expect(page.getByText("选文已添加到画布", { exact: true })).toBeVisible();
  expect(posts).toBe(1);
  expect((await w.command<Schema<"ProjectCanvas">>("GET", `${w.path}/canvas`)).canvas.document.nodes).toHaveLength(1);
});

test("ST-06 Feishu: the synthetic provider previews fixed content, confirms it and downloads the exact exported original", async ({ page, workspace }) => {
  const f = workspace.runtime.feishu;
  f.config.tenantId = workspace.tenant.id;
  f.config.sources = [{ projectId: workspace.project.id, url: f.wikiUrl }];
  const original = Buffer.from(f.state.bytes), count = (await workspace.scripts()).items.length;
  await page.goto(`${studio(workspace)}/script`);
  await page.getByRole("button", { name: "从飞书导入", exact: true }).click();
  await page.getByLabel("飞书文档链接").fill(f.wikiUrl);
  await page.getByRole("button", { name: "读取并预览", exact: true }).click();
  const preview = page.getByRole("region", { name: "飞书导入预览" });
  await expect(preview.getByText(/尚未导入/)).toBeVisible();
  await expect(preview.getByRole("article")).toContainText("林夏：钥匙在哪里？😀");
  await expect(preview.getByRole("table")).toContainText("咖啡馆");
  await expect(preview.getByRole("img")).toBeVisible();
  expect((await workspace.scripts()).items.length).toBe(count);
  // A newer document upstream must not replace what was previewed.
  f.state.bytes = docxFixture("<w:p><w:r><w:t>外部后续新稿，不应替换刚才的预览</w:t></w:r></w:p>");
  f.state.revision++;
  await preview.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole("article", paper)).toContainText("林夏：钥匙在哪里？😀");
  await page.reload();
  await expect(page.getByRole("article", paper)).toContainText("林夏：钥匙在哪里？😀");
  await page.getByRole("button", { name: "文档更多操作", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "下载本次导出文件", exact: true }).click();
  const download = await downloading, location = await download.path();
  expect(location).not.toBeNull();
  expect(createHash("sha256").update(await readFile(location!)).digest("hex")).toBe(createHash("sha256").update(original).digest("hex"));
  const scripts = (await workspace.scripts()).items;
  expect(scripts.length).toBe(count + 1);
  const saved = scripts.find((s) => s.source?.provider === "feishu")!;
  expect(saved.source?.sourceKind).toBe("wiki");
  expect(saved.source?.observedRevision).toBe(f.state.revision - 1);
});

test("ST-06 Feishu: permissions fail closed, a pending import survives a refresh, and a lost commit resolves with one receipt", async ({ page, workspace }) => {
  const f = workspace.runtime.feishu;
  f.config.tenantId = workspace.tenant.id;
  f.config.sources = [{ projectId: workspace.project.id, url: f.sourceUrl }];
  f.state.denied = false;
  const count = (await workspace.scripts()).items.length;
  await page.goto(`${studio(workspace)}/script`);
  await page.getByRole("button", { name: "从飞书导入", exact: true }).click();
  await page.getByLabel("飞书文档链接").fill(f.sourceUrl);
  await page.getByRole("button", { name: "读取并预览", exact: true }).click();
  let preview = page.getByRole("region", { name: "飞书导入预览" });
  await expect(preview.getByText(/尚未导入/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "恢复未提交内容", exact: true }).click();
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
  await page.getByRole("button", { name: "恢复未提交内容", exact: true }).click();
  await page.getByRole("button", { name: "核对导入结果", exact: true }).click();
  await expect(page.getByRole("region", { name: "飞书导入预览" })).toHaveCount(0);
  await expect(page.getByRole("article", paper)).toHaveCount(1);
  expect(posts).toBe(1);
  expect((await workspace.scripts()).items.length).toBe(count + 1);
  await page.unroute("**/feishu-imports/*/confirm");
});

test("ST-06: revoked project access cannot reveal the cached script or the project's name", async ({ page, context, workspace: w }) => {
  const collaborator = await w.runtime.identity("script-collaborator"), membershipId = randomUUID();
  // Synthetic membership bootstrap is confined to the test process; the project grant uses the real API.
  await w.runtime.database.admin.query(
    `INSERT INTO "${w.runtime.database.schema}".memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')`,
    [membershipId, w.tenant.id, collaborator.userId],
  );
  const grant = await w.command<{ revision: number }>("POST", `${w.path}/members`, { membershipId });
  await context.clearCookies();
  await context.addCookies([{ name: "session", value: collaborator.token, url: w.runtime.origin, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(`${studio(w)}/script`);
  await expect(page.getByRole("article", paper)).toHaveText(w.current.text);
  await w.command("DELETE", `${w.path}/members/${membershipId}`, undefined, grant.revision);
  const views = page.getByRole("navigation", { name: "创作区视图", exact: true });
  await views.getByRole("link", { name: "创作台", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "操作未完成" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^创作台保存状态：/ })).toHaveCount(0);
  await views.getByRole("link", { name: "剧本", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "操作未完成" }).first()).toBeVisible();
  await expect(page.getByRole("article", paper)).toHaveCount(0);
  await expect(page.getByText(w.project.name, { exact: true })).toHaveCount(0);
  await expect(page.getByText(w.current.text, { exact: true })).toHaveCount(0);
  expect((await w.runtime.request(collaborator, "GET", `${w.path}/scripts`)).status).toBe(404);
  expect((await w.scripts()).items).toHaveLength(2);
});

test("ST-06: an archived project keeps its script readable with no import controls", async ({ page, workspace: w }) => {
  await w.command("POST", `${w.path}/archive`, undefined, w.project.revision);
  await page.goto(`${studio(w)}/script`);
  await expect(page.getByRole("article", paper)).toHaveText(w.current.text);
  await expect(page.getByRole("button", { name: "从飞书导入", exact: true })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByRole("navigation", { name: "创作区视图", exact: true }).getByRole("link", { name: "创作台", exact: true }).click();
  await expect(page.getByRole("button", { name: "创建项目创作台", exact: true })).toBeDisabled();
  expect((await w.scripts()).items).toHaveLength(2);
});
