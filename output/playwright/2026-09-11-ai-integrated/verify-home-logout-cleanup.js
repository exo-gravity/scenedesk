async (page) => {
  const identity = await page.evaluate(async () => {
    const response = await fetch("/v1/session");
    if (!response.ok) throw new Error("Actual session required");
    const session = await response.json();
    return { userId: session.userId, sessionId: session.id };
  });
  const count = () =>
    page.evaluate(async ({ userId, sessionId }) => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("scenedesk-assistant", 1);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        if (!db.objectStoreNames.contains("sessions")) return 0;
        return await new Promise((resolve, reject) => {
          const tx = db.transaction("sessions", "readonly"),
            r = tx.objectStore("sessions").getAllKeys();
          tx.oncomplete = () =>
            resolve(
              r.result.filter((raw) => {
                const key = JSON.parse(String(raw));
                return key[0] === userId && key[3] === sessionId;
              }).length,
            );
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, identity);
  const before = await count();
  if (before < 1)
    throw new Error("Need actual historical assistant recovery data");
  await page.goto("http://127.0.0.1:4311/#/app");
  await page.reload();
  await page.getByRole("button", { name: "退出登录", exact: true }).waitFor();
  const lazySceneLoaded = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .some((e) => /SceneProductionWorkspace-.*\.js/.test(e.name)),
  );
  if (lazySceneLoaded)
    throw new Error(
      "Logout must be tested without loading the production workspace chunk",
    );
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.waitForURL((url) => url.hash === "#/app");
  await page.getByRole("link", { name: "登录并继续", exact: true }).waitFor();
  let after = await count();
  const deadline = Date.now() + 10000;
  while (after && Date.now() < deadline) {
    await page.waitForTimeout(100);
    after = await count();
  }
  const unauthenticated = await page.evaluate(
    async () => (await fetch("/v1/session")).status === 401,
  );
  if (after !== 0 || !unauthenticated)
    throw new Error("Logout did not clear historical recovery data");
  return {
    verification:
      "Actual session logout from a fresh home document without lazy scene workspace",
    historicalRecordsBefore: before,
    historicalRecordsAfter: after,
    lazySceneLoaded,
    serverSessionRevoked: unauthenticated,
  };
}
