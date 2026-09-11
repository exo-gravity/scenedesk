async (page) => {
  const path = "/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f/projects/ff8f70f2-8075-45de-b2bc-c54bd62e2653";
  const takeId = "346e0146-aeae-43fe-a758-037bda07489b";
  const panel = page.locator('[aria-label="候选意见"]');
  const ordinary = page.locator('[aria-label="本次创作输入"]');
  const requests = [], errors = [];
  let review, comment;
  const onError = error => errors.push(error.message);
  page.on("pageerror", onError);
  try {
    await page.setViewportSize({ width: 1512, height: 982 });
    await panel.getByRole("button", { name: "记录候选意见", exact: true }).click();
    const text = "候选意见技术验收：保留停顿和人物造型；看向门口的动作慢一些。🌌";
    await panel.getByRole("textbox", { name: "候选意见正文", exact: true }).fill(text);
    await ordinary.getByRole("textbox", { name: "本次提示", exact: true }).fill("普通输入独立保留，不属于候选修改。");
    let lostReview;
    const reviewReceipt = new Promise(resolve => { lostReview = resolve; });
    await page.route(`**${path}/reviews`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      const request = route.request();
      requests.push({ kind: "review", key: request.headers()["idempotency-key"], body: request.postDataJSON() });
      const response = await route.fetch();
      if (response.status() !== 201) throw Error(`Review POST ${response.status()}`);
      const body = await response.json();
      if (!review) {
        review = body;
        await route.abort("failed");
        lostReview();
      } else {
        if (body.id !== review.id) throw Error("Review replay created a second identity");
        await route.fulfill({ response });
      }
    });
    await panel.getByRole("button", { name: "建立此候选的意见记录", exact: true }).click();
    await reviewReceipt;
    await panel.getByText("原请求结果待核对", { exact: true }).waitFor();
    await page.reload();
    await panel.getByRole("button", { name: "明确恢复原请求", exact: true }).waitFor();
    if (requests.length !== 1) throw Error("Reload automatically resent Review creation");
    if (await panel.getByRole("textbox", { name: "候选意见正文", exact: true }).inputValue() !== text)
      throw Error("Review recovery lost the pending comment text");
    await panel.getByRole("button", { name: "明确恢复原请求", exact: true }).click();
    await panel.getByRole("button", { name: "保存意见", exact: true }).waitFor();
    let lostComment;
    const commentReceipt = new Promise(resolve => { lostComment = resolve; });
    await page.route(`**${path}/reviews/${review.id}/comments`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      const request = route.request();
      requests.push({ kind: "comment", key: request.headers()["idempotency-key"], body: request.postDataJSON() });
      const response = await route.fetch();
      if (response.status() !== 201) throw Error(`Comment POST ${response.status()}`);
      const body = await response.json();
      if (!comment) {
        comment = body;
        await route.abort("failed");
        lostComment();
      } else {
        if (body.id !== comment.id) throw Error("Comment replay created a second identity");
        await route.fulfill({ response });
      }
    });
    await panel.getByRole("button", { name: "保存意见", exact: true }).click();
    await commentReceipt;
    await panel.getByText("原请求结果待核对", { exact: true }).waitFor();
    await page.reload();
    await panel.getByRole("button", { name: "明确恢复原请求", exact: true }).waitFor();
    if (requests.length !== 3) throw Error("Reload automatically resent Comment creation");
    await panel.getByRole("button", { name: "明确恢复原请求", exact: true }).click();
    await panel.getByRole("button", { name: "记录候选意见", exact: true }).waitFor();
    if (requests.length !== 4 || JSON.stringify(requests[0]) !== JSON.stringify(requests[1]) || JSON.stringify(requests[2]) !== JSON.stringify(requests[3]))
      throw Error("Recovery changed a fixed body/key or submitted an extra request");
    if (await ordinary.getByRole("textbox", { name: "本次提示", exact: true }).inputValue() !== "普通输入独立保留，不属于候选修改。")
      throw Error("Ordinary prompt was changed by feedback recovery");
    const counts = await page.evaluate(async ({ path, takeId, reviewId }) => {
      const reviews = await (await fetch(`${path}/reviews?takeId=${takeId}`)).json();
      const comments = await (await fetch(`${path}/reviews/${reviewId}/comments`)).json();
      return { reviews: reviews.items.length, comments: comments.items.length };
    }, { path, takeId, reviewId: review.id });
    if (counts.reviews !== 1 || counts.comments !== 1 || errors.length)
      throw Error("Real feedback persistence or browser error check failed");
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "output/playwright/2026-09-12-take-rework-integrated/feedback-1512.png" });
    return { actualApi: true, reviewId: review.id, commentId: comment.id, commentRevision: comment.revision,
      commentBody: comment.body, reviewPosts: 2, commentPosts: 2, createEffects: counts,
      responseDropsAfter201: 2, reloadAutomaticPosts: 0, originalBodiesAndKeysPreserved: true,
      ordinaryPromptPreserved: true, errors };
  } finally {
    await page.unroute(`**${path}/reviews`);
    if (review) await page.unroute(`**${path}/reviews/${review.id}/comments`);
    page.off("pageerror", onError);
  }
}
