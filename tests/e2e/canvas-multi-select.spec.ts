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
test("CW-BATCH-2/3: the canvas never registers or adopts, and shot candidates stay shot-scoped", async ({
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
  const nodeId = randomUUID(),
    looseNodeId = randomUUID();
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
          {
            id: looseNodeId,
            kind: "video",
            title: "未关联蓝片",
            position: { x: 480, y: 80 },
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

  // --- #3 forward: the canvas never registers a candidate ---------------------
  // Creating one is a shot-scoped decision, and nothing on a result node says which
  // shot a clip belongs to, so the canvas offers no registration control at all.
  await page.getByRole("button", { name: "查找画布内容", exact: true }).click();
  await page
    .getByRole("region", { name: "画布查找与定位" })
    .getByRole("button", { name: "合成蓝片", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "登记为镜头候选", exact: true }),
  ).toHaveCount(0);
  // Selecting a result node is not a decision: nothing is registered or adopted.
  expect((await seeded.takes()).items).toHaveLength(takesBefore);
  expect((await seeded.selection()).currentSelection?.takeId).toBe(
    adoptedBefore,
  );

  // --- #3: a shot's candidates are reachable from its own workspace -----------
  // The legacy deep link still reads that workspace, and looking at a candidate
  // adopts nothing.
  await page.goto(
    `${w.runtime.origin}${w.basePath}/production?scene=${w.scene.id}&mode=storyboard&shot=${seeded.shot.id}`,
  );
  await page.getByRole("button", { name: "候选与历史", exact: true }).click();
  const dock = page.getByRole("complementary", { name: "制作辅助面板" });
  const candidates = dock.getByRole("link", { name: /^查看候选 \d+/ });
  await expect(candidates.first()).toBeVisible();
  await candidates.nth(1).click();
  expect((await seeded.takes()).items).toHaveLength(takesBefore);
  expect((await seeded.selection()).currentSelection?.takeId).toBe(
    adoptedBefore,
  );

  // --- #3 reverse: the candidate that came from the canvas links back --------
  const link = dock.getByRole("link", { name: "在画布上查看来源节点" });
  await expect(link).toHaveCount(1);
  expect(await link.getAttribute("href")).toContain(`node=${nodeId}`);
  // Following it must land on that node: the canvas selects it, not merely opens.
  await link.click();
  await expect(
    page.getByRole("button", { name: "画布保存状态：已保存", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("已选 · 合成蓝片", { exact: true })).toBeVisible();
  await expect(page.getByText("已选 · 未关联蓝片", { exact: true })).toHaveCount(0);

  // Nothing in this whole flow adopted a candidate or produced an extra one.
  expect((await seeded.selection()).currentSelection?.takeId).toBe(
    adoptedBefore,
  );
  expect((await seeded.takes()).items).toHaveLength(takesBefore);
});
