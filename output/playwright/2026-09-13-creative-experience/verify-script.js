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
  check(build.phase === "after", "after bundle mismatch")
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
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(path + "/script")
  await page.reload()
  const article = page.getByRole("article", { name: "剧本正文", exact: true })
  await article.waitFor()
  check(
    (await page
      .getByRole("textbox", { name: "剧本正文", exact: true })
      .count()) === 0,
    "default script must be reading",
  )
  const original = await article.innerText()
  await capture("script-1440-reading")
  await page.getByRole("button", { name: "编辑正文", exact: true }).click()
  const text = page.getByRole("textbox", { name: "剧本正文", exact: true })
  await text.fill("")
  check(
    await page
      .getByRole("button", { name: "阅读预览", exact: true })
      .isDisabled(),
    "empty read preview should be disabled",
  )
  await text.pressSequentially("第")
  check(
    await text.evaluate((e) => e === document.activeElement),
    "first character lost focus",
  )
  const edited = original + "\n\n隔离验收：林夏把钥匙轻轻放回桌面。"
  await text.fill(edited)
  await page.getByRole("button", { name: "阅读预览", exact: true }).click()
  check(
    (await article.innerText()).includes("隔离验收"),
    "read preview lost text",
  )
  await page.getByRole("button", { name: "整理为镜头", exact: true }).click()
  const assistant = page.getByRole("complementary", {
    name: "剧本提案助手",
    exact: true,
  })
  await assistant.waitFor()
  await page.getByRole("button", { name: "收起提案助手", exact: true }).click()
  await assistant.waitFor({ state: "hidden" })
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab")
    check(
      !(await page.evaluate(
        () =>
          document.activeElement?.closest('[aria-label="剧本提案助手"]') !==
          null,
      )),
      "hidden assistant receives keyboard focus",
    )
  }
  await page.getByRole("button", { name: "编辑正文", exact: true }).click()
  check((await text.inputValue()) === edited, "read/edit lost input")
  await page.reload()
  await page
    .getByRole("button", { name: "恢复未提交内容", exact: true })
    .click()
  if (
    await page
      .getByRole("button", { name: "编辑正文", exact: true })
      .isVisible()
  )
    await page.getByRole("button", { name: "编辑正文", exact: true }).click()
  check((await text.inputValue()) === edited, "reload recovery lost script")
  await page.getByRole("button", { name: "保存为第 2 版", exact: true }).click()
  await page.getByText("第 2 版 · 已保存", { exact: true }).waitFor()
  const scripts = await page.evaluate(
    async (p) => await (await fetch(p + "/scripts")).json(),
    f.path,
  )
  check(scripts.items.length === 2, "script save not exactly one revision")
  check(
    scripts.items.find((x) => x.number === 2).text === edited,
    "saved script readback mismatch",
  )
  await page.getByRole("article", { name: "剧本正文", exact: true }).waitFor()
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
    await page
      .getByRole("article")
      .getByText(value, { exact: true })
      .isVisible(),
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
  await page.getByRole("button", { name: "编辑设定", exact: true }).waitFor()
  await page.reload()
  await page.getByRole("article").getByText(value, { exact: true }).waitFor()
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
