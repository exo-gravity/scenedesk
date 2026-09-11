async (page) => {
  const errors = [],
    context = page.context();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__projectHints = [];
    const Original = window.EventSource;
    window.EventSource = class extends Original {
      constructor(url, options) {
        super(url, options);
        this.addEventListener("message", ({ data }) => {
          const event = JSON.parse(data);
          window.__projectHints.push({
            type: event.type,
            kind: event.resourceKind,
            revision: event.resourceRevision,
          });
        });
      }
    };
  });
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.reload();
  await page.getByText("项目更新已连接", { exact: true }).waitFor();
  const saved = (target) =>
    target.waitForFunction(() =>
      [...document.querySelectorAll("[role=status]")].some((e) =>
        e.textContent.includes("画布 · 已保存"),
      ),
    );
  await saved(page);
  await page.getByRole("button", { name: "文字", exact: true }).click();
  const marker = "跨页面通知核对 " + Date.now();
  await page
    .getByRole("textbox", { name: "节点名称", exact: true })
    .fill(marker);
  await saved(page);
  const ids = await page.evaluate(async () => {
    const parts = location.hash.split("?")[0].split("/"),
      scene = new URLSearchParams(location.hash.split("?")[1]).get("scene");
    const path = `/v1/tenants/${parts[3]}/projects/${parts[5]}`;
    const response = await fetch(`${path}/scenes/${scene}/canvas`),
      data = await response.json();
    return { path, canvasId: data.canvas.id };
  });
  const other = await context.newPage();
  other.on("pageerror", (error) => errors.push(error.message));
  try {
    await other.setViewportSize({ width: 1512, height: 982 });
    await other.goto(page.url());
    await other.getByText("项目更新已连接", { exact: true }).waitFor();
    await saved(other);
    if (
      !(await other
        .getByRole("textbox", { name: "节点名称", exact: true })
        .count())
    )
      await other
        .getByRole("article", { name: marker + " · text", exact: true })
        .click();
    await page.bringToFront();
    await page.waitForFunction(
      () =>
        document.body.textContent.includes("另有") &&
        document.body.textContent.includes("个页面正在查看"),
      undefined,
      { timeout: 35_000 },
    );
    const presence = await page.evaluate(async ({ path, canvasId }) => {
      const response = await fetch(
        `${path}/editing-presence?kind=canvas&objectId=${canvasId}`,
      );
      return response.json();
    }, ids);
    if (new Set(presence.entries.map((e) => e.clientSessionId)).size < 2)
      throw Error("Tabs share a client identity");
    await page.getByRole("textbox", { name: "节点名称", exact: true }).fill("");
    await page
      .getByText("请填写节点名称；原输入已保留", { exact: true })
      .waitFor();
    await other.bringToFront();
    await other.waitForFunction(
      () => document.body.textContent.includes("个页面正在编辑"),
      undefined,
      { timeout: 35_000 },
    );
    const changedAt = Date.now();
    await other
      .getByRole("textbox", { name: "节点名称", exact: true })
      .fill(marker + " · 已在另一页修改");
    await saved(other);
    await page.getByText(/保存冲突 · 本机基线/).waitFor({ timeout: 10_000 });
    const notificationMs = Date.now() - changedAt;
    if (
      (await page
        .getByRole("textbox", { name: "节点名称", exact: true })
        .inputValue()) !== ""
    )
      throw Error("Notification overwrote incomplete input");
    const hints = await page.evaluate(() => window.__projectHints);
    if (
      !hints.some(
        (event) => event.type === "resource_changed" && event.kind === "canvas",
      )
    )
      throw Error("No real canvas SSE delivered");
    await context.setOffline(true);
    await page
      .getByText("编辑状态暂不可用", { exact: true })
      .waitFor({ timeout: 35_000 });
    await page
      .getByText("项目更新暂不可用，保留当前输入", { exact: true })
      .waitFor({ timeout: 10_000 });
    if (
      (await page
        .getByRole("textbox", { name: "节点名称", exact: true })
        .inputValue()) !== ""
    )
      throw Error("Offline lost input");
    await context.setOffline(false);
    await page
      .getByText("项目更新已连接", { exact: true })
      .waitFor({ timeout: 20_000 });
    if (
      (await page
        .getByRole("textbox", { name: "节点名称", exact: true })
        .inputValue()) !== ""
    )
      throw Error("Reconnect overwrote input");
    await page
      .getByRole("button", { name: "放弃本机修改", exact: true })
      .click();
    await page
      .getByRole("button", { name: "确认使用服务器内容", exact: true })
      .click();
    await saved(page);
    if (
      (await page
        .getByRole("textbox", { name: "节点名称", exact: true })
        .inputValue()) !==
      marker + " · 已在另一页修改"
    )
      throw Error("Explicit server version did not restore remote content");
    const layouts = [];
    for (const [width, height] of [
      [1512, 982],
      [1366, 900],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      if (overflow) throw Error("Horizontal overflow at " + width);
      await page.screenshot({
        path: `output/playwright/scene-canvas/14-project-updates-${width}.png`,
        fullPage: false,
      });
      layouts.push({ width, height, horizontalOverflow: false });
    }
    if (errors.length) throw Error(JSON.stringify(errors));
    return {
      distinctTabPresence: true,
      activeEditingVisible: true,
      actualCanvasSse: true,
      notificationMs,
      dirtyBufferPreserved: true,
      offlineShownAsUnknown: true,
      reconnectPreservedInput: true,
      explicitServerRecovery: true,
      layouts,
      pageErrors: 0,
      scope:
        "local fixture, actual production browser/API/database; no real provider or user acceptance",
    };
  } finally {
    await context.setOffline(false);
    await other.close();
    await page.setViewportSize({ width: 1512, height: 982 });
  }
}
