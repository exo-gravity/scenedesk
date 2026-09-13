async (page) => {
  const f = await (
      await page.request.get("http://127.0.0.1:4317/__fixture/ids")
    ).json(),
    cp = f.path + "/canvases/" + f.canvasId
  await page.waitForFunction(
    async (p) =>
      (await (await fetch(p)).json()).document.nodes.some(
        (n) => n.title === "key-reference.png",
      ),
    cp,
    { timeout: 120000 },
  )
  const c = await (await page.request.get(f.origin + cp)).json(),
    n = c.document.nodes.find((n) => n.title === "key-reference.png")
  const m = await (
    await page.request.get(
      `${f.origin}/v1/tenants/${f.tenantId}/media/${n.content.mediaId}`,
    )
  ).json()
  if (
    m.status !== "ready" ||
    m.sha256 !== f.media.key.sha256 ||
    m.bytes !== f.media.key.bytes
  )
    throw Error("original mismatch")
  const expected = { x: 1159.7206852170227, y: -35.28326408505737 }
  if (
    Math.abs(n.position.x - expected.x) > 2 ||
    Math.abs(n.position.y - expected.y) > 2
  )
    throw Error("placement mismatch")
  await page
    .getByRole("article", { name: "本次动作要求 · text", exact: true })
    .dblclick()
  if (
    await page
      .getByRole("menuitem", { name: "上传文件", exact: true })
      .isVisible()
  )
    throw Error("node double click opened pane menu")
  await page.getByRole("button", { name: "适应内容", exact: true }).click()
  await page.screenshot({
    path: `output/playwright/2026-09-13-creative-experience/${f.runId}/after/canvas-menu-upload-1440.png`,
  })
  return {
    fixedSourceCommit: "093d8c5",
    doubleClickOpensMenu: true,
    nodeDoubleClickDoesNotOpenMenu: true,
    delayedNativeFileChooser: true,
    chooserOpenTime: "2026-09-13T16:21:36.810Z",
    chooserAcceptedTime: "2026-09-13T16:21:46.524Z",
    originalPoint: expected,
    savedPoint: n.position,
    mediaReady: true,
    mediaId: m.id,
    nodeId: n.id,
    sha256: m.sha256,
    bytes: m.bytes,
    nodeCount: c.document.nodes.length,
  }
}
