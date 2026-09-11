async (page) => {
  await page.goto("about:blank");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.context().unrouteAll({ behavior: "ignoreErrors" });
  const tenant = "11111111-1111-4111-8111-111111111111",
    actorA = "22222222-2222-4222-8222-222222222222",
    actorB = "33333333-3333-4333-8333-333333333333",
    leadA = "44444444-4444-4444-8444-444444444444",
    leadB = "55555555-5555-4555-8555-555555555555";
  let identity = {
      id: "66666666-6666-4666-8666-666666666666",
      revision: 1,
      userId: actorA,
      email: "controlled-project@example.test",
      csrfToken: "explicit-controlled-transport",
    },
    mode = "normal",
    posts = [],
    commits = [],
    bindings = new Map(),
    allow = true;
  const base = `/v1/tenants/${tenant}`,
    app = `http://127.0.0.1:4316/#/app/t/${tenant}`,
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => dialog.accept());
  const reply = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  const stored = (target) =>
    target.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("scenedesk-project-creation", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("drafts");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return new Promise((resolve, reject) => {
        const tx = db.transaction("drafts"),
          store = tx.objectStore("drafts"),
          req = store.getAll(),
          keys = store.getAllKeys();
        tx.oncomplete = () => {
          db.close();
          resolve(
            req.result.map((value, index) => ({
              key: JSON.parse(keys.result[index]),
              ...value,
            })),
          );
        };
        tx.onerror = () => reject(tx.error);
      });
    });
  await page
    .context()
    .route("**/health/**", (route) =>
      reply(route, {
        phase: "business",
        identityMode: "local_test",
        providerMode: "mock",
      }),
    );
  await page.context().route("**/v1/**", async (route) => {
    const request = route.request(),
      url = request.url().split("?")[0],
      method = request.method();
    if (url.endsWith("/v1/session")) return reply(route, identity);
    if (url.endsWith("/v1/tenants"))
      return reply(route, {
        items: [
          {
            id: tenant,
            name: "受控项目工作室",
            revision: 1,
            ownerUserId: identity.userId,
            currency: "CNY",
          },
        ],
      });
    if (url.endsWith(`${base}/members`))
      return reply(route, {
        items: [
          {
            id: identity.userId === actorA ? leadA : leadB,
            revision: 1,
            userId: identity.userId,
            role: allow ? "owner" : "member",
            status: "active",
          },
        ],
      });
    if (url.endsWith(`${base}/projects`) && method === "GET")
      return reply(route, {
        items: commits
          .filter((item) => item.actor === identity.userId)
          .map((item) => item.project),
      });
    if (url.endsWith(`${base}/projects`) && method === "POST") {
      const body = request.postDataJSON(),
        key = request.headers()["idempotency-key"],
        actor = identity.userId,
        action = mode;
      mode = "normal";
      const pending = (await stored(request.frame().page())).find(
        (row) =>
          row.key[0] === actor && row.record?.request?.idempotencyKey === key,
      )?.record.request;
      if (
        !pending ||
        JSON.stringify(pending.body) !== JSON.stringify(body) ||
        !body.creationRequestId
      )
        throw Error("POST preceded durable exact request");
      posts.push({ body, key, actor });
      if (action === "reject")
        return reply(
          route,
          {
            code: "INVALID_REQUEST",
            message: "受控确定输入拒绝",
            requestId: "controlled-rejection",
          },
          422,
        );
      const bindingKey = JSON.stringify([
        tenant,
        actor,
        body.creationRequestId,
      ]);
      if (!bindings.has(bindingKey)) {
        const project = {
          id: `01234567-1234-4234-8234-${String(commits.length + 1).padStart(12, "0")}`,
          revision: 1,
          createdAt: "2026-09-11T00:00:00Z",
          updatedAt: "2026-09-11T00:00:00Z",
          tenantId: tenant,
          name: body.name,
          kind: "drama",
          leadMembershipId: body.leadMembershipId,
          status: "active",
          spec: body.spec,
        };
        const value = { body, project, actor };
        bindings.set(bindingKey, value);
        commits.push(value);
      }
      const value = bindings.get(bindingKey);
      if (JSON.stringify(value.body) !== JSON.stringify(body))
        return reply(
          route,
          {
            code: "PROJECT_CREATION_CONFLICT",
            message: "原创建身份冲突",
            requestId: "controlled-conflict",
          },
          409,
        );
      if (action === "lose") return route.abort("failed");
      if (action === "proxy422")
        return reply(
          route,
          {
            code: "INVALID_REQUEST",
            message: "proxy replaced a committed response",
          },
          422,
        );
      if (action === "proxy400")
        return route.fulfill({
          status: 400,
          contentType: "text/html",
          body: "Bad gateway request",
        });
      if (action === "bad201")
        return reply(route, { id: value.project.id }, 201);
      if (action === "conflict")
        return reply(
          route,
          {
            code: "PROJECT_CREATION_CONFLICT",
            message: "受控创建身份冲突",
            requestId: "controlled-conflict",
          },
          409,
        );
      return reply(route, value.project, 201);
    }
    const project = commits.find((item) =>
      url.endsWith(`${base}/projects/${item.project.id}`),
    )?.project;
    if (project) return reply(route, project);
    if (url.endsWith("/content"))
      return reply(route, {
        projectId: url.split("/").at(-2),
        revision: 1,
        episodes: [],
        scenes: [],
        shots: [],
      });
    if (url.endsWith("/events"))
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": controlled transport\n\n",
      });
    if (method !== "GET") throw Error("Unexpected write " + method + " " + url);
    return reply(route, { items: [] });
  });
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put,
      get = IDBObjectStore.prototype.get,
      remove = IDBObjectStore.prototype.delete;
    const isProject = (store) =>
      store.transaction.db.name === "scenedesk-project-creation";
    IDBObjectStore.prototype.get = function (...args) {
      if (isProject(this) && window.__failProjectRead)
        throw Error("controlled recovery read failure");
      return get.apply(this, args);
    };
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (isProject(this)) {
        if (window.__failProjectIntent && value?.record?.request)
          throw Error("controlled intent write failure");
        if (window.__failProjectResult && value?.record?.result)
          throw Error("controlled result write failure");
        if (
          window.__holdProjectFields &&
          value?.record &&
          !value.record.request
        ) {
          const store = this;
          const keep = () => {
            const req = get.call(store, args[0]);
            req.onsuccess = () =>
              window.__holdProjectFields
                ? keep()
                : put.call(store, value, ...args);
          };
          keep();
          return;
        }
      }
      return put.call(this, value, ...args);
    };
    IDBObjectStore.prototype.delete = function (...args) {
      if (isProject(this) && window.__failProjectClear)
        throw Error("controlled cleanup failure");
      return remove.apply(this, args);
    };
  });
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto(app);
  await page.getByRole("button", { name: "新建项目", exact: true }).waitFor();
  await page.evaluate(async () => {
    const existing = await indexedDB.databases();
    if (!existing.some((item) => item.name === "scenedesk-project-creation"))
      return;
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("scenedesk-project-creation");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  const open = async (target) => {
    await target.getByRole("button", { name: "新建项目", exact: true }).click();
    return target.getByRole("dialog");
  };
  const create = async (name) => {
    await page.goto(app);
    const dialog = await open(page);
    await dialog
      .getByRole("textbox", { name: "项目名称", exact: true })
      .fill(name);
    return dialog;
  };
  let dialog = await create("项目原文草稿");
  await dialog.getByRole("combobox", { name: "画幅", exact: true }).click();
  await page
    .getByRole("option", { name: "横屏 · 1920 × 1080", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "语言", exact: true })
    .fill("zh-HK");
  await dialog
    .getByText("本标签页的项目草稿已保留；创建需明确提交。", { exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.reload();
  dialog = await open(page);
  await dialog
    .getByRole("button", { name: "恢复项目创建记录", exact: true })
    .click();
  if (
    (await dialog
      .getByRole("textbox", { name: "项目名称", exact: true })
      .inputValue()) !== "项目原文草稿" ||
    (await dialog
      .getByRole("textbox", { name: "语言", exact: true })
      .inputValue()) !== "zh-HK"
  )
    throw Error("Closed/reloaded field draft lost");
  // A real IDB transaction is held open while later accepted edits and a reopened reader queue behind it.
  await page.evaluate(() => (window.__holdProjectFields = true));
  await dialog
    .getByRole("textbox", { name: "项目名称", exact: true })
    .fill("较早的项目名称");
  await dialog
    .getByRole("textbox", { name: "项目名称", exact: true })
    .fill("关闭前最后几字");
  await page.keyboard.press("Escape");
  dialog = await open(page);
  await dialog.getByLabel("正在核对项目创建记录", { exact: true }).waitFor();
  await page.evaluate(() => (window.__holdProjectFields = false));
  await dialog
    .getByRole("button", { name: "恢复项目创建记录", exact: true })
    .click();
  if (
    (await dialog
      .getByRole("textbox", { name: "项目名称", exact: true })
      .inputValue()) !== "关闭前最后几字"
  )
    throw Error("Slow close/reopen discarded accepted final edit");
  await page.evaluate(() => (window.__failProjectIntent = true));
  await dialog.getByRole("button", { name: "创建项目", exact: true }).click();
  await dialog
    .getByText("controlled intent write failure", { exact: true })
    .waitFor();
  if (posts.length) throw Error("Local intent write failure posted");
  await page.evaluate(() => (window.__failProjectIntent = false));
  mode = "lose";
  await dialog
    .getByRole("button", { name: "恢复原项目创建请求", exact: true })
    .click();
  await dialog
    .getByText("连接中断，创建结果尚未确认。请保留并恢复原请求。", {
      exact: true,
    })
    .waitFor();
  if (posts.length !== 1 || commits.length !== 1)
    throw Error("Lost response did not follow commit");
  const original = JSON.stringify(posts[0]),
    sourceTab = await page.evaluate(() =>
      sessionStorage.getItem("scenedesk-content-tab"),
    );
  const second = await page.context().newPage();
  second.on("pageerror", (e) => errors.push(e.message));
  await second.addInitScript(
    (tab) => sessionStorage.setItem("scenedesk-content-tab", tab),
    sourceTab,
  );
  await second.goto(app);
  let otherDialog = await open(second);
  await otherDialog
    .getByRole("textbox", { name: "项目名称", exact: true })
    .fill("另一标签自己的草稿");
  await otherDialog
    .getByText("本标签页的项目草稿已保留；创建需明确提交。", { exact: true })
    .waitFor();
  const otherTab = await second.evaluate(() =>
    sessionStorage.getItem("scenedesk-content-tab"),
  );
  if (otherTab === sourceTab)
    throw Error("Duplicated tab shared creation slot");
  const rows = await stored(second);
  if (
    !rows.some(
      (row) =>
        row.key[2] === sourceTab &&
        row.record?.request?.body.creationRequestId ===
          posts[0].body.creationRequestId,
    ) ||
    !rows.some(
      (row) =>
        row.key[2] === otherTab &&
        row.record?.fields.name === "另一标签自己的草稿",
    )
  )
    throw Error("Two tabs overwrote one another");
  await second.close();
  // Same actor, renewed app session and no generic HTTP cache: durable binding returns the edited archived project.
  identity = { ...identity, id: "77777777-7777-4777-8777-777777777777" };
  commits[0].project = {
    ...commits[0].project,
    name: "后来更名的项目",
    status: "archived",
    revision: 3,
  };
  await page.reload();
  await page.evaluate(() => (window.__failProjectRead = true));
  dialog = await open(page);
  await dialog
    .getByText("controlled recovery read failure", { exact: true })
    .waitFor();
  if (
    (await dialog
      .getByRole("textbox", { name: "项目名称", exact: true })
      .count()) ||
    posts.length !== 1
  )
    throw Error("Failed initial read allowed overwrite or POST");
  await page.evaluate(() => (window.__failProjectRead = false));
  await dialog.getByRole("button", { name: "重新读取", exact: true }).click();
  await dialog
    .getByRole("button", { name: "恢复项目创建记录", exact: true })
    .click();
  if (
    await dialog
      .getByRole("button", { name: "保留输入，返回编辑", exact: true })
      .count()
  )
    throw Error("Unknown identity released");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "output/playwright/2026-09-12-project-creation/unknown-project-390.png",
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "恢复原项目创建请求", exact: true })
    .click();
  await page.waitForURL(/\/content$/);
  if (
    posts.length !== 2 ||
    JSON.stringify(posts[1]) !== original ||
    commits.length !== 1
  )
    throw Error("Renewed session recovery changed creation");
  await page.setViewportSize({ width: 1512, height: 982 });
  // Confirmed result must remain until local receipt and cleanup succeed, and cleanup rechecks current actor.
  dialog = await create("本地整理恢复项目");
  await page.evaluate(() => (window.__failProjectResult = true));
  await dialog.getByRole("button", { name: "创建项目", exact: true }).click();
  await dialog
    .getByRole("button", { name: "重试整理并打开项目", exact: true })
    .waitFor();
  const cleanupPosts = posts.length;
  if (page.url().includes("/content"))
    throw Error("Navigated before local result persistence");
  await page.evaluate(() => {
    window.__failProjectResult = false;
    window.__failProjectClear = true;
  });
  await dialog
    .getByRole("button", { name: "重试整理并打开项目", exact: true })
    .click();
  await dialog
    .getByText("controlled cleanup failure", { exact: true })
    .waitFor();
  await page.screenshot({
    path: "output/playwright/2026-09-12-project-creation/project-cleanup-failed.png",
    animations: "disabled",
  });
  identity = {
    ...identity,
    id: "88888888-8888-4888-8888-888888888888",
    userId: actorB,
    email: "controlled-project-b@example.test",
  };
  await page.evaluate(() => (window.__failProjectClear = false));
  await dialog
    .getByRole("button", { name: "重试整理并打开项目", exact: true })
    .click();
  await page.getByText("controlled-project-b@example.test", {exact: true}).waitFor();
  await page.getByRole("button", { name: "新建项目", exact: true }).waitFor();
  if (page.url().includes("/content") || posts.length !== cleanupPosts)
    throw Error("Changed actor cleanup navigated or posted");
  await page.reload();
  dialog = await open(page);
  await dialog
    .getByRole("textbox", { name: "项目名称", exact: true })
    .waitFor();
  if (
    (await dialog
      .getByRole("textbox", { name: "项目名称", exact: true })
      .inputValue()) !== "" ||
    (await dialog
      .getByRole("button", { name: "恢复项目创建记录", exact: true })
      .count())
  )
    throw Error("Other actor exposed original draft");
  identity = {
    ...identity,
    id: "99999999-9999-4999-8999-999999999999",
    userId: actorA,
    email: "controlled-project@example.test",
  };
  await page.reload();
  dialog = await open(page);
  await dialog
    .getByRole("button", { name: "恢复项目创建记录", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "重试整理并打开项目", exact: true })
    .click();
  await page.waitForURL(/\/content$/);
  if (posts.length !== cleanupPosts)
    throw Error("Confirmed receipt recovery resubmitted");
  for (const responseMode of ["proxy422", "proxy400", "bad201", "conflict"]) {
    dialog = await create("原请求保护-" + responseMode);
    mode = responseMode;
    const before = commits.length;
    await dialog.getByRole("button", { name: "创建项目", exact: true }).click();
    await dialog
      .getByRole("button", { name: "恢复原项目创建请求", exact: true })
      .waitFor();
    await dialog.getByText("操作未完成", { exact: true }).waitFor();
    if (
      await dialog
        .getByRole("button", { name: "保留输入，返回编辑", exact: true })
        .count()
    )
      throw Error("Unproven error released original request " + responseMode);
    if (commits.length !== before + 1)
      throw Error("Replacement response scenario did not commit");
    await dialog
      .getByRole("button", { name: "恢复原项目创建请求", exact: true })
      .click();
    await page.waitForURL(/\/content$/);
    if (commits.length !== before + 1)
      throw Error("Recovery duplicated " + responseMode);
  }
  dialog = await create("首次明确输入拒绝");
  mode = "reject";
  const before = commits.length;
  await dialog.getByRole("button", { name: "创建项目", exact: true }).click();
  await dialog
    .getByRole("button", { name: "保留输入，返回编辑", exact: true })
    .click();
  if (commits.length !== before) throw Error("Definite rejection committed");
  await dialog
    .getByRole("textbox", { name: "项目名称", exact: true })
    .fill("核对后完成项目");
  await dialog.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.waitForURL(/\/content$/);
  if (commits.length !== before + 1)
    throw Error("Known rejection retry failed");
  if (errors.length) throw Error("Page errors " + JSON.stringify(errors));
  const result = {
    controlledTransport: true,
    realBackendAcceptance: false,
    draftCloseReload: true,
    realIndexedDbSlowWriteCloseReopen: true,
    duplicatedTabIdsDistinct: true,
    actorRenewalKeepsOriginalRequest: true,
    otherActorCannotReadDraft: true,
    initialReadFailureBlocked: true,
    initialWriteFailurePosts: 0,
    confirmedCleanupRechecksActor: true,
    confirmedCleanupNewPosts: 0,
    malformed422400201And409RemainUnknown: true,
    knownFirst422Editable: true,
    originalRequestRecoveredOnce: true,
    posts: posts.length,
    projects: commits.length,
    pageErrors: errors,
  };
  await page.evaluate(result => sessionStorage.setItem("scenedesk-controlled-project-result", JSON.stringify(result)), result);
  return result;
}
