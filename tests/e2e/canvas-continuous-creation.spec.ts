import { test, expect } from "./canvas-generation-fixture.js";

test("CW-09/11: one click submits fixed inputs once and the next draft survives refresh", async ({
  page,
  generation: f,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const project = await f.createProject("连续创作 · 合成验收");
  const path = `${f.base}/projects/${project.id}`;
  const ensured = await f.request("POST", `${path}/canvas`);
  expect(ensured.statusCode).toBe(200);
  const canvasId = ensured.json().canvas.id;
  await page.goto(`${f.origin}/#/app/t/${f.tenant.id}/p/${project.id}/canvas`);
  await expect(
    page.getByRole("button", { name: "画布保存状态：已保存", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建画布内容", exact: true }).click();
  await page.getByRole("menuitem", { name: "图片草稿", exact: true }).click();
  const focus = page
    .getByRole("button", { name: "专注编辑", exact: true })
    .first();
  await focus.click();
  await page
    .getByRole("textbox", { name: "本次提示词", exact: true })
    .fill("第一稿：雨夜中的门。");
  await page
    .getByRole("combobox", { name: "图片生成模型", exact: true })
    .click();
  await page.getByRole("option", { name: /显式文件 fixture/ }).click();
  let plans = 0,
    jobs = 0;
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (request.url().endsWith(`/canvases/${canvasId}/generation-plans`))
      plans++;
    if (request.url().endsWith("/generation-jobs")) jobs++;
  });
  await page.getByRole("button", { name: "生成图片", exact: true }).click();
  await expect(page.getByText("排队中", { exact: true }).first()).toBeVisible();
  expect(plans).toBe(1);
  expect(jobs).toBe(1);
  const entries = await f.ok(
    "GET",
    `${path}/canvases/${canvasId}/generation-plans`,
  );
  expect(entries.items).toHaveLength(1);
  expect(entries.items[0].plan.input.prompt).toBe("第一稿：雨夜中的门。");
  const jobId = entries.items[0].jobId;
  await page
    .getByRole("button", { name: "保留原任务，准备下一张图片", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "本次提示词", exact: true })
    .fill("下一稿：靠近人物的眼睛。");
  // Navigate through the shared retention barrier while the original job remains queued.
  await page.getByRole("button", { name: "返回画布", exact: true }).click();
  await page
    .getByRole("navigation", { name: "项目导航", exact: true })
    .getByRole("link", { name: "剧本", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "项目导航", exact: true })
    .getByRole("link", { name: "画布", exact: true })
    .click();
  await page.reload();
  await expect(page.getByRole("alert", {
    name: "发现尚未同步的本机画布", exact: true,
  })).toBeVisible();
  await page.getByRole("button", { name: "恢复本机修改", exact: true }).click();
  await page.getByRole("button", { name: "保存画布", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "画布保存状态：已保存", exact: true }),
  ).toBeVisible();
  const current = await f.ok("GET", `${path}/canvases/${canvasId}`);
  expect(current.document.nodes[0].content.prompt).toBe(
    "下一稿：靠近人物的眼睛。",
  );
  expect((await f.job(jobId)).status).toBe("queued");
  expect(plans).toBe(1);
  expect(jobs).toBe(1);
  expect((await f.ok("GET", `${path}/content`)).scenes).toHaveLength(0);
  const screenshot = info.outputPath("continuous-creation-1280.png");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("continuous-creation-1280", {
    path: screenshot,
    contentType: "image/png",
  });
});

test("CW-11: a lost execution reply is recovered by reading the original job; unknown provider submission stays guarded", async ({
  page,
  generation: f,
}) => {
  const project = await f.createProject("原提交核对 · 合成验收"),
    path = `${f.base}/projects/${project.id}`;
  const ensured = await f.request("POST", `${path}/canvas`),
    canvas = ensured.json().canvas;
  const node = {
    id: crypto.randomUUID(),
    kind: "image",
    title: "固定尝试",
    width: 360,
    position: { x: 80, y: 80 },
    content: {
      type: "draft",
      prompt: "固定的画面",
      connectionId: f.input.connectionId,
      capabilityId: f.input.capabilityId,
      output: f.input.output,
    },
  };
  await f.ok(
    "PUT",
    `${path}/canvases/${canvas.id}`,
    { schemaVersion: 1, document: { nodes: [node], edges: [], groups: [] } },
    canvas.revision,
  );
  let posts = 0;
  await page.route("**/generation-jobs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch();
    const job = await response.json();
    f.setUnknown(true);
    await f.worker.process(job.id);
    await route.abort("failed");
  });
  await page.goto(
    `${f.origin}/#/app/t/${f.tenant.id}/p/${project.id}/canvas?node=${node.id}`,
  );
  await expect(
    page.getByRole("button", { name: "画布保存状态：已保存", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .getByRole("button", { name: "专注编辑", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "生成图片", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "核对后恢复原提交", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "画布保存状态：已保存", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .getByRole("button", { name: "专注编辑", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("提交待核对", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "保留原任务，准备下一张图片",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(posts).toBe(1);
  expect(f.calls()).toBe(1);
});
