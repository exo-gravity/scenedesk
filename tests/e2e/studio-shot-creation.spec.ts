import { test, expect, type WorkspaceFixture } from "./fixture.js";
import type { components } from "@drama/contracts";

type Shot = components["schemas"]["Shot"];
type Scene = components["schemas"]["Scene"];

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

test.beforeEach(async ({ workspace: w }) => {
  const canvas = await w.runtime.request(w.owner, "POST", `${w.path}/canvas`);
  expect(canvas.status).toBe(200);
});

async function existingShot(w: WorkspaceFixture) {
  return w.command<Shot>("POST", `${w.path}/shots`, {
    sceneId: w.scene.id,
    label: "原有镜头",
    position: 0,
    status: "active",
    spec: { intent: "原有镜头的要求", references: [] },
  }, (await w.content()).revision);
}

test("the scene-directory entry uses the same short shot dialog", async ({ page, workspace: w }, info) => {
  await existingShot(w);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`${w.runtime.origin}${w.basePath}/content?scene=${w.scene.id}`);
  await page.getByText(/^镜头要求与历史 ·/).click();
  await page.getByRole("button", { name: "添加镜头", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新增镜头", exact: true });
  const name = dialog.getByRole("textbox", { name: "镜头名称", exact: true });
  await expect(name).toBeFocused();
  await name.fill("推门进店");
  await expect(dialog.getByRole("textbox", { name: "镜头说明（选填）", exact: true })).toBeVisible();
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "创建镜头", exact: true })).toBeInViewport();
  expect(await dialog.evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("shot-create-dialog.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "创建镜头", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await w.content()).shots.some(shot => shot.label === "推门进店")).toBe(true);
});

test("shot creation stays compact, retains cancelled inputs through refresh, and focuses the created shot", async ({ page, workspace: w }, info) => {
  await existingShot(w);
  await page.goto(`${w.runtime.origin}${w.basePath}/studio/shots?scene=${w.scene.id}`);
  const list = page.getByRole("list", { name: "镜头列表", exact: true });
  await page.getByRole("button", { name: "新增镜头", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新增镜头", exact: true });
  const form = dialog.getByRole("form", { name: "新增镜头", exact: true });
  const name = form.getByRole("textbox", { name: "镜头名称", exact: true });
  const description = form.getByRole("textbox", { name: "镜头说明（选填）", exact: true });
  const create = form.getByRole("button", { name: "创建镜头", exact: true });
  await expect(name).toBeFocused();
  await expect(create).toBeDisabled();
  await expect(form.getByRole("combobox")).toHaveCount(0);
  await expect(form.getByText("入口状态", { exact: true })).toHaveCount(0);
  await expect(form.getByRole("button", { name: "添加参考素材", exact: true })).toHaveCount(0);
  await name.fill("凝视戒指");
  await description.fill("她发现对方仍戴着那枚戒指。");
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 820, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(name).toBeInViewport({ ratio: 1 });
    await expect(description).toBeInViewport({ ratio: 1 });
    await expect(create).toBeInViewport({ ratio: 1 });
    await expect(form.getByRole("button", { name: "取消", exact: true })).toBeInViewport({ ratio: 1 });
    expect(await dialog.evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    expect(await form.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`shot-create-${viewport.width}.png`), animations: "disabled" });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await form.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(list.getByRole("listitem").nth(0)).toContainText("原有镜头");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await w.content()).shots).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: "新增镜头", exact: true }).click();
  await form.getByRole("button", { name: "恢复未提交内容", exact: true }).click();
  await expect(name).toHaveValue("凝视戒指");
  await expect(description).toHaveValue("她发现对方仍戴着那枚戒指。");

  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${w.path}/content`, async route => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  try {
    await create.click();
    await expect(form).toHaveCount(0);
    await expect(page.getByRole("region", { name: "镜头 原有镜头", exact: true })).toHaveCount(0);
    await expect(page.getByText("正在读取镜头…", { exact: true })).toBeVisible();
  } finally {
    release();
  }
  const detail = page.getByRole("region", { name: "镜头 凝视戒指", exact: true });
  const focus = detail.getByRole("region", { name: "镜头专注预览" });
  await expect(detail).toBeVisible();
  await expect(focus.getByRole("heading", { name: "凝视戒指", exact: true })).toBeVisible();
  const shots = (await w.content()).shots;
  expect(shots).toHaveLength(2);
  const created = shots.find(shot => shot.label === "凝视戒指")!;
  expect(created.sceneId).toBe(w.scene.id);
  expect(created.spec.intent).toBe("她发现对方仍戴着那枚戒指。");
  expect(created.currentTakeId).toBeUndefined();
  await expect(focus.getByText("这个镜头还没有视频候选", { exact: true })).toBeVisible();
  await expect(focus.getByRole("button", { name: "前往本场创作台", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("shot-created-focused.png"), animations: "disabled" });
});

test("lost shot creation response recovers the same request without a duplicate or a required description", async ({ page, workspace: w }) => {
  await existingShot(w);
  const keys: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === `${w.path}/shots`)
      keys.push(request.headers()["idempotency-key"]!);
  });
  await page.goto(`${w.runtime.origin}${w.basePath}/studio/shots?scene=${w.scene.id}`);
  await page.getByRole("button", { name: "新增镜头", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新增镜头", exact: true });
  const form = dialog.getByRole("form", { name: "新增镜头", exact: true });
  await form.getByRole("textbox", { name: "镜头名称", exact: true }).fill("停顿");
  await page.route(`**${w.path}/shots`, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  }, { times: 1 });
  await form.getByRole("button", { name: "创建镜头", exact: true }).click();
  await expect(form.getByText("创建结果待确认", { exact: true })).toBeVisible();
  expect((await w.content()).shots.filter(shot => shot.label === "停顿")).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: "新增镜头", exact: true }).click();
  await form.getByRole("button", { name: "恢复创建记录", exact: true }).click();
  await form.getByRole("button", { name: "恢复原创建请求", exact: true }).click();
  await expect(page.getByRole("region", { name: "镜头 停顿", exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  const shots = (await w.content()).shots.filter(shot => shot.label === "停顿");
  expect(shots).toHaveLength(1);
  expect(shots[0]!.spec.intent).toBe("");
});

test("legacy detailed shot drafts remain reviewable and retain their requirements when created", async ({ page, workspace: w }) => {
  const other = await w.command<Scene>("POST", `${w.path}/scenes`, {
    episodeId: w.episode.id,
    title: "旧车站",
    position: 1,
    summary: "等待来信人",
    state: {},
    status: "active",
  }, (await w.content()).revision);
  await page.goto(`${w.runtime.origin}${w.basePath}/studio/shots?scene=${w.scene.id}`);
  const empty = page.getByRole("region", { name: "本场还没有镜头", exact: true });
  await empty.getByRole("button", { name: "新增镜头", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新增镜头", exact: true });
  const form = dialog.getByRole("form", { name: "新增镜头", exact: true });
  await form.getByRole("textbox", { name: "镜头名称", exact: true }).fill("旧草稿镜头");
  await form.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // Restore the persisted shape written by the previous full creation editor.
  // Assertions below exercise the visible editor and the actual saved ShotSpec.
  await page.evaluate(async ({ path, parentId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("scenedesk-content-drafts", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("drafts", "readwrite");
        const request = tx.objectStore("drafts").openCursor();
        let updated = false;
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (JSON.parse(String(cursor.key))[1] === path) {
            const record = cursor.value;
            record.value.parentId = parentId;
            record.value.action = "她慢慢放下手中的信。";
            record.value.camera = "近景，固定机位";
            record.value.duration = "3.5";
            record.value.entry = "信在右手";
            record.value.exit = "信在桌上";
            record.value.dialogue = [{ id: crypto.randomUUID(), text: "原来是你。" }];
            cursor.update(record);
            updated = true;
          }
          cursor.continue();
        };
        tx.oncomplete = () => updated ? resolve() : reject(new Error("Expected a retained shot draft"));
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, { path: `${w.path}/shot/new:${w.scene.id}`, parentId: other.id });
  await empty.getByRole("button", { name: "新增镜头", exact: true }).click();
  await form.getByRole("button", { name: "恢复未提交内容", exact: true }).click();
  await expect(form.getByRole("combobox", { name: "所属场次", exact: true })).toHaveValue(`${w.episode.title} · ${other.title}`);
  await expect(form.getByRole("textbox", { name: "动作与表演", exact: true })).toHaveValue("她慢慢放下手中的信。");
  await expect(form.getByRole("textbox", { name: "镜头与机位", exact: true })).toHaveValue("近景，固定机位");
  await expect(form.getByRole("textbox", { name: "计划时长（秒）", exact: true })).toHaveValue("3.5");
  await expect(form.getByRole("textbox", { name: "第 1 句台词", exact: true })).toHaveValue("原来是你。");
  await form.getByRole("button", { name: "创建镜头", exact: true }).click();
  await expect(page.getByRole("region", { name: "镜头 旧草稿镜头", exact: true })).toBeVisible();
  const created = (await w.content()).shots.find(shot => shot.label === "旧草稿镜头")!;
  await expect(page).toHaveURL(`${w.runtime.origin}${w.basePath}/studio/shots?scene=${other.id}&shot=${created.id}`);
  await expect(page.getByRole("combobox", { name: "查看场次", exact: true })).toHaveValue(`${w.episode.title} · ${other.title}`);
  expect(created.sceneId).toBe(other.id);
  expect(created.spec).toMatchObject({
    action: "她慢慢放下手中的信。",
    camera: "近景，固定机位",
    plannedDurationUs: 3500000,
    entryState: { spatialNotes: "信在右手" },
    exitState: { spatialNotes: "信在桌上" },
    dialogue: [{ text: "原来是你。" }],
  });
});

test("a late creation response does not take the user back to a scene they left", async ({ page, workspace: w }) => {
  await existingShot(w);
  const other = await w.command<Scene>("POST", `${w.path}/scenes`, {
    episodeId: w.episode.id,
    title: "旧车站",
    position: 1,
    summary: "等待来信人",
    state: {},
    status: "active",
  }, (await w.content()).revision);
  await page.goto(`${w.runtime.origin}${w.basePath}/studio/shots?scene=${w.scene.id}`);
  await page.getByRole("button", { name: "新增镜头", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新增镜头", exact: true });
  const form = dialog.getByRole("form", { name: "新增镜头", exact: true });
  await form.getByRole("textbox", { name: "镜头名称", exact: true }).fill("迟到的创建回执");
  let release!: () => void;
  let accepted!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const serverAccepted = new Promise<void>(resolve => { accepted = resolve; });
  const creationResponse = page.waitForResponse(response =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === `${w.path}/shots`,
  );
  await page.route(`**${w.path}/shots`, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    accepted();
    await held;
    await route.fulfill({ response });
  }, { times: 1 });
  try {
    await form.getByRole("button", { name: "创建镜头", exact: true }).click();
    await serverAccepted;
    await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("combobox", { name: "查看场次", exact: true }).click();
    await page.getByRole("option", { name: `${w.episode.title} · ${other.title}`, exact: true }).click();
    await expect(page).toHaveURL(`${w.runtime.origin}${w.basePath}/studio/shots?scene=${other.id}`);
    await expect(page.getByText("本场还没有镜头", { exact: true })).toBeVisible();
  } finally {
    release();
  }
  expect((await creationResponse).status()).toBe(201);
  await expect.poll(async () => (await w.content()).shots.some(shot => shot.label === "迟到的创建回执")).toBe(true);
  await expect(page.getByRole("combobox", { name: "查看场次", exact: true })).toHaveValue(`${w.episode.title} · ${other.title}`);
  await expect(page).toHaveURL(`${w.runtime.origin}${w.basePath}/studio/shots?scene=${other.id}`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const created = (await w.content()).shots.filter(shot => shot.label === "迟到的创建回执");
  expect(created).toHaveLength(1);
  expect(created[0]!.sceneId).toBe(w.scene.id);
});

test("closing the creation modal after submission does not change the focused shot when the response arrives", async ({ page, workspace: w }) => {
  await existingShot(w);
  await page.goto(`${w.runtime.origin}${w.basePath}/studio/shots?scene=${w.scene.id}`);
  await page.getByRole("button", { name: "新增镜头", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新增镜头", exact: true });
  const form = dialog.getByRole("form", { name: "新增镜头", exact: true });
  await form.getByRole("textbox", { name: "镜头名称", exact: true }).fill("关闭后收到的镜头");
  let release!: () => void;
  let accepted!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const serverAccepted = new Promise<void>(resolve => { accepted = resolve; });
  const creationResponse = page.waitForResponse(response =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === `${w.path}/shots`,
  );
  await page.route(`**${w.path}/shots`, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    accepted();
    await held;
    await route.fulfill({ response });
  }, { times: 1 });
  try {
    await form.getByRole("button", { name: "创建镜头", exact: true }).click();
    await serverAccepted;
    await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  } finally {
    // Deliver during the modal's exit, without waiting for its animation to finish.
    release();
  }
  expect((await creationResponse).status()).toBe(201);
  await expect(dialog).toHaveCount(0);
  const list = page.getByRole("list", { name: "镜头列表", exact: true });
  await expect(list.getByRole("listitem").filter({ hasText: "关闭后收到的镜头" })).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "镜头 原有镜头", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const created = (await w.content()).shots.filter(shot => shot.label === "关闭后收到的镜头");
  expect(created).toHaveLength(1);
  expect(created[0]!.sceneId).toBe(w.scene.id);
  expect(created[0]!.currentTakeId).toBeUndefined();
  // Reopening is a new user action; the acknowledged creation must not reappear as a draft.
  await page.getByRole("button", { name: "新增镜头", exact: true }).click();
  await expect(form.getByRole("textbox", { name: "镜头名称", exact: true })).toBeFocused();
  await expect(form.getByRole("textbox", { name: "镜头名称", exact: true })).toHaveValue("");
  await expect(form.getByRole("button", { name: "恢复创建记录", exact: true })).toHaveCount(0);
});
