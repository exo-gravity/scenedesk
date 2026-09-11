async (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.reload();
  const saved = () =>
    page.waitForFunction(() =>
      [...document.querySelectorAll("[role=status]")].some((el) =>
        el.textContent.includes("画布 · 已保存"),
      ),
    );
  await saved();
  const root = await page.evaluate(() => {
    const p = location.hash.split("?")[0].split("/");
    return `/v1/tenants/${p[3]}/projects/${p[5]}`;
  });
  const scene = await page.evaluate(() =>
    new URLSearchParams(location.hash.split("?")[1]).get("scene"),
  );
  const read = () =>
    page.evaluate(
      async (path) => (await fetch(path)).json(),
      `${root}/scenes/${scene}/canvas`,
    );
  const before = await read(),
    marker = `画布拖入验证 ${Date.now()}.png`;
  const surface = page.locator(".react-flow");
  await surface.scrollIntoViewIfNeeded();
  const bounds = await surface.boundingBox();
  if (!bounds) throw Error("Canvas missing");
  const point = {
    x: bounds.x + bounds.width * 0.6,
    y: bounds.y + bounds.height * 0.5,
  };
  const data = await page.evaluateHandle(async (name) => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const c = canvas.getContext("2d");
    c.fillStyle = "#536778";
    c.fillRect(0, 0, 256, 128);
    c.fillStyle = "#ebdfcb";
    c.fillRect(32, 32, 192, 64);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    const data = new DataTransfer();
    data.items.add(new File([blob], name, { type: "image/png" }));
    return data;
  }, marker);
  await surface.dispatchEvent("drop", {
    dataTransfer: data,
    clientX: point.x,
    clientY: point.y,
  });
  const row = page.getByRole("article", {
    name: `画布上传 ${marker}`,
    exact: true,
  });
  await row.waitFor();
  await page
    .locator(".react-flow__node-upload")
    .filter({ hasText: marker })
    .waitFor();
  const pending = await page.evaluate(
    async (url) => (await fetch(url)).json(),
    `${root}/canvases/${before.canvas.id}/uploads`,
  );
  const deadline = Date.now() + 120000;
  for (;;) {
    const actual = await read();
    if (
      actual.canvas.document.nodes.some(
        (n) => n.title === marker && n.content.type === "media",
      )
    )
      break;
    if (Date.now() > deadline) throw Error("Imported node was not saved");
    await page.waitForTimeout(500);
  }
  await saved();
  const after = await read();
  const added = after.canvas.document.nodes.find((n) => n.title === marker);
  if (
    after.canvas.document.nodes.length !==
    before.canvas.document.nodes.length + 1
  )
    throw Error("Expected one fixed node");
  await page.reload();
  await saved();
  if (!(await read()).canvas.document.nodes.some((n) => n.id === added.id))
    throw Error("Reload lost imported media");
  if (errors.length) throw Error(JSON.stringify(errors));
  return {
    actualDrop: true,
    pendingNode: true,
    acceptedMedia: true,
    reloadPreservesIdentity: true,
    nodeId: added.id,
    mediaId: added.content.mediaId,
    marker,
    canvasId: before.canvas.id,
    pageErrors: 0,
  };
}
