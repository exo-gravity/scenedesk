async (page) => {
  const tenant = "b128e444-cd57-4087-bcfe-c403051bbd8f",
    project = "ff8f70f2-8075-45de-b2bc-c54bd62e2653",
    jobId = "2cee077e-5f19-49d4-b35e-d65b5abef5c0";
  const base = `/v1/tenants/${tenant}`,
    path = `${base}/projects/${project}`;
  let creationPosts = 0,
    accessPosts = 0;
  const errors = [],
    failures = [];
  const errorHandler = (error) => errors.push(error.message);
  const requestHandler = (request) => {
    if (request.method() !== "POST") return;
    if (
      request.url().endsWith("/generation-plans") ||
      request.url().endsWith("/generation-jobs")
    )
      creationPosts++;
    if (request.url().includes(`/media/${jobId}/access`)) {
      accessPosts++;
      if (
        !request.headers()["idempotency-key"] ||
        !request.headers()["x-csrf-token"]
      )
        throw Error("Missing media access headers");
    }
  };
  const responseHandler = (response) => {
    if (response.status() >= 400 && response.url().includes("/v1/"))
      failures.push(response.status());
  };
  const read = (url) =>
    page.evaluate(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw Error(`GET ${response.status}`);
      return response.json();
    }, url);
  page.on("pageerror", errorHandler);
  page.on("request", requestHandler);
  page.on("response", responseHandler);
  try {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.reload();
    const composer = page.locator('[aria-label="本次创作输入"]');
    await composer
      .getByRole("button", { name: "生成图片", exact: true })
      .waitFor();
    const close = page.getByRole("button", { name: "收起", exact: true });
    if (await close.isVisible()) await close.click();
    await composer
      .getByRole("button", { name: "生成图片", exact: true })
      .click();
    const panel = composer.locator('[aria-label="生成单张图片"]');
    await panel.getByText("图片结果已归档", { exact: true }).waitFor();
    await panel.locator("img").waitFor();
    await panel.locator("img").evaluate(async (image) => {
      await image.decode();
      if (!image.naturalWidth) throw Error("Image did not decode");
    });
    const job = await read(`${base}/generation-jobs/${jobId}`),
      media = await read(`${base}/media/${jobId}`),
      plan = await read(`${base}/generation-plans/${job.planId}`);
    const tree = await read(`${path}/content`),
      shot = tree.shots.find(
        (shot) => shot.id === "a9f4d414-2467-43bb-a56d-4be7fe13e651",
      );
    const prompt = await composer
      .getByRole("textbox", { name: "本次提示", exact: true })
      .inputValue();
    if (
      creationPosts ||
      !accessPosts ||
      job.status !== "succeeded" ||
      job.mediaIds.length !== 1 ||
      job.mediaIds[0] !== media.id ||
      media.kind !== "image" ||
      media.status !== "ready" ||
      media.sourceJobId !== jobId ||
      media.width !== 256 ||
      media.height !== 256 ||
      plan.input.assistanceSource?.revision !== 2 ||
      !prompt.endsWith("图片计划后手工续写：保留窗外光线。") ||
      plan.input.prompt.includes("图片计划后手工续写") ||
      shot.specRevisionId !== plan.resolvedInput.shots[0].shotRevisionId ||
      shot.activeTakeId ||
      tree.shots.length !== 1
    )
      throw Error("Recovered image/source/manual state mismatch");
    const viewports = [];
    for (const size of [
      { width: 1512, height: 982 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await panel.locator("img").scrollIntoViewIfNeeded();
      const bounds = await panel.boundingBox();
      if (!bounds || bounds.x < 0 || bounds.x + bounds.width > size.width + 1)
        throw Error("Image panel overflows");
      await page.screenshot({
        path: `output/playwright/2026-09-11-image-integrated/shot-${size.width}.png`,
        animations: "disabled",
      });
      viewports.push(size.width);
    }
    if (errors.length || failures.length)
      throw Error(`Browser failures ${JSON.stringify({ errors, failures })}`);
    return {
      actualApiDatabaseWorkerStorage: true,
      explicitTechnicalFixture: true,
      realModelAcceptance: false,
      planId: plan.id,
      jobId,
      mediaId: media.id,
      creationPosts,
      accessPosts,
      recoveredOriginalJob: true,
      adviceRevision: 2,
      manualInputPreserved: true,
      shotUnchanged: true,
      image: { width: media.width, height: media.height, status: media.status },
      viewports,
      errors,
      failures,
    };
  } finally {
    page.off("pageerror", errorHandler);
    page.off("request", requestHandler);
    page.off("response", responseHandler);
  }
}
