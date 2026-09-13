async (page) => {
  const base = "http://127.0.0.1:4317",
    tenant = "8bfa2905-6429-4a05-8072-a6fae34df0ac",
    project = "c3adbaae-9c8c-41d9-93a7-172bf491b1bd",
    asset = "45e09b48-2858-4b0d-93ba-945f9f3c335b",
    media = "bd667a9c-6d31-446c-9323-fc4075453385";
  const route = `${base}/#/app/t/${tenant}/p/${project}`,
    api = `/v1/tenants/${tenant}`,
    out = "output/playwright/2026-09-12-approved-assets-assistant/";
  const errors = [],
    mutations = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(r.method()) &&
      !r.url().endsWith("/access")
    )
      mutations.push({ method: r.method(), path: new URL(r.url()).pathname });
  });
  const check = (v, message) => {
    if (!v) throw Error(message);
  };
  async function read(path) {
    return page.evaluate(async (path) => {
      const r = await fetch(path);
      if (!r.ok) throw Error("Read failed " + r.status);
      return r.json();
    }, path);
  }
  async function shot(name) {
    await page.screenshot({ path: out + name + ".png", fullPage: false });
  }
  async function noOverflow() {
    return page.evaluate(() => {
      const main = document.querySelector("main");
      return {
        body: document.documentElement.scrollWidth <= innerWidth,
        main: main.scrollWidth <= main.clientWidth + 1,
        clientHeight: main.clientHeight,
        scrollHeight: main.scrollHeight,
      };
    });
  }
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto(`${route}/assets?asset=${asset}`);
  await page.getByRole("heading", { name: "旧铜钥匙", exact: true }).waitFor();
  await page
    .getByRole("img", { name: "视觉验收-旧铜钥匙.png" })
    .evaluate((img) => img.decode());
  if (
    await page
      .getByRole("button", { name: "切换浅色", exact: true })
      .isVisible()
  )
    await page.getByRole("button", { name: "切换浅色", exact: true }).click();
  const before = await read(`${api}/assets/${asset}`);
  const initialBounds = await noOverflow();
  check(initialBounds.body && initialBounds.main, "Asset overflow");
  check(
    initialBounds.scrollHeight <= initialBounds.clientHeight + 1,
    "Asset single-reference preview exceeds work area",
  );
  const imageLight = await page
    .getByRole("img", { name: "视觉验收-旧铜钥匙.png" })
    .evaluate((img) => ({
      src: img.currentSrc,
      filter: getComputedStyle(img).filter,
      opacity: getComputedStyle(img).opacity,
      radius: getComputedStyle(img).borderRadius,
    }));
  await shot("asset-v2-light-1512");
  await page.getByRole("button", { name: "切换深色", exact: true }).click();
  const imageDark = await page
    .getByRole("img", { name: "视觉验收-旧铜钥匙.png" })
    .evaluate((img) => ({
      src: img.currentSrc,
      filter: getComputedStyle(img).filter,
      opacity: getComputedStyle(img).opacity,
      radius: getComputedStyle(img).borderRadius,
    }));
  check(
    JSON.stringify(imageLight) === JSON.stringify(imageDark) &&
      imageDark.filter === "none" &&
      imageDark.opacity === "1",
    "Theme changed media presentation",
  );
  await shot("asset-v2-dark-1512");
  await page.getByRole("button", { name: "切换浅色", exact: true }).click();
  await page.getByText("固定版本历史", { exact: true }).click();
  await page.getByRole("link", { name: "查看 v1", exact: true }).click();
  await page
    .getByText("旧铜色，圆形匙环，保留左侧磨痕。", { exact: true })
    .waitFor();
  check(
    (await read(`${api}/assets/${asset}`)).currentRevisionId ===
      before.currentRevisionId,
    "Viewing history changed current revision",
  );
  await shot("asset-v1-history-1512");
  await page.getByRole("link", { name: "查看当前版本", exact: true }).click();
  await page
    .getByText("增加匙环内侧的刻字说明，保留尺寸、铜色与磨痕。", {
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("button", { name: "基于当前版本新建修订", exact: true })
    .click();
  const draft = "视觉验收未提交草稿：保留铜色与磨痕，核对刻字位置。";
  await page
    .getByRole("textbox", { name: "固定设定说明", exact: true })
    .fill(draft);
  await page
    .getByText("修改已保存在本标签页，尚未提交。", { exact: true })
    .waitFor();
  check(
    !(await page
      .getByRole("img", { name: "视觉验收-旧铜钥匙.png" })
      .isVisible()),
    "Editor failed to replace preview",
  );
  check(
    await page
      .getByRole("heading", { name: "设定版本", exact: true })
      .isVisible(),
    "Editor lost fixed version context",
  );
  await shot("asset-editor-1512");
  await page
    .getByRole("button", { name: "返回预览，保留本机草稿", exact: true })
    .click();
  await page.getByRole("img", { name: "视觉验收-旧铜钥匙.png" }).waitFor();
  await page
    .getByRole("button", { name: "基于当前版本新建修订", exact: true })
    .click();
  await page
    .getByRole("button", { name: "恢复未提交内容", exact: true })
    .click();
  check(
    (await page
      .getByRole("textbox", { name: "固定设定说明", exact: true })
      .inputValue()) === draft,
    "Closed asset draft was lost",
  );
  await page
    .getByRole("button", { name: "返回预览，保留本机草稿", exact: true })
    .click();
  await page.setViewportSize({ width: 1366, height: 900 });
  check((await noOverflow()).body, "1366 asset overflow");
  await shot("asset-v2-light-1366");
  await page.setViewportSize({ width: 390, height: 844 });
  check(
    (await noOverflow()).body && (await noOverflow()).main,
    "390 asset overflow",
  );
  await shot("asset-v2-light-390");
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto(`${route}/assets`);
  await page.getByRole("heading", { name: "项目资产", exact: true }).waitFor();
  await page.getByRole("link", { name: "旧铜钥匙", exact: false }).waitFor();
  await shot("asset-list-1512");
  await page
    .getByRole("textbox", { name: "查找资产", exact: true })
    .fill("旧铜");
  await page
    .getByRole("link", { name: "林夏", exact: true })
    .waitFor({ state: "hidden" });
  check(
    await page
      .getByRole("link", { name: "旧铜钥匙", exact: false })
      .isVisible(),
    "Asset search lost matching asset",
  );
  await page.goto(`${route}/media`);
  await page
    .getByRole("link", { name: "查看素材 视觉验收-旧铜钥匙.png", exact: true })
    .waitFor();
  await shot("media-list-1512");
  await page.getByRole("button", { name: "导入与恢复", exact: true }).click();
  await page
    .getByRole("region", { name: "文件导入与恢复", exact: true })
    .waitFor();
  await shot("media-import-1512");
  await page.goto(`${route}/media?media=${media}`);
  await page
    .getByRole("heading", { name: "视觉验收-旧铜钥匙.png", exact: true })
    .waitFor();
  await page
    .getByRole("img", { name: "视觉验收-旧铜钥匙.png" })
    .evaluate((img) => img.decode());
  await shot("media-detail-1512");
  await page.setViewportSize({ width: 390, height: 844 });
  check(
    (await noOverflow()).body && (await noOverflow()).main,
    "390 media overflow",
  );
  await shot("media-detail-390");
  check(
    (await read(`${api}/assets/${asset}`)).revision === before.revision,
    "Draft edits changed server asset",
  );
  check(!mutations.length, "Unexpected business mutation");
  check(!errors.length, "Page errors");
  return {
    scope: "real API/PostgreSQL/MinIO visual fixture; no provider execution",
    assetVersionHistoryUnchanged: true,
    editorReplacesPreview: true,
    localDraftRecovered: true,
    mediaThemeUnchanged: true,
    assetSearch: true,
    importPanel: true,
    viewports: [1512, 1366, 390],
    assetInitialBounds: initialBounds,
    businessMutations: mutations,
    pageErrors: errors,
  };
};
