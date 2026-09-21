import { test, expect } from "./canvas-generation-fixture.js";

test.use({ viewport: { width: 1920, height: 902 } });

async function openStudio(page: import("@playwright/test").Page, f: { origin: string; tenant: { id: string } }, projectId: string) {
  await page.goto(`${f.origin}/#/app/t/${f.tenant.id}/p/${projectId}/studio`);
  await expect(page.getByRole("button", { name: "创作台保存状态：已保存", exact: true })).toBeVisible();
}

test("ST-03: one click fixes the inputs and submits once; the next draft survives a reload", async ({ page, generation: f }, info) => {
  const project = await f.createProject("连续创作 · 创作台");
  const path = `${f.base}/projects/${project.id}`;
  const ensured = await f.request("POST", `${path}/canvas`);
  expect(ensured.statusCode).toBe(200);
  const canvasId = ensured.json().canvas.id;
  await openStudio(page, f, project.id);
  const board = page.getByRole("main", { name: "创作台", exact: true });

  // A new image draft is selected on creation, so its panel opens right under it.
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("menuitem", { name: "图片", exact: true }).click();
  const panel = page.getByRole("region", { name: "生成图片", exact: true });
  await expect(panel).toBeVisible();
  const submit = panel.getByRole("button", { name: "生成图片", exact: true });
  await expect(submit).toBeDisabled();
  const prompt = panel.getByRole("textbox", { name: "提示词", exact: true });
  await expect(prompt).toBeFocused();
  await prompt.fill("第一稿：雨夜中的门。");
  await expect(submit).toBeDisabled();
  // Rule 5 and 17: the model goes into the document, and its single choices fill in.
  await panel.getByRole("button", { name: "生成模型", exact: true }).click();
  const option = page.getByRole("option", { name: /显式文件 fixture/ });
  await expect(option).toContainText("受控测试");
  await option.click();
  await expect(panel.getByRole("button", { name: "生成规格", exact: true })).toContainText("1:1 · 32x32");
  await expect(submit).toBeEnabled();
  await expect(page.getByRole("button", { name: "创作台保存状态：已保存", exact: true })).toBeVisible();
  const saved = await f.ok("GET", `${path}/canvases/${canvasId}`);
  expect(saved.document.nodes[0].content).toMatchObject({
    type: "draft", prompt: "第一稿：雨夜中的门。", capabilityId: f.input.capabilityId,
    connectionId: f.input.connectionId, output: { resolution: "32x32", aspectRatio: "1:1" },
  });
  const shot = info.outputPath("studio-composer-1920.png");
  await page.screenshot({ path: shot, animations: "disabled" });
  await info.attach("studio-composer-1920", { path: shot, contentType: "image/png" });
  // The model list and the specification popover, for the side-by-side review.
  await panel.getByRole("button", { name: "生成模型", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "可用模型", exact: true })).toBeVisible();
  const modelsShot = info.outputPath("studio-model-picker-1920.png");
  await page.screenshot({ path: modelsShot, animations: "disabled" });
  await info.attach("studio-model-picker-1920", { path: modelsShot, contentType: "image/png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "可用模型", exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "生成规格", exact: true }).click();
  const spec = page.getByRole("group", { name: "生成规格", exact: true });
  await expect(spec).toBeVisible();
  await expect(spec.getByRole("button", { name: "1:1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(spec.getByRole("button", { name: "32x32", exact: true })).toHaveAttribute("aria-pressed", "true");
  const specShot = info.outputPath("studio-spec-picker-1920.png");
  await page.screenshot({ path: specShot, animations: "disabled" });
  await info.attach("studio-spec-picker-1920", { path: specShot, contentType: "image/png" });
  await page.keyboard.press("Escape");
  await expect(spec).toHaveCount(0);

  // Rule 8: one click prepares and executes once.
  let plans = 0, jobs = 0;
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (request.url().endsWith(`/canvases/${canvasId}/generation-plans`)) plans++;
    if (request.url().endsWith("/generation-jobs")) jobs++;
  });
  await submit.click();
  await expect(panel.getByRole("status")).toHaveText("排队中");
  expect(plans).toBe(1);
  expect(jobs).toBe(1);
  const entries = await f.ok("GET", `${path}/canvases/${canvasId}/generation-plans`);
  expect(entries.items).toHaveLength(1);
  expect(entries.items[0].plan.input.prompt).toBe("第一稿：雨夜中的门。");
  const jobId = entries.items[0].jobId;
  // Rule 6: with a fixed plan the model and specification are frozen; the prompt is read-only.
  await expect(panel.getByRole("button", { name: "生成模型", exact: true })).toBeDisabled();
  await expect(panel.getByRole("textbox", { name: "提示词", exact: true })).toHaveCount(0);

  // Rule 14: keep the original task and prepare the next draft.
  await panel.getByRole("button", { name: "保留原任务，准备下一张图片", exact: true }).click();
  await panel.getByRole("textbox", { name: "提示词", exact: true }).fill("下一稿：靠近人物的眼睛。");
  await expect(page.getByRole("button", { name: "创作台保存状态：已保存", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "创作台保存状态：已保存", exact: true })).toBeVisible();
  await board.getByRole("article", { name: "图片 1 · 图片", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "提示词", exact: true })).toHaveValue("下一稿：靠近人物的眼睛。");
  const current = await f.ok("GET", `${path}/canvases/${canvasId}`);
  expect(current.document.nodes[0].content.prompt).toBe("下一稿：靠近人物的眼睛。");
  expect((await f.job(jobId)).status).toBe("queued");
  expect(plans).toBe(1);
  expect(jobs).toBe(1);
  await expect(board.getByRole("article", { name: "图片 1 · 图片", exact: true })).toBeVisible();
});

test("ST-03: a lost execution reply is recovered by reading the original job; the unknown submission is never repeated", async ({ page, generation: f }) => {
  const project = await f.createProject("原提交核对 · 创作台");
  const path = `${f.base}/projects/${project.id}`;
  const ensured = await f.request("POST", `${path}/canvas`);
  const canvas = ensured.json().canvas;
  const node = {
    id: crypto.randomUUID(), kind: "image", title: "固定尝试", width: 360, position: { x: 240, y: 200 },
    content: { type: "draft", prompt: "固定的画面", connectionId: f.input.connectionId, capabilityId: f.input.capabilityId, output: f.input.output },
  };
  await f.ok("PUT", `${path}/canvases/${canvas.id}`, { schemaVersion: 1, document: { nodes: [node], edges: [], groups: [] } }, canvas.revision);
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
  await openStudio(page, f, project.id);
  const board = page.getByRole("main", { name: "创作台", exact: true });
  await board.getByRole("article", { name: "固定尝试 · 图片", exact: true }).click();
  const panel = page.getByRole("region", { name: "生成图片", exact: true });
  await panel.getByRole("button", { name: "生成图片", exact: true }).click();
  await expect(panel.getByRole("button", { name: "核对后恢复原提交", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "创作台保存状态：已保存", exact: true })).toBeVisible();
  await board.getByRole("article", { name: "固定尝试 · 图片", exact: true }).click();
  // The original job is found by its plan and read back as an unknown submission.
  await expect(panel.getByRole("status")).toHaveText(/提交(结果)?待核对/);
  await expect(panel.getByRole("button", { name: "保留原任务，准备下一张图片", exact: true })).toHaveCount(0);
  expect(posts).toBe(1);
  expect(f.calls()).toBe(1);
});

test("ST-03: a revoked collaborator's panel turns into the access recheck and the board hides the project", async ({ page, context, generation: f }) => {
  const project = await f.createProject("撤权 · 创作台");
  const path = `${f.base}/projects/${project.id}`;
  const ensured = await f.request("POST", `${path}/canvas`);
  const canvas = ensured.json().canvas;
  const node = {
    id: crypto.randomUUID(), kind: "image", title: "协作草稿", width: 360, position: { x: 240, y: 200 },
    content: { type: "draft", prompt: "", output: {} },
  };
  await f.ok("PUT", `${path}/canvases/${canvas.id}`, { schemaVersion: 1, document: { nodes: [node], edges: [], groups: [] } }, canvas.revision);
  const collaborator = await f.identity("canvas-collaborator");
  const membershipId = crypto.randomUUID();
  await f.admin.query(
    `INSERT INTO "${f.schema}".memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')`,
    [membershipId, f.tenant.id, collaborator.userId],
  );
  const grant = await f.ok("POST", `${path}/members`, { membershipId });
  await context.clearCookies();
  await context.addCookies([{ name: "session", value: collaborator.token, url: f.origin, httpOnly: true, sameSite: "Lax" }]);
  await openStudio(page, f, project.id);
  const board = page.getByRole("main", { name: "创作台", exact: true });
  await board.getByRole("article", { name: "协作草稿 · 图片", exact: true }).click();
  const panel = page.getByRole("region", { name: "生成图片", exact: true });
  await expect(panel.getByRole("button", { name: "生成模型", exact: true })).toBeVisible();
  await f.ok("DELETE", `${path}/members/${membershipId}`, undefined, grant.revision);
  await page.reload();
  await expect(page.getByText("你已没有这个工作室的访问权限。", { exact: false }).or(page.getByRole("alert")).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^创作台保存状态：/ })).toHaveCount(0);
  await expect(page).not.toHaveTitle(new RegExp(project.name));
  expect((await f.request("GET", `${path}/canvas`, undefined, undefined, undefined, collaborator)).statusCode).toBe(404);
});
