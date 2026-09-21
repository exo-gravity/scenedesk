import { test, expect } from "./continuous-workspace-fixture.js";

test.use({ viewport: { width: 1920, height: 902 } });

test("ST-04: a result fills its card, stays after a reload, is placed explicitly and is listed in the card's history", async ({ page, continuous: f }, info) => {
  test.setTimeout(120_000);
  await page.goto(`${f.origin}/#/app/t/${f.tenant.id}/p/${f.project.id}/studio`);
  const status = page.getByRole("button", { name: "创作台保存状态：已保存", exact: true });
  await expect(status).toBeVisible();
  const board = page.getByRole("main", { name: "创作台", exact: true });

  // The seeded reference image continues into a video draft with the image as its reference.
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
  await expect(panel.getByRole("button", { name: "生成规格", exact: true })).toContainText("4 秒");
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
  expect(first.plan.resolvedInput.references).toHaveLength(1);
  expect(first.plan.resolvedInput.references[0].reference.mediaId).toBe(f.canvas.document.nodes[0].content.mediaId);

  // The synthetic worker finishes the job; the card fills with the result and the tag goes away.
  await f.completeVideo(first.jobId);
  await panel.getByRole("button", { name: "核对视频任务", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("结果已就绪");
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
