import { test, expect } from "./continuous-workspace-fixture.js";

test("CW-09/10: image reference → video draft → exact results, explicit placement, comparison and refreshed history", async ({
  page,
  continuous: f,
}, info) => {
  test.setTimeout(120_000);
  const url = `${f.origin}/#/app/t/${f.tenant.id}/p/${f.project.id}/canvas`;
  await page.goto(`${url}?node=${f.referenceId}`);
  await expect(
    page.getByRole("button", { name: "画布保存状态：已保存", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续创作", exact: true }).click();
  await page.getByRole("button", { name: "新的视频草稿", exact: true }).click();
  await page
    .getByRole("button", { name: "专注编辑", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "本次提示词", exact: true })
    .fill("第一段：雨夜窗边，缓慢推近。");
  await page.getByRole("combobox", { name: "视频生成模型", exact: true }).click();
  await page.getByRole("option", { name: /Local Video Demo/ }).click();
  let jobPosts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/generation-jobs")
    )
      jobPosts++;
  });
  await page.getByRole("button", { name: "生成视频", exact: true }).click();
  await expect(page.getByText("排队中", { exact: true }).first()).toBeVisible();
  const entries = () =>
    f.ok("GET", `${f.path}/canvases/${f.canvas.id}/generation-plans`);
  const first = (await entries()).items[0];
  expect(first.plan.resolvedInput.references).toHaveLength(1);
  expect(first.plan.resolvedInput.references[0].reference.mediaId).toBe(
    f.canvas.document.nodes[0].content.mediaId,
  );
  await f.completeVideo(first.jobId);
  await page.getByRole("button", { name: "核对任务进度", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "本次生成结果", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("尚未放入画布", { exact: true })).toBeVisible();
  const beforePlace = await f.ok("GET", `${f.path}/canvases/${f.canvas.id}`);
  expect(beforePlace.document.nodes).toHaveLength(3);
  const videoDraft = beforePlace.document.nodes.find(
    (node: any) => node.kind === "video",
  );
  await page
    .getByRole("button", { name: "查看添加到画布的位置", exact: true })
    .click();
  await page
    .getByRole("button", { name: "确认添加到画布", exact: true })
    .click();
  await expect(page.getByText("已添加到画布", { exact: true })).toBeVisible();
  const placed = await f.ok("GET", `${f.path}/canvases/${f.canvas.id}`);
  expect(placed.document.nodes).toHaveLength(4);
  expect(
    placed.document.nodes.find((node: any) => node.id === videoDraft.id).content
      .prompt,
  ).toBe("第一段：雨夜窗边，缓慢推近。");
  expect(
    placed.document.nodes.find(
      (node: any) => node.content.mediaId === first.jobId,
    ),
  ).toBeTruthy();
  expect((await f.ok("GET", `${f.path}/takes`)).items).toHaveLength(0);
  await page
    .getByRole("button", { name: "保留原任务，准备下一段视频", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "本次提示词", exact: true })
    .fill("第二段：人物缓缓抬头。");
  await page.getByRole("button", { name: "生成视频", exact: true }).click();
  await expect(page.getByText("排队中", { exact: true }).first()).toBeVisible();
  const second = (await entries()).items.find(
    (entry: any) => entry.plan.id !== first.plan.id,
  );
  await f.completeVideo(second.jobId);
  await page.getByRole("button", { name: "核对任务进度", exact: true }).click();
  await page.getByRole("button", { name: "与上次比较", exact: true }).click();
  const comparison = page.getByRole("dialog", {
    name: "比较固定成果",
    exact: true,
  });
  await expect(comparison).toBeVisible();
  await expect(
    comparison.getByText("上一次固定结果", { exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "返回画布", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "任务与结果", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^查看固定尝试 新的视频草稿/ }),
  ).toHaveCount(2);
  await page
    .getByRole("button", {
      name: new RegExp(
        `查看固定尝试 新的视频草稿 · ${first.plan.id.slice(0, 8)}`,
      ),
    })
    .click();
  await expect(
    page.getByRole("button", { name: "打开所选的固定视频任务", exact: true }),
  ).toBeVisible();
  expect(
    (
      await f.ok("GET", `${f.path}/canvases/${f.canvas.id}`)
    ).document.nodes.find((node: any) => node.id === videoDraft.id).content
      .prompt,
  ).toBe("第二段：人物缓缓抬头。");
  expect(jobPosts).toBe(2);
  expect(f.videoCalls()).toBe(2);
  const screenshot = info.outputPath("fixed-video-history.png");
  await page.screenshot({ path: screenshot });
  await info.attach("fixed-video-history", {
    path: screenshot,
    contentType: "image/png",
  });
});

test("CW-10/11: lost assistant application reply recovers the same draft, then direct editing resumes without generation", async ({
  page,
  continuous: f,
}) => {
  await f.seedAdvice();
  let applications = 0,
    generations = 0;
  await page.route("**/assistance-applications", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    applications++;
    await route.fetch();
    await route.abort("failed");
  });
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/generation-jobs")
    )
      generations++;
  });
  await page.goto(
    `${f.origin}/#/app/t/${f.tenant.id}/p/${f.project.id}/canvas?node=${f.referenceId}`,
  );
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  await page
    .getByRole("button", { name: "查看建议与应用差异", exact: true })
    .click();
  await page.getByText("应用到画布草稿", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "明确应用到哪个草稿", exact: true })
    .click();
  await page
    .getByRole("option", { name: "待助手调整的草稿", exact: true })
    .click();
  await page.getByRole("button", { name: "查看应用差异", exact: true }).click();
  await page
    .getByRole("button", { name: "确认应用这份建议", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "查询原应用记录", exact: true }),
  ).toBeVisible();
  await page.reload();
  const assistantToggle = page.getByRole("button", { name: "AI 助手", exact: true });
  // Panel preferences save separately from the durable application receipt.
  // A quick reload may close the panel; reopening must still recover that receipt.
  if ((await assistantToggle.getAttribute("aria-pressed")) !== "true")
    await assistantToggle.click();
  await page
    .getByRole("button", { name: "查询原应用记录", exact: true })
    .click();
  await page
    .getByRole("button", { name: "继续编辑此草稿", exact: true })
    .click();
  await expect(page).toHaveURL((url) =>
    new URLSearchParams(url.hash.split("?")[1]).get("node") === f.draftId,
  );
  await page
    .getByRole("button", { name: "专注编辑", exact: true })
    .first()
    .click();
  const prompt = page.getByRole("textbox", { name: "本次提示词", exact: true });
  await expect(prompt).toHaveValue("合成助手建议：雨夜窗边的人物，轻轻抬头。");
  await prompt.fill("助手建议后，用户继续修改同一草稿。");
  await page.getByRole("button", { name: "返回画布", exact: true }).click();
  await page.getByRole("button", { name: "保存画布", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "画布保存状态：已保存", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("已选 · 待助手调整的草稿", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "项目导航", exact: true })
    .getByRole("link", { name: "剧本", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "项目导航", exact: true })
    .getByRole("link", { name: "画布", exact: true })
    .click();
  await page.reload();
  const current = await f.ok("GET", `${f.path}/canvases/${f.canvas.id}`);
  expect(current.document.nodes).toHaveLength(2);
  expect(
    current.document.nodes.find((node: any) => node.id === f.draftId).content
      .prompt,
  ).toBe("助手建议后，用户继续修改同一草稿。");
  expect(applications).toBe(1);
  expect(generations).toBe(0);
});

test("CW-12: default scene canvas uses the shot list while legacy storyboard deep links remain reachable", async ({
  page,
  continuous: f,
}, info) => {
  await page.goto(`${f.origin}/#/app/t/${f.tenant.id}/p/${f.project.id}/canvas`);
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of ["镜头列表", "任务与结果", "素材", "AI 助手", "画布恢复与协作"]) {
      const action = page.getByRole("button", { name, exact: true });
      await expect(action).toBeVisible();
      await expect.poll(async () => {
        const box = await action.boundingBox();
        return !!box && box.x >= 0 && box.x + box.width <= width;
      }, { message: `${width}px: ${name} stays inside the viewport` }).toBe(true);
    }
    if (width === 390) {
      const screenshot = info.outputPath("canvas-actions-390.png");
      await page.screenshot({ path: screenshot });
      await info.attach("canvas-actions-390", { path: screenshot, contentType: "image/png" });
      await page.getByRole("button", { name: "AI 助手", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "发送给画布助手", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "收起 AI 助手", exact: true }).click();
    }
  }
  const ensured = await f.request(
    "POST",
    `${f.path}/scenes/${f.scene.id}/canvas`,
  );
  expect(ensured.statusCode).toBe(200);
  const base = `${f.origin}/#/app/t/${f.tenant.id}/p/${f.project.id}/production?scene=${f.scene.id}`;
  await page.goto(`${base}&mode=canvas`);
  await expect(
    page.getByRole("button", { name: "镜头列表", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "分镜台", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "镜头列表", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "镜头列表", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`${base}&mode=storyboard&shot=${f.shot.id}`);
  await expect(
    page.getByRole("button", { name: "返回画布", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回画布", exact: true }).click();
  await expect(page).toHaveURL(`${base}&mode=canvas&shot=${f.shot.id}`);
  await expect(
    page.getByRole("button", { name: "镜头列表", exact: true }),
  ).toBeVisible();
});
