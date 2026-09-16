import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, type WorkspaceFixture } from "./fixture.js";

const navigation = (page: Page) => page.getByRole("navigation", { name: "项目导航", exact: true });
const scriptURL = (w: WorkspaceFixture) => `${w.runtime.origin}${w.basePath}/script`;

test("CW-01: project card opens script, all primary sections and legacy scene canvas remain reachable", async ({ page, workspace: w }, info) => {
  await page.goto(`${w.runtime.origin}/#/app/t/${w.tenant.id}`);
  await page.getByRole("link", { name: `进入项目 ${w.project.name}`, exact: true }).click();
  await expect(page).toHaveURL(scriptURL(w));
  await expect(page.getByRole("article", { name: "剧本正文", exact: true })).toHaveText(w.current.text);
  const nav = navigation(page);
  await expect(nav.getByRole("link")).toHaveCount(3);
  await expect(nav.getByRole("link", { name: "剧本", exact: true })).toHaveAttribute("aria-current", "page");
  await info.attach("script-desktop", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByRole("button", { name: "账号与退出登录", exact: true }).click();
  await page.getByRole("menuitem", { name: "切换深色", exact: true }).click();
  await info.attach("script-desktop-dark", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByRole("button", { name: "账号与退出登录", exact: true }).click();
  await page.getByRole("menuitem", { name: "切换浅色", exact: true }).click();

  await nav.getByRole("link", { name: "画布", exact: true }).click();
  await expect(page.getByRole("heading", { name: "画布", exact: true })).toBeVisible();
  await expect(page.getByText(w.scene.title, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "打开画布", exact: true }).click();
  await expect(page).toHaveURL(`${w.runtime.origin}${w.basePath}/production?scene=${w.scene.id}&mode=canvas`);
  await expect(page.getByRole("button", { name: "返回场次目录", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "AI 助手", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回场次目录", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/content\\?scene=${w.scene.id}$`));

  await nav.getByRole("link", { name: "项目资产", exact: true }).click();
  await page.getByRole("link", { name: `查看资产 ${w.asset.name}`, exact: true }).click();
  await expect(page.getByRole("region", { name: "资产详情", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: w.asset.name, exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "项目资产", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("合成角色的固定设定：寻找来信人。", { exact: true })).toBeVisible();
  await info.attach("asset-detail-desktop", { body: await page.screenshot(), contentType: "image/png" });
});

test("CW-01: compact rail and narrow drawer support keyboard navigation and restore focus", async ({ page, workspace: w }, info) => {
  await page.goto(scriptURL(w));
  await expect(page.getByRole("article", { name: "剧本正文", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "收起项目导航", exact: true }).click();
  await expect(page.getByRole("button", { name: "展开项目导航", exact: true })).toHaveAttribute("aria-expanded", "false");
  await navigation(page).getByRole("link", { name: "项目资产", exact: true }).click();
  await expect(page.getByRole("link", { name: `查看资产 ${w.asset.name}`, exact: true })).toBeVisible();

  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const trigger = page.getByRole("button", { name: "展开项目导航", exact: true });
    await trigger.focus();
    await trigger.press("Enter");
    const drawer = page.getByRole("dialog", { name: "项目导航", exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "关闭项目导航", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    // The focused control remains inside the modal, including at the focus boundary.
    await expect(drawer.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await info.attach(`navigation-drawer-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    await drawer.getByRole("link", { name: "剧本", exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("article", { name: "剧本正文", exact: true })).toHaveText(w.current.text);
    await expect(trigger).toBeFocused();
  }
});

test("CW-02: fixed script history is read-only and does not replace the current revision", async ({ page, workspace: w }) => {
  await page.goto(scriptURL(w));
  await page.getByRole("combobox", { name: "查阅历史剧本", exact: true }).click();
  await page.getByRole("option", { name: /^第 1 版/ }).click();
  await expect(page.getByRole("article", { name: "第 1 版原文", exact: true })).toHaveText(w.first.text);
  await expect(page.getByText("正在查阅第 1 版 · 只读", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^保存为第/ })).toHaveCount(0);
  expect((await w.content()).currentScriptRevisionId).toBe(w.current.id);
  expect((await w.scripts()).items).toHaveLength(2);
  // Existing fixed-revision deep links must still resolve after refresh.
  await page.goto(`${scriptURL(w)}?revision=${w.first.id}`);
  await page.reload();
  await expect(page.getByRole("article", { name: "第 1 版原文", exact: true })).toHaveText(w.first.text);
});

test("CW-02: unsaved script survives navigation and refresh, then saves exactly one new revision", async ({ page, workspace: w }) => {
  await page.goto(scriptURL(w));
  await page.getByRole("button", { name: "编辑正文", exact: true }).click();
  const draft = `${w.current.text}\n林收起信，走向车站。`;
  await page.getByRole("textbox", { name: "剧本正文", exact: true }).fill(draft);
  await expect(page.getByText("修改已保存在本标签页，尚未提交。", { exact: true })).toBeVisible();
  await navigation(page).getByRole("link", { name: "画布", exact: true }).click();
  await navigation(page).getByRole("link", { name: "剧本", exact: true }).click();
  await page.getByRole("button", { name: "恢复未提交内容", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "剧本正文", exact: true })).toHaveValue(draft);
  await page.reload();
  await page.getByRole("button", { name: "恢复未提交内容", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "剧本正文", exact: true })).toHaveValue(draft);
  expect((await w.content()).currentScriptRevisionId).toBe(w.current.id);
  expect((await w.scripts()).items).toHaveLength(2);

  await page.getByRole("button", { name: "保存为第 3 版", exact: true }).click();
  await expect(page.getByText("第 3 版 · 已保存", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "剧本正文", exact: true })).toHaveText(draft);
  const revisions = (await w.scripts()).items;
  expect(revisions).toHaveLength(3);
  expect(revisions.find((r) => r.number === 3)).toMatchObject({ text: draft, parentRevisionId: w.current.id });
  expect(revisions.find((r) => r.id === w.first.id)?.text).toBe(w.first.text);
  await page.reload();
  await expect(page.getByRole("article", { name: "剧本正文", exact: true })).toHaveText(draft);
  await expect(page.getByRole("button", { name: "恢复未提交内容", exact: true })).toHaveCount(0);
  expect((await w.scripts()).items).toHaveLength(3);
});

test("CW-02: concurrent server update preserves the local draft and requires explicit rebase", async ({ page, workspace: w }) => {
  await page.goto(scriptURL(w));
  await page.getByRole("button", { name: "编辑正文", exact: true }).click();
  const draft = `${w.current.text}\n本地分支：林决定留下。`;
  await page.getByRole("textbox", { name: "剧本正文", exact: true }).fill(draft);
  await expect(page.getByText("修改已保存在本标签页，尚未提交。", { exact: true })).toBeVisible();
  await w.command("POST", `${w.path}/scripts`, {
    text: "其他作者提交：林离开了城市。", parentRevisionId: w.current.id,
  }, (await w.content()).revision);
  await page.reload();
  await page.getByRole("button", { name: "恢复未提交内容", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "剧本正文", exact: true })).toHaveValue(draft);
  await expect(page.getByRole("textbox", { name: "服务器当前剧本", exact: true })).toHaveValue("其他作者提交：林离开了城市。");
  await expect(page.getByRole("button", { name: "保存为第 4 版", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "核对后使用最新版本作为保存基线", exact: true }).click();
  await page.getByRole("button", { name: "保存为第 4 版", exact: true }).click();
  await expect(page.getByText("第 4 版 · 已保存", { exact: true })).toBeVisible();
  const revisions = (await w.scripts()).items;
  expect(revisions).toHaveLength(4);
  expect(revisions.find((r) => r.number === 3)?.text).toBe("其他作者提交：林离开了城市。");
  expect(revisions.find((r) => r.number === 4)?.text).toBe(draft);
});

test("CW-01/02: revoked project access cannot reveal cached script or project identity", async ({ page, context, workspace: w }) => {
  const collaborator = await w.runtime.identity("collaborator");
  const membershipId = randomUUID();
  // Synthetic membership bootstrap is confined to the test process. Project grants use the real API.
  await w.runtime.database.admin.query(
    `INSERT INTO "${w.runtime.database.schema}".memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')`,
    [membershipId, w.tenant.id, collaborator.userId],
  );
  const grant = await w.command<{ revision: number }>("POST", `${w.path}/members`, { membershipId });
  await context.clearCookies();
  await context.addCookies([{ name: "session", value: collaborator.token,
    url: w.runtime.origin, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(scriptURL(w));
  await expect(page.getByRole("article", { name: "剧本正文", exact: true })).toHaveText(w.current.text);
  await w.command("DELETE", `${w.path}/members/${membershipId}`, undefined, grant.revision);
  await navigation(page).getByRole("link", { name: "画布", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "操作未完成" }).first()).toBeVisible();
  await navigation(page).getByRole("link", { name: "剧本", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "操作未完成" }).first()).toBeVisible();
  await expect(page.getByRole("article", { name: "剧本正文", exact: true })).toHaveCount(0);
  await expect(page.getByText(w.project.name, { exact: true })).toHaveCount(0);
  await expect(page.getByText(w.current.text, { exact: true })).toHaveCount(0);
  expect((await w.runtime.request(collaborator, "GET", `${w.path}/scripts`)).status).toBe(404);
  expect((await w.scripts()).items).toHaveLength(2);
});

test("CW-02: archived project remains readable with no script editing controls", async ({ page, workspace: w }) => {
  await w.command("POST", `${w.path}/archive`, undefined, w.project.revision);
  await page.goto(scriptURL(w));
  await expect(page.getByRole("textbox", { name: "第 2 版", exact: true })).toHaveValue(w.current.text);
  await expect(page.getByRole("textbox", { name: "第 2 版", exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: "编辑正文", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^保存为第/ })).toHaveCount(0);
  await navigation(page).getByRole("link", { name: "画布", exact: true }).click();
  await expect(page.getByText("已归档 · 只读", { exact: true }).last()).toBeVisible();
  expect((await w.scripts()).items).toHaveLength(2);
});
