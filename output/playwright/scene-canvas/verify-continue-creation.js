async (page) => {
  const errors = [],
    generationRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /generation-(plans|jobs)/.test(request.url())
    )
      generationRequests.push(request.url());
  });
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.reload();
  const saved = () =>
    page.waitForFunction(() =>
      [...document.querySelectorAll("[role=status]")].some((e) =>
        e.textContent.includes("画布 · 已保存"),
      ),
    );
  await saved();
  const path = await page.evaluate(() => {
    const p = location.hash.split("?")[0].split("/");
    return `/v1/tenants/${p[3]}/projects/${p[5]}`;
  });
  const scene = await page.evaluate(() =>
    new URLSearchParams(location.hash.split("?")[1]).get("scene"),
  );
  const read = () =>
    page.evaluate(async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw Error("Canvas read " + r.status);
      return r.json();
    }, `${path}/scenes/${scene}/canvas`);
  const marker = "继续创作来源 " + Date.now();
  await page.getByRole("button", { name: "文字", exact: true }).click();
  await page
    .getByRole("textbox", { name: "节点名称", exact: true })
    .fill(marker);
  await page
    .getByRole("textbox", { name: "文字内容", exact: true })
    .fill("先看向门，再放下钥匙。");
  await saved();
  const before = await read(),
    note = before.canvas.document.nodes.find((n) => n.title === marker),
    media = before.canvas.document.nodes.find(
      (n) => n.content.type === "media",
    );
  if (!note || !media) throw Error("Reference fixtures missing");
  const list = page
    .locator("details")
    .filter({
      has: page.locator("summary", { hasText: "节点列表与键盘定位" }),
    });
  const openList = async () => {
    if (!(await list.evaluate((e) => e.open)))
      await list.locator("summary").click();
  };
  await openList();
  await list.getByRole("button", { name: marker, exact: true }).click();
  await list
    .getByRole("button", { name: media.title, exact: true })
    .first()
    .click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "共同作为参考", exact: true }).click();
  const picker = page.getByRole("dialog").filter({ hasText: "从这些来源创建" });
  await picker.getByText(marker, { exact: true }).waitFor();
  await picker.getByText(media.title, { exact: true }).waitFor();
  await picker
    .getByRole("button", { name: "新的视频草稿", exact: true })
    .click();
  await saved();
  let current = await read(),
    draft = current.canvas.document.nodes.find(
      (n) =>
        n.kind === "video" &&
        n.title === "新的视频草稿" &&
        !before.canvas.document.nodes.some((old) => old.id === n.id),
    );
  if (!draft) throw Error("New draft missing");
  const inbound = current.canvas.document.edges
    .filter((e) => e.targetNodeId === draft.id)
    .sort((a, b) => a.position - b.position);
  if (
    JSON.stringify(inbound.map((e) => [e.sourceNodeId, e.purpose])) !==
    JSON.stringify([
      [note.id, "prompt"],
      [media.id, "composition"],
    ])
  )
    throw Error("Wrong references or order");
  for (const source of [note, media])
    if (
      JSON.stringify(
        current.canvas.document.nodes.find((n) => n.id === source.id),
      ) !== JSON.stringify(source)
    )
      throw Error("Original changed");
  if (current.bindings.some((binding) => binding.nodeId === draft.id))
    throw Error("Draft inherited a shot binding");
  await page
    .getByRole("textbox", { name: "本次提示词", exact: true })
    .fill("保持人物一致，缓慢推近。");
  await page
    .getByRole("combobox", { name: media.title + " · 用途", exact: true })
    .click();
  await page.getByRole("option", { name: "动作", exact: true }).click();
  await page.getByRole("button", { name: "停用", exact: true }).first().click();
  await saved();
  const edited = (await read()).canvas.document.edges.filter(
    (edge) => edge.targetNodeId === draft.id,
  );
  if (
    edited.find((edge) => edge.sourceNodeId === media.id)?.purpose !==
      "action" ||
    edited.find((edge) => edge.sourceNodeId === note.id)?.enabled !== false
  )
    throw Error("References did not retain explicit edits");
  await page.getByRole("button", { name: "分镜", exact: true }).click();
  await page.getByRole("button", { name: "自由画布", exact: true }).click();
  if (
    (await page
      .getByRole("textbox", { name: "本次提示词", exact: true })
      .inputValue()) !== "保持人物一致，缓慢推近。"
  )
    throw Error("Mode lost draft");
  await page.reload();
  await saved();
  if (
    (await page
      .getByRole("textbox", { name: "本次提示词", exact: true })
      .inputValue()) !== "保持人物一致，缓慢推近。"
  )
    throw Error("Reload lost draft");
  await openList();
  await list.getByRole("button", { name: marker, exact: true }).click();
  await page.getByRole("button", { name: "继续创作", exact: true }).click();
  const remote = await read();
  await page.evaluate(
    async ({ path, canvasId, revision, doc, noteId }) => {
      const session = await (await fetch("/v1/session")).json();
      doc.nodes = doc.nodes.map((n) =>
        n.id === noteId
          ? {
              ...n,
              content: { type: "text", text: "已在另一页改为转身离开。" },
            }
          : n,
      );
      const response = await fetch(`${path}/canvases/${canvasId}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": session.csrfToken,
          "if-match": `"${revision}"`,
        },
        body: JSON.stringify({ schemaVersion: 1, document: doc }),
      });
      if (!response.ok) throw Error("Remote edit " + response.status);
    },
    {
      path,
      canvasId: remote.canvas.id,
      revision: remote.canvas.revision,
      doc: remote.canvas.document,
      noteId: note.id,
    },
  );
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll("textarea")].find(
      (el) => el.value === "已在另一页改为转身离开。",
    );
    return !!el;
  });
  await picker
    .getByRole("button", { name: "新的图片草稿", exact: true })
    .click();
  await picker
    .getByText("打开操作后来源已修改或移除，请重新选择后继续。", {
      exact: true,
    })
    .waitFor();
  if (
    (await read()).canvas.document.nodes.length !==
    current.canvas.document.nodes.length
  )
    throw Error("Stale sources created draft");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "继续创作", exact: true }).click();
  await picker
    .getByRole("button", { name: "新的图片草稿", exact: true })
    .click();
  await saved();
  current = await read();
  const imageDraft = current.canvas.document.nodes.find(
    (n) =>
      n.title === "新的图片草稿" &&
      !before.canvas.document.nodes.some((old) => old.id === n.id),
  );
  if (!imageDraft) throw Error("Single-source draft missing");
  await page.getByRole("button", { name: "撤销画布编辑", exact: true }).click();
  await saved();
  if ((await read()).canvas.document.nodes.some((n) => n.id === imageDraft.id))
    throw Error("Undo retained new draft");
  await page.getByRole("button", { name: "重做画布编辑", exact: true }).click();
  await saved();
  if (!(await read()).canvas.document.nodes.some((n) => n.id === imageDraft.id))
    throw Error("Redo missing draft");
  const layouts = [];
  for (const [width, height] of [
    [1512, 982],
    [1366, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await openList();
    await list.getByRole("button", { name: marker, exact: true }).click();
    await page.getByRole("button", { name: "继续创作", exact: true }).click();
    await picker.waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[role="dialog"]')].some(
        (el) =>
          el.textContent.includes("从这些来源创建") &&
          getComputedStyle(el).opacity === "1",
      ),
    );
    const bounds = await picker.boundingBox();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    if (overflow || !bounds || bounds.x < 0 || bounds.x + bounds.width > width)
      throw Error("Picker outside viewport " + width);
    await page.screenshot({
      path: `output/playwright/scene-canvas/15-continue-creation-${width}.png`,
      fullPage: false,
    });
    layouts.push({
      width,
      height,
      containedPicker: true,
      horizontalOverflow: false,
    });
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1512, height: 982 });
  if (generationRequests.length || errors.length)
    throw Error(JSON.stringify({ generationRequests, errors }));
  return {
    singleSource: true,
    multipleSources: true,
    fixedMediaAndText: true,
    independentDraft: true,
    editableReferences: true,
    modeAndReloadRecovery: true,
    staleSourceBlocked: true,
    atomicUndoRedo: true,
    generationRequests: 0,
    layouts,
    pageErrors: 0,
    scope: "actual local production browser/API canvas, no model execution",
  };
}
