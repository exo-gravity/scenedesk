async (page) => {
  const tenantId = "b128e444-cd57-4087-bcfe-c403051bbd8f";
  const projectId = "202c59b3-39c3-4fe0-9523-67b66db68eae";
  const path = `/v1/tenants/${tenantId}/projects/${projectId}`;
  const cases = [
    { sceneId: "7f004e06-6d1d-41c1-b55a-bfd5bd9cc7fa", nodes: 300, edges: 500 },
    {
      sceneId: "177e5a52-6d31-4b15-a7df-6b8bf2fa4e26",
      nodes: 2000,
      edges: 5000,
    },
  ];
  const errors = [],
    failures = [],
    results = [];
  const onError = (error) => errors.push(error.message);
  const onResponse = (response) => {
    if (response.status() >= 400 && response.url().includes("/v1/"))
      failures.push(response.status());
  };
  page.on("pageerror", onError);
  page.on("response", onResponse);
  try {
    for (const item of cases) {
      await page.setViewportSize({ width: 1512, height: 982 });
      await page.goto(
        `http://127.0.0.1:4311/#/app/t/${tenantId}/p/${projectId}/production?scene=${item.sceneId}&mode=canvas`,
      );
      await page.reload();
      await page.locator(".react-flow__node").first().waitFor();
      const document = await page.evaluate(
        async ({ path, sceneId }) => {
          const response = await fetch(`${path}/scenes/${sceneId}/canvas`);
          if (!response.ok) throw Error(`Canvas GET ${response.status}`);
          const sceneCanvas = await response.json();
          return sceneCanvas.canvas;
        },
        { path, sceneId: item.sceneId },
      );
      if (
        document.document.nodes.length !== item.nodes ||
        document.document.edges.length !== item.edges
      )
        throw Error("Persisted capacity changed");
      const list = page
        .locator("details")
        .filter({
          has: page
            .locator("summary")
            .filter({ hasText: "节点列表与键盘定位" }),
        });
      const groups = page
        .locator("details")
        .filter({
          has: page.locator("summary").filter({ hasText: "管理分组" }),
        });
      if (
        (await list.locator("input,button").count()) ||
        (await groups.locator("input,button").count())
      )
        throw Error("Collapsed controls mounted");
      const summary = list.locator("summary");
      await summary.focus();
      await page.keyboard.press("Enter");
      const query = `CAP${String(item.nodes).padStart(4, "0")}`;
      await list
        .getByRole("textbox", { name: "查找节点", exact: true })
        .fill(query);
      await summary.click();
      await list
        .getByRole("textbox", { name: "查找节点", exact: true })
        .waitFor({ state: "detached" });
      await summary.click();
      if (
        (await list
          .getByRole("textbox", { name: "查找节点", exact: true })
          .inputValue()) !== query
      )
        throw Error("Collapsed search lost query");
      await list
        .getByRole("button", { name: new RegExp(`^${query} `) })
        .click();
      await page
        .locator(`[data-id="${document.document.nodes.at(-1).id}"]`)
        .waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByText("窄屏以列表查看内容；完整空间制作请使用桌面宽度。", {
          exact: true,
        })
        .waitFor();
      const narrow = await page.evaluate(() => ({
        width: innerWidth,
        pageWidth: globalThis.document.documentElement.scrollWidth,
        flowCount: globalThis.document.querySelectorAll(".react-flow").length,
      }));
      if (narrow.pageWidth > narrow.width || narrow.flowCount !== 0)
        throw Error("Narrow canvas layout overflow");
      await page.setViewportSize({ width: 1512, height: 982 });
      await page.locator(".react-flow__node").first().waitFor();
      await list
        .getByRole("textbox", { name: "查找节点", exact: true })
        .fill("CAP0041");
      await list.getByRole("button", { name: /^CAP0041 / }).click();
      const videoNode = document.document.nodes[40];
      const node = page.locator(`[data-id="${videoNode.id}"]`);
      await node.getByRole("button", { name: "播放预览", exact: true }).click();
      await page.locator("video").waitFor({ state: "attached" });
      await page.waitForFunction(
        () => globalThis.document.querySelector("video")?.readyState >= 2,
      );
      await page.locator("video").evaluate(async (video) => {
        video.muted = true;
        await video.play();
      });
      await page.waitForFunction(() => {
        const video = globalThis.document.querySelector("video");
        return video && !video.paused && video.currentTime > 0;
      });
      const playing = await page
        .locator("video")
        .evaluate((video) => ({
          readyState: video.readyState,
          paused: video.paused,
          currentTime: video.currentTime,
        }));
      await page
        .getByRole("button", { name: "定位当前内容", exact: true })
        .click();
      await page.screenshot({
        path: `output/playwright/2026-09-11-canvas-capacity/integrated-${item.nodes}.png`,
        fullPage: false,
        animations: "disabled",
      });
      await page.getByRole("button", { name: "分镜", exact: true }).click();
      await page.locator(".react-flow").waitFor({ state: "detached" });
      if (await page.locator("video,audio").count())
        throw Error("Player survived mode unmount");
      results.push({
        nodeCount: item.nodes,
        edgeCount: item.edges,
        canvasId: document.id,
        revision: document.revision,
        collapsedControlsAbsent: true,
        keyboardAndSearchRecovery: true,
        narrow,
        playing,
        playersAfterMode: 0,
      });
    }
    if (errors.length || failures.length)
      throw Error("Browser or API failures");
    return {
      sameOriginActualApi: true,
      productionBuild: true,
      originOverrides: false,
      newPerformanceMeasurements: false,
      cases: results,
      pageErrors: errors,
      apiFailures: failures,
    };
  } finally {
    page.off("pageerror", onError);
    page.off("response", onResponse);
  }
}
