async (page) => {
  page.setDefaultTimeout(20000)
  const f = await (
      await page.request.get("http://127.0.0.1:4317/__fixture/ids")
    ).json(),
    out = `output/playwright/2026-09-13-creative-experience/${f.runId}/after`,
    root = `${f.origin}/#/app/t/${f.tenantId}/p/${f.projectId}`
  const check = (v, m) => {
      if (!v) throw Error(m)
    },
    results = [],
    errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  const read = async (p) =>
    page.evaluate(async (p) => {
      const r = await fetch(p)
      if (!r.ok) throw Error("GET " + r.status)
      return r.json()
    }, p)
  const shotBefore = (await read(f.path + "/content")).shots.find(
    (s) => s.id === f.shots[3].id,
  )
  async function capture(name) {
    const geometry = await page.evaluate(() => {
      const box = (e) => {
        if (!e) return null
        const r = e.getBoundingClientRect()
        return {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          bottom: r.bottom,
        }
      }
      return {
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        video: box(document.querySelector("video")),
        flow: box(document.querySelector(".react-flow")),
        strip: box(document.querySelector('[aria-label="本场分镜顺序"]')),
        filter: document.querySelector("video")
          ? getComputedStyle(document.querySelector("video")).filter
          : null,
      }
    })
    check(geometry.documentWidth <= geometry.width, "overflow " + name)
    await page.screenshot({
      path: out + "/" + name + ".png",
      animations: "disabled",
    })
    results.push({ name, geometry })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(
    root +
      `/production?scene=${f.sceneId}&shot=${f.shots[3].id}&mode=storyboard`,
  )
  await page.getByRole("heading", { name: "SH-04", exact: true }).waitFor()
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 2,
  )
  await capture("storyboard-1440")
  const video = page.locator("video").first()
  const box = await video.boundingBox()
  check(box, "video missing")
  await page.mouse.click(box.x + 15, box.y + box.height - 15)
  await page.waitForFunction(
    () => document.querySelector("video")?.currentTime > 0.2,
  )
  const playing = await video.evaluate((v) => ({
    time: v.currentTime,
    paused: v.paused,
    duration: v.duration,
  }))
  check(!playing.paused, "native play did not start")
  await page.mouse.click(box.x + 15, box.y + box.height - 15)
  await page.waitForFunction(() => document.querySelector("video")?.paused)
  results.push({ actualNativePlayback: playing })
  await page.getByRole("tab", { name: "视频", exact: true }).click()
  await page.getByText("视频生成暂不可用", { exact: true }).waitFor()
  const prompt = page.getByRole("textbox", { name: "本次提示", exact: true })
  await prompt.fill("本次E2E：保留手指接触匙环后的停顿。")
  await page.getByRole("tab", { name: "视频", exact: true }).click()
  await page.getByRole("tab", { name: "视频", exact: true }).click()
  check(
    (await prompt.inputValue()) === "本次E2E：保留手指接触匙环后的停顿。",
    "creation tab lost prompt",
  )
  await page.setViewportSize({ width: 1366, height: 768 })
  await capture("storyboard-1366-video-open")
  await page.getByRole("button", { name: "AI 助手", exact: true }).click()
  await page.getByRole("complementary", { name: "AI 创作助手" }).waitFor()
  await page.getByRole("button", { name: "切换深色", exact: true }).click()
  await capture("storyboard-1366-dark-assistant")
  await page.getByRole("button", { name: "AI 助手", exact: true }).click()
  await page.getByRole("button", { name: "切换浅色", exact: true }).click()
  const shotAfter = (await read(f.path + "/content")).shots.find(
    (s) => s.id === f.shots[3].id,
  )
  check(
    JSON.stringify(shotAfter) === JSON.stringify(shotBefore),
    "viewing changed selection",
  )
  await page.getByRole("button", { name: "自由画布", exact: true }).click()
  await page.locator(".react-flow").waitFor()
  await page.getByRole("button", { name: "适应内容", exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page
    .getByRole("article", { name: "本次动作要求 · text", exact: true })
    .click()
  await page.getByRole("textbox", { name: "文字内容", exact: true }).waitFor()
  const toolbar = page.locator('[aria-label="所选内容操作"]')
  await toolbar.waitFor()
  await capture("canvas-1440-selection")
  const text = page.getByRole("textbox", { name: "文字内容", exact: true })
  await text.fill("画布实际编辑：保留光线与铜色。")
  await text.press("End")
  await text.press("Backspace")
  await text.pressSequentially("。")
  check(
    (await text.inputValue()) === "画布实际编辑：保留光线与铜色。",
    "textbox key handling",
  )
  await page.getByRole("button", { name: "保存画布", exact: true }).click()
  await page.waitForFunction(
    async ({ p, id }) => {
      const c = await (await fetch(p)).json()
      return (
        c.document.nodes.find((n) => n.id === id)?.content.text ===
        "画布实际编辑：保留光线与铜色。"
      )
    },
    { p: f.path + "/canvases/" + f.canvasId, id: f.textId },
  )
  const saved = await read(f.path + "/canvases/" + f.canvasId)
  await page.reload()
  await page
    .getByRole("article", { name: "本次动作要求 · text", exact: true })
    .click()
  await page.getByRole("textbox", { name: "文字内容", exact: true }).waitFor()
  check(
    (await page
      .getByRole("textbox", { name: "文字内容", exact: true })
      .inputValue()) === "画布实际编辑：保留光线与铜色。",
    "canvas reload readback",
  )
  await page
    .getByRole("article", { name: "动作优化 · 创作草稿 · video", exact: true })
    .click()
  await page.getByRole("textbox", { name: "本次提示词", exact: true }).waitFor()
  check(
    await page.locator('[aria-label="本次画布参考"]').isVisible(),
    "reference strip missing",
  )
  await page.locator("summary").filter({ hasText: "参考材料" }).click()
  await capture("canvas-1440-references")
  await page.setViewportSize({ width: 390, height: 844 })
  await capture("canvas-390-list")
  await page.setViewportSize({ width: 1440, height: 900 })
  return {
    results,
    actualPlayback: true,
    viewingDoesNotAdopt: true,
    tabDraftPreserved: true,
    canvasSavedRevision: saved.revision,
    canvasReload: true,
    pageErrors: errors,
    providerCalls: 0,
  }
}
