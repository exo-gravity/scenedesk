async (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.reload();
  await page.getByRole("button", { name: "上传文件", exact: true }).waitFor();
  const root = await page.evaluate(() => {
    const p = location.hash.split("?")[0].split("/");
    return `/v1/tenants/${p[3]}/projects/${p[5]}`;
  });
  const scene = await page.evaluate(() =>
    new URLSearchParams(location.hash.split("?")[1]).get("scene"),
  );
  const read = () =>
    page.evaluate(
      async (url) => (await fetch(url, { cache: "no-store" })).json(),
      `${root}/scenes/${scene}/canvas`,
    );
  const poll = async (work, message) => {
    const until = Date.now() + 120000;
    for (;;) {
      const result = await work();
      if (result) return result;
      if (Date.now() > until) throw Error(message);
      await page.waitForTimeout(500);
    }
  };
  const start = await read(),
    canvasId = start.canvas.id;
  const entries = () =>
    page.evaluate(
      async (url) => (await fetch(url, { cache: "no-store" })).json(),
      `${root}/canvases/${canvasId}/uploads`,
    );
  const marker = `上传恢复 ${Date.now()}`;
  const makeDrop = async (names) => {
    const surface = page.locator(".react-flow");
    await surface.scrollIntoViewIfNeeded();
    const rect = await surface.boundingBox();
    const files = await page.evaluateHandle(async (names) => {
      const data = new DataTransfer();
      for (let i = 0; i < names.length; i++) {
        const c = document.createElement("canvas");
        c.width = 96;
        c.height = 64;
        const ctx = c.getContext("2d");
        ctx.fillStyle = i ? "#ebdfcb" : "#536778";
        ctx.fillRect(0, 0, 96, 64);
        const b = await new Promise((resolve) =>
          c.toBlob(resolve, "image/png"),
        );
        data.items.add(new File([b], names[i], { type: "image/png" }));
      }
      return data;
    }, names);
    await surface.dispatchEvent("drop", {
      dataTransfer: files,
      clientX: rect.x + rect.width * 0.55,
      clientY: rect.y + rect.height * 0.5,
    });
    return files;
  };
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let completes = 0;
  const hold = async (route) => {
    if (route.request().method() === "POST" && ++completes === 1) await gate;
    await route.continue();
  };
  await page.route("**/uploads/*/complete", hold);
  const names = [`${marker} A.png`, `${marker} B.png`];
  try {
    await makeDrop(names);
    await poll(async () => completes === 1, "First completion not reached");
    if (
      (await page
        .locator(".react-flow__node-upload")
        .filter({ hasText: marker })
        .count()) !== 2
    )
      throw Error("Expected two pending landing points");
    await page.getByRole("button", { name: "分镜", exact: true }).click();
    await page
      .getByRole("article", { name: `画布上传 ${names[0]}`, exact: true })
      .waitFor();
    release();
    await poll(async () => {
      const s = await read();
      return names.every((name) =>
        s.canvas.document.nodes.some((n) => n.title === name),
      );
    }, "Multiple uploads not saved through mode switch");
  } finally {
    release();
    await page.unroute("**/uploads/*/complete", hold);
  }
  await page.getByRole("button", { name: "自由画布", exact: true }).click();
  const multi = (await read()).canvas.document.nodes.filter((n) =>
    names.includes(n.title),
  );
  if (
    multi.length !== 2 ||
    multi[1].position.x - multi[0].position.x !== 36 ||
    multi[1].position.y - multi[0].position.y !== 24
  )
    throw Error("Landing offsets changed");
  await page.getByRole("button", { name: "撤销画布编辑", exact: true }).click();
  await poll(
    async () =>
      !(await read()).canvas.document.nodes.some((n) => n.id === multi[1].id),
    "Undo not saved",
  );
  await page.waitForTimeout(5500);
  await page.reload();
  await page.getByRole("button", { name: "上传文件", exact: true }).waitFor();
  if ((await read()).canvas.document.nodes.some((n) => n.id === multi[1].id))
    throw Error("Undo reinserted upload");
  if (errors.length) throw Error(JSON.stringify(errors));
  return {
    multipleFiles: true,
    modeSwitchContinues: true,
    fixedLandingOffsets: true,
    undoNeverReinserts: true,
    nodes: multi.map((n) => ({
      id: n.id,
      title: n.title,
      position: n.position,
    })),
    pageErrors: 0,
  };
}
