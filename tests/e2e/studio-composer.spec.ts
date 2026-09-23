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
  // One size is the only tier this fixture has, so the panel states it.
  await expect(spec.getByRole("button", { name: "32x32", exact: true })).toHaveCount(0);
  await expect(spec).toContainText("32x32");
  const specShot = info.outputPath("studio-spec-picker-1920.png");
  await page.screenshot({ path: specShot, animations: "disabled" });
  await info.attach("studio-spec-picker-1920", { path: specShot, contentType: "image/png" });
  await page.keyboard.press("Escape");
  await expect(spec).toHaveCount(0);

  // One row per model: two records differing only in mode collapse into one.
  await panel.getByRole("button", { name: "生成模型", exact: true }).click();
  const list = page.getByRole("listbox", { name: "可用模型", exact: true });
  await expect(list.getByRole("option", { name: /双模式 fixture/ })).toHaveCount(1);
  await list.getByRole("option", { name: /双模式 fixture/ }).click();
  // The mode is chosen beside the model, not inside its row.
  const modePill = panel.getByRole("button", { name: "进料方式", exact: true });
  await expect(modePill).toContainText("首尾帧");
  await modePill.click();
  await page.getByRole("option", { name: "参考图", exact: true }).click();
  await expect(modePill).toContainText("参考图");
  // Three ratios on offer; 21:9 is the model's, not the panel's.
  await panel.getByRole("button", { name: "生成规格", exact: true }).click();
  await expect(spec.getByRole("button", { name: "21:9", exact: true })).toHaveCount(0);
  await spec.getByRole("button", { name: "16:9", exact: true }).click();
  await spec.getByRole("button", { name: "720p", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button", { name: "生成规格", exact: true })).toContainText("16:9 · 720p");
  // 9:16 has one tier here, so the panel states it — and still fills the size in.
  await panel.getByRole("button", { name: "生成规格", exact: true }).click();
  await spec.getByRole("button", { name: "9:16", exact: true }).click();
  await expect(spec.getByRole("button", { name: "720p", exact: true })).toHaveCount(0);
  await expect(spec).toContainText("720p");
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button", { name: "生成规格", exact: true })).toContainText("9:16 · 720p");
  // Back to the fixture: a model with one mode shows no pill, and only a
  // fixture may be submitted in this suite.
  await panel.getByRole("button", { name: "生成模型", exact: true }).click();
  await page.getByRole("option", { name: /显式文件 fixture/ }).click();
  await expect(panel.getByRole("button", { name: "进料方式", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "生成规格", exact: true })).toContainText("1:1 · 32x32");

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
  await expect(panel.getByRole("button", { name: "进料方式", exact: true })).toHaveCount(0);
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

test("ST-03: a draft carrying a ratio but no size can still choose its only tier", async ({ page, generation: f }) => {
  // Drafts saved while the ratio was an independent optional toggle can hold a
  // ratio and no size. A ratio with one tier states that tier rather than
  // offering a button, so such a draft must still be able to take it — or the
  // size can never be set and the submission is refused.
  const project = await f.createProject("单档位补齐 · 创作台");
  const path = `${f.base}/projects/${project.id}`;
  const canvas = (await f.request("POST", `${path}/canvas`)).json().canvas;
  const reference = f.dualMode.find((c) => c.mode === "reference_v1")!;
  const node = {
    id: crypto.randomUUID(), kind: "image", title: "旧草稿", width: 360, position: { x: 240, y: 200 },
    content: {
      type: "draft", prompt: "竖幅的门。",
      connectionId: f.input.connectionId, capabilityId: reference.id,
      output: { aspectRatio: "9:16" },
    },
  };
  await f.ok("PUT", `${path}/canvases/${canvas.id}`, { schemaVersion: 1, document: { nodes: [node], edges: [], groups: [] } }, canvas.revision);
  await openStudio(page, f, project.id);
  await page.getByRole("main", { name: "创作台", exact: true })
    .getByRole("article", { name: "旧草稿 · 图片", exact: true }).click();
  const panel = page.getByRole("region", { name: "生成图片", exact: true });
  await panel.getByRole("button", { name: "生成规格", exact: true }).click();
  const spec = page.getByRole("group", { name: "生成规格", exact: true });
  await expect(spec.getByRole("button", { name: "9:16", exact: true })).toHaveAttribute("aria-pressed", "true");
  await spec.getByRole("button", { name: "720p", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button", { name: "生成规格", exact: true })).toContainText("9:16 · 720p");
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

test("ST-04: selecting several drafts is not submitting; the batch review opens from the menu and prepares only", async ({ page, generation: f }) => {
  const project = await f.createProject("批量生成 · 创作台");
  const path = `${f.base}/projects/${project.id}`;
  const ensured = await f.request("POST", `${path}/canvas`);
  const canvasId = ensured.json().canvas.id;
  const draftNode = (title: string, prompt: string, x: number) => ({
    id: crypto.randomUUID(), kind: "image" as const, title, width: 320, position: { x, y: 200 },
    content: { type: "draft" as const, prompt, connectionId: f.input.connectionId, capabilityId: f.input.capabilityId, output: f.input.output },
  });
  await f.ok("PUT", `${path}/canvases/${canvasId}`, {
    schemaVersion: 1, document: { nodes: [draftNode("第一镜", "雨夜便利店门口，女主回头", 240), draftNode("第二镜", "推门而入，暖光落在肩上", 700)], edges: [], groups: [] },
  }, ensured.json().canvas.revision);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/(generation-jobs|generation-batches|generation-plans|canvas-generation-batches)/.test(request.url()))
      writes.push(request.url().replace(f.origin, ""));
  });
  await openStudio(page, f, project.id);
  const board = page.getByRole("main", { name: "创作台", exact: true });
  const first = board.getByRole("article", { name: "第一镜 · 图片", exact: true });
  const second = board.getByRole("article", { name: "第二镜 · 图片", exact: true });
  await first.click();
  await second.click({ modifiers: ["Shift"] });
  await expect(first.locator("xpath=..")).toHaveAttribute("data-selected", "true");
  await expect(second.locator("xpath=..")).toHaveAttribute("data-selected", "true");
  await second.click({ button: "right" });
  expect(writes).toHaveLength(0);
  await page.getByRole("menuitem", { name: "查看 2 项的生成计划", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/这一步只准备计划，不会提交任何生成。/)).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(0);
});
