async (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.reload();
  await page.getByRole("button", { name: "自由画布", exact: true }).click();
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
  const missing = `${marker} 丢失创建回包.png`;
  let created = null,
    createCount = 0;
  const countRequest = (request) => {
    if (
      request.method() === "POST" &&
      request.url().match(/\/v1\/tenants\/[^/]+\/uploads$/)
    )
      createCount++;
  };
  page.on("request", countRequest);
  const createPattern = `**/v1/tenants/*/uploads`;
  const lose = async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    if (response.status() !== 201) throw Error("Actual create failed");
    const body = await response.json();
    created = { id: body.id };
    await route.abort("connectionfailed");
  };
  await page.route(createPattern, lose);
  let drop;
  try {
    drop = await makeDrop([missing]);
    await poll(async () => created, "Create did not commit");
    await page
      .getByRole("article", { name: `画布上传 ${missing}`, exact: true })
      .getByText("需要恢复", { exact: true })
      .waitFor();
  } finally {
    await page.unroute(createPattern, lose);
  }
  const bytes = await drop.evaluate(async (data) =>
    Array.from(new Uint8Array(await data.files[0].arrayBuffer())),
  );
  await page.reload();
  const row = page.getByRole("article", {
    name: `画布上传 ${missing}`,
    exact: true,
  });
  await row.waitFor();
  const record = await poll(
    async () =>
      page.evaluate(async (name) => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open("scenedesk-media-imports", 1);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const all = await new Promise((resolve, reject) => {
          const r = db.transaction("imports").objectStore("imports").getAll();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        db.close();
        return all.find((x) => x.declaration.fileName === name && x.intentId);
      }, missing),
    "Request identity was not recovered",
  );
  if (record.intentId !== created.id) throw Error("Recovered another upload");
  page.off("request", countRequest);
  return {
    lostActualCreateRecovered: true,
    createRequests: createCount,
    uploadId: created.id,
    requestId: record.id,
    marker: missing,
    bytes,
    pageErrors: errors,
  };
}
