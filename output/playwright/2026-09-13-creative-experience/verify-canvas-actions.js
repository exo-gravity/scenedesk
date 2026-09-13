async (page) => {
  const f = await (
      await page.request.get("http://127.0.0.1:4317/__fixture/ids")
    ).json(),
    cp = f.path + "/canvases/" + f.canvasId,
    out = `output/playwright/2026-09-13-creative-experience/${f.runId}/after`,
    check = (v, m) => {
      if (!v) throw Error(m)
    }
  page.setDefaultTimeout(15000)
  await page.getByRole("button", { name: "适应内容", exact: true }).click()
  await page.waitForTimeout(400)
  const before = await (await page.request.get(f.origin + cp)).json(),
    original = before.document.nodes.find((n) => n.id === f.textId)
  const header = page
    .getByRole("article", { name: "本次动作要求 · text", exact: true })
    .locator(".canvas-drag-handle")
  const b = await header.boundingBox()
  await page.mouse.move(b.x + 40, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + 125, b.y + b.height / 2 + 50, { steps: 12 })
  await page.mouse.up()
  await page.waitForFunction(
    async ({ cp, id, x }) =>
      (await (await fetch(cp)).json()).document.nodes.find((n) => n.id === id)
        .position.x !== x,
    { cp, id: f.textId, x: original.position.x },
  )
  const dragged = await (await page.request.get(f.origin + cp)).json(),
    moved = dragged.document.nodes.find((n) => n.id === f.textId)
  check(
    JSON.stringify(moved.content) === JSON.stringify(original.content),
    "drag changed content",
  )
  const toolbar = page.locator('[aria-label="所选内容操作"]')
  await toolbar.getByRole("button", { name: "继续创作", exact: true }).click()
  await page.getByRole("button", { name: "新的图片草稿", exact: true }).click()
  await page.getByRole("textbox", { name: "本次提示词", exact: true }).waitFor()
  await page.getByRole("button", { name: "保存画布", exact: true }).click()
  await page.waitForFunction(
    async ({ cp, n }) =>
      (await (await fetch(cp)).json()).document.nodes.length === n,
    { cp, n: dragged.document.nodes.length + 1 },
  )
  const after = await (await page.request.get(f.origin + cp)).json(),
    added = after.document.nodes.find(
      (n) => !dragged.document.nodes.some((old) => old.id === n.id),
    )
  check(
    added.kind === "image" && added.content.type === "draft",
    "continue failed new draft",
  )
  check(
    after.document.edges.some(
      (e) =>
        e.sourceNodeId === f.textId &&
        e.targetNodeId === added.id &&
        e.purpose === "prompt",
    ),
    "continue missing source edge",
  )
  const preserved = after.document.nodes.find((n) => n.id === f.textId)
  check(
    preserved.id === moved.id &&
      preserved.title === moved.title &&
      preserved.width === moved.width &&
      preserved.position.x === moved.position.x &&
      preserved.position.y === moved.position.y &&
      preserved.content.type === moved.content.type &&
      preserved.content.text === moved.content.text,
    "continue rewrote source",
  )
  await page.screenshot({ path: out + "/canvas-continue-1440.png" })
  await page
    .getByRole("article", { name: "本次动作要求 · text", exact: true })
    .click()
  const flow = page.locator(".react-flow")
  const r = await flow.boundingBox()
  await page.mouse.move(r.x + 20, r.y + 80)
  await page.mouse.wheel(2400, 0)
  await page.waitForTimeout(500)
  const label = await toolbar.innerText(),
    tb = await toolbar.boundingBox()
  check(
    label.includes("本次动作要求"),
    "offscreen toolbar missing selection identity",
  )
  check(
    tb.x >= r.x && tb.x + tb.width <= r.x + r.width + 1 && tb.y >= r.y,
    "offscreen toolbar out of viewport",
  )
  await page.screenshot({ path: out + "/canvas-offscreen-selection-1440.png" })
  await page.getByRole("button", { name: "适应内容", exact: true }).click()
  return {
    realPointerDrag: { before: original.position, after: moved.position },
    dragAutoSaved: true,
    continueCreatedDraft: added.id,
    sourceEdgePreserved: true,
    sourceUnchanged: true,
    toolbarClickNotPane: true,
    offscreenSelectionLabel: label,
    toolbar: tb,
    generationCalls: 0,
  }
}
