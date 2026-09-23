import type { Page } from "@playwright/test";
import { test, expect } from "./continuous-workspace-fixture.js";

test.use({ viewport: { width: 1920, height: 902 } });

type Continuous = Parameters<Parameters<typeof test>[2]>[0]["continuous"];

/** The seeded reference image continues into a video draft, which the synthetic worker completes. */
async function produceVideo(page: Page, f: Continuous) {
  await page.goto(`${f.origin}/#/app/t/${f.tenant.id}/p/${f.project.id}/studio`);
  const status = page.getByRole("button", { name: "创作台保存状态：已保存", exact: true });
  await expect(status).toBeVisible();
  const board = page.getByRole("main", { name: "创作台", exact: true });
  const reference = board.getByRole("article", { name: "合成参考图 · 图片", exact: true });
  await reference.click();
  await page.getByRole("button", { name: "继续创作", exact: true }).click();
  const plusMenu = page.getByRole("menu").filter({ hasNot: page.getByRole("menuitem", { name: "文字", exact: true }) });
  await plusMenu.getByRole("menuitem", { name: "视频", exact: true }).click();
  const panel = page.getByRole("region", { name: "生成视频", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: /合成参考图 · 构图/ })).toBeVisible();
  await panel.getByRole("textbox", { name: "提示词", exact: true }).fill("第一段：雨夜窗边，缓慢推近。");
  await panel.getByRole("button", { name: "生成模型", exact: true }).click();
  await page.getByRole("option", { name: /Local Video Demo/ }).click();
  await expect(panel.getByRole("button", { name: "生成规格", exact: true })).toContainText("4s");
  let jobPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/generation-jobs")) jobPosts++;
  });
  await panel.getByRole("button", { name: "生成视频", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("排队中");
  const video = board.getByRole("article", { name: "新的视频草稿 · 视频", exact: true });
  await expect(video.getByRole("status")).toHaveText("排队中");
  const entries = () => f.ok("GET", `${f.path}/canvases/${f.canvas.id}/generation-plans`);
  const first = (await entries()).items[0];
  await f.completeVideo(first.jobId);
  await panel.getByRole("button", { name: "核对视频任务", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("结果已就绪");
  return { status, board, panel, video, first, jobPosts: () => jobPosts };
}

test("ST-04: a result fills its card, stays after a reload, is placed explicitly and is listed in the card's history", async ({ page, continuous: f }, info) => {
  test.setTimeout(120_000);
  const { status, board, panel, video, first, jobPosts: posted } = await produceVideo(page, f);
  const jobPosts = posted();
  expect(first.plan.resolvedInput.references).toHaveLength(1);
  expect(first.plan.resolvedInput.references[0].reference.mediaId).toBe(f.canvas.document.nodes[0].content.mediaId);
  // The synthetic media has no poster yet, so the frame holds the result placeholder rather than a picture.
  await expect(video.locator("[data-result]")).toBeVisible();
  await expect(video.getByRole("status")).toHaveCount(0);
  const resultShot = info.outputPath("studio-result-1920.png");
  await page.screenshot({ path: resultShot, animations: "disabled" });
  await info.attach("studio-result-1920", { path: resultShot, contentType: "image/png" });

  // Rules 10, 11, 21: explicit placement puts the archived result on the board as its own card.
  const before = await f.ok("GET", `${f.path}/canvases/${f.canvas.id}`);
  expect(before.document.nodes).toHaveLength(3);
  await panel.getByRole("button", { name: "添加到创作台", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认添加视频结果", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "确认添加到创作台", exact: true }).click();
  await expect(panel.getByText("已添加到创作台", { exact: true })).toBeVisible();
  const placed = await f.ok("GET", `${f.path}/canvases/${f.canvas.id}`);
  expect(placed.document.nodes).toHaveLength(4);
  expect(placed.document.nodes.find((node: any) => node.content.mediaId === first.jobId)).toBeTruthy();
  expect((await f.ok("GET", `${f.path}/takes`)).items).toHaveLength(0);
  expect(jobPosts).toBe(1);
  expect(f.videoCalls()).toBe(1);

  // After a reload the result is still in the draft's frame, and the history lists the attempt.
  await page.reload();
  await expect(status).toBeVisible();
  await expect(video.locator("[data-result]")).toBeVisible();
  await video.click();
  await panel.getByRole("button", { name: "尝试与结果", exact: true }).click();
  const history = page.getByRole("dialog", { name: /^尝试与结果/ });
  await expect(history.getByRole("button", { name: /^查看固定尝试/ })).toHaveCount(1);
  await history.getByRole("button", { name: /^查看固定尝试/ }).click();
  // Opening an attempt retitles the dialog to the fixed attempt.
  const attempt = page.getByRole("dialog", { name: /^固定尝试/ });
  await expect(attempt.getByLabel("固定提示词", { exact: true })).toHaveText("第一段：雨夜窗边，缓慢推近。");
  await expect(attempt.getByText("结果已就绪", { exact: false })).toBeVisible();
});

test("ST-04: a placement refused for a changed board is re-reviewed, and the result is added once", async ({ page, continuous: f }) => {
  test.setTimeout(120_000);
  const { panel, first } = await produceVideo(page, f);
  const statuses: number[] = [];
  page.on("response", (response) => {
    if (response.request().method() === "POST" && /\/canvases\/[^/]+\/results$/.test(response.url())) statuses.push(response.status());
  });
  await panel.getByRole("button", { name: "添加到创作台", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认添加视频结果", exact: true });
  await expect(dialog).toBeVisible();
  // Someone else changes the board while the placement is being reviewed.
  const current = await f.ok("GET", `${f.path}/canvases/${f.canvas.id}`);
  await f.ok("PUT", `${f.path}/canvases/${f.canvas.id}`, {
    schemaVersion: 1,
    document: { ...current.document, nodes: [...current.document.nodes, {
      id: "11111111-1111-4111-8111-111111111111", kind: "text", title: "别处的修改", position: { x: 900, y: 40 }, width: 240,
      content: { type: "text", text: "另一个人在放置前加的说明。" },
    }] },
  }, current.revision);
  await dialog.getByRole("button", { name: "确认添加到创作台", exact: true }).click();
  // Rule 11: the stale If-Match is refused; the panel says so and offers a fresh review, nothing was added.
  await expect(panel.getByText("创作台已有修改，视频未添加", { exact: true })).toBeVisible();
  expect(statuses).toEqual([412]);
  let afterRefusal = await f.ok("GET", `${f.path}/canvases/${f.canvas.id}`);
  expect(afterRefusal.document.nodes.filter((node: any) => node.content.mediaId === first.jobId)).toHaveLength(0);
  await panel.getByRole("button", { name: "重新核对添加位置", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "确认添加到创作台", exact: true }).click();
  await expect(panel.getByText("已添加到创作台", { exact: true })).toBeVisible();
  expect(statuses).toEqual([412, 201]);
  afterRefusal = await f.ok("GET", `${f.path}/canvases/${f.canvas.id}`);
  expect(afterRefusal.document.nodes).toHaveLength(5);
  expect(afterRefusal.document.nodes.filter((node: any) => node.content.mediaId === first.jobId)).toHaveLength(1);
  expect(afterRefusal.document.nodes.some((node: any) => node.title === "别处的修改")).toBe(true);
  expect(f.videoCalls()).toBe(1);
});

test("ST-04: a placement whose reply is lost is recovered after a reload through the same request, never a second card", async ({ page, continuous: f }) => {
  test.setTimeout(120_000);
  const { status, panel, video, first } = await produceVideo(page, f);
  const keys: string[] = [];
  await page.route("**/canvases/*/results", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"] ?? JSON.stringify(route.request().postDataJSON()));
    const response = await route.fetch(); // The real API places the result before the client loses the reply.
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await panel.getByRole("button", { name: "添加到创作台", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认添加视频结果", exact: true });
  await dialog.getByRole("button", { name: "确认添加到创作台", exact: true }).click();
  // Rule 12: only "恢复本次添加" is offered; the board already holds the card on the server.
  await expect(panel.getByRole("button", { name: "恢复本次添加", exact: true })).toBeVisible();
  const placed = await f.ok("GET", `${f.path}/canvases/${f.canvas.id}`);
  expect(placed.document.nodes.filter((node: any) => node.content.mediaId === first.jobId)).toHaveLength(1);
  await page.unroute("**/canvases/*/results");
  await page.reload();
  await expect(status).toBeVisible();
  await video.click();
  await panel.getByRole("button", { name: "恢复本次添加", exact: true }).click();
  await expect(panel.getByText("已添加到创作台", { exact: true })).toBeVisible();
  const recovered = await f.ok("GET", `${f.path}/canvases/${f.canvas.id}`);
  expect(recovered.document.nodes.filter((node: any) => node.content.mediaId === first.jobId)).toHaveLength(1);
  expect(recovered.document.nodes).toHaveLength(4);
  expect(keys).toHaveLength(1);
  expect(f.videoCalls()).toBe(1);
});
