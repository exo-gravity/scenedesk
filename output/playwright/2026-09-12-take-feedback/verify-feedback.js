async (page) => {
  await page.goto("about:blank");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.context().unrouteAll({ behavior: "ignoreErrors" });
  const id = (n) => `${String(n).padStart(8, "0")}-aabb-4ccd-8eef-112233445566`;
  const tenant = id(90),
    projectId = id(91),
    actor = id(92),
    session = id(93),
    scene = id(94),
    episode = id(95),
    shotId = id(96),
    oldRevision = id(97),
    takeId = id(98),
    mediaId = id(99),
    reviewId = id(100),
    commentId = id(101);
  const base = `/v1/tenants/${tenant}`,
    path = `${base}/projects/${projectId}`,
    url = `http://127.0.0.1:4316/#/app/t/${tenant}/p/${projectId}/production?scene=${scene}&shot=${shotId}&take=${takeId}&mode=storyboard`;
  const identity = {
    id: session,
    revision: 1,
    userId: actor,
    email: "controlled-feedback@example.test",
    csrfToken: "explicit-controlled-transport-only",
  };
  const project = {
    id: projectId,
    tenantId: tenant,
    revision: 1,
    name: "候选意见 · 受控传输验收",
    kind: "drama",
    status: "active",
    leadMembershipId: id(102),
    spec: {
      width: 1080,
      height: 1920,
      fpsNum: 24,
      fpsDen: 1,
      language: "zh-CN",
    },
  };
  const shot = {
    id: shotId,
    projectId,
    sceneId: scene,
    revision: 2,
    label: "S01",
    position: 0,
    status: "active",
    specRevisionId: id(103),
    spec: { intent: "当前新版镜头要求", references: [], dialogue: [] },
  };
  const revision = {
    id: oldRevision,
    shotId,
    number: 1,
    spec: { intent: "原候选：近景手指接触钥匙", references: [], dialogue: [] },
  };
  const tree = {
    projectId,
    revision: 2,
    episodes: [
      {
        id: episode,
        projectId,
        revision: 1,
        title: "第一集",
        position: 0,
        status: "active",
      },
    ],
    scenes: [
      {
        id: scene,
        projectId,
        episodeId: episode,
        revision: 1,
        title: "门边取钥匙",
        position: 0,
        status: "active",
        summary: "固定候选反馈验证",
        state: {},
        defaultAssetRevisionIds: [],
      },
    ],
    shots: [shot],
  };
  const take = {
    id: takeId,
    revision: 1,
    shotId,
    shotRevisionId: oldRevision,
    mediaId,
    range: { inUs: 0, outUs: 2000000 },
    note: "旧要求的固定候选",
    projectId,
  };
  const media = {
    id: mediaId,
    revision: 1,
    scope: "project",
    projectId,
    kind: "video",
    status: "ready",
    displayName: "候选片段（受控传输）",
    fileName: "controlled.mp4",
    durationUs: 2000000,
    width: 256,
    height: 144,
    fpsNum: 24,
    fpsDen: 1,
    hasAudio: false,
    derivatives: [],
  };
  const text = {
    id: id(104),
    revision: 1,
    connectionId: id(105),
    purpose: "creative_assistance",
    modelVersion: "受控返工助手",
    mode: "text_fixture_v1",
    enabled: true,
    executionMode: "test_fixture",
    supportedPurposes: [],
  };
  const target = {
    ...text,
    id: id(106),
    purpose: "video",
    modelVersion: "受控视频目标",
    mode: "video_fixture_v1",
    allowedResolutions: ["256x144"],
    allowedAspectRatios: ["16:9"],
    minDurationSeconds: 2,
    maxDurationSeconds: 2,
    audioOutput: false,
    inputRules: [],
  };
  const reviews = [],
    comments = [],
    writes = [],
    receipts = new Map(),
    plans = new Map();
  let drop = "review",
    job,
    artifact,
    originalArtifact,
    allow = 0,
    capabilities = true;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const reply = (r, body, status = 200) =>
    r.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  const stored = () =>
    page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("scenedesk-assistant", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("sessions");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      return new Promise((resolve, reject) => {
        const tx = db.transaction("sessions"),
          r = tx.objectStore("sessions").getAll();
        tx.oncomplete = () => {
          db.close();
          resolve(r.result);
        };
        tx.onerror = () => reject(tx.error);
      });
    });
  await page
    .context()
    .route("**/health/**", (r) =>
      reply(r, {
        phase: "business",
        identityMode: "local_test",
        providerMode: "mock",
      }),
    );
  await page.context().route("**/v1/**", async (r) => {
    const req = r.request(),
      u = req.url().split("?")[0],
      m = req.method();
    if (u.endsWith("/v1/session")) return reply(r, identity);
    if (u.endsWith("/v1/tenants"))
      return reply(r, {
        items: [
          {
            id: tenant,
            revision: 1,
            name: "受控意见工作室",
            ownerUserId: actor,
            currency: "CNY",
          },
        ],
      });
    if (u.endsWith(`${base}/members`))
      return reply(r, {
        items: [
          {
            id: id(102),
            revision: 1,
            userId: actor,
            role: "owner",
            status: "active",
          },
        ],
      });
    if (u.endsWith(`${base}/projects`)) return reply(r, { items: [project] });
    if (u.endsWith(path)) return reply(r, project);
    if (u.endsWith(`${path}/content`)) return reply(r, tree);
    if (u.endsWith("/events"))
      return r.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": controlled transport\n\n",
      });
    if (u.endsWith("/workspace-preference"))
      return reply(r, {
        sceneId: scene,
        revision: 1,
        mode: "storyboard",
        viewport: { x: 0, y: 0, zoom: 1 },
      });
    if (u.endsWith(`${path}/scenes/${scene}/canvas`))
      return reply(
        r,
        {
          code: "SCENE_CANVAS_NOT_CREATED",
          message: "No canvas in controlled feedback test",
          requestId: "controlled",
        },
        404,
      );
    if (u.endsWith(`${path}/takes/${takeId}`))
      return allow
        ? reply(
            r,
            {
              code: "FORBIDDEN",
              message: "受控权限变化",
              requestId: "controlled",
            },
            allow,
          )
        : reply(r, take);
    if (u.endsWith(`${path}/takes`)) return reply(r, { items: [take] });
    if (u.includes(`/shots/${shotId}/revisions/`))
      return reply(
        r,
        u.endsWith(oldRevision)
          ? revision
          : { id: shot.specRevisionId, shotId, number: 2, spec: shot.spec },
      );
    if (u.endsWith(`${base}/media/${mediaId}`)) return reply(r, media);
    if (u.endsWith(`${base}/media/${mediaId}/access`)) {
      if (!req.headers()["idempotency-key"])
        throw Error("Media authorization lacks key");
      return reply(r, {
        url: "http://127.0.0.1:4316/controlled-feedback.mp4",
        expiresAt: "2099-01-01T00:00:00Z",
      });
    }
    if (u.endsWith(`${base}/capabilities`))
      return reply(r, {
        items:
          !capabilities || req.url().includes("purpose=script_analysis")
            ? []
            : req.url().includes("purpose=video")
              ? [target]
              : req.url().includes("purpose=")
                ? []
                : [text, target],
      });
    if (u.endsWith(`${path}/reviews`) && m === "GET")
      return reply(r, { items: reviews });
    if (u.endsWith(`${path}/reviews/${reviewId}`)) return reply(r, reviews[0]);
    if (u.endsWith(`${path}/reviews/${reviewId}/comments`) && m === "GET")
      return reply(r, { items: comments });
    if (u.includes(`${path}/reviews`) && m !== "GET") {
      const body = req.postDataJSON(),
        kind =
          m === "PATCH"
            ? "change"
            : u.endsWith("/reviews")
              ? "review"
              : "comment",
        key = req.headers()["idempotency-key"],
        version = req.headers()["if-match"];
      const pending = (await stored())
        .map((x) => x.draft.intent)
        .find(
          (i) =>
            i &&
            i.kind === kind &&
            (kind === "change" ? `"${i.revision}"` === version : i.key === key),
        );
      if (
        !pending ||
        JSON.stringify(pending.body) !== JSON.stringify(body) ||
        !pending.attemptedAt
      )
        throw Error("Mutation lacks original durable input/key/CAS");
      writes.push({ kind, body, key, version });
      let result = receipts.get(key);
      if (kind === "review" && !result) {
        result = {
          id: reviewId,
          revision: 1,
          projectId,
          subject: { takeId },
          number: 1,
          status: "open",
          sourceReviewIds: [],
          reworkItems: [],
        };
        reviews.push(result);
        receipts.set(key, result);
      }
      if (kind === "comment" && !result) {
        result = {
          id: commentId,
          revision: 1,
          reviewId,
          authorId: actor,
          body: body.body,
          resolved: false,
        };
        comments.push(result);
        receipts.set(key, result);
      }
      if (kind === "change") {
        if (version !== `"${comments[0].revision}"`)
          return reply(
            r,
            {
              code: "VERSION_CONFLICT",
              message: "受控意见版本冲突",
              requestId: "controlled",
            },
            412,
          );
        const c = comments[0];
        result = {
          ...c,
          ...body,
          revision:
            c.revision +
            (Object.entries(body).some(([k, v]) => c[k] !== v) ? 1 : 0),
        };
        comments[0] = result;
      }
      if (drop === kind) {
        drop = "";
        return r.abort("failed");
      }
      return reply(r, result, kind === "change" ? 200 : 201);
    }
    if (u.endsWith(`${base}/generation-plans`) && m === "POST") {
      const input = req.postDataJSON();
      writes.push({
        kind: "plan",
        body: input,
        key: req.headers()["idempotency-key"],
      });
      if (
        input.shotSources.length !== 1 ||
        input.shotSources[0].shotRevisionId !== oldRevision
      )
        throw Error("Rework upgraded the fixed Take shot");
      const plan = {
        id: id(input.purpose === "creative_assistance" ? 107 : 110),
        revision: 1,
        input,
        status: "ready",
        blockingReasons: [],
        expiresAt: "2099-01-01T00:00:00Z",
        capabilityRevision: 1,
        connectionVersionId: id(111),
        inputHash: "controlled",
        executionMode: "test_fixture",
        resolvedInput: {
          resolverVersion: "controlled",
          prompt: input.prompt,
          references: [],
          shots: [{ shotId, shotRevisionId: oldRevision, spec: revision.spec }],
          dependencies: [],
          targetCapabilitySnapshot: target,
          capabilitySnapshot: target,
          output: input.output,
        },
      };
      if (input.purpose === "creative_assistance") {
        if (
          input.assistance.kind !== "prepare_rework" ||
          input.assistance.sourceTakeId !== takeId ||
          input.assistance.feedback.commentRevision !== comments[0].revision ||
          comments[0].resolved
        )
          throw Error("Feedback identity not fixed/current");
        plan.resolvedInput.feedbackSnapshot = {
          reviewId,
          commentId,
          commentRevision: comments[0].revision,
          body: comments[0].body,
          subject: { takeId },
        };
        artifact = {
          id: id(108),
          revision: 1,
          projectId,
          generationJobId: id(109),
          request: input.assistance,
          shotSources: input.shotSources,
          resolvedInput: plan.resolvedInput,
          body: {
            prompt: "受控建议：保持钥匙位置，手指自然接触。",
            retain: ["钥匙位置"],
            change: ["手指接触动作"],
            referenceSuggestions: [],
            notes: "受控传输测试，非真实模型结果",
          },
          inputOutdated: false,
          executionMode: "test_fixture",
        };
        originalArtifact = JSON.parse(JSON.stringify(artifact));
      } else if (
        input.assistanceSource?.artifactId !== artifact.id ||
        input.assistanceSource.revision !== 2
      )
        throw Error("Media plan lost fixed edited assistance provenance");
      plans.set(plan.id, plan);
      return reply(r, plan, 201);
    }
    if (u.includes(`${base}/generation-plans/`))
      return reply(r, plans.get(u.split("/").pop()));
    if (u.endsWith(`${base}/generation-jobs`) && m === "POST") {
      writes.push({
        kind: "execute",
        body: req.postDataJSON(),
        key: req.headers()["idempotency-key"],
      });
      if (writes.filter((w) => w.kind === "execute").length > 1)
        throw Error("Repeated execution");
      job = {
        id: id(109),
        revision: 1,
        scope: "project",
        projectId,
        planId: id(107),
        status: "submission_unknown",
        mediaIds: [],
        inputOutdated: false,
        executionMode: "test_fixture",
      };
      plans.get(id(107)).status = "consumed";
      return r.abort("failed");
    }
    if (u.includes(`${base}/generation-jobs`))
      return reply(
        r,
        u.endsWith("/generation-jobs") ? { items: job ? [job] : [] } : job,
      );
    if (u.includes(`${path}/assistance-artifacts`)) {
      if (m === "PUT") {
        writes.push({
          kind: "artifact-edit",
          body: req.postDataJSON(),
          version: req.headers()["if-match"],
        });
        if (req.headers()["if-match"] !== '"1"')
          throw Error("Artifact edit lost opened revision");
        artifact = { ...artifact, revision: 2, body: req.postDataJSON().body };
        return reply(r, artifact);
      }
      if (u.endsWith("/assistance-artifacts"))
        return reply(r, { items: artifact ? [artifact] : [] });
      return reply(r, u.endsWith("/revisions/1") ? originalArtifact : artifact);
    }
    if (m !== "GET") throw Error("Unexpected write " + m + " " + u);
    return reply(r, { items: [] });
  });
  await page.goto("http://127.0.0.1:4316/");
  await page.evaluate(async (actor) => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("scenedesk-assistant", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("sessions");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("sessions", "readwrite"),
        r = tx.objectStore("sessions").openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return;
        if (JSON.parse(c.key)[0] === actor) c.delete();
        c.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, actor);
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto(url);
  const feedback = page.locator('[aria-label="候选意见"]'),
    composer = page.locator('[aria-label="按意见准备修改"]'),
    normal = page
      .locator('[aria-label="本次创作输入"]')
      .filter({
        has: page.getByRole("textbox", { name: "本次提示", exact: true }),
      });
  await feedback
    .getByRole("button", { name: "记录候选意见", exact: true })
    .click();
  await feedback
    .getByRole("textbox", { name: "候选意见正文", exact: true })
    .fill("手指接触钥匙不自然，请保留钥匙位置。");
  await feedback
    .getByRole("button", { name: "建立此候选的意见记录", exact: true })
    .click();
  await feedback
    .getByRole("button", { name: "明确恢复原请求", exact: true })
    .waitFor();
  await page.reload();
  await feedback
    .getByRole("button", { name: "明确恢复原请求", exact: true })
    .waitFor();
  if (writes.length !== 1) throw Error("Review reload wrote");
  await feedback
    .getByRole("button", { name: "明确恢复原请求", exact: true })
    .click();
  await feedback
    .getByRole("button", { name: "保存意见", exact: true })
    .waitFor();
  if (reviews.length !== 1 || comments.length !== 0)
    throw Error("Review silently created a comment");
  drop = "comment";
  await feedback.getByRole("button", { name: "保存意见", exact: true }).click();
  await feedback
    .getByRole("button", { name: "明确恢复原请求", exact: true })
    .waitFor();
  await page.reload();
  await feedback
    .getByRole("button", { name: "明确恢复原请求", exact: true })
    .waitFor();
  if (writes.length !== 3) throw Error("Comment reload wrote");
  await page.setViewportSize({ width: 390, height: 844 });
  await feedback
    .getByText("原请求结果待核对", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "output/playwright/2026-09-12-take-feedback/final/unknown-390.png",
    animations: "disabled",
  });
  await feedback
    .getByRole("button", { name: "明确恢复原请求", exact: true })
    .click();
  await feedback
    .getByRole("button", { name: "记录候选意见", exact: true })
    .waitFor();
  if (comments.length !== 1) throw Error("Duplicate comment");
  await feedback.getByRole("button", { name: "编辑正文", exact: true }).click();
  await feedback
    .getByRole("textbox", { name: "编辑意见 · r1", exact: true })
    .fill("手指要自然接触钥匙；位置和服装保持原样。");
  drop = "change";
  await feedback
    .getByRole("button", { name: "保存意见新修订", exact: true })
    .click();
  await feedback
    .getByRole("button", { name: "只读核对本次修改", exact: true })
    .waitFor();
  await page.reload();
  await feedback
    .getByRole("button", { name: "只读核对本次修改", exact: true })
    .click();
  await feedback
    .getByRole("button", { name: "记录候选意见", exact: true })
    .waitFor();
  if (
    writes.filter((w) => w.kind === "change").length !== 1 ||
    comments[0].revision !== 2
  )
    throw Error("CAS read recovery rewrote");
  await normal
    .getByRole("textbox", { name: "本次提示", exact: true })
    .fill("普通镜头的手工输入不能被返工替换。");
  await feedback
    .getByRole("button", { name: "按意见准备修改…", exact: true })
    .click();
  await page
    .getByRole("button", { name: "以此版本准备修改", exact: true })
    .click();
  await composer
    .getByRole("textbox", { name: "本次提示", exact: true })
    .fill("返工手工原文：保持原位置。");
  await composer
    .getByRole("button", { name: "AI 准备提示", exact: true })
    .click();
  await composer
    .getByRole("combobox", { name: "准备提示的模型", exact: true })
    .click();
  await page
    .getByRole("option", { name: "受控返工助手", exact: false })
    .click();
  await composer
    .getByRole("combobox", { name: "提示将用于哪项能力", exact: true })
    .click();
  await page
    .getByRole("option", { name: "受控视频目标", exact: false })
    .click();
  await composer
    .getByRole("textbox", { name: "本次准备要求", exact: true })
    .fill("按原意见调整手指动作。");
  await composer
    .getByRole("button", { name: "查看固定计划", exact: true })
    .click();
  await composer.getByText("固定生成计划", { exact: true }).waitFor();
  await composer
    .getByRole("button", { name: "明确执行提示准备", exact: true })
    .click();
  await composer
    .getByRole("button", { name: "核对原任务", exact: true })
    .waitFor();
  await page.reload();
  await composer
    .getByRole("button", { name: "AI 准备提示", exact: true })
    .click();
  await composer.getByText("提交待核对", { exact: true }).waitFor();
  if (writes.filter((w) => w.kind === "execute").length !== 1)
    throw Error("Execution reload wrote");
  job = { ...job, status: "succeeded", assistanceArtifactId: artifact.id };
  await composer
    .getByRole("button", { name: "核对原任务", exact: true })
    .click();
  await composer
    .getByRole("button", { name: "打开提示建议", exact: true })
    .click();
  await composer
    .getByRole("textbox", { name: "建议提示", exact: true })
    .fill("人工修改：先停顿，再让手指自然接触钥匙。");
  await composer
    .getByRole("button", { name: "保存建议修订", exact: true })
    .click();
  await composer
    .getByRole("button", { name: "追加到本次提示…", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "确认追加到本次提示", exact: true })
    .waitFor();
  await page.screenshot({
    path: "output/playwright/2026-09-12-take-feedback/final/apply-390.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "确认追加，保留原文", exact: true })
    .click();
  await composer.getByText("本次输入已应用建议", { exact: true }).waitFor();
  if (
    (await normal
      .getByRole("textbox", { name: "本次提示", exact: true })
      .inputValue()) !== "普通镜头的手工输入不能被返工替换。"
  )
    throw Error("Rework polluted normal input");
  const expected =
    "返工手工原文：保持原位置。\n\n人工修改：先停顿，再让手指自然接触钥匙。";
  if (
    (await composer
      .getByRole("textbox", { name: "本次提示", exact: true })
      .inputValue()) !== expected
  )
    throw Error("Manual rework lost");
  await composer.getByRole("button", { name: "生成视频", exact: true }).click();
  const video = composer.locator('[aria-label="生成单段视频"]');
  await video
    .getByRole("combobox", { name: "视频生成模型", exact: true })
    .click();
  await page
    .getByRole("option", { name: "受控视频目标", exact: false })
    .click();
  await video
    .getByRole("button", { name: "查看视频生成计划", exact: true })
    .click();
  await video.getByText("固定视频计划", { exact: true }).waitFor();
  await page.reload();
  await composer
    .getByRole("textbox", { name: "本次提示", exact: true })
    .waitFor();
  if (
    (await composer
      .getByRole("textbox", { name: "本次提示", exact: true })
      .inputValue()) !== expected
  )
    throw Error("Applied rework failed refresh");
  await normal.getByRole("button", { name: "生成视频", exact: true }).click();
  const normalVideo = normal.locator('[aria-label="生成单段视频"]');
  await normalVideo
    .getByRole("combobox", { name: "视频生成模型", exact: true })
    .waitFor();
  if (await normalVideo.getByText("固定视频计划", { exact: true }).count())
    throw Error("Normal input inherited rework generation session");
  for (const width of [1512, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 982 });
    await composer.scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    if (overflow) throw Error("Page overflow " + width);
    await page.screenshot({
      path: `output/playwright/2026-09-12-take-feedback/final/rework-${width}.png`,
      animations: "disabled",
    });
  }
  allow = 503;
  await feedback
    .getByRole("button", { name: "读取当前意见", exact: true })
    .click();
  await page
    .getByText("意见暂时无法读取。本机输入仍保留，请重试。", { exact: true })
    .waitFor();
  if (await composer.count())
    throw Error("Temporary access failure exposed rework");
  allow = 0;
  await page
    .getByRole("button", { name: "重新读取候选意见", exact: true })
    .click();
  await composer
    .getByRole("textbox", { name: "本次提示", exact: true })
    .waitFor();
  allow = 403;
  await feedback
    .getByRole("button", { name: "读取当前意见", exact: true })
    .click();
  await page.getByText("当前不可访问候选意见", { exact: true }).waitFor();
  if ((await stored()).some((r) => r.draft.selected))
    throw Error("Confirmed denial kept feedback draft");
  if (errors.length) throw Error(errors.join(";"));
  const result = {
    controlledTransport: true,
    realIndexedDB: true,
    notRealModelAcceptance: true,
    writes,
    reviews: reviews.length,
    comments: comments.length,
    commentRevision: comments[0].revision,
    shotRevisionFixed: oldRevision,
    artifactRevision: artifact.revision,
    normalInputIsolated: true,
    unknownRefreshZeroPosts: true,
    casRecoveryReadsOnly: true,
    viewports: [1512, 390],
    accessRecovery: true,
    pageErrors: errors,
  };
  await page.evaluate(
    (result) =>
      sessionStorage.setItem(
        "take-feedback-test-result",
        JSON.stringify(result),
      ),
    result,
  );
  return result;
}
