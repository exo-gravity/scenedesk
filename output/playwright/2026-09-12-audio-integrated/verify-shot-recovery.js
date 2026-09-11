async (page) => {
  const base = "/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f";
  const project = "ff8f70f2-8075-45de-b2bc-c54bd62e2653";
  const jobId = "51eb0629-4147-494c-866e-9d1e0c02250d";
  const failures = [],
    errors = [];
  let creations = 0,
    accesses = 0;
  const onRequest = (request) => {
    if (request.method() !== "POST") return;
    if (/\/generation-(plans|jobs)$/.test(request.url())) creations++;
    if (/\/media\/[^/]+\/access$/.test(request.url())) {
      accesses++;
      if (
        !request.headers()["x-csrf-token"] ||
        !request.headers()["idempotency-key"]
      )
        errors.push("Media access missing request identity");
    }
  };
  const onResponse = (response) => {
    if (response.status() >= 400 && response.url().includes("/v1/"))
      failures.push(response.status());
  };
  const onError = (error) => errors.push(error.message);
  const read = (endpoint) =>
    page.evaluate(async (endpoint) => {
      const r = await fetch(endpoint);
      if (!r.ok) throw Error(`Read failed ${r.status}`);
      return r.json();
    }, endpoint);
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("pageerror", onError);
  try {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.reload();
    const composer = page.locator('[aria-label="本次创作输入"]');
    await composer
      .getByRole("button", { name: "生成音频", exact: true })
      .click();
    const panel = composer.locator('[aria-label="生成单段音频"]');
    await panel.getByText("音频结果已归档", { exact: true }).waitFor();
    const job = await read(`${base}/generation-jobs/${jobId}`);
    const plan = await read(`${base}/generation-plans/${job.planId}`);
    const media = await read(`${base}/media/${jobId}`);
    const tree = await read(`${base}/projects/${project}/content`);
    const manual = await composer
      .getByRole("textbox", { name: "本次提示", exact: true })
      .inputValue();
    if (
      job.status !== "succeeded" ||
      job.mediaIds.length !== 1 ||
      job.mediaIds[0] !== jobId ||
      job.executionMode !== "test_fixture" ||
      media.sourceJobId !== jobId ||
      media.kind !== "audio" ||
      media.status !== "ready" ||
      !media.hasAudio ||
      media.width !== undefined ||
      media.height !== undefined ||
      media.durationUs !== 2000000
    )
      throw Error("Actual original audio identity mismatch");
    if (
      plan.id !== "f710af66-be16-4d22-8a04-4047600582b3" ||
      plan.input.purpose !== "audio" ||
      plan.input.assistanceSource?.revision !== 2 ||
      plan.resolvedInput.shots[0].shotRevisionId !==
        "9522ed5a-d2e3-4ba0-a678-7aab55c495a2" ||
      plan.resolvedInput.output.durationSeconds !== 2 ||
      ["resolution", "aspectRatio", "withAudio"].some(
        (k) => k in plan.resolvedInput.output,
      ) ||
      manual !== `${plan.input.prompt}\n音频计划后手工续写：保留门外脚步。` ||
      tree.revision !== 5
    )
      throw Error("Fixed input or original manual/content state changed");
    const geometries = [];
    for (const width of [1512, 390]) {
      const close = panel.getByRole("button", {
        name: "关闭音频预览",
        exact: true,
      });
      if (await close.isVisible()) await close.click();
      await page.setViewportSize({ width, height: width === 1512 ? 982 : 844 });
      if (await panel.locator("video").count())
        throw Error("Decoder mounted before explicit preview");
      await panel
        .locator('[aria-label="独立音频结果"]')
        .scrollIntoViewIfNeeded();
      await panel
        .getByRole("button", { name: "预览音频", exact: true })
        .click();
      await panel.locator("video").waitFor({ state: "attached" });
      await panel.locator("video").evaluate(async (el) => {
        await el.play();
        if (
          !Number.isFinite(el.duration) ||
          el.duration <= 0 ||
          el.videoWidth !== 0
        )
          throw Error("Audio failed actual browser decode");
        el.pause();
      });
      await panel.locator("media-controller").scrollIntoViewIfNeeded();
      const geometry = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
      }));
      if (geometry.document > geometry.viewport)
        throw Error("Narrow audio view overflows");
      geometries.push(geometry);
      await page.screenshot({
        path: `output/playwright/2026-09-12-audio-integrated/shot-${width}.png`,
      });
    }
    if (creations || failures.length || errors.length)
      throw Error(
        `Read-only recovery failed ${JSON.stringify({ creations, failures, errors })}`,
      );
    return {
      actualApiDatabaseWorkerStorage: true,
      explicitTechnicalFixture: true,
      realModelAcceptance: false,
      jobId,
      planId: plan.id,
      mediaId: media.id,
      restoredSameJob: true,
      creationsDuringRecovery: creations,
      accesses,
      adviceRevision: 2,
      manualInputPreserved: true,
      originalContentRevision: tree.revision,
      audio: {
        durationUs: media.durationUs,
        hasAudio: media.hasAudio,
        mime: media.mime,
        derivatives: media.derivatives.map((d) => ({
          kind: d.kind,
          status: d.status,
        })),
      },
      geometries,
      errors,
      failures,
    };
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("pageerror", onError);
  }
}
