import { test, expect } from "./canvas-generation-fixture.js";

/**
 * 分组面板的可关闭性与键盘可达性。
 *
 * 背景：分组管理从原生 `<details>` 浮动岛改为工具轨上的受控 `Popover` 之后，
 * `opened` 每次渲染都从状态重新求值。若把「存在未保存的分组名草稿」直接并入
 * `opened`，面板会在草稿存在时永远重新打开——点击、Escape、点击外部全部失效。
 * 原生 `<details>` 没有这个问题：React 只在 prop 变化时写 `open` 属性。
 */
test("CW-13: the group panel opens for an unsaved name and can still be closed", async ({
  page,
  generation: f,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const project = await f.createProject("分组面板 · 合成验收");
  const path = `${f.base}/projects/${project.id}`;
  const ensured = await f.request("POST", `${path}/canvas`);
  expect(ensured.statusCode).toBe(200);
  const canvas = ensured.json().canvas;

  const node = (title: string, x: number) => ({
    id: crypto.randomUUID(),
    kind: "image",
    title,
    width: 320,
    position: { x, y: 120 },
    content: {
      type: "draft",
      prompt: `${title} 的固定画面`,
      connectionId: f.input.connectionId,
      capabilityId: f.input.capabilityId,
      output: f.input.output,
    },
  });
  await f.ok(
    "PUT",
    `${path}/canvases/${canvas.id}`,
    {
      schemaVersion: 1,
      document: {
        nodes: [node("分组甲", 80), node("分组乙", 480)],
        edges: [],
        groups: [],
      },
    },
    canvas.revision,
  );

  await page.goto(`${f.origin}/#/app/t/${f.tenant.id}/p/${project.id}/canvas`);
  await expect(
    page.getByRole("button", { name: "画布保存状态：已保存", exact: true }),
  ).toBeVisible();

  // 分组工具栏按钮在工具轨上，且不依赖先选中节点
  const groupTool = page.getByRole("button", { name: "分组", exact: true });
  await expect(groupTool).toBeVisible();
  await groupTool.click();
  await expect(page.getByText("还没有分组。", { exact: false })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("还没有分组。", { exact: false })).toBeHidden();

  // 从「查找」列表多选两个节点后建组（画布节点本身不支持 shift 累加选择）
  await page.getByRole("button", { name: "查找画布内容", exact: true }).click();
  const panel = page.locator('section[aria-label="画布查找与定位"]');
  await panel.getByText("按住 Shift 点击可多选").waitFor({ state: "visible" });
  await panel.getByRole("button", { name: "分组甲", exact: true }).click();
  await panel
    .getByRole("button", { name: "分组乙", exact: true })
    .click({ modifiers: ["Shift"] });
  await expect(page.getByText("已选 2 项", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "更多所选内容操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "新建分组", exact: true }).click();

  // 打开分组面板，键盘应当能进入面板（trapFocus + data-autofocus）
  await groupTool.click();
  const nameInput = page.getByRole("textbox", { name: "分组名称", exact: true });
  await expect(nameInput).toBeVisible();
  await expect(nameInput).toBeFocused();

  // 清空名称制造未保存草稿
  await nameInput.fill("");
  await expect(
    page.getByText("请填写分组名称；原输入已保留", { exact: true }),
  ).toBeVisible();

  // 草稿存在时，面板仍然必须可以关闭
  await page.keyboard.press("Escape");
  await expect(nameInput).toBeHidden();
  await groupTool.click();
  await expect(nameInput).toBeVisible();
  await groupTool.click();
  await expect(nameInput).toBeHidden();

  // 草稿没有被丢弃：重新打开仍然看得到
  await groupTool.click();
  await expect(nameInput).toBeVisible();
  await expect(nameInput).toHaveValue("");
  await expect(
    page.getByText("请填写分组名称；原输入已保留", { exact: true }),
  ).toBeVisible();
});
