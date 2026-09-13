async (page) => {
  page.setDefaultTimeout(15000)
  const f = await (
      await page.request.get("http://127.0.0.1:4317/__fixture/ids")
    ).json(),
    root = `${f.origin}/#/app/t/${f.tenantId}/p/${f.projectId}`,
    base = `/v1/tenants/${f.tenantId}`,
    out = `output/playwright/2026-09-13-creative-experience/${f.runId}/after`
  const check = (v, m) => {
      if (!v) throw Error(m)
    },
    states = [],
    errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  const read = async (p) =>
    page.evaluate(async (p) => {
      const r = await fetch(p)
      if (!r.ok) throw Error("GET " + r.status)
      return r.json()
    }, p)
  async function capture(name) {
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    )
    check(width <= page.viewportSize().width, "overflow " + name)
    await page.screenshot({
      path: out + "/" + name + ".png",
      animations: "disabled",
    })
    states.push(name)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(root + "/assets")
  await page.reload()
  const card = page.getByRole("link", {
    name: "查看资产 旧铜钥匙",
    exact: true,
  })
  await card.waitFor()
  await card.locator("img").waitFor()
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll('a[aria-label="查看资产 旧铜钥匙"] img'),
    ].some((i) => i.complete && i.naturalWidth > 0),
  )
  check(
    (await page
      .getByRole("link", { name: "查看资产 没有参考图的场景", exact: true })
      .locator("img")
      .count()) === 0,
    "no-image asset borrowed thumbnail",
  )
  await capture("assets-1440")
  await page
    .getByRole("group", { name: "资产类别" })
    .getByRole("button", { name: "角色", exact: true })
    .click()
  await page.getByRole("link", { name: "查看资产 林夏", exact: true }).waitFor()
  check((await card.count()) === 0, "category filtering failed")
  await page
    .getByRole("group", { name: "资产类别" })
    .getByRole("button", { name: "全部", exact: true })
    .click()
  await page
    .getByRole("textbox", { name: "查找资产", exact: true })
    .fill("铜钥匙")
  await card.waitFor()
  await page
    .getByRole("link", { name: "查看资产 林夏", exact: true })
    .waitFor({ state: "hidden" })
  await page.getByRole("textbox", { name: "查找资产", exact: true }).fill("")
  await page.getByRole("button", { name: "筛选", exact: true }).click()
  await page.getByRole("combobox", { name: "资产状态", exact: true }).click()
  await page.getByRole("option", { name: "已归档", exact: true }).click()
  await page
    .getByRole("link", { name: "查看资产 已归档旧信封", exact: true })
    .waitFor()
  await page.keyboard.press("Escape")
  await page.goto(root + "/assets?asset=" + f.assetId)
  await page.getByRole("heading", { name: "旧铜钥匙", exact: true }).waitFor()
  const before = await read(base + "/assets/" + f.assetId)
  check(
    before.currentRevisionId === f.secondRevision,
    "fixture current fixed revision mismatch",
  )
  await page
    .getByRole("button", { name: "查看道具参考 2", exact: true })
    .click()
  await page.getByText(f.media.hand.displayName, { exact: true }).waitFor()
  await capture("asset-v2-1440")
  check(
    JSON.stringify(await read(base + "/assets/" + f.assetId)) ===
      JSON.stringify(before),
    "browse reference wrote asset",
  )
  await page.getByText("固定版本历史", { exact: true }).click()
  await page.getByRole("link", { name: "查看 v1", exact: true }).click()
  await page
    .getByText("旧铜色，圆形匙环，保留左侧磨痕。", { exact: true })
    .waitFor()
  const v1 = await read(base + "/asset-revisions/" + f.firstRevision)
  check(v1.status === "confirmed", "history approval changed")
  await page.reload()
  await page
    .getByText("旧铜色，圆形匙环，保留左侧磨痕。", { exact: true })
    .waitFor()
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.getByRole("button", { name: "切换深色", exact: true }).click()
  await capture("asset-v1-1366-dark")
  check(
    (await page
      .locator("main img")
      .first()
      .evaluate((i) => getComputedStyle(i).filter)) === "none",
    "dark recolors asset",
  )
  await page.getByRole("button", { name: "切换浅色", exact: true }).click()
  await page.goto(root + "/assets?asset=" + f.characterId)
  await page.getByRole("heading", { name: "林夏", exact: true }).waitFor()
  await page
    .getByRole("combobox", { name: "查看身份或造型参考", exact: true })
    .click()
  await page
    .getByRole("option", { name: "手部与袖口 · 造型修订 1", exact: true })
    .click()
  await page.getByText(f.media.hand.displayName, { exact: true }).waitFor()
  await capture("asset-look-1366")
  await page.goto(root + "/assets?asset=" + f.assetId)
  await page.getByRole("button", { name: "新建修订", exact: true }).click()
  const definition = page.getByRole("textbox", {
    name: "固定设定说明",
    exact: true,
  })
  const value = "E2E新修订：保留铜色与左侧磨痕，增加匙环刻字说明。"
  await definition.fill(value)
  await page
    .getByText("修改已保存在本标签页，尚未提交。", { exact: true })
    .waitFor()
  await page.reload()
  await page.getByRole("button", { name: "新建修订", exact: true }).click()
  await page
    .getByRole("button", { name: "恢复未提交内容", exact: true })
    .click()
  check((await definition.inputValue()) === value, "asset draft reload lost")
  await capture("asset-editor-1366")
  await page
    .getByRole("button", { name: "保存为新的固定版本", exact: true })
    .click()
  await definition.waitFor({ state: "hidden" })
  const after = await read(base + "/assets/" + f.assetId),
    fixed = await read(base + "/asset-revisions/" + after.currentRevisionId)
  check(
    fixed.number === 3 &&
      fixed.definition.description === value &&
      fixed.parentRevisionId === f.secondRevision,
    "new asset fixed revision mismatch",
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await capture("asset-detail-390")
  return {
    categoryAndSearch: true,
    archivedFilter: true,
    noImageHonest: true,
    fixedHistoryConfirmed: true,
    referenceLookReadOnly: true,
    draftRecovery: true,
    savedFixedRevision: fixed.id,
    savedNumber: fixed.number,
    states,
    pageErrors: errors,
    providerCalls: 0,
  }
}
