async (page) => {
  const f = await (
      await page.request.get("http://127.0.0.1:4317/__fixture/ids")
    ).json(),
    cp = f.path + "/canvases/" + f.canvasId,
    out = `output/playwright/2026-09-13-creative-experience/${f.runId}/after`,
    check = (v, m) => {
      if (!v) throw Error(m)
    }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(
    `${f.origin}/#/app/t/${f.tenantId}/p/${f.projectId}/production?scene=${f.sceneId}&mode=canvas`,
  )
  await page.getByRole("button", { name: "适应内容", exact: true }).click()
  await page.waitForTimeout(400)
  const c = await (await page.request.get(f.origin + cp)).json(),
    source = c.document.nodes.find((n) => n.id === f.textId),
    created = c.document.nodes.find(
      (n) => n.kind === "image" && n.content.type === "draft",
    )
  check(
    created &&
      c.document.edges.some(
        (e) =>
          e.sourceNodeId === source.id &&
          e.targetNodeId === created.id &&
          e.purpose === "prompt",
      ),
    "continue draft source missing",
  )
  check(
    source.content.text === "冲突核对后仍保留这段本机文字。",
    "continue changed text",
  )
  await page
    .getByRole("article", { name: created.title + " · image", exact: true })
    .click()
  await page.screenshot({ path: out + "/canvas-continue-1440.png" })
  await page
    .getByRole("article", { name: "本次动作要求 · text", exact: true })
    .click()
  const toolbar = page.locator('[aria-label="所选内容操作"]'),
    flow = page.locator(".react-flow"),
    r = await flow.boundingBox()
  await page.mouse.move(r.x + 20, r.y + 80)
  await page.mouse.wheel(2400, 0)
  await page.waitForTimeout(600)
  const label = await toolbar.innerText(),
    tb = await toolbar.boundingBox()
  check(label.includes("本次动作要求"), "offscreen toolbar missing selection")
  check(
    tb.x >= r.x && tb.x + tb.width <= r.x + r.width + 1 && tb.y >= r.y,
    "offscreen toolbar out of viewport",
  )
  await page.screenshot({ path: out + "/canvas-offscreen-selection-1440.png" })
  await page.getByRole("button", { name: "适应内容", exact: true }).click()
  return {
    pointerDrag: { before: { x: 300, y: 40 }, after: source.position },
    dragAutoSaved: true,
    createdDraftId: created.id,
    sourceId: source.id,
    promptEdge: true,
    sourceContentPreserved: true,
    sourceHistoryIdenticalRevisions: [7, 8],
    toolbarClickNotPane: true,
    offscreenSelectionLabel: label,
    toolbar: tb,
    generationCalls: 0,
  }
}
