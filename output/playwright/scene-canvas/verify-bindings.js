async (page) => {
  await page.setViewportSize({ width: 1512, height: 982 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const route = page.url().split("#")[1].split("?")[0];
  const scene = await page.evaluate(() =>
    new URLSearchParams(location.hash.split("?")[1]).get("scene"),
  );
  const projectPath =
    "/v1/tenants/" +
    route
      .split("/t/")[1]
      .replace("/p/", "/projects/")
      .replace("/production", "");
  const scenePath = projectPath + "/scenes/" + scene + "/canvas";
  const read = () =>
    page.evaluate(async (path) => {
      const r = await fetch(path);
      if (!r.ok) throw Error("Read " + r.status);
      return r.json();
    }, scenePath);
  const readTakes = () =>
    page.evaluate(
      async (path) => (await fetch(path + "/takes?limit=100")).json(),
      projectPath,
    );
  await page.getByRole("textbox", { name: "节点名称", exact: true }).waitFor();
  await page.getByRole("button", { name: "复制", exact: true }).click();
  const fixtureTitle = "镜头关联回归 " + Date.now();
  await page
    .getByRole("textbox", { name: "节点名称", exact: true })
    .fill(fixtureTitle);
  await page.waitForFunction(() =>
    [...document.querySelectorAll("[role=status]")].some((e) =>
      e.textContent.includes("画布 · 已保存"),
    ),
  );
  await page.getByRole("button", { name: /^镜头关联 ·/ }).click();
  const title = await page
    .getByRole("textbox", { name: "节点名称", exact: true })
    .inputValue();
  let current = await read();
  const node = current.canvas.document.nodes.find((n) => n.title === title);
  if (!node) throw Error("Target missing");
  const chooseShot = async () => {
    await page
      .getByRole("combobox", { name: "关联到本场镜头", exact: true })
      .click();
    await page.getByRole("option", { name: "对白核对", exact: true }).click();
  };
  const role = async (label) => {
    await page.getByRole("combobox", { name: "关联用途", exact: true }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
  };
  const saved = () =>
    page.waitForFunction(() =>
      [...document.querySelectorAll("[role=status]")].some((e) =>
        e.textContent.includes("画布 · 已保存"),
      ),
    );
  const rebase = async () => {
    const button = page.getByRole("button", {
      name: "已核对，使用当前画布版本",
      exact: true,
    });
    if (await button.count()) await button.click();
  };
  if (
    await page
      .getByRole("button", { name: "恢复未提交内容", exact: true })
      .count()
  )
    await page
      .getByRole("button", { name: "恢复未提交内容", exact: true })
      .click();
  await chooseShot();
  await role("视频候选");
  await page
    .getByRole("textbox", { name: "候选入点（秒）", exact: true })
    .fill("0.");
  await page
    .getByRole("textbox", { name: "候选出点（秒）", exact: true })
    .fill("2.000001");
  await page.getByRole("button", { name: "分镜", exact: true }).click();
  if (
    (await page
      .getByRole("textbox", { name: "候选入点（秒）", exact: true })
      .inputValue()) !== "0."
  )
    throw Error("Mode lost raw range");
  await page.getByRole("button", { name: "自由画布", exact: true }).click();
  await page
    .getByText("修改已保存在本标签页，尚未提交。", { exact: true })
    .waitFor();
  await page.reload();
  await saved();
  await page.getByRole("button", { name: /^镜头关联 ·/ }).click();
  await page
    .getByRole("button", { name: "恢复未提交内容", exact: true })
    .click();
  if (
    (await page
      .getByRole("textbox", { name: "候选入点（秒）", exact: true })
      .inputValue()) !== "0."
  )
    throw Error("Reload lost raw range");
  if (
    await page
      .getByRole("button", { name: "确认关联镜头", exact: true })
      .isEnabled()
  )
    throw Error("Incomplete range submitted");
  await page
    .getByRole("textbox", { name: "候选入点（秒）", exact: true })
    .fill("0.250001");
  await rebase();
  const takesBefore = (await readTakes()).items.length;
  const contentBefore = await page.evaluate(
    async (path) => (await fetch(path + "/content")).json(),
    projectPath,
  );
  let posts = 0,
    lost = false;
  await page.route("**/shot-bindings", async (request) => {
    if (request.request().method() !== "POST") return request.continue();
    posts++;
    if (!lost) {
      const response = await request.fetch();
      if (response.status() !== 201)
        throw Error(
          "Bind server " + response.status() + " " + (await response.text()),
        );
      lost = true;
      await request.abort("failed");
    } else await request.continue();
  });
  await page.getByRole("button", { name: "确认关联镜头", exact: true }).click();
  await page
    .getByText("连接中断。请保留当前内容，恢复连接后重试。", { exact: true })
    .waitFor();
  await saved();
  await page
    .getByRole("button", { name: "已核对，使用当前画布版本", exact: true })
    .waitFor();
  current = await read();
  const bound = current.bindings.find(
    (b) => b.nodeId === node.id && b.role === "candidate",
  );
  if (!bound) throw Error("No committed binding");
  const take = await page.evaluate(
    async (path) => (await fetch(path)).json(),
    projectPath + "/takes/" + bound.takeId,
  );
  if (take.range.inUs !== 250001 || take.range.outUs !== 2000001)
    throw Error("Wrong fixed range");
  await rebase();
  await page.getByRole("button", { name: "确认关联镜头", exact: true }).click();
  await page
    .getByText("已确认镜头关联；候选与采用保持分别处理。", { exact: true })
    .waitFor();
  if (posts !== 1) throw Error("Unknown reply repeated POST");
  await page.unroute("**/shot-bindings");
  const after = (await readTakes()).items.length;
  if (after > takesBefore + 1) throw Error("Duplicated Take");
  const contentAfter = await page.evaluate(
    async (path) => (await fetch(path + "/content")).json(),
    projectPath,
  );
  if (JSON.stringify(contentBefore) !== JSON.stringify(contentAfter))
    throw Error("Binding changed shot/adoption");
  await chooseShot();
  await rebase();
  await page.getByRole("button", { name: "确认关联镜头", exact: true }).click();
  await page.waitForFunction(
    async ({ path, id }) => {
      const s = await (await fetch(path)).json();
      return s.bindings.filter((b) => b.nodeId === id).length === 2;
    },
    { path: scenePath, id: node.id },
  );
  await saved();
  await page
    .getByRole("button", { name: "解除此关联", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "节点名称", exact: true })
    .fill(title + " · 关联核对");
  await saved();
  if (
    await page
      .getByRole("button", { name: "确认解除关联", exact: true })
      .isEnabled()
  )
    throw Error("Stale unlink enabled");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("button", { name: "解除此关联", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "确认解除关联", exact: true }).click();
  await page.waitForFunction(
    async ({ path, id }) =>
      !(await (await fetch(path)).json()).bindings.some((b) => b.id === id),
    { path: scenePath, id: bound.id },
  );
  await saved();
  const retained = await page.evaluate(
    async (path) => (await fetch(path)).json(),
    projectPath + "/takes/" + bound.takeId,
  );
  if (retained.id !== bound.takeId) throw Error("Unlink deleted Take");
  await page.getByRole("button", { name: "移除节点", exact: true }).click();
  await saved();
  current = await read();
  const reference = current.bindings.find(
    (b) => b.nodeId === node.id && b.role === "reference",
  );
  if (!reference || reference.nodeActive)
    throw Error("Removed node lost reference history");
  await page.getByRole("button", { name: "撤销画布编辑", exact: true }).click();
  await saved();
  current = await read();
  if (
    !current.bindings.find((b) => b.id === reference.id)?.nodeActive ||
    current.bindings.some((b) => b.id === bound.id)
  )
    throw Error("Undo changed binding facts");
  await page.getByRole("button", { name: "定位镜头节点", exact: true }).click();
  await page.getByRole("button", { name: "复制", exact: true }).click();
  await saved();
  current = await read();
  const copied = current.canvas.document.nodes.find(
    (n) => n.title === title + " · 关联核对 副本",
  );
  if (!copied || current.bindings.some((b) => b.nodeId === copied.id))
    throw Error("Copy inherited binding");
  const target = page.getByText("关联目标 · " + title, { exact: true });
  await target.waitFor();
  await page.getByRole("button", { name: "添加到画布", exact: true }).click();
  const candidateCard = page
    .getByText(new RegExp("^候选 " + take.id.slice(0, 8) + " ·"))
    .locator("..");
  await candidateCard
    .getByRole("button", { name: "添加这份素材到画布", exact: true })
    .click();
  await saved();
  await page
    .getByText("修改已保存在本标签页，尚未提交。", { exact: true })
    .waitFor();
  await page.reload();
  await saved();
  await page.getByRole("button", { name: /^镜头关联 ·/ }).click();
  await page
    .getByRole("button", { name: "恢复未提交内容", exact: true })
    .click();
  await rebase();
  if (
    (await page
      .getByRole("textbox", { name: "候选入点（秒）", exact: true })
      .inputValue()) !== "0.250001"
  )
    throw Error("Placement lost fixed interval");
  await page.getByRole("button", { name: "确认关联镜头", exact: true }).click();
  await page
    .getByText("已确认镜头关联；候选与采用保持分别处理。", { exact: true })
    .waitFor();
  await saved();
  current = await read();
  if (
    !current.bindings.some((b) => b.nodeId !== node.id && b.takeId === take.id)
  )
    throw Error("Placement did not reuse candidate");
  if ((await readTakes()).items.length !== after)
    throw Error("Placement duplicated Take");
  await page.getByRole("button", { name: "定位当前内容", exact: true }).click();
  await page.waitForFunction(() => {
    const stage = document.querySelector(".react-flow"),
      node = document.querySelector(".react-flow__node.selected");
    if (!stage || !node) return false;
    const a = stage.getBoundingClientRect(),
      b = node.getBoundingClientRect();
    return (
      b.top >= a.top - 2 &&
      b.bottom <= a.bottom + 2 &&
      b.left >= a.left - 2 &&
      b.right <= a.right + 2
    );
  });
  const layouts = [];
  for (const [width, height] of [
    [1512, 982],
    [1366, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    if (width > 760) {
      await page
        .getByRole("button", { name: "定位当前内容", exact: true })
        .click();
      await page.waitForFunction(() => {
        const stage = document.querySelector(".react-flow"),
          node = document.querySelector(".react-flow__node.selected");
        if (!stage || !node) return false;
        const a = stage.getBoundingClientRect(),
          b = node.getBoundingClientRect();
        return (
          b.top >= a.top - 2 &&
          b.bottom <= a.bottom + 2 &&
          b.left >= a.left - 2 &&
          b.right <= a.right + 2
        );
      });
      await page.waitForFunction(() => {
        const el = document.querySelector(".react-flow__viewport");
        if (!el) return false;
        const zoom = Math.round(
          new DOMMatrix(getComputedStyle(el).transform).a * 100,
        );
        return [...document.querySelectorAll("p")].some((p) =>
          p.textContent.includes("缩放 " + zoom + "%"),
        );
      });
    }
    const dock = page.getByRole("complementary", {
      name: "本场镜头与探索",
      exact: true,
    });
    await dock.evaluate((el) => {
      el.scrollTop = 300;
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    const header = await dock.getByText(/^当前关联：/).boundingBox(),
      bounds = await dock.boundingBox();
    if (
      !header ||
      !bounds ||
      header.y < bounds.y ||
      header.y + header.height > bounds.y + bounds.height
    )
      throw Error("Hidden binding target " + width);
    await dock.evaluate((el) => {
      el.scrollTop = 0;
    });
    if (width <= 760) await dock.scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    if (overflow) throw Error("Overflow " + width);
    await page.screenshot({
      path: "output/playwright/scene-canvas/13-bindings-" + width + ".png",
      fullPage: false,
    });
    layouts.push({
      width,
      height,
      horizontalOverflow: overflow,
      bindingTargetStaysVisible: true,
      ...(width > 760 ? { explicitFocusContainsMedia: true } : {}),
    });
  }
  await page.setViewportSize({ width: 1512, height: 982 });
  if (errors.length) throw Error(JSON.stringify(errors));
  return {
    canvasId: current.canvas.id,
    revision: current.canvas.revision,
    rawRangeModeAndReload: true,
    unknownCommittedPosts: posts,
    candidateId: take.id,
    staleUnlinkBlocked: true,
    unlinkRetainsCandidate: true,
    undoOnlyChangesDocument: true,
    copyDoesNotInheritBinding: true,
    existingCandidatePlacement: true,
    placementInputsSurviveReload: true,
    focusedMediaContained: true,
    layouts,
    pageErrors: errors.length,
    scope:
      "production browser and real local API/PostgreSQL with imported technical video; no real model or user acceptance",
  };
};
