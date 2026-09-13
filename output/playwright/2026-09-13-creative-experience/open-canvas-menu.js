async (page) => {
  const f = await (
    await page.request.get("http://127.0.0.1:4317/__fixture/ids")
  ).json()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(
    `${f.origin}/#/app/t/${f.tenantId}/p/${f.projectId}/production?scene=${f.sceneId}&mode=canvas`,
  )
  await page.locator(".react-flow").waitFor()
  await page.getByRole("button", { name: "适应内容", exact: true }).click()
  await page.waitForTimeout(400)
  const point = await page.evaluate(() => {
    const r = document.querySelector(".react-flow").getBoundingClientRect()
    for (
      let y = Math.max(r.top + 20, 150);
      y < Math.min(r.bottom - 30, innerHeight - 30);
      y += 50
    )
      for (let x = r.right - 30; x > r.left + 30; x -= 50) {
        const e = document.elementFromPoint(x, y)
        if (e?.classList.contains("react-flow__pane")) return { x, y }
      }
    return null
  })
  if (!point) throw Error("visible pane unavailable")
  await page.mouse.dblclick(point.x, point.y, { delay: 80 })
  return {
    point,
    menu: await page
      .getByRole("menuitem", { name: "上传文件", exact: true })
      .isVisible(),
  }
}
