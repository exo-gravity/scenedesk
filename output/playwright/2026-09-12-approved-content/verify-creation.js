async (page) => {
  await page.goto("about:blank");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const tenant = "11111111-1111-4111-8111-111111111111",
    projectId = "22222222-2222-4222-8222-222222222222",
    userId = "33333333-3333-4333-8333-333333333333",
    sessionId = "44444444-4444-4444-8444-444444444444",
    sceneId = "55555555-5555-4555-8555-555555555555",
    episodeId = "66666666-6666-4666-8666-666666666666",
    shotId = "77777777-7777-4777-8777-777777777777";
  const base = `/v1/tenants/${tenant}`,
    path = `${base}/projects/${projectId}`,
    app = `http://127.0.0.1:4417/#/app/t/${tenant}/p/${projectId}/content`;
  const identity = {
    id: sessionId,
    revision: 1,
    userId,
    email: "controlled-creation@example.test",
    csrfToken: "synthetic-" + Math.random().toString(36).slice(2),
  };
  const member = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    revision: 1,
    userId,
    role: "member",
    status: "active",
  };
  const project = {
    id: projectId,
    revision: 1,
    name: "受控创建恢复项目",
    status: "active",
    leadMembershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    spec: {
      width: 1080,
      height: 1920,
      fpsNum: 24,
      fpsDen: 1,
      language: "zh-CN",
    },
  };
  const tree = {
    projectId,
    revision: 1,
    episodes: [
      {
        id: episodeId,
        projectId,
        revision: 1,
        title: "已有单集",
        position: 0,
        status: "active",
      },
    ],
    scenes: [
      {
        id: sceneId,
        projectId,
        episodeId,
        revision: 1,
        title: "已有场次",
        position: 0,
        status: "active",
        summary: "保留现有内容",
        state: {},
        defaultAssetRevisionIds: [],
      },
    ],
    shots: [
      {
        id: shotId,
        projectId,
        sceneId,
        revision: 1,
        label: "已有镜头",
        position: 0,
        status: "active",
        specRevisionId: "88888888-8888-4888-8888-888888888888",
        spec: { intent: "已有要求", references: [] },
      },
    ],
  };
  let mode = "normal",
    attempts = [],
    commits = [],
    receipts = new Map(),
    otherWrites = 0,
    reads = 0;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const reply = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await page.route("**/health/**", (route) =>
    reply(route, {
      phase: "business",
      identityMode: "local_test",
      providerMode: "mock",
    }),
  );
  await page.route("**/v1/**", async (route) => {
    const request = route.request(),
      url = request.url().split("?")[0],
      method = request.method();
    if (url.endsWith("/v1/session")) return reply(route, identity);
    if (url.endsWith("/v1/tenants"))
      return reply(route, {
        items: [
          {
            id: tenant,
            name: "受控工作室",
            revision: 1,
            ownerUserId: "other-user",
            currency: "CNY",
          },
        ],
      });
    if (url.endsWith(`${base}/members`))
      return reply(route, { items: [member] });
    if (url.endsWith(`${base}/projects`))
      return reply(route, { items: [project] });
    if (url.endsWith(path)) return reply(route, project);
    if (url.endsWith(`${path}/content`)) {
      reads++;
      return reply(route, tree);
    }
    if (url.endsWith("/events"))
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": controlled transport\n\n",
      });
    const kind = ["episode", "scene", "shot"].find((kind) =>
      url.endsWith(`${path}/${kind}s`),
    );
    if (kind && method === "POST") {
      const body = request.postDataJSON(),
        headers = request.headers(),
        key = headers["idempotency-key"],
        version = headers["if-match"];
      const attempt = { kind, body, key, version };
      attempts.push(attempt);
      const stored = await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open("scenedesk-content-drafts", 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        return new Promise((resolve, reject) => {
          const tx = db.transaction("drafts"),
            req = tx.objectStore("drafts").getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(req.result);
          };
          tx.onerror = () => reject(tx.error);
        });
      });
      const pending = stored.find(
        (record) => record.value.creationIntent?.command.idempotencyKey === key,
      )?.value.creationIntent.command;
      if (
        !pending ||
        JSON.stringify(pending.body) !== JSON.stringify(body) ||
        `"${pending.version}"` !== version
      )
        throw Error("Business effect attempted without exact durable request");
      if (receipts.has(key)) return reply(route, receipts.get(key), 201);
      if (mode === "reject") {
        mode = "normal";
        tree.revision++;
        return reply(
          route,
          { code: "REVISION_MISMATCH", message: "受控首次请求版本已变化" },
          412,
        );
      }
      if (version !== `"${tree.revision}"`)
        return reply(
          route,
          { code: "REVISION_MISMATCH", message: "原请求版本已变化" },
          412,
        );
      const id = `01234567-1234-4234-8234-${String(commits.length + 1).padStart(12, "0")}`;
      const entity = {
        id,
        projectId,
        revision: 1,
        ...body,
        ...(kind === "shot"
          ? {
              specRevisionId: `abcdef01-1234-4234-8234-${String(commits.length + 1).padStart(12, "0")}`,
            }
          : {}),
      };
      tree[kind + "s"].push(entity);
      tree.revision++;
      receipts.set(key, entity);
      commits.push({ id, kind, key });
      if (mode === "lose") {
        mode = "normal";
        return route.abort("failed");
      }
      return reply(route, entity, 201);
    }
    if (method !== "GET") otherWrites++;
    return reply(route, { items: [] });
  });
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put,
      remove = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (window.__failCreationStage && value?.value?.creationIntent)
        throw Error("controlled creation stage storage failure");
      return put.call(this, value, ...args);
    };
    IDBObjectStore.prototype.delete = function (...args) {
      if (
        window.__failCreationCleanup &&
        this.name === "drafts" &&
        sessionStorage.getItem(`scenedesk-draft-committed:${args[0]}`)
      )
        throw Error("controlled completion cleanup failure");
      return remove.call(this, ...args);
    };
  });
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto(app);
  await page.getByText("01 · 已有场次", { exact: true }).waitFor();
  await page.evaluate(async (userId) => {
    const existing = await indexedDB.databases();
    if (!existing.some((db) => db.name === "scenedesk-content-drafts")) return;
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("scenedesk-content-drafts");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite"),
        req = tx.objectStore("drafts").openCursor();
      req.onsuccess = () => {
        const row = req.result;
        if (!row) return;
        if (JSON.parse(row.key)[0] === userId) {
          row.delete();
          sessionStorage.removeItem(`scenedesk-draft-committed:${row.key}`);
        }
        row.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, userId);
  const open = async (kind) => {
    if (
      kind === "shot" &&
      !(await page
        .getByRole("button", { name: "添加镜头", exact: true })
        .isVisible())
    )
      await page
        .getByRole("button", { name: "场次与镜头要求", exact: true })
        .first()
        .click();
    await page
      .getByRole("button", {
        name: { episode: "新建单集", scene: "添加场次", shot: "添加镜头" }[
          kind
        ],
        exact: true,
      })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    return dialog;
  };
  const label = (kind) => (kind === "shot" ? "镜头编号" : "标题");
  const createLabel = (kind) =>
    "创建" + { episode: "单集", scene: "场次", shot: "镜头" }[kind];
  const lostResults = [];
  for (const kind of ["episode", "scene", "shot"]) {
    const beforeAttempts = attempts.length,
      beforeCommits = commits.length,
      title = `丢回包恢复${kind}`;
    let dialog = await open(kind);
    await dialog
      .getByRole("textbox", { name: label(kind), exact: true })
      .fill(title);
    if (kind === "shot")
      await dialog
        .getByRole("textbox", { name: "叙事意图", exact: true })
        .fill("必须保留的原镜头创作输入");
    mode = "lose";
    await dialog
      .getByRole("button", { name: createLabel(kind), exact: true })
      .click();
    await dialog.getByText("创建结果待确认", { exact: true }).waitFor();
    if (commits.length !== beforeCommits + 1)
      throw Error("Controlled transport did not commit before losing response");
    const original = JSON.stringify(attempts[beforeAttempts]);
    await page.reload();
    if (kind === "shot")
      await page
        .getByRole("button", { name: "场次与镜头要求", exact: true })
        .first()
        .click();
    await page.getByText(title, { exact: false }).first().waitFor();
    if (attempts.length !== beforeAttempts + 1)
      throw Error("Reload wrote automatically");
    dialog = await open(kind);
    await dialog
      .getByRole("button", { name: "恢复创建记录", exact: true })
      .click();
    if (
      (await dialog
        .getByRole("textbox", { name: label(kind), exact: true })
        .inputValue()) !== title
    )
      throw Error("Reload lost original input");
    if (
      await dialog
        .getByRole("button", {
          name: "核对后使用最新版本作为保存基线",
          exact: true,
        })
        .count()
    )
      throw Error("Unknown creation exposed rebase");
    if (
      await dialog
        .getByRole("button", { name: "放弃这份本地草稿", exact: true })
        .count()
    )
      throw Error("Unknown creation could discard identity");
    if (
      !(await dialog
        .getByRole("button", { name: createLabel(kind), exact: true })
        .isDisabled())
    )
      throw Error("Unknown creation allowed a new POST");
    if (kind === "shot") {
      await page.setViewportSize({ width: 390, height: 844 });
      await dialog
        .getByText("创建结果待确认", { exact: true })
        .scrollIntoViewIfNeeded();
    }
    await dialog
      .getByText("创建结果待确认", { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `output/playwright/2026-09-12-approved-content/${kind}-unknown-restored.png`,
      animations: "disabled",
    });
    await dialog
      .getByRole("button", { name: "恢复原创建请求", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    if (
      attempts.length !== beforeAttempts + 2 ||
      JSON.stringify(attempts[beforeAttempts + 1]) !== original ||
      commits.length !== beforeCommits + 1
    )
      throw Error("Recovery duplicated or changed creation " + kind);
    dialog = await open(kind);
    await dialog
      .getByRole("textbox", { name: label(kind), exact: true })
      .waitFor();
    if (
      (await dialog
        .getByRole("textbox", { name: label(kind), exact: true })
        .inputValue()) !== ""
    )
      throw Error("Successful recovery left old input");
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1512, height: 982 });
    lostResults.push({
      kind,
      attempts: 2,
      commits: 1,
      fixedRequest: true,
      noAutomaticReplay: true,
      rebaseBlocked: true,
    });
  }
  // Failed durable staging must not send a request; repairing local storage permits the same visible input.
  let dialog = await open("shot");
  await dialog
    .getByRole("textbox", { name: "镜头编号", exact: true })
    .fill("本地写入失败保留输入");
  await page.evaluate(() => {
    window.__failCreationStage = true;
  });
  const beforeStage = attempts.length;
  await dialog.getByRole("button", { name: "创建镜头", exact: true }).click();
  await dialog.getByText("本地保存不可用", { exact: true }).waitFor();
  if (attempts.length !== beforeStage)
    throw Error("Storage failure still submitted");
  if (
    (await dialog
      .getByRole("textbox", { name: "镜头编号", exact: true })
      .inputValue()) !== "本地写入失败保留输入"
  )
    throw Error("Staging failure lost text");
  await page.evaluate(() => {
    window.__failCreationStage = false;
  });
  await dialog.getByRole("button", { name: "创建镜头", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  // A known initial CAS rejection may explicitly return to editing and rebase; that first request has no commit.
  dialog = await open("episode");
  await dialog
    .getByRole("textbox", { name: "标题", exact: true })
    .fill("明确拒绝后保留输入");
  const beforeReject = commits.length;
  mode = "reject";
  await dialog.getByRole("button", { name: "创建单集", exact: true }).click();
  await dialog
    .getByRole("button", { name: "保留输入，返回编辑", exact: true })
    .click();
  await dialog
    .getByRole("button", {
      name: "核对后使用最新版本作为保存基线",
      exact: true,
    })
    .click();
  await dialog.getByRole("button", { name: "创建单集", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  if (commits.length !== beforeReject + 1)
    throw Error("Known rejection produced unexpected effects");
  // A received server success with failed IDB cleanup must retain the completion receipt across reload.
  dialog = await open("scene");
  await dialog
    .getByRole("textbox", { name: "标题", exact: true })
    .fill("成功后的清理恢复");
  const beforeCleanup = attempts.length;
  await page.evaluate(() => {
    window.__failCreationCleanup = true;
  });
  await dialog.getByRole("button", { name: "创建场次", exact: true }).click();
  await dialog
    .getByRole("button", { name: "重试清理本地草稿", exact: true })
    .waitFor();
  await page.screenshot({
    path: "output/playwright/2026-09-12-approved-content/committed-cleanup-failed.png",
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "重试清理本地草稿", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "重试清理本地草稿", exact: true })
    .waitFor();
  if (attempts.length !== beforeCleanup + 1)
    throw Error("Cleanup retry wrote business data");
  await page.reload();
  await page.getByText("成功后的清理恢复", { exact: false }).first().waitFor();
  dialog = await open("scene");
  await dialog.getByRole("textbox", { name: "标题", exact: true }).waitFor();
  if (
    (await dialog
      .getByRole("textbox", { name: "标题", exact: true })
      .inputValue()) !== "" ||
    (await dialog
      .getByRole("button", { name: "恢复创建记录", exact: true })
      .count()) ||
    attempts.length !== beforeCleanup + 1
  )
    throw Error("Completion recovery submitted again or restored stale intent");
  await page.keyboard.press("Escape");
  if (otherWrites || errors.length)
    throw Error(
      "Unexpected effects " + JSON.stringify({ otherWrites, errors }),
    );
  return {
    controlledTransport: true,
    realBackendAcceptance: false,
    lostResults,
    failedLocalStagePosts: 0,
    knownRejectionThenExplicitRebase: true,
    completionReceiptReloadWithoutReplay: true,
    attempts: attempts.length,
    commits: commits.length,
    otherWrites,
    reads,
    pageErrors: errors,
  };
};
