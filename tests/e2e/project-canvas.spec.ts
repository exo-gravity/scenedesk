import { randomUUID } from "node:crypto";
import type { components } from "@drama/contracts";
import { test, expect, type WorkspaceFixture } from "./fixture.js";

type Schema<K extends keyof components["schemas"]> = components["schemas"][K];

async function emptyProject(w: WorkspaceFixture) {
  const project = await w.command<Schema<"Project">>("POST", `${w.tenantPath}/projects`, {
    name: "E2E 零场次直接创作", leadMembershipId: w.project.leadMembershipId, spec: w.project.spec,
  });
  const path = `${w.tenantPath}/projects/${project.id}`;
  const baseURL = `${w.runtime.origin}/#/app/t/${w.tenant.id}/p/${project.id}`;
  const canvas = () => w.command<Schema<"ProjectCanvas">>("GET", `${path}/canvas`);
  const content = () => w.command<Schema<"ContentTree">>("GET", `${path}/content`);
  return { project, path, baseURL, canvas, content };
}

test("CW-03: zero-scene project creates one canvas across tabs and retains text, assistant draft and viewport", async ({ page, context, workspace: w }, info) => {
  const p = await emptyProject(w);
  await page.goto(`${p.baseURL}/canvas`);
  await expect(page.getByRole("button", { name: "创建项目画布", exact: true })).toBeVisible();
  expect((await w.runtime.request(w.owner, "GET", `${p.path}/canvas`)).status).toBe(404);
  await expect(page.getByRole("combobox", { name: "打开已有场次画布", exact: true })).toHaveCount(0);
  const second = await context.newPage();
  await second.goto(`${p.baseURL}/canvas`);
  await expect(second.getByRole("button", { name: "创建项目画布", exact: true })).toBeVisible();
  await Promise.all([
    page.getByRole("button", { name: "创建项目画布", exact: true }).click(),
    second.getByRole("button", { name: "创建项目画布", exact: true }).click(),
  ]);
  await expect(page.getByRole("button", { name: "画布保存状态：已保存", exact: true })).toBeVisible();
  await expect(second.getByRole("button", { name: "画布保存状态：已保存", exact: true })).toBeVisible();
  const originalId = (await p.canvas()).canvas.id;
  await second.close();

  await page.getByRole("button", { name: "添加文字", exact: true }).click();
  const note = "无需分集分场，先记录雨夜的第一张画面。";
  await page.getByRole("textbox", { name: "文字内容", exact: true }).fill(note);
  await page.getByRole("button", { name: "保存画布", exact: true }).click();
  await expect(page.getByRole("button", { name: "画布保存状态：已保存", exact: true })).toBeVisible();
  expect((await p.canvas()).canvas.document.nodes[0]?.content).toEqual({ type: "text", text: note });
  await page.getByRole("button", { name: "缩小画布", exact: true }).click();
  const zoom = page.getByRole("button", { name: "画布缩放到百分之百", exact: true });
  await expect(zoom).not.toHaveText("100%");
  const zoomLabel = await zoom.innerText();
  await page.getByRole("button", { name: "AI 助手", exact: true }).click();
  const assistantDraft = "尚未发送：帮我讨论这个故事的色彩方向。";
  await page.getByRole("textbox", { name: "发送给画布助手", exact: true }).fill(assistantDraft);
  const nav = page.getByRole("navigation", { name: "项目导航", exact: true });
  await nav.getByRole("link", { name: "剧本", exact: true }).click();
  await expect(page).toHaveURL(`${p.baseURL}/script`);
  await nav.getByRole("link", { name: "画布", exact: true }).click();
  await expect(page.getByRole("button", { name: "画布保存状态：已保存", exact: true })).toBeVisible();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await expect(zoom).toHaveText(zoomLabel);
  await expect(page.getByRole("textbox", { name: "发送给画布助手", exact: true })).toHaveValue(assistantDraft);
  await page.reload();
  await expect(page.getByRole("button", { name: "画布保存状态：已保存", exact: true })).toBeVisible();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await expect(zoom).toHaveText(zoomLabel);
  await expect(page.getByRole("textbox", { name: "发送给画布助手", exact: true })).toHaveValue(assistantDraft);
  expect((await p.canvas()).canvas.id).toBe(originalId);
  const tree = await p.content();
  expect(tree.scenes).toHaveLength(0);
  expect(tree.episodes).toHaveLength(0);
  await expect(page.getByRole("button", { name: "分镜", exact: true })).toHaveCount(0);
  const screenshot = info.outputPath("zero-scene-project-canvas.png");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("zero-scene-project-canvas", { path: screenshot, contentType: "image/png" });
});

test("CW-03: archived project canvas remains readable and rejects new canvas edits", async ({ page, workspace: w }) => {
  const p = await emptyProject(w);
  const ensured = await w.runtime.request<Schema<"ProjectCanvas">>(w.owner, "POST", `${p.path}/canvas`);
  expect(ensured.status).toBe(200);
  const original = ensured.value.canvas;
  const node = { id: randomUUID(), kind: "text", title: "归档记录", position: { x: 0, y: 0 }, width: 280,
    content: { type: "text", text: "归档前已固定的创作内容。" } };
  const saved = await w.command<Schema<"Canvas">>("PUT", `${p.path}/canvases/${original.id}`, {
    schemaVersion: 1, document: { nodes: [node], edges: [], groups: [] },
  }, original.revision);
  await w.command("POST", `${p.path}/archive`, undefined, p.project.revision);
  await page.goto(`${p.baseURL}/canvas`);
  await expect(page.getByText("项目已归档，可继续查看原有画布。", { exact: true })).toBeVisible();
  await expect(page.getByText(node.content.text, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "添加文字", exact: true })).toBeDisabled();
  expect((await w.runtime.request(w.owner, "PUT", `${p.path}/canvases/${original.id}`, {
    schemaVersion: 1, document: saved.document,
  }, saved.revision)).status).toBe(409);
  await page.getByRole("navigation", { name: "项目导航", exact: true }).getByRole("link", { name: "剧本", exact: true }).click();
  await expect(page).toHaveURL(`${p.baseURL}/script`);
  expect((await p.canvas()).canvas.revision).toBe(saved.revision);
});

test("CW-03: revoked collaborator cannot reopen cached project canvas or read its document", async ({ page, context, workspace: w }) => {
  const p = await emptyProject(w);
  const ensured = await w.runtime.request<Schema<"ProjectCanvas">>(w.owner, "POST", `${p.path}/canvas`);
  expect(ensured.status).toBe(200);
  const collaborator = await w.runtime.identity("canvas-collaborator"), membershipId = randomUUID();
  await w.runtime.database.admin.query(
    `INSERT INTO "${w.runtime.database.schema}".memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member')`,
    [membershipId, w.tenant.id, collaborator.userId],
  );
  const grant = await w.command<{ revision: number }>("POST", `${p.path}/members`, { membershipId });
  await context.clearCookies();
  await context.addCookies([{ name: "session", value: collaborator.token,
    url: w.runtime.origin, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(`${p.baseURL}/canvas`);
  await expect(page.getByRole("button", { name: "画布保存状态：已保存", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "项目导航", exact: true }).getByRole("link", { name: "剧本", exact: true }).click();
  await expect(page).toHaveURL(`${p.baseURL}/script`);
  await w.command("DELETE", `${p.path}/members/${membershipId}`, undefined, grant.revision);
  await page.getByRole("navigation", { name: "项目导航", exact: true }).getByRole("link", { name: "画布", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "操作未完成" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^画布保存状态：/ })).toHaveCount(0);
  await expect(page.getByText(p.project.name, { exact: true })).toHaveCount(0);
  await expect(page).not.toHaveTitle(new RegExp(p.project.name));
  expect((await w.runtime.request(collaborator, "GET", `${p.path}/canvas`)).status).toBe(404);
  expect((await w.runtime.request(collaborator, "GET", `${p.path}/canvases/${ensured.value.canvas.id}`)).status).toBe(404);
});
