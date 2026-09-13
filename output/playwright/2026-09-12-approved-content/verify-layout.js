async (page) => {
  await page.goto("about:blank");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const tenant = "11111111-1111-4111-8111-111111111111",
    projectId = "22222222-2222-4222-8222-222222222222",
    userId = "cccccccc-3333-4333-8333-333333333333",
    sessionId = "dddddddd-4444-4444-8444-444444444444",
    sceneId = "55555555-5555-4555-8555-555555555555",
    episodeId = "66666666-6666-4666-8666-666666666666",
    shotId = "77777777-7777-4777-8777-777777777777";
  const base = `/v1/tenants/${tenant}`,
    path = `${base}/projects/${projectId}`,
    app = `http://127.0.0.1:4417/#/app/t/${tenant}/p/${projectId}/content`;
  const identity = {
    id: sessionId,
    revision: 1,
    userId,
    email: "controlled-creation@example.test",
    csrfToken: "synthetic-" + Math.random().toString(36).slice(2),
  };
  const member = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    revision: 1,
    userId,
    role: "member",
    status: "active",
  };
  const project = {
    id: projectId,
    revision: 1,
    name: "春日来信",
    status: "active",
    leadMembershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    spec: {
      width: 1080,
      height: 1920,
      fpsNum: 24,
      fpsDen: 1,
      language: "zh-CN",
    },
  };
  let tree = {
    projectId,
    revision: 1,
    episodes: [
      {
        id: episodeId,
        projectId,
        revision: 1,
        title: "第 1 集 · 再见之前",
        position: 0,
        status: "active",
      },
    ],
    scenes: [
      {
        id: sceneId,
        projectId,
        episodeId,
        revision: 1,
        title: "咖啡厅",
        position: 0,
        status: "active",
        summary: "保留现有内容",
        state: {},
        defaultAssetRevisionIds: [],
      },
    ],
    shots: [
      {
        id: shotId,
        projectId,
        sceneId,
        revision: 1,
        label: "S01",
        position: 0,
        status: "active",
        specRevisionId: "88888888-8888-4888-8888-888888888888",
        spec: {
          intent: "林予没有立刻回答。她的手停在杯沿，听着雨声。",
          references: [],
        },
      },
    ],
  };
  const scriptId = "12345678-1234-4234-8234-123456789012",
    oldId = "12345678-1234-4234-8234-123456789011";
  const original =
    "第 1 场 · 咖啡厅 / 日\n\n午后的雨水沿着玻璃滑落。林予坐在靠窗的位置，面前的咖啡已经凉了。\n\n陈屿推门进来，停了一下。他想起许多开场的话，最后只说：\n\n陈屿：好久不见。\n\n林予抬起头，手指仍搭在杯沿。她没有立刻回答。\n\n林予：你还是会在下雨的时候迟到。\n\n两人都笑了一下，窗外驶过一辆公交车。";
  let scripts = [
    {
      id: scriptId,
      number: 2,
      projectId,
      text: original,
      parentRevisionId: oldId,
      createdAt: "2026-09-10T04:00:00Z",
    },
    {
      id: oldId,
      number: 1,
      projectId,
      text: "旧版原文：他们在雨中重逢。",
      createdAt: "2026-09-09T04:00:00Z",
    },
  ];
  tree.currentScriptRevisionId = scriptId;
  tree.scenes[0].timeLabel = "日";
  tree.scenes[0].locationLabel = "内景";
  tree.scenes.push({
    ...tree.scenes[0],
    id: "abcdef01-5555-4555-8555-555555555555",
    title: "街角",
    position: 1,
    locationLabel: "外景",
    timeLabel: "傍晚",
  });
  const capability = {
    id: "6173d697-b96a-4b7f-a4e9-d888ce6487ae",
    revision: 2,
    connectionId: "dd28d22a-4454-48e3-8271-51eab9ca0b68",
    purpose: "script_analysis",
    modelVersion: "受控分镜测试",
    mode: "script_analysis",
    enabled: true,
    executionMode: "test_fixture",
    supportedPurposes: [],
    notes: "仅验证界面与恢复，不是真实模型验收。",
  };
  const proposalId = "98723c80-77cd-4a87-a7ab-bd7e7b56c9f8",
    planId = "f84ab73b-5895-4ce4-9dce-5f31b1ce6d37",
    jobId = "b13131cf-4b24-4dfe-97de-7ad0b8ee7f04";
  let plan,
    job,
    proposal,
    initialProposal,
    scriptPosts = 0,
    planPosts = 0,
    executePosts = 0,
    editPosts = 0,
    applyPosts = 0,
    readFailure = false;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const reply = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await page.route("**/health/**", (route) =>
    reply(route, {
      phase: "business",
      identityMode: "local_test",
      providerMode: "mock",
    }),
  );
  await page.route("**/v1/**", async (route) => {
    const req = route.request(),
      p =
        "/" +
        req.url().split("://")[1].split("/").slice(1).join("/").split("?")[0],
      method = req.method();
    if (p === "/v1/session") return reply(route, identity);
    if (p === "/v1/tenants")
      return reply(route, {
        items: [
          {
            id: tenant,
            name: "向光工作室",
            revision: 1,
            ownerUserId: userId,
            currency: "CNY",
          },
        ],
      });
    if (p === base + "/members") return reply(route, { items: [member] });
    if (p === base + "/projects") return reply(route, { items: [project] });
    if (p === path) return reply(route, project);
    if (p.endsWith("/events"))
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": fixture\n\n",
      });
    if (p === path + "/content")
      return readFailure
        ? reply(
            route,
            { code: "UNAVAILABLE", message: "受控保存后读取故障" },
            503,
          )
        : reply(route, tree);
    if (p === path + "/scripts") {
      if (method === "POST") {
        if (req.headers()["if-match"] !== `"${tree.revision}"`)
          throw Error("script CAS changed");
        scriptPosts++;
        const body = req.postDataJSON();
        const next = {
          id: "12345678-1234-4234-8234-123456789013",
          number: 3,
          projectId,
          ...body,
          createdAt: "2026-09-12T04:00:00Z",
        };
        scripts.unshift(next);
        tree = {
          ...tree,
          revision: tree.revision + 1,
          currentScriptRevisionId: next.id,
        };
        readFailure = true;
        return reply(route, next, 201);
      }
      return readFailure
        ? reply(
            route,
            { code: "UNAVAILABLE", message: "受控保存后读取故障" },
            503,
          )
        : reply(route, { items: scripts });
    }
    if (p === base + "/capabilities")
      return reply(route, { items: [capability] });
    if (p === base + "/generation-plans") {
      planPosts++;
      const input = req.postDataJSON(),
        source = scripts.find((s) => s.id === input.sourceScriptRevisionId),
        quote = Array.from(source.text)
          .slice(input.scriptRange.startOffset, input.scriptRange.endOffset)
          .join("");
      if (
        input.contextSources.length !== 1 ||
        input.contextSources[0].objectId !== sceneId
      )
        throw Error("context not fixed");
      plan = {
        id: planId,
        revision: 1,
        input,
        capabilityRevision: 2,
        inputHash: "controlled-fixture-hash",
        expiresAt: "2099-01-01T00:00:00Z",
        status: "ready",
        blockingReasons: [],
        executionMode: "test_fixture",
        connectionVersionId: "3218e626-cfeb-4f53-979c-0e2d71a3e00d",
        resolvedInput: {
          resolverVersion: "test-1",
          prompt: input.prompt,
          references: [],
          shots: [],
          dependencies: [],
          sourceExcerpt: {
            scriptRevisionId: source.id,
            range: input.scriptRange,
            quote,
          },
          contextSnapshots: [
            {
              source: {
                kind: "scene",
                objectId: sceneId,
                revision: 1,
                tracking: "fixed",
                contentHash: "test",
              },
              text: tree.scenes[0].summary,
            },
          ],
        },
      };
      const excerpt = plan.resolvedInput.sourceExcerpt;
      proposal = {
        id: proposalId,
        revision: 1,
        projectId,
        baseContentRevision: tree.revision,
        status: "proposed",
        sourceKind: "ai_analysis",
        sourceScriptRevisionId: source.id,
        sourceHash: "controlled-fixture-hash",
        scriptRange: input.scriptRange,
        target: input.proposalTarget,
        baseContentSnapshot: JSON.parse(JSON.stringify(tree)),
        operations: [
          {
            opId: "be2df5aa-05b8-48ae-966f-fd83efdd35ef",
            temporaryId: "79c1b5e4-ed14-43e0-8877-086fd68c89be",
            kind: "shot",
            action: "create",
            summary: "候选分镜",
            proposed: {
              sceneId,
              label: "S02 · 杯沿",
              position: 1,
              spec: {
                intent: "让停顿成为重逢的第一句回应。",
                action: "手指沿杯沿轻轻移动，目光转向来人。",
                references: [],
                sourceExcerpts: [excerpt],
              },
            },
            sourceExcerpts: [excerpt],
          },
        ],
      };
      initialProposal = JSON.parse(JSON.stringify(proposal));
      return reply(route, plan, 201);
    }
    if (p === base + "/generation-plans/" + planId) return reply(route, plan);
    if (p === base + "/generation-jobs") {
      if (method === "POST") {
        executePosts++;
        job = {
          id: jobId,
          revision: 1,
          scope: "project",
          projectId,
          planId,
          status: "succeeded",
          proposalId,
          mediaIds: [],
          reservationStatus: "held",
          inputOutdated: false,
          connectionVersionId: plan.connectionVersionId,
          costStatus: "unavailable",
          confirmedCost: { currency: "CNY", amountMicros: "0" },
          reservationRemaining: { currency: "CNY", amountMicros: "0" },
          recoveryEpoch: 0,
          executionMode: "test_fixture",
        };
        plan.status = "consumed";
        return reply(route, job, 202);
      }
      return reply(route, { items: job ? [job] : [] });
    }
    if (p === base + "/generation-jobs/" + jobId) return reply(route, job);
    if (p === path + "/proposals")
      return reply(route, { items: proposal ? [proposal] : [] });
    if (p === path + "/proposals/" + proposalId) {
      if (method === "PUT") {
        editPosts++;
        proposal = {
          ...proposal,
          ...req.postDataJSON(),
          revision: proposal.revision + 1,
        };
        return reply(route, proposal);
      }
      return reply(
        route,
        req.url().includes("revisionNumber=1") ? initialProposal : proposal,
      );
    }
    if (p === path + "/proposals/" + proposalId + "/apply") {
      applyPosts++;
      const selected = req.postDataJSON().selectedOperationIds;
      if (selected.length !== 1) throw Error("wrong selection");
      const id = "3751acbe-82f4-4590-835d-35bb9a383866";
      tree = {
        ...tree,
        revision: tree.revision + 1,
        shots: [
          ...tree.shots,
          {
            ...proposal.operations[0].proposed,
            id,
            projectId,
            status: "active",
            revision: 1,
            specRevisionId: "f5d6bf56-947a-44e4-87d2-a72d7a8f36a7",
          },
        ],
      };
      proposal = {
        ...proposal,
        status: "applied",
        application: {
          proposalRevision: proposal.revision,
          selectedOperationIds: selected,
          createdObjects: { [selected[0]]: id },
          contentRevision: tree.revision,
          appliedAt: new Date().toISOString(),
        },
      };
      return reply(route, tree);
    }
    if (method !== "GET") throw Error("unexpected write " + p);
    return reply(route, { items: [] });
  });
  const baseHash = `#/app/t/${tenant}/p/${projectId}`;
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto(app);
  await page.getByText("01 · 咖啡厅", { exact: true }).waitFor();
  if (await page.getByRole("region", { name: "场次镜头" }).isVisible())
    throw Error("catalog opens heavy shot panel automatically");
  await page.screenshot({
    path: "output/playwright/2026-09-12-approved-content/scenes-1512.png",
    animations: "disabled",
  });
  await page.getByRole("link", { name: "剧本与设定", exact: true }).click();
  const body = page.getByRole("textbox", { name: "剧本正文", exact: true });
  await body.waitFor();
  if ((await body.inputValue()) !== original)
    throw Error("saved script missing");
  await page.screenshot({
    path: "output/playwright/2026-09-12-approved-content/script-1512.png",
    animations: "disabled",
  });
  const edited = original + "\n\n待保存：保留两个人之间的距离。";
  await body.fill(edited);
  await page.getByRole("link", { name: "返回场次", exact: true }).click();
  await page.getByText("01 · 咖啡厅", { exact: true }).waitFor();
  await page.getByRole("link", { name: "剧本与设定", exact: true }).click();
  if ((await body.inputValue()) !== edited)
    throw Error("view switch lost script draft");
  await page.reload();
  await page
    .getByRole("button", { name: "恢复未提交内容", exact: true })
    .click();
  if ((await body.inputValue()) !== edited)
    throw Error("refresh lost script draft");
  await page
    .getByRole("button", { name: "保存为第 3 版", exact: true })
    .click();
  await page
    .getByRole("button", { name: "重新读取已保存的剧本", exact: true })
    .waitFor();
  await page.getByText("受控保存后读取故障", { exact: true }).first().waitFor();
  if (
    await page
      .getByRole("button", { name: "保存为第 3 版", exact: true })
      .count()
  )
    throw Error("saved read failure reopened writable stale document");
  await page.getByRole("link", { name: "返回场次", exact: true }).click();
  await page.getByRole("link", { name: "剧本与设定", exact: true }).click();
  await page
    .getByRole("button", { name: "重新读取已保存的剧本", exact: true })
    .waitFor();
  if (scriptPosts !== 1) throw Error("script writes after read failure");
  await page.screenshot({
    path: "output/playwright/2026-09-12-approved-content/script-saved-read-failed.png",
    animations: "disabled",
  });
  readFailure = false;
  await page
    .getByRole("button", { name: "重新读取已保存的剧本", exact: true })
    .click();
  await body.waitFor();
  if ((await body.inputValue()) !== edited)
    throw Error("reopened stale script");
  await page.goto(
    `http://127.0.0.1:4417/${baseHash}/content?revision=${oldId}`,
  );
  const old = page.getByRole("textbox", { name: "第 1 版原文", exact: true });
  await old.waitFor();
  if (!(await old.getAttribute("readonly"))) {
    if (!(await old.evaluate((e) => e.readOnly)))
      throw Error("history editable");
  }
  if ((await old.inputValue()) !== scripts[2].text)
    throw Error("deep link changed fixed script");
  await page.goto(`http://127.0.0.1:4417/${baseHash}/script`);
  await body.waitFor();
  const dock = page.getByRole("complementary", { name: "剧本提案助手" });
  await dock
    .getByRole("combobox", { name: "本次建议的目标场次", exact: true })
    .click();
  await page
    .getByRole("option", { name: "第 1 集 · 再见之前 · 咖啡厅", exact: true })
    .click();
  await dock.getByRole("combobox", { name: "来源剧本", exact: true }).click();
  await page.getByRole("option", { name: "剧本第 3 版", exact: false }).click();
  await dock
    .getByRole("textbox", { name: "选择要分析的原文", exact: true })
    .evaluate((el) => {
      el.focus();
      el.setSelectionRange(0, 40);
      el.dispatchEvent(new Event("select", { bubbles: true }));
    });
  await dock.getByRole("button", { name: "使用选区", exact: true }).click();
  await dock
    .getByRole("textbox", { name: "分镜要求", exact: true })
    .fill("保留原对白，从手部动作开始。");
  await dock
    .getByRole("checkbox", { name: "附带本场摘要与连续性设定", exact: true })
    .check();
  await dock
    .getByRole("combobox", { name: "分镜分析模型", exact: true })
    .click();
  await page
    .getByRole("option", { name: "受控分镜测试", exact: false })
    .click();
  await dock
    .getByRole("button", { name: "查看分镜分析计划", exact: true })
    .click();
  await dock.getByRole("region", { name: "固定生成计划" }).waitFor();
  if (tree.shots.length !== 1) throw Error("plan auto created shots");
  await dock
    .getByRole("button", { name: "确认执行测试计划", exact: true })
    .click();
  await dock
    .getByRole("button", { name: "编辑并采纳分镜提案", exact: true })
    .click();
  await dock
    .getByRole("checkbox", { name: "采纳镜头 S02 · 杯沿", exact: true })
    .waitFor();
  await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 0));
  await page.screenshot({
    path: "output/playwright/2026-09-12-approved-content/script-proposal-1512.png",
    animations: "disabled",
  });
  await dock
    .getByRole("button", { name: "修改S02 · 杯沿", exact: true })
    .click();
  await dock
    .getByRole("textbox", { name: "叙事意图", exact: true })
    .fill("人工修改：先看到犹豫，再切到手部。");
  if (!(await body.isVisible()))
    throw Error("proposal edit hid source document");
  await dock.getByRole("button", { name: "保留本项修改", exact: true }).click();
  await dock.getByRole("button", { name: "保存提案修订", exact: true }).click();
  await dock
    .getByRole("checkbox", { name: "采纳镜头 S02 · 杯沿", exact: true })
    .check();
  await dock.getByRole("button", { name: "检查采纳结果", exact: true }).click();
  if (tree.shots.length !== 1) throw Error("selection auto applied proposal");
  await dock
    .getByRole("button", { name: "确认采纳并创建", exact: true })
    .click();
  await dock.getByText("本提案已采纳", { exact: true }).waitFor();
  if (
    tree.shots.length !== 2 ||
    scriptPosts !== 1 ||
    planPosts !== 1 ||
    executePosts !== 1 ||
    editPosts !== 1 ||
    applyPosts !== 1
  )
    throw Error("wrong business counts");
  for (const viewport of [
    { width: 1366, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.screenshot({
      path: `output/playwright/2026-09-12-approved-content/script-proposal-${viewport.width}.png`,
      animations: "disabled",
    });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error("horizontal page overflow " + viewport.width);
  }
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.getByRole("button", { name: "切换深色", exact: true }).click();
  await page.screenshot({
    path: "output/playwright/2026-09-12-approved-content/script-dark.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "切换浅色", exact: true }).click();
  if (errors.length) throw Error(errors.join(";"));
  return {
    productionBuild: true,
    controlledTransport: true,
    realBackendAcceptance: false,
    catalogInitiallyFlat: true,
    scriptDraftSurvivesNavigationAndRefresh: true,
    committedReadFailureCannotResubmit: true,
    fixedHistoryDeepLink: true,
    documentRemainsDuringProposalEditing: true,
    explicitProposalApplication: true,
    scriptPosts,
    planPosts,
    executePosts,
    editPosts,
    applyPosts,
    pageErrors: errors,
  };
};
