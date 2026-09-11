async (page) => {
  const marker = "上传恢复 1789124885414 丢失创建回包.png",
    uploadId = "28d075b2-a603-4450-903b-94729ff29055";
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let createRequests = 0;
  const count = (r) => {
    if (r.method() === "POST" && /\/v1\/tenants\/[^/]+\/uploads$/.test(r.url()))
      createRequests++;
  };
  page.on("request", count);
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
      const r = await work();
      if (r) return r;
      if (Date.now() > until) throw Error(message);
      await page.waitForTimeout(500);
    }
  };
  const row = page.getByRole("article", {
    name: `画布上传 ${marker}`,
    exact: true,
  });
  await row.waitFor();
  await row
    .locator("input[type=file]")
    .setInputFiles("output/playwright/scene-canvas/upload-recovery-wrong.png");
  await row
    .getByText(
      "所选文件与本次上传的原声明不同，请选择原文件；更换内容应新建导入。",
      { exact: true },
    )
    .waitFor();
  await row
    .locator("input[type=file]")
    .setInputFiles(
      "output/playwright/scene-canvas/upload-recovery-original.png",
    );
  const final = await poll(async () => {
    const s = await read();
    return s.canvas.document.nodes.find((n) => n.title === marker);
  }, "Original file did not recover");
  await page.getByRole("button", { name: "撤销画布编辑", exact: true }).click();
  await poll(
    async () =>
      !(await read()).canvas.document.nodes.some((n) => n.id === final.id),
    "Undo not saved",
  );
  await page.waitForTimeout(5500);
  await page.reload();
  await page.getByRole("button", { name: "上传文件", exact: true }).waitFor();
  const state = await read();
  if (state.canvas.document.nodes.some((n) => n.id === final.id))
    throw Error("Undo reinserted accepted upload");
  const entry = await page.evaluate(
    async (url) => (await fetch(url)).json(),
    `${root}/canvases/${state.canvas.id}/uploads/${uploadId}`,
  );
  if (!entry.placed || entry.upload.mediaId !== final.content.mediaId)
    throw Error("Permanent placed identity missing");
  if (createRequests !== 0 || errors.length)
    throw Error(JSON.stringify({ createRequests, errors }));
  page.off("request", count);
  return {
    wrongFileRejected: true,
    originalFileResumes: true,
    noRepeatedCreate: true,
    undoNeverReinsertsAfterReload: true,
    uploadId,
    nodeId: final.id,
    mediaId: final.content.mediaId,
    pageErrors: 0,
  };
}
