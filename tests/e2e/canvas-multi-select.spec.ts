import { randomUUID } from "node:crypto";
import type { components } from "@drama/contracts";
import { test as base, expect, startWorkspaceRuntime } from "./fixture.js";
import { startShotMedia } from "./shot-media.js";
import { seedShotList } from "./shot-list-fixture.js";
type Schema<K extends keyof components["schemas"]> = components["schemas"][K];

/** Candidates reference real media, so the browser needs the isolated store. */
const test = base.extend({
  runtime: [
    async ({}, use) => {
      const storage = await startShotMedia();
      try {
        const runtime = await startWorkspaceRuntime({ media: storage.media });
        try {
          await use(runtime);
        } finally {
          await runtime.stop();
        }
      } finally {
        await storage.stop();
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],
});

/**
 * Step 1's #2 and #3. Batch here means reviewing and comparing side by side —
 * never adopting, and never submitting paid work.
 */
test("CW-BATCH-2/3: multi-select reviews and compares, and never adopts", async ({
  page,
  workspace: w,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seeded = await seedShotList(w);
  // A second candidate for the same shot so a comparison has two sides.
  await w.command<Schema<"Take">>("POST", `${w.path}/takes`, {
    shotId: seeded.shot.id,
    shotRevisionId: seeded.shot.specRevisionId,
    mediaId: seeded.blue.id,
    range: { inUs: 0, outUs: 2000000 },
    note: "受控蓝片；不是供应商验收。",
  });
  // The scene canvas carries the result node; the binding route is scene-scoped.
  // Ensuring a scene canvas is idempotent and answers 200, not 201.
  const ensuredScene = await w.runtime.request<Schema<"SceneCanvas">>(
    w.owner,
    "POST",
    `${w.path}/scenes/${w.scene.id}/canvas`,
  );
  expect(ensuredScene.status).toBe(200);
  const sceneCanvas = ensuredScene.value;
  const nodeId = randomUUID();
  const saved = await w.command<Schema<"Canvas">>(
    "PUT",
    `${w.path}/canvases/${sceneCanvas.canvas.id}`,
    {
      schemaVersion: 1,
      document: {
        nodes: [
          {
            id: nodeId,
            kind: "video",
            title: "合成蓝片",
            position: { x: 80, y: 80 },
            width: 320,
            content: { type: "media", mediaId: seeded.blue.id },
          },
        ],
        edges: [],
        groups: [],
      },
    },
    sceneCanvas.canvas.revision,
  );
  const bound = await w.command<Schema<"SceneCanvas">>(
    "POST",
    `${w.path}/scenes/${w.scene.id}/canvas/nodes/${nodeId}/shot-bindings`,
    {
      role: "candidate",
      shotId: seeded.shot.id,
      shotRevisionId: seeded.shot.specRevisionId,
      range: { inUs: 0, outUs: 1500000 },
    },
    saved.revision,
  );
  const boundTakeId = bound.bindings.find(
    (binding) => binding.nodeId === nodeId && binding.role === "candidate",
  )!.takeId!;
  expect(boundTakeId).toBeTruthy();

  const adoptedBefore = (await seeded.selection()).currentSelection?.takeId;
  const takesBefore = (await seeded.takes()).items.length;

  await page.goto(
    `${w.runtime.origin}${w.basePath}/production?scene=${w.scene.id}&mode=canvas`,
  );
  await expect(
    page.getByRole("button", { name: "画布保存状态：已保存", exact: true }),
  ).toBeVisible();

  // --- #3 forward: a result node opens the candidate form, pre-filled --------
  await page.getByRole("button", { name: "查找画布内容", exact: true }).click();
  await page
    .getByRole("region", { name: "画布查找与定位" })
    .getByRole("button", { name: "合成蓝片", exact: true })
    .click();
  const register = page.getByRole("button", {
    name: "登记为镜头候选",
    exact: true,
  });
  await expect(register).toBeVisible();
  // Offering the form must not have created anything yet.
  expect((await seeded.takes()).items).toHaveLength(takesBefore);
  await register.click();
  // The role and the interval are pre-filled: only the shot is the user's call,
  // because nothing in the canvas says which shot this clip belongs to.
  await expect(
    page.getByRole("combobox", { name: "关联到本场镜头", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("textbox", { name: "候选入点（秒）", exact: true }),
  ).toHaveValue("0");
  await expect(
    page.getByRole("textbox", { name: "候选出点（秒）", exact: true }),
  ).not.toHaveValue("");
  // Still nothing registered: the form is a form, not an adoption.
  expect((await seeded.takes()).items).toHaveLength(takesBefore);
  expect((await seeded.selection()).currentSelection?.takeId).toBe(
    adoptedBefore,
  );

  // --- #2: select two shots and review their candidates side by side ---------
  await page.getByRole("button", { name: "镜头列表", exact: true }).click();
  const list = page.getByRole("dialog", { name: "镜头列表", exact: true });
  await expect(list).toBeVisible();
  await list
    .getByRole("button", { name: /^1\. 01 推门/ })
    .click({ modifiers: ["Shift"] });
  await list
    .getByRole("button", { name: /^2\. 02 阅读/ })
    .click({ modifiers: ["Shift"] });
  const review = list.getByRole("button", {
    name: "查看 2 个镜头的候选",
    exact: true,
  });
  await expect(review).toBeVisible();
  // One shot's read fails while the other succeeds, so the review has to keep the
  // two independent: the broken column reports itself and the healthy one still
  // reads.
  await page.route("**/takes?shotId=*", async (route) => {
    const shotId = new URL(route.request().url()).searchParams.get("shotId");
    if (shotId === seeded.second.id)
      return route.fulfill({ status: 500, body: "{}" });
    return route.continue();
  });
  await review.click();
  const overview = page.getByRole("dialog", { name: "2 个镜头的候选" });
  await expect(overview).toBeVisible();
  await expect(
    overview.getByText(/只读取候选，不改变任何镜头的采用/),
  ).toBeVisible();
  const firstColumn = overview.getByRole("region", { name: "01 推门 的候选" });
  const secondColumn = overview.getByRole("region", { name: "02 阅读 的候选" });
  await expect(firstColumn.getByText("候选 1", { exact: true })).toBeVisible();
  await expect(secondColumn.getByRole("alert")).toBeVisible();

  // The failed column recovers in place once the read works again.
  await page.unroute("**/takes?shotId=*");
  await secondColumn
    .getByRole("button", { name: "重新读取", exact: true })
    .click();
  await expect(
    secondColumn.getByText("还没有候选。", { exact: true }),
  ).toBeVisible();
  // Reviewing decided nothing, before or after the failure.
  expect((await seeded.selection()).currentSelection?.takeId).toBe(
    adoptedBefore,
  );
  await page.keyboard.press("Escape");

  // --- #2: select two candidates and compare them ----------------------------
  // Candidates live in the shot's own production workspace, not in the list.
  await page.goto(
    `${w.runtime.origin}${w.basePath}/production?scene=${w.scene.id}&mode=storyboard&shot=${seeded.shot.id}`,
  );
  await page.getByRole("button", { name: "候选与历史", exact: true }).click();
  const dock = page.getByRole("complementary", { name: "制作辅助面板" });
  const candidates = dock.getByRole("link", { name: /^查看候选 \d+$/ });
  await expect(candidates.first()).toBeVisible();
  // Probe: a plain click focuses one candidate, and that focus must not wipe the set.
  await candidates.nth(0).click({ modifiers: ["Shift"] });
  await candidates.nth(1).click({ modifiers: ["Shift"] });
  await expect(candidates.nth(0)).toHaveAttribute("data-batch", "true");
  await expect(candidates.nth(1)).toHaveAttribute("data-batch", "true");
  // Looking at a third candidate must not disturb the pair already picked, and
  // looking is not selecting.
  await candidates.nth(2).click();
  await expect(candidates.nth(0)).toHaveAttribute("data-batch", "true");
  await expect(candidates.nth(1)).toHaveAttribute("data-batch", "true");
  await expect(candidates.nth(2)).not.toHaveAttribute("data-batch", "true");
  const compare = dock.getByRole("button", {
    name: "比较所选候选",
    exact: true,
  });
  await expect(compare).toBeVisible();
  await compare.click();
  const comparison = page.getByRole("dialog", { name: /比较 2 份候选/ });
  await expect(comparison).toBeVisible();
  await expect(comparison.getByText(/不改变镜头采用/).first()).toBeVisible();
  // Comparing is a read: it selected nothing for the shot.
  expect((await seeded.selection()).currentSelection?.takeId).toBe(
    adoptedBefore,
  );
  await page.keyboard.press("Escape");

  // --- #3 reverse: the candidate that came from the canvas links back --------
  const link = dock.getByRole("link", { name: "在画布上查看来源节点" });
  await expect(link).toHaveCount(1);
  expect(await link.getAttribute("href")).toContain(`node=${nodeId}`);

  // Nothing in this whole flow adopted a candidate or produced an extra one.
  expect((await seeded.selection()).currentSelection?.takeId).toBe(
    adoptedBefore,
  );
  expect((await seeded.takes()).items).toHaveLength(takesBefore);
});
