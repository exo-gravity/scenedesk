import { randomUUID } from "node:crypto";
import type { components } from "@drama/contracts";
import { test, expect, type WorkspaceFixture } from "./fixture.js";

type Schema<K extends keyof components["schemas"]> = components["schemas"][K];

async function emptyProject(w: WorkspaceFixture) {
  const project = await w.command<Schema<"Project">>("POST", `${w.tenantPath}/projects`, {
    name: "雨夜来信", leadMembershipId: w.project.leadMembershipId, spec: w.project.spec,
  });
  const path = `${w.tenantPath}/projects/${project.id}`;
  const content = () => w.command<Schema<"ContentTree">>("GET", `${path}/content`);
  const url = `${w.runtime.origin}/#/app/t/${w.tenant.id}/p/${project.id}/studio/shots`;
  return { project, path, content, url };
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

test("an empty project offers a centered action and creates its first scene and shot without leaving the organizer", async ({ page, workspace: w }, info) => {
  const p = await emptyProject(w);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(p.url);
  const empty = page.getByRole("region", { name: "还没有场次", exact: true });
  const start = empty.getByRole("button", { name: "新建场次", exact: true });
  await expect(start).toBeVisible();
  await expect(page.getByRole("combobox", { name: "查看场次" })).toHaveCount(0);
  await expect(page.getByText("0 镜头 · 0 已选用", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "调整顺序", exact: true })).toHaveCount(0);
  const box = (await start.boundingBox())!;
  expect(box.y).toBeGreaterThan(300);
  expect(box.y + box.height).toBeLessThan(600);
  await page.screenshot({ path: info.outputPath("no-scenes-light.png"), animations: "disabled" });
  await page.getByRole("button", { name: "账号与退出登录", exact: true }).click();
  await page.getByRole("menuitem", { name: "切换深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "dark");
  await page.screenshot({ path: info.outputPath("no-scenes-dark.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(start).toBeInViewport({ ratio: 1 });
  await expect(empty.getByRole("button", { name: "返回创作台", exact: true })).toBeInViewport({ ratio: 1 });
  expect(await empty.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("no-scenes-390-dark.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1366, height: 768 });
  expect((await p.content()).episodes).toHaveLength(0);
  expect((await p.content()).scenes).toHaveLength(0);

  await start.click();
  const episode = page.getByRole("dialog", { name: "新建单集", exact: true });
  await episode.getByRole("textbox", { name: "标题", exact: true }).fill("第一集");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${p.path}/content`, async route => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  try {
    await episode.getByRole("button", { name: "创建单集", exact: true }).click();
    await expect(page.getByLabel("正在读取新建单集", { exact: true })).toBeVisible();
  } finally {
    release();
  }
  await page.unrouteAll({ behavior: "wait" });
  const scene = page.getByRole("dialog", { name: "新建场次", exact: true });
  await expect(scene.getByRole("combobox", { name: "所属单集", exact: true })).toHaveValue("第一集");
  await scene.getByRole("textbox", { name: "标题", exact: true }).fill("雨夜咖啡店");
  await page.screenshot({ path: info.outputPath("create-first-scene-dark.png"), animations: "disabled" });
  await scene.getByRole("button", { name: "创建场次", exact: true }).click();
  await expect(scene).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "查看场次", exact: true })).toHaveValue("第一集 · 雨夜咖啡店");
  const emptyShots = page.getByRole("region", { name: "本场还没有镜头", exact: true });
  await emptyShots.getByRole("button", { name: "新增镜头", exact: true }).click();
  const shot = page.getByRole("dialog", { name: "新增镜头", exact: true });
  await shot.getByRole("textbox", { name: "镜头名称", exact: true }).fill("推门");
  await shot.getByRole("button", { name: "创建镜头", exact: true }).click();
  await expect(page.getByRole("region", { name: "镜头 推门", exact: true })).toBeVisible();
  const tree = await p.content();
  expect(tree.episodes).toHaveLength(1);
  expect(tree.scenes).toHaveLength(1);
  expect(tree.shots).toHaveLength(1);
  expect(tree.scenes[0]!.episodeId).toBe(tree.episodes[0]!.id);
  expect(tree.shots[0]!.sceneId).toBe(tree.scenes[0]!.id);
});

test("an existing episode skips setup, keeps the cancelled scene draft and carried video, and recovers a lost creation reply once", async ({ page, workspace: w }) => {
  const p = await emptyProject(w);
  await w.command("POST", `${p.path}/episodes`, {
    title: "第一集", position: 0, status: "active",
  }, (await p.content()).revision);
  const mediaId = randomUUID();
  const keys: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === `${p.path}/scenes`)
      keys.push(request.headers()["idempotency-key"]!);
  });
  await page.goto(`${p.url}?media=${mediaId}`);
  await page.getByRole("button", { name: "新建场次", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建场次", exact: true });
  await dialog.getByRole("textbox", { name: "标题", exact: true }).fill("旧车站");
  await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect((await p.content()).scenes).toHaveLength(0);
  await page.reload();
  await page.getByRole("button", { name: "新建场次", exact: true }).click();
  await dialog.getByRole("button", { name: "恢复未提交内容", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "标题", exact: true })).toHaveValue("旧车站");
  await page.route(`**${p.path}/scenes`, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  }, { times: 1 });
  await dialog.getByRole("button", { name: "创建场次", exact: true }).click();
  await expect(dialog.getByText("创建结果待确认", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "恢复原创建请求", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const tree = await p.content();
  expect(tree.scenes).toHaveLength(1);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  await expect(page).toHaveURL(`${p.url}?scene=${tree.scenes[0]!.id}&media=${mediaId}`);
  await expect(page.getByRole("region", { name: "本场还没有镜头", exact: true })).toBeVisible();
});

test("a closed setup does not reopen or navigate when episode creation finishes late", async ({ page, workspace: w }) => {
  const p = await emptyProject(w);
  await page.goto(p.url);
  await page.getByRole("button", { name: "新建场次", exact: true }).click();
  const episode = page.getByRole("dialog", { name: "新建单集", exact: true });
  await episode.getByRole("textbox", { name: "标题", exact: true }).fill("迟到回执");
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${p.path}/episodes`, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await held;
    await route.fulfill({ response });
  });
  try {
    await episode.getByRole("button", { name: "创建单集", exact: true }).click();
    await expect.poll(async () => (await p.content()).episodes.length).toBe(1);
    await page.keyboard.press("Escape");
    await expect(episode).toHaveCount(0);
    const response = page.waitForResponse(r => r.url().endsWith(`${p.path}/episodes`) && r.request().method() === "POST");
    release();
    await response;
    await page.unrouteAll({ behavior: "wait" });
    await expect(page).toHaveURL(p.url);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "新建场次", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "新建场次", exact: true })).toBeVisible();
    expect((await p.content()).scenes).toHaveLength(0);
  } finally {
    release();
  }
});

test("an archived empty project only offers returning to the canvas", async ({ page, workspace: w }) => {
  const p = await emptyProject(w);
  await w.command("POST", `${p.path}/archive`, undefined, p.project.revision);
  await page.goto(p.url);
  const empty = page.getByRole("region", { name: "还没有场次", exact: true });
  await expect(empty).toBeVisible();
  await expect(empty.getByRole("button", { name: "新建场次", exact: true })).toHaveCount(0);
  await empty.getByRole("button", { name: "返回创作台", exact: true }).click();
  await expect(page).toHaveURL(p.url.replace(/\/shots$/, ""));
  expect((await p.content()).episodes).toHaveLength(0);
  expect((await p.content()).scenes).toHaveLength(0);
});
