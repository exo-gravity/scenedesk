async (page) => {
  const path = "/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f/projects/ff8f70f2-8075-45de-b2bc-c54bd62e2653";
  const reviewId = "8074afa1-96be-42fd-960b-64b6fafea995";
  const commentId = "100d449a-ac63-4a27-8b42-ae302c1192e7";
  const feedback = page.locator('[aria-label="候选意见"]');
  let plans = 0;
  const onRequest = request => {
    if (request.method() === "POST" && request.url().endsWith("/generation-plans")) plans++;
  };
  page.on("request", onRequest);
  try {
    await feedback.getByRole("button", { name: "按意见准备修改…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "确认本次修改依据", exact: true });
    await dialog.waitFor();
    const fixedText = await dialog.innerText();
    const updated = await page.evaluate(async ({ path, reviewId, commentId }) => {
      const session = await (await fetch("/v1/session")).json();
      const response = await fetch(`${path}/reviews/${reviewId}/comments/${commentId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken, "If-Match": '"1"' },
        body: JSON.stringify({ body: "候选意见修订二：保留人物造型与停顿；看向门口后再多停半拍。🌌" }),
      });
      if (response.status !== 200) throw Error(`Concurrent comment edit ${response.status}`);
      return response.json();
    }, { path, reviewId, commentId });
    if (updated.revision !== 2 || await dialog.innerText() !== fixedText)
      throw Error("Open confirmation silently changed to the new comment version");
    await dialog.getByRole("button", { name: "以此版本准备修改", exact: true }).click();
    await feedback.getByText("这条意见已改变，请读取当前意见后重新选择。原输入仍保留。", { exact: true }).waitFor();
    if (plans || await page.locator('[aria-label="按意见准备修改"]').count())
      throw Error("Stale confirmation created a plan or initialized rework silently");
    await feedback.getByRole("button", { name: "读取当前意见", exact: true }).click();
    await feedback.getByText(updated.body, { exact: true }).waitFor();
    await feedback.getByRole("button", { name: "按意见准备修改…", exact: true }).click();
    await dialog.waitFor();
    if (!(await dialog.innerText()).includes(updated.body)) throw Error("Explicit new selection did not show current comment");
    await dialog.getByRole("button", { name: "以此版本准备修改", exact: true }).click();
    const rework = page.locator('[aria-label="按意见准备修改"]');
    await rework.waitFor();
    if (!(await rework.innerText()).includes("技术夹具原要求：保留停顿，再看向门口。"))
      throw Error("Old candidate silently picked the latest shot requirements");
    await rework.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "output/playwright/2026-09-12-take-rework-integrated/fixed-feedback-1512.png" });
    return { reviewId, commentId, commentRevision: 2, commentBody: updated.body,
      staleConfirmationKeptOriginalText: true, staleConfirmationBlocked: true,
      automaticPlanPosts: plans, explicitNewCommentSelection: true, fixedOldTakeRequirements: true };
  } finally { page.off("request", onRequest); }
}
