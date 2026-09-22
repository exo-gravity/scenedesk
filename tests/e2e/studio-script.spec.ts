import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { components } from "@drama/contracts";
import { test, expect, type WorkspaceFixture } from "./fixture.js";

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
  await expect(page.getByText("当前稿 · 纯文本", { exact: true })).toBeVisible();
  const shot = info.outputPath("studio-script-1920.png");
  await page.screenshot({ path: shot, animations: "disabled" });
  await info.attach("studio-script-1920", { path: shot, contentType: "image/png" });

  // A fixed earlier revision is read-only and addressed, so a reload keeps it.
  await page.getByRole("combobox", { name: "查阅历史剧本", exact: true }).click();
  await page.getByRole("option", { name: /^第 1 稿/ }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/script\\?revision=${w.first.id}$`));
  await expect(page.getByRole("article", paper)).toContainText("第一稿：林在雨夜发现一封没有署名的信。");
  await expect(page.getByText("历史稿 · 只读 · 纯文本", { exact: true })).toBeVisible();
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
  await expect(page.getByText("当前稿 · Word 导入", { exact: true })).toBeVisible();
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
