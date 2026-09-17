import type { Page } from "@playwright/test";
import type { components } from "@drama/contracts";
import { test, expect, type WorkspaceFixture } from "./fixture.js";
type Schema<K extends keyof components["schemas"]> = components["schemas"][K];
const base = (w: WorkspaceFixture) => `${w.runtime.origin}${w.basePath}`;
const nav = (page: Page) =>
  page.getByRole("navigation", { name: "项目导航", exact: true });
const switcher = (page: Page) =>
  page.getByRole("button", { name: /^切换画布：/ });
const saved = (page: Page) =>
  page.getByRole("button", { name: "画布保存状态：已保存", exact: true });
async function choose(page: Page, name: string) {
  await switcher(page).click();
  await page.getByRole("button", { name, exact: true }).click();
}

test("CW-12: sole existing scene opens from canvas navigation, retains drafts across shared sidebar, and explicit project history returns correctly", async ({
  page,
  workspace: w,
}, info) => {
  expect(
    (
      await w.runtime.request(
        w.owner,
        "POST",
        `${w.path}/scenes/${w.scene.id}/canvas`,
      )
    ).status,
  ).toBe(200);
  await page.goto(`${base(w)}/script`);
  await nav(page).getByRole("link", { name: "画布", exact: true }).click();
  const sceneURL = `${base(w)}/production?scene=${w.scene.id}&mode=canvas`;
  await expect(page).toHaveURL(sceneURL);
  await expect(saved(page)).toBeVisible();
  await expect(
    nav(page).getByRole("link", { name: "画布", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("link", { name: "场次管理", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "添加文字", exact: true }).click();
  const note = "尚未手动保存的场次笔记。";
  await page.getByRole("textbox", { name: "文字内容", exact: true }).fill(note);
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  const draft = "未发送：让画面节奏缓慢一些。";
  await page
    .getByRole("textbox", { name: "发送给画布助手", exact: true })
    .fill(draft);
  await nav(page).getByRole("link", { name: "剧本", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "剧本阅读正文", exact: true }),
  ).toBeVisible();
  await nav(page).getByRole("link", { name: "画布", exact: true }).click();
  await expect(page).toHaveURL(sceneURL);
  await expect(
    page.getByRole("textbox", { name: "发送给画布助手", exact: true }),
  ).toHaveValue(draft);
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await expect(saved(page)).toBeVisible();
  const fixedScene = await w.command<Schema<"SceneCanvas">>(
    "GET",
    `${w.path}/scenes/${w.scene.id}/canvas`,
  );
  expect(fixedScene.canvas.document.nodes[0]?.content).toEqual({
    type: "text",
    text: note,
  });
  await choose(page, "项目画布");
  await expect(page).toHaveURL(`${base(w)}/canvas?scope=project`);
  await expect(
    page.getByRole("button", { name: "创建项目画布", exact: true }),
  ).toBeVisible();
  // Merely choosing a workspace must never create it.
  expect(
    (await w.runtime.request(w.owner, "GET", `${w.path}/canvas`)).status,
  ).toBe(404);
  await page.getByRole("button", { name: "创建项目画布", exact: true }).click();
  await expect(saved(page)).toBeVisible();
  await choose(page, `${w.episode.title} · ${w.scene.title}`);
  await expect(page).toHaveURL(sceneURL);
  await page.goBack();
  await expect(page).toHaveURL(`${base(w)}/canvas?scope=project`);
  await expect(switcher(page)).toHaveAccessibleName("切换画布：项目画布");
  await expect(saved(page)).toBeVisible();
  await switcher(page).click();
  await page
    .getByRole("textbox", { name: "搜索画布或场次", exact: true })
    .fill("咖啡");
  await expect(
    page.getByRole("button", {
      name: `${w.episode.title} · ${w.scene.title}`,
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(switcher(page)).toBeFocused();
  const screenshot = info.outputPath("unified-canvas-navigation.png");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("unified-canvas-navigation", {
    path: screenshot,
    contentType: "image/png",
  });
});

test("CW-12: multiple canvases ask once, a remembered archived scene cannot trap entry, and fresh index sees externally added scenes", async ({
  page,
  workspace: w,
}) => {
  expect(
    (await w.runtime.request(w.owner, "POST", `${w.path}/canvas`)).status,
  ).toBe(200);
  expect(
    (
      await w.runtime.request(
        w.owner,
        "POST",
        `${w.path}/scenes/${w.scene.id}/canvas`,
      )
    ).status,
  ).toBe(200);
  await page.goto(`${base(w)}/canvas`);
  await expect(
    page.getByText("继续在哪张画布创作？", { exact: true }),
  ).toBeVisible();
  await choose(page, `${w.episode.title} · ${w.scene.title}`);
  await expect(saved(page)).toBeVisible();
  await nav(page).getByRole("link", { name: "剧本", exact: true }).click();
  await w.command(
    "PUT",
    `${w.path}/scenes/${w.scene.id}`,
    {
      episodeId: w.episode.id,
      title: w.scene.title,
      position: w.scene.position,
      summary: w.scene.summary,
      state: w.scene.state,
      status: "archived",
    },
    w.scene.revision,
  );
  await nav(page).getByRole("link", { name: "画布", exact: true }).click();
  await expect(page).toHaveURL(`${base(w)}/canvas?scope=project`);
  await expect(saved(page)).toBeVisible();
  await switcher(page).click();
  await expect(
    page.getByRole("button", {
      name: `${w.episode.title} · ${w.scene.title}`,
      exact: true,
    }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  const freshProject = await w.command<Schema<"Project">>(
    "POST",
    `${w.tenantPath}/projects`,
    {
      name: "新画布项目",
      leadMembershipId: w.project.leadMembershipId,
      spec: w.project.spec,
    },
  );
  const freshPath = `${w.tenantPath}/projects/${freshProject.id}`,
    freshBase = `${w.runtime.origin}/#/app/t/${w.tenant.id}/p/${freshProject.id}`;
  const tree = () =>
    w.command<Schema<"ContentTree">>("GET", `${freshPath}/content`);
  await page.goto(`${freshBase}/script`);
  await expect(
    page.getByRole("button", { name: "导入 Word", exact: true }),
  ).toBeVisible();
  const episode = await w.command<Schema<"Episode">>(
    "POST",
    `${freshPath}/episodes`,
    { title: "其他作者刚建的集", status: "active", position: 0 },
    (await tree()).revision,
  );
  const scene = await w.command<Schema<"Scene">>(
    "POST",
    `${freshPath}/scenes`,
    {
      episodeId: episode.id,
      title: "刚建场次",
      summary: "",
      state: {},
      status: "active",
      position: 0,
    },
    (await tree()).revision,
  );
  expect(
    (
      await w.runtime.request(
        w.owner,
        "POST",
        `${freshPath}/scenes/${scene.id}/canvas`,
      )
    ).status,
  ).toBe(200);
  await nav(page).getByRole("link", { name: "画布", exact: true }).click();
  await expect(page).toHaveURL(
    `${freshBase}/production?scene=${scene.id}&mode=canvas`,
  );
  await expect(saved(page)).toBeVisible();
});

test("CW-12: canvas menu opens a light scene directory, details stay local, and minimal creation keeps advanced fields optional", async ({
  page,
  workspace: w,
}, info) => {
  await page.goto(`${base(w)}/canvas`);
  await choose(page, "新增场次");
  const create = page.getByRole("dialog", { name: "新建场次", exact: true });
  await expect(create).toBeVisible();
  await expect(
    create.getByRole("combobox", { name: "所属单集", exact: true }),
  ).toHaveValue(w.episode.title);
  await expect(create.getByText("场次状态", { exact: true })).toBeHidden();
  await create
    .getByRole("textbox", { name: "标题", exact: true })
    .fill("门外街道");
  await create
    .getByRole("textbox", { name: "地点", exact: true })
    .fill("咖啡店门口");
  await create.getByRole("button", { name: "创建场次", exact: true }).click();
  await expect(create).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "场次目录", exact: true }),
  ).toBeVisible();
  const created = (await w.content()).scenes.find(
    (s) => s.title === "门外街道",
  );
  expect(created?.episodeId).toBe(w.episode.id);
  expect(created?.locationLabel).toBe("咖啡店门口");
  const row = page.getByRole("article").filter({ hasText: "门外街道" });
  await row.getByRole("button", { name: "详情", exact: true }).click();
  const details = page.getByRole("dialog", {
    name: "门外街道 · 场次详情",
    exact: true,
  });
  await expect(details).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "场次目录", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await expect(
    row.getByRole("button", { name: "详情", exact: true }),
  ).toBeFocused();
  await page.goto(`${base(w)}/content?scene=${created!.id}`);
  await expect(details).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await page.reload();
  await expect(details).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "新建场次", exact: true }),
  ).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await nav(page).getByRole("link", { name: "剧本", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "整理为镜头", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "选文带入画布", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "剧本操作", exact: true }).click();
  // 剧本页的溢出菜单只放本页动作；场次目录归画布菜单，旧深链另行可达。
  await expect(page.getByRole("menuitem", { name: "场次目录", exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem")).toHaveCount(3);
  await page.getByRole("menuitem", { name: "分镜建议", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "剧本提案助手", exact: true }),
  ).toBeVisible();
  const screenshot = info.outputPath("script-secondary-suggestions.png");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("script-secondary-suggestions", {
    path: screenshot,
    contentType: "image/png",
  });
});

test("CW-12: narrow canvas menu stays reachable and a zero-episode project creates structure only on explicit confirmation", async ({ page, workspace: w }, info) => {
  const project = await w.command<Schema<"Project">>("POST", `${w.tenantPath}/projects`, {
    name: "最小新场次验收", leadMembershipId: w.project.leadMembershipId, spec: w.project.spec,
  });
  const path = `${w.tenantPath}/projects/${project.id}`;
  const url = `${w.runtime.origin}/#/app/t/${w.tenant.id}/p/${project.id}`;
  const content = () => w.command<Schema<"ContentTree">>("GET", `${path}/content`);
  await page.goto(`${url}/canvas`);
  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await switcher(page).click();
    const create = page.getByRole("button", { name: "新增场次", exact: true });
    await expect(create).toBeVisible();
    const bounds = (await create.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    const screenshot = info.outputPath(`canvas-menu-${width}.png`);
    await page.screenshot({ path: screenshot, animations: "disabled" });
    await info.attach(`canvas-menu-${width}`, { path: screenshot, contentType: "image/png" });
    await page.keyboard.press("Escape");
    await expect(switcher(page)).toBeFocused();
  }
  await choose(page, "新增场次");
  const sceneDialog = page.getByRole("dialog", { name: "新建场次", exact: true });
  await expect(sceneDialog).toBeVisible();
  await expect(sceneDialog.getByRole("textbox", { name: "标题", exact: true })).toHaveCount(0);
  expect((await content()).episodes).toHaveLength(0);
  expect((await content()).scenes).toHaveLength(0);
  await sceneDialog.getByRole("button", { name: "新建单集", exact: true }).click();
  const episodeDialog = page.getByRole("dialog", { name: "新建单集", exact: true });
  await expect(episodeDialog).toBeVisible();
  await episodeDialog.getByRole("textbox", { name: "标题", exact: true }).fill("第一集");
  await episodeDialog.getByRole("button", { name: "创建单集", exact: true }).click();
  await expect(episodeDialog).toBeHidden();
  await page.getByRole("button", { name: "新增场次", exact: true }).click();
  await sceneDialog.getByRole("textbox", { name: "标题", exact: true }).fill("第一场");
  await sceneDialog.getByRole("button", { name: "创建场次", exact: true }).click();
  await expect(sceneDialog).toBeHidden();
  expect((await content()).episodes).toHaveLength(1);
  expect((await content()).scenes).toHaveLength(1);
  expect((await w.runtime.request(w.owner, "GET", `${path}/canvas`)).status).toBe(404);
});
