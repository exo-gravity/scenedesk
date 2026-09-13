async (page) => {
  page.setDefaultTimeout(15000)
  const f = await (
      await page.request.get("http://127.0.0.1:4317/__fixture/ids")
    ).json(),
    root = `${f.origin}/#/app/t/${f.tenantId}/p/${f.projectId}`,
    name = "E2E收起后继续上传"
  await page.goto(root + "/media")
  await page.getByRole("button", { name: "导入素材", exact: true }).click()
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles("apps/web/public/demo/workspace-v2/key-reference.png")
  await page.getByRole("textbox", { name: "素材名称", exact: true }).fill(name)
  const panel = page.getByRole("region", {
    name: "文件导入与恢复",
    exact: true,
  })
  await panel.getByRole("button", { name: "收起", exact: true }).click()
  await page.getByRole("button", { name: "导入素材", exact: true }).click()
  if (
    (await page
      .getByRole("textbox", { name: "素材名称", exact: true })
      .inputValue()) !== name
  )
    throw Error("collapse lost name")
  if (
    (await page
      .locator("input[type=file]")
      .first()
      .evaluate((i) => i.files?.[0]?.name)) !== "key-reference.png"
  )
    throw Error("collapse lost file")
  await page.getByRole("button", { name: "开始导入", exact: true }).click()
  await panel.getByRole("button", { name: "收起", exact: true }).click()
  await page
    .getByRole("article", { name: "导入记录 " + name, exact: true })
    .waitFor()
  await page.screenshot({
    path: `output/playwright/2026-09-13-creative-experience/${f.runId}/after/media-import-collapsed.png`,
  })
  return {
    fileAndNameSurviveCollapse: true,
    uploadStartedAndPanelCollapsed: true,
    name,
  }
}
