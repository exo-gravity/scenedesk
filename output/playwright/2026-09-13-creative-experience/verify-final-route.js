async (page) => {
  page.setDefaultTimeout(15000)
  const f = await (
      await page.request.get("http://127.0.0.1:4317/__fixture/ids")
    ).json(),
    root = `${f.origin}/#/app/t/${f.tenantId}/p/${f.projectId}`,
    out = `output/playwright/2026-09-13-creative-experience/${f.runId}/after`,
    check = (v, m) => {
      if (!v) throw Error(m)
    }
  const build = await (
    await page.request.get(f.origin + "/__fixture/build")
  ).json()
  check(
    build.scripts.some((s) => s.includes("index-l_bRDbIN.js")),
    "final bundle mismatch",
  )
  await page.goto(root + "/script")
  await page.reload()
  await page.getByRole("button", { name: "编辑正文", exact: true }).click()
  const field = page.getByRole("textbox", { name: "剧本正文", exact: true }),
    old = await field.inputValue(),
    value = old + "\n路由验收未提交草稿。"
  await field.fill(value)
  await page
    .getByText("修改已保存在本标签页，尚未提交。", { exact: true })
    .waitFor()
  await page.getByRole("tab", { name: "故事设定", exact: true }).click()
  check(page.url().endsWith("tab=settings"), "tab click did not update URL")
  await page.getByRole("button", { name: "编辑设定", exact: true }).waitFor()
  await page.goBack()
  await field.waitFor()
  check((await field.inputValue()) === value, "back lost draft")
  await page.goForward()
  await page.getByRole("button", { name: "编辑设定", exact: true }).waitFor()
  await page.goto(root + "/script?tab=text")
  await field.waitFor()
  check((await field.inputValue()) === value, "same-page URL lost draft")
  await page.goto(root + "/script?tab=settings")
  await page.getByRole("button", { name: "编辑设定", exact: true }).waitFor()
  await page.reload()
  await page.getByRole("button", { name: "编辑设定", exact: true }).waitFor()
  await page.getByRole("tab", { name: "剧本正文", exact: true }).click()
  await page
    .getByRole("button", { name: "恢复未提交内容", exact: true })
    .click()
  await field.waitFor()
  check((await field.inputValue()) === value, "reload/tab draft recovery")
  await page.getByRole("button", { name: "阅读预览", exact: true }).click()
  await page.getByRole("button", { name: "切换深色", exact: true }).click()
  await page.setViewportSize({ width: 1366, height: 768 })
  const colors = await page
    .getByRole("tablist")
    .first()
    .getByRole("tab")
    .evaluateAll((tabs) =>
      tabs.map((t) => {
        const c = getComputedStyle(t)
        let e = t,
          bg
        while (e) {
          const b = getComputedStyle(e).backgroundColor
          if (b !== "rgba(0, 0, 0, 0)" && b !== "transparent") {
            bg = b
            break
          }
          e = e.parentElement
        }
        return {
          text: t.textContent,
          color: c.color,
          background: bg,
          fontSize: c.fontSize,
        }
      }),
    )
  const rgb = (s) =>
      s
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number),
    lum = (rgb) =>
      rgb
        .map((c) => {
          const s = c / 255
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        })
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
  for (const c of colors) {
    const a = lum(rgb(c.color)),
      b = lum(rgb(c.background))
    c.contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    check(c.contrast >= 4.5, "tab contrast failed")
  }
  await page.screenshot({ path: out + "/script-final-1366-dark.png" })
  await page.getByRole("button", { name: "切换浅色", exact: true }).click()
  return {
    build,
    urlTabBackForward: true,
    samePageURLSync: true,
    scriptDraftPreservedAcrossHiddenPanels: true,
    explicitReloadRecovery: true,
    colors,
    modelCalls: 0,
  }
}
