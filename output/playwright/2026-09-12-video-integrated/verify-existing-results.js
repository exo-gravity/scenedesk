async (page) => {
  const base = "/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f",
    path = base + "/projects/ff8f70f2-8075-45de-b2bc-c54bd62e2653";
  const read = (url) =>
    page.evaluate(async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw Error("GET " + r.status);
      return r.json();
    }, url);
  const failures = [],
    errors = [];
  let creationPosts = 0,
    accessPosts = 0;
  const onRequest = (r) => {
      if (r.method() !== "POST") return;
      if (
        r.url().endsWith("/generation-plans") ||
        r.url().endsWith("/generation-jobs")
      )
        creationPosts++;
      if (r.url().includes("/media/") && r.url().endsWith("/access")) {
        accessPosts++;
        if (!r.headers()["idempotency-key"] || !r.headers()["x-csrf-token"])
          throw Error("Media access identity missing");
      }
    },
    onResponse = (r) => {
      if (r.status() >= 400 && r.url().includes("/v1/"))
        failures.push(r.status());
    },
    onError = (e) => errors.push(e.message);
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("pageerror", onError);
  try {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.getByRole("button", { name: "分镜", exact: true }).click();
    const composer = page.locator('[aria-label="本次创作输入"]');
    const manual = await composer
      .getByRole("textbox", { name: "本次提示", exact: true })
      .inputValue();
    if (
      !manual.endsWith("视频计划后手工续写：保留窗外光线。") ||
      !manual.includes("图片计划后手工续写")
    )
      throw Error("Continued manual input lost");
    await composer
      .getByRole("button", { name: "生成图片", exact: true })
      .click();
    const image = page.locator('[aria-label="生成单张图片"]');
    await image.getByText("图片结果已归档", { exact: true }).waitFor();
    await image.locator("img").waitFor();
    await image.locator("img").evaluate(async (i) => {
      await i.decode();
      if (i.naturalWidth !== 256 || i.naturalHeight !== 256)
        throw Error("Original image did not decode");
    });
    const imageJob = await read(
      base + "/generation-jobs/2cee077e-5f19-49d4-b35e-d65b5abef5c0",
    );
    if (
      imageJob.status !== "succeeded" ||
      imageJob.mediaIds[0] !== "2cee077e-5f19-49d4-b35e-d65b5abef5c0"
    )
      throw Error("Image job identity changed");
    await image.locator("img").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "output/playwright/2026-09-12-video-integrated/original-image-regression.png",
      animations: "disabled",
    });
    await composer
      .getByRole("button", { name: "生成视频", exact: true })
      .click();
    const video = page.locator('[aria-label="生成单段视频"]');
    await video.getByText("视频结果已归档", { exact: true }).waitFor();
    await video.getByRole("button", { name: "预览视频", exact: true }).click();
    await video.locator("video").waitFor();
    await video.locator("video").evaluate(async (v) => {
      await v.play();
      if (v.videoWidth !== 256 || v.videoHeight !== 144)
        throw Error("Original video did not decode");
      v.pause();
    });
    const job = await read(
        base + "/generation-jobs/f7807eec-fe1b-4243-987f-0fda188d7e26",
      ),
      media = await read(base + "/media/" + job.id),
      plan = await read(base + "/generation-plans/" + job.planId),
      tree = await read(path + "/content"),
      shot = tree.shots.find(
        (s) => s.id === "a9f4d414-2467-43bb-a56d-4be7fe13e651",
      );
    if (
      job.status !== "succeeded" ||
      job.mediaIds.length !== 1 ||
      job.mediaIds[0] !== media.id ||
      media.hasAudio !== true ||
      media.durationUs !== 2021333 ||
      plan.input.assistanceSource?.revision !== 2 ||
      plan.input.prompt.includes("视频计划后手工续写") ||
      shot.activeTakeId ||
      shot.specRevisionId !== plan.resolvedInput.shots[0].shotRevisionId
    )
      throw Error("Fixed shot/video input changed");
    if (creationPosts || failures.length || errors.length)
      throw Error(
        "Read-only recovery failed " +
          JSON.stringify({ creationPosts, failures, errors }),
      );
    return {
      actualApiDatabaseWorkerStorage: true,
      explicitTechnicalFixture: true,
      realModelAcceptance: false,
      imageJobId: imageJob.id,
      imageDecoded: true,
      videoJobId: job.id,
      videoPlanId: job.planId,
      videoMediaId: media.id,
      videoDecoded: true,
      video: {
        width: media.width,
        height: media.height,
        durationUs: media.durationUs,
        fpsNum: media.fpsNum,
        fpsDen: media.fpsDen,
        hasAudio: media.hasAudio,
      },
      fixedAdviceRevision: 2,
      manualInputPreserved: true,
      shotUnchanged: true,
      creationPosts,
      accessPosts,
      errors,
      failures,
    };
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("pageerror", onError);
  }
}
