import { test, expect } from "./canvas-generation-fixture.js";

/**
 * The multi-selection only offers to *review* a preparation; every paid submission
 * happens inside the confirmation panel. This runs the real browser path against the
 * real API and the explicit local fixture adapter.
 */
test("CW-BATCH: multi-select reviews one plan per node and submits only on confirmation", async ({
  page,
  generation: f,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const project = await f.createProject("批量生成 · 合成验收");
  const path = `${f.base}/projects/${project.id}`;
  const ensured = await f.request("POST", `${path}/canvas`);
  expect(ensured.statusCode).toBe(200);
  const canvasId = ensured.json().canvas.id;
  await page.goto(`${f.origin}/#/app/t/${f.tenant.id}/p/${project.id}/canvas`);
  await expect(
    page.getByRole("button", { name: "画布保存状态：已保存", exact: true }),
  ).toBeVisible();

  // The two drafts are persisted through the API so this spec exercises the batch
  // path itself: selection, review and confirmation in the browser, nothing else.
  const draftNode = (title: string, prompt: string) => ({
    id: crypto.randomUUID(),
    kind: "image" as const,
    title,
    width: 320,
    position: { x: 100, y: 100 },
    content: {
      type: "draft" as const,
      prompt,
      connectionId: f.input.connectionId,
      capabilityId: f.input.capabilityId,
      output: f.input.output,
    },
  });
  const drafts = [
    draftNode("第一镜", "雨夜便利店门口，女主回头"),
    draftNode("第二镜", "推门而入，暖光落在肩上"),
  ];
  const saved = await f.ok(
    "PUT",
    `${path}/canvases/${canvasId}`,
    { schemaVersion: 1, document: { nodes: drafts, edges: [], groups: [] } },
    ensured.json().canvas.revision,
  );
  expect(saved.document.nodes).toHaveLength(2);

  // Watch every write this flow could use. The batch submits jobs server-side, so
  // watching only /generation-jobs would miss a submission triggered by opening the
  // panel and make the "selecting is not submitting" assertions vacuous.
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(generation-jobs|generation-batches|generation-plans|canvas-generation-batches)/.test(
        request.url(),
      )
    )
      writes.push(request.url().replace(f.origin, ""));
  });

  await page.getByRole("button", { name: "查找画布内容", exact: true }).click();
  // The node list names each node by title and kind; the second click extends the
  // selection exactly like a user's Shift-click.
  const listed = page
    .getByRole("region", { name: "画布查找与定位" })
    .getByRole("button", { name: /^第一镜$|^第二镜$/ });
  await expect(listed).toHaveCount(2);
  const first = listed.nth(0);
  const second = listed.nth(1);
  await first.click();
  await second.click({ modifiers: ["Shift"] });

  // Selecting is not submitting.
  const review = page.getByRole("button", {
    name: "查看 2 项的生成计划",
    exact: true,
  });
  await expect(review).toBeVisible();
  expect(writes).toHaveLength(0);

  await review.click();
  const panel = page.getByRole("dialog");
  await expect(
    panel.getByText(/这一步只准备计划，不会提交任何生成。/),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "查看 2 项的生成计划", exact: true })
    .click();

  // The confirmation lists one row per node with its own status and reservation.
  await expect(panel.getByText(/2 项可执行 · 2 项已列出/)).toBeVisible();
  await expect(panel.getByText(/合计本次预留：0 CNY/)).toBeVisible();
  await expect(panel.getByText("第一镜", { exact: true })).toBeVisible();
  await expect(panel.getByText("第二镜", { exact: true })).toBeVisible();
  // The resolved input the plan will send is on screen, not just the node's name.
  await expect(
    panel.getByText("雨夜便利店门口，女主回头", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("推门而入，暖光落在肩上", { exact: true }),
  ).toBeVisible();
  // The panel has prepared plans, but submitted nothing: the only write so far is
  // the prepare call itself.
  expect(writes.some((url) => /generation-batches/.test(url))).toBe(true);
  expect(writes.filter((url) => /execute|generation-jobs/.test(url))).toHaveLength(0);

  const submit = panel.getByRole("button", { name: "提交 2 项生成", exact: true });
  await expect(submit).toBeDisabled();
  await panel
    .getByRole("checkbox", { name: /我确认按上面列出的 2 项提交生成/ })
    .check();
  await submit.click();
  await expect(panel.getByText(/0 项可执行 · 2 项已列出/)).toBeVisible();

  // The batch is grouping only: two independent queued jobs, and nothing adopted.
  const jobs = await f.ok(
    "GET",
    `${f.base}/generation-jobs?scope=project&projectId=${project.id}`,
  );
  expect(jobs.items).toHaveLength(2);
  for (const job of jobs.items) expect(job.status).toBe("queued");
  const content = await f.ok("GET", `${path}/content`);
  expect(content.shots).toHaveLength(0);
  const takes = await f.ok("GET", `${path}/takes`);
  expect(takes.items).toHaveLength(0);

  await page.screenshot({
    path: "output/reviews/2026-09-18-workspace-usability-round-2/probes/canvas-batch-confirmation.png",
    animations: "disabled",
  });
  await info.attach("canvas-batch-confirmation", {
    body: await page.screenshot({ animations: "disabled" }),
    contentType: "image/png",
  });
});
