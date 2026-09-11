async (page) => {
  const base = "/v1/tenants/b128e444-cd57-4087-bcfe-c403051bbd8f";
  const path = `${base}/projects/ff8f70f2-8075-45de-b2bc-c54bd62e2653`;
  const artifactId = "c6313140-4aee-419e-a1ec-701a11fb7420";
  const panel = page.locator('[aria-label="按意见准备修改"]');
  const ordinary = page.locator('[aria-label="本次创作输入"]');
  let editPuts = 0, mediaPlans = 0, saved, mediaPlan, released;
  const receipt = new Promise(resolve => { released = resolve; });
  const errors = [], serverErrors = [];
  const onError = error => errors.push(error.message);
  const onResponse = response => { if (response.status() >= 500 && response.url().includes("/v1/")) serverErrors.push(response.status()); };
  const onRequest = request => { if (request.method() === "PUT" && request.url().endsWith(`/assistance-artifacts/${artifactId}`)) editPuts++; if (request.method() === "POST" && request.url().endsWith("/generation-plans")) mediaPlans++; };
  page.on("pageerror", onError); page.on("response", onResponse); page.on("request", onRequest);
  try {
    const prompt = panel.getByRole("textbox", { name: "本次提示", exact: true });
    const originalManual = await prompt.inputValue();
    const revised = "人工修改建议：人物看向门口后多停半拍，再缓慢推进。";
    await panel.getByRole("textbox", { name: "建议提示", exact: true }).fill(revised);
    await panel.getByRole("textbox", { name: "保留要求（每行一项）", exact: true }).fill("");
    await page.route(`**${path}/assistance-artifacts/${artifactId}`, async route => {
      if (route.request().method() !== "PUT") return route.continue();
      if (route.request().headers()["if-match"] !== '"1"') throw Error("Artifact edit changed its fixed revision precondition");
      const response = await route.fetch();
      if (response.status() !== 200) throw Error(`Artifact PUT ${response.status()}`);
      saved = await response.json(); await route.abort("failed"); released();
    });
    await panel.getByRole("button", { name: "保存建议修订", exact: true }).click();
    await receipt;
    await panel.getByText("保存结果待核对", { exact: true }).waitFor();
    await page.reload();
    await panel.getByRole("button", { name: "AI 准备提示", exact: true }).click();
    await panel.getByRole("button", { name: "核对建议修订", exact: true }).click();
    await panel.getByRole("button", { name: "追加到本次提示…", exact: true }).waitFor();
    if (saved.revision !== 2 || saved.body.retain.length !== 0 || editPuts !== 1)
      throw Error("Unknown edit was resubmitted or empty retain list was rejected");
    await panel.getByRole("button", { name: "追加到本次提示…", exact: true }).click();
    await page.getByRole("dialog", { name: "确认追加到本次提示", exact: true }).getByRole("button", { name: "确认追加，保留原文", exact: true }).click();
    await panel.getByText("本次输入已应用建议", { exact: true }).waitFor();
    const expected = `${originalManual}\n\n${revised}`;
    if (await prompt.inputValue() !== expected) throw Error("Artifact application lost manual text");
    await panel.getByRole("button", { name: "生成视频", exact: true }).click();
    const video = panel.locator('[aria-label="生成单段视频"]');
    await video.getByRole("combobox", { name: "视频生成模型", exact: true }).click();
    await page.getByRole("option", { name: /本地视频归档测试（无真实模型）/ }).click();
    await page.route(`**${base}/generation-plans`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      if (response.status() !== 201) throw Error(`Rework media plan ${response.status()}: ${await response.text()}`);
      mediaPlan = await response.json(); await route.fulfill({ response });
    });
    await video.getByRole("button", { name: "查看视频生成计划", exact: true }).click();
    await video.getByText("固定视频计划", { exact: true }).waitFor();
    if (mediaPlan.status !== "ready" || mediaPlan.input.purpose !== "video" || mediaPlan.input.prompt !== expected || mediaPlan.input.assistanceSource.artifactId !== artifactId || mediaPlan.input.assistanceSource.revision !== 2 || mediaPlan.resolvedInput.shots[0].shotRevisionId !== "bd8fa74c-3f39-48cd-a9ce-84ecae9a84d6" || mediaPlans !== 1)
      throw Error("Media plan did not preserve the selected feedback artifact and old Take requirements");
    await page.reload();
    await panel.waitFor();
    if (await panel.getByRole("textbox", { name: "本次提示", exact: true }).inputValue() !== expected || await ordinary.getByRole("textbox", { name: "本次提示", exact: true }).inputValue() !== "普通输入独立保留，不属于候选修改。")
      throw Error("Independent ordinary/rework input recovery failed");
    for (const size of [{ width: 1512, height: 982 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size); await panel.scrollIntoViewIfNeeded();
      const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      if (geometry.document > geometry.viewport) throw Error("Rework layout overflows viewport");
      await page.screenshot({ path: `output/playwright/2026-09-12-take-rework-integrated/rework-${size.width}.png`, animations: "disabled" });
    }
    if (errors.length || serverErrors.length) throw Error("Artifact/media flow browser errors");
    return { artifactId, artifactRevision: 2, editPuts, editReplyDroppedAfter200: true,
      editRecoveredByGet: true, emptyRetainAccepted: true, originalManualPreserved: true,
      mediaPlanId: mediaPlan.id, mediaPlans, mediaPlanStatus: "ready", mediaExecuted: false,
      fixedOldTakeRequirements: true, fixedArtifactRevision: 2, ordinaryInputPreserved: true,
      narrowViewNoOverflow: true, errors, serverErrors };
  } finally {
    await page.unroute(`**${path}/assistance-artifacts/${artifactId}`); await page.unroute(`**${base}/generation-plans`);
    page.off("pageerror", onError); page.off("response", onResponse); page.off("request", onRequest);
  }
}
