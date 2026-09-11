async (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
      const r = await fetch(url);
      const b = await r.json();
      if (!r.ok)
        throw Error(JSON.stringify({ status: r.status, code: b.code }));
      return b;
    }, `${root}/scenes/${scene}/canvas`);
  const before = await read(),
    canvasId = before.canvas.id;
  const seeded = await page.evaluate(
    async ({ root, canvasId }) => {
      const session = await (await fetch("/v1/session")).json();
      const p = root.split("/"),
        id = crypto.randomUUID(),
        marker = `过期本机上传 ${Date.now()}.png`;
      const record = {
        id,
        userId: session.userId,
        scopeKey: `canvas:${p[3]}:${p[5]}:${canvasId}`,
        createdAt: new Date(Date.now() - 16 * 60_000).toISOString(),
        declaration: {
          scope: "project",
          projectId: p[5],
          fileName: marker,
          displayName: marker,
          bytes: 3,
          mime: "image/png",
          sha256: "a".repeat(64),
          canvasTarget: {
            canvasId,
            clientRequestId: id,
            position: { x: 0, y: 0 },
          },
        },
      };
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("scenedesk-media-imports", 1);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise((resolve, reject) => {
        const t = db.transaction("imports", "readwrite");
        t.objectStore("imports").put(record);
        t.oncomplete = resolve;
        t.onabort = t.onerror = () => reject(t.error);
      });
      db.close();
      return { id, marker };
    },
    { root, canvasId },
  );
  let creates = 0,
    lookups = 0;
  const count = (r) => {
    if (r.method() === "POST" && /\/v1\/tenants\/[^/]+\/uploads$/.test(r.url()))
      creates++;
    if (
      r.method() === "GET" &&
      r.url().endsWith(`/uploads/by-request/${seeded.id}`)
    )
      lookups++;
  };
  page.on("request", count);
  let failLookup = true;
  const lookupPattern = `**/uploads/by-request/${seeded.id}`;
  await page.route(lookupPattern, async (route) => {
    if (failLookup) {
      failLookup = false;
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          code: "FIXTURE_READ_UNAVAILABLE",
          message: "恢复读取暂不可用",
        }),
      });
    } else await route.continue();
  });
  await page.reload();
  await page.getByText("恢复读取暂不可用", { exact: true }).waitFor();
  if (
    await page
      .getByRole("button", { name: "上传文件", exact: true })
      .isEnabled()
  )
    throw Error("Unverified local recovery enabled uploads");
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "上传文件" && !b.disabled,
    ),
  );
  await page.unroute(lookupPattern);
  const row = page.getByRole("article", {
    name: `画布上传 ${seeded.marker}`,
    exact: true,
  });
  await row
    .getByRole("button", { name: "移除过期本机记录", exact: true })
    .waitFor();
  await row
    .getByRole("button", { name: "移除过期本机记录", exact: true })
    .click();
  await row.waitFor({ state: "hidden" });
  if (
    creates !== 0 ||
    lookups < 2 ||
    (await read()).canvas.revision !== before.canvas.revision
  )
    throw Error("Expired cleanup wrote server state or skipped reconciliation");
  page.off("request", count);
  return {
    initialRecoveryReadFailureRetry: true,
    uploadsBlockedUntilRecoveryRead: true,
    expiredUnknownRecordReconciledAndRemoved: true,
    noCreationForCleanup: true,
    cleanupKeptCanvasRevision: true,
    lookupRequests: lookups,
    createRequests: creates,
    pageErrors: errors,
  };
}
