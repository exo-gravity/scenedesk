async (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const failedReads = [];
  page.on("response", (r) => {
    if (r.status() >= 500 && r.request().method() === "GET")
      failedReads.push({
        status: r.status(),
        path: r.url().match(/\/v1\/[^?]*/)?.[0],
      });
  });
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto(
    "http://127.0.0.1:4311/#/app/t/b128e444-cd57-4087-bcfe-c403051bbd8f/p/1498c59a-a789-4087-8069-4c99ebcbd63f/production?scene=c31f8ac4-a0f4-4b43-983a-6e3b09c05d1d&mode=canvas",
  );
  await page.getByRole("button", { name: "上传文件", exact: true }).waitFor();
  const root = await page.evaluate(() => {
    const p = location.hash.split("?")[0].split("/");
    return `/v1/tenants/${p[3]}/projects/${p[5]}`;
  });
  const scene = await page.evaluate(() =>
    new URLSearchParams(location.hash.split("?")[1]).get("scene"),
  );
  const read = () =>
    page.evaluate(async (url) => {
      const r = await fetch(url, { cache: "no-store" });
      const b = await r.json();
      if (!r.ok)
        throw Error(JSON.stringify({ status: r.status, code: b.code }));
      return b;
    }, `${root}/scenes/${scene}/canvas`);
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
    page.evaluate(async (url) => {
      const r = await fetch(url, { cache: "no-store" });
      const b = await r.json();
      if (!r.ok)
        throw Error(JSON.stringify({ status: r.status, code: b.code }));
      return b;
    }, `${root}/canvases/${canvasId}/uploads`);
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

  const name = `${marker} 保留已导入文件.png`;
  let completeCount = 0,
    uploadId;
  const lose = async (route) => {
    completeCount++;
    const response = await route.fetch();
    if (response.status() !== 202) throw Error("Completion did not persist");
    const body = await response.json();
    uploadId = body.id;
    await route.abort("connectionfailed");
  };
  await page.route("**/uploads/*/complete", lose);
  try {
    await makeDrop([name]);
    await poll(async () => uploadId, "Completion not received");
    await page
      .getByRole("article", { name: `画布上传 ${name}`, exact: true })
      .getByText("需要恢复", { exact: true })
      .waitFor();
  } finally {
    await page.unroute("**/uploads/*/complete", lose);
  }
  await page.reload();
  const entry = await poll(async () => {
    const found = (await entries()).items.find((e) => e.upload.id === uploadId);
    if (found && ["expired", "rejected"].includes(found.upload.status))
      throw Error(JSON.stringify(found.upload.issue));
    return found?.upload.status === "accepted" && found;
  }, "Accepted upload was not recovered");
  if ((await read()).canvas.document.nodes.some((n) => n.id === entry.nodeId))
    throw Error("Reload unexpectedly placed media");
  const row = page.getByRole("article", {
    name: `画布上传 ${name}`,
    exact: true,
  });
  await row.getByRole("button", { name: "放入画布", exact: true }).waitFor();
  const before = (await read()).canvas;
  await row
    .getByRole("button", { name: "移除待处理呈现", exact: true })
    .click();
  await row.waitFor({ state: "hidden" });
  const after = (await read()).canvas;
  const final = await page.evaluate(
    async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw Error("Original media is no longer accessible");
      return r.json();
    },
    `/v1/tenants/${root.split("/")[3]}/media/${entry.upload.mediaId}`,
  );
  const exact = await page.evaluate(async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw Error("Missing dismissed identity");
    return r.json();
  }, `${root}/canvases/${canvasId}/uploads/${uploadId}`);
  if (
    before.revision !== after.revision ||
    !exact.dismissed ||
    final.status !== "ready" ||
    completeCount !== 1 ||
    errors.length ||
    failedReads.length
  )
    throw Error("Dismiss changed source or canvas");
  return {
    acceptedMediaDismissal: true,
    originalMediaStillReady: true,
    canvasRevisionUnchanged: true,
    completeRequests: completeCount,
    uploadId,
    mediaId: final.id,
    pageErrors: 0,
    failedReads,
  };
}
