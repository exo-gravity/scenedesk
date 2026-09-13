async (page) => {
  const f = await (
      await page.request.get("http://127.0.0.1:4317/__fixture/ids")
    ).json(),
    path = `/v1/tenants/${f.tenantId}/media?scope=project&projectId=${f.projectId}`,
    out = `output/playwright/2026-09-13-creative-experience/${f.runId}/after`
  await page.waitForFunction(
    async (p) =>
      (await (await fetch(p)).json()).items.some(
        (m) => m.displayName === "E2E收起后继续上传" && m.status === "ready",
      ),
    path,
    { timeout: 180000 },
  )
  const m = await page.evaluate(
    async (p) =>
      (await (await fetch(p)).json()).items.find(
        (m) => m.displayName === "E2E收起后继续上传",
      ),
    path,
  )
  if (m.sha256 !== f.media.key.sha256 || m.bytes !== f.media.key.bytes)
    throw Error("actual upload readback mismatch")
  await page.getByRole("button", { name: "导入记录", exact: true }).click()
  await page
    .getByRole("article", { name: "导入记录 E2E收起后继续上传", exact: true })
    .getByText("导入完成", { exact: true })
    .waitFor()
  await page.reload()
  await page.getByRole("button", { name: "导入记录", exact: true }).click()
  await page
    .getByRole("article", { name: "导入记录 E2E收起后继续上传", exact: true })
    .getByText("导入完成", { exact: true })
    .waitFor()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: out + "/media-import-ready-1440.png" })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: out + "/media-390.png" })
  return {
    actualUploadReady: true,
    collapseDidNotAbort: true,
    reloadKeptRecord: true,
    mediaId: m.id,
    sha256: m.sha256,
    bytes: m.bytes,
    documentWidth: await page.evaluate(
      () => document.documentElement.scrollWidth,
    ),
  }
}
