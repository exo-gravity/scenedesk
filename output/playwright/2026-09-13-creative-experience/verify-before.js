async (page) => {
  const f = await (
    await page.request.get("http://127.0.0.1:4317/__fixture/ids")
  ).json()
  const build = await (
    await page.request.get(f.origin + "/__fixture/build")
  ).json()
  if (
    build.phase !== "before" ||
    !build.scripts.some((s) => s.includes("index-DLdKIDFc.js"))
  )
    throw Error("Expected fresh 585eb10 baseline bundle")
  const out = `output/playwright/2026-09-13-creative-experience/${f.runId}/before`
  const route = `${f.origin}/#/app/t/${f.tenantId}/p/${f.projectId}`
  const scene = `${route}/production?scene=${f.sceneId}&shot=${f.shots[3].id}&mode=storyboard`
  const states = [],
    errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  async function capture(name) {
    const geometry = await page.evaluate(() => {
      const rect = (selector) => {
        const e = document.querySelector(selector)
        if (!e) return null
        const r = e.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }
      return {
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        main: rect("main"),
        video: rect("video"),
        canvas: rect(".react-flow"),
        focus:
          document.activeElement?.getAttribute("aria-label") ??
          document.activeElement?.tagName,
      }
    })
    await page.screenshot({
      path: `${out}/${name}.png`,
      animations: "disabled",
    })
    states.push({ name, geometry })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(scene)
  await page.reload()
  await page.getByRole("heading", { name: /SH-04/ }).first().waitFor()
  await page.waitForFunction(
    () => document.querySelector("video")?.readyState >= 2,
  )
  await capture("storyboard-1440-light")
  await page.setViewportSize({ width: 1366, height: 768 })
  await capture("storyboard-1366-light")
  await page.getByRole("button", { name: "AI 助手", exact: true }).click()
  await page.getByRole("complementary", { name: "AI 创作助手" }).waitFor()
  await page.getByRole("button", { name: "切换深色", exact: true }).click()
  await capture("storyboard-1366-dark-assistant")
  await page.getByRole("button", { name: "AI 助手", exact: true }).click()
  await page.getByRole("button", { name: "切换浅色", exact: true }).click()
  await page.getByRole("button", { name: "自由画布", exact: true }).click()
  await page.locator(".react-flow").waitFor()
  await page.getByRole("button", { name: "适应内容", exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await capture("canvas-1440-light")
  await page.setViewportSize({ width: 390, height: 844 })
  await capture("canvas-390-list")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(route + "/assets")
  await page.getByRole("heading", { name: "项目资产", exact: true }).waitFor()
  await capture("assets-1440-light")
  await page.goto(route + "/assets?asset=" + f.assetId)
  await page.getByRole("heading", { name: "旧铜钥匙", exact: true }).waitFor()
  await page.waitForFunction(() =>
    [...document.querySelectorAll("main img")].some(
      (i) => i.complete && i.naturalWidth > 0,
    ),
  )
  await capture("asset-detail-1440-light")
  await page.goto(route + "/script")
  await page.getByRole("textbox", { name: "剧本正文", exact: true }).waitFor()
  await capture("script-1440-light")
  return {
    phase: "before",
    build,
    states,
    pageErrors: errors,
    fixtureScope: "real isolated API/PG/MinIO; zero generation calls",
    note: "Baseline observations, not final acceptance",
  }
}
