async (page) => {
  page.setDefaultTimeout(15000)
  const f = await (
    await page.request.get("http://127.0.0.1:4317/__fixture/ids")
  ).json()
  const build = await (
    await page.request.get(f.origin + "/__fixture/build")
  ).json()
  const check = (condition, message) => {
    if (!condition) throw Error(message)
  }
  check(
    build.phase === "after" &&
      build.scripts.some((s) => s.includes("index-CoHRsRPT.js")),
    "after bundle mismatch",
  )
  const path = `${f.origin}/#/app/t/${f.tenantId}/p/${f.projectId}`,
    out = `output/playwright/2026-09-13-creative-experience/${f.runId}/after`
  const errors = [],
    states = []
  page.on("pageerror", (e) => errors.push(e.message))
  async function capture(name) {
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      docWidth: document.documentElement.scrollWidth,
      mainWidth: document.querySelector("main")?.getBoundingClientRect().width,
    }))
    check(
      geometry.docWidth <= geometry.width,
      "horizontal document overflow " + name,
    )
    await page.screenshot({
      path: `${out}/${name}.png`,
      animations: "disabled",
    })
    states.push({ name, geometry })
  }
  const text = page.getByRole("textbox", { name: "剧本正文", exact: true })
  const edited = await text.inputValue()
  check(
    edited.endsWith("隔离验收：林夏把钥匙轻轻放回桌面。"),
    "recovered final text mismatch",
  )
  await page.getByRole("button", { name: "保存为第 2 版", exact: true }).click()
  await page
    .getByRole("button", { name: "保存为第 3 版", exact: true })
    .waitFor()
  const scripts = await page.evaluate(
    async (p) => await (await fetch(p + "/scripts")).json(),
    f.path,
  )
  check(scripts.items.length === 2, "script save not exactly one revision")
  check(
    scripts.items.find((x) => x.number === 2).text === edited,
    "saved script readback mismatch",
  )
  await page.getByRole("button", { name: "阅读预览", exact: true }).click()
  await page.setViewportSize({ width: 1366, height: 768 })
  await capture("script-1366-reading")
  await page.getByRole("button", { name: "切换深色", exact: true }).click()
  await capture("script-1366-dark")
  await page.getByRole("button", { name: "切换浅色", exact: true }).click()
  await page.goto(path + "/script?tab=settings")
  await page.getByRole("button", { name: "编辑设定", exact: true }).click()
  const brief = page.getByRole("textbox", {
    name: "故事与创作设定",
    exact: true,
  })
  const value = "隔离验收故事设定：午后自然光，保留人物克制与钥匙的磨痕。"
  await brief.fill(value)
  await page.getByRole("button", { name: "阅读设定", exact: true }).click()
  check(
    await page.getByText(value, { exact: true }).isVisible(),
    "settings preview lost draft",
  )
  await page.reload()
  await page
    .getByRole("button", { name: "恢复未提交内容", exact: true })
    .click()
  if (
    await page
      .getByRole("button", { name: "编辑设定", exact: true })
      .isVisible()
  )
    await page.getByRole("button", { name: "编辑设定", exact: true }).click()
  check((await brief.inputValue()) === value, "settings reload lost old draft")
  await page.getByRole("button", { name: "保存剧目设定", exact: true }).click()
  await page.getByRole("button", { name: "阅读设定", exact: true }).click()
  await page.reload()
  await page.getByText(value, { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await capture("settings-390")
  return {
    build,
    scriptReadingEditingRecovery: true,
    firstCharacterFocus: true,
    assistantHiddenFocus: true,
    scriptRevisions: scripts.items.length,
    settingsDraftRecoveryAndSave: true,
    states,
    pageErrors: errors,
    providerCalls: 0,
  }
}
