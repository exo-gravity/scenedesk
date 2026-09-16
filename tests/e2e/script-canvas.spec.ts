import { randomUUID } from "node:crypto";
import type { components } from "@drama/contracts";
import { test, expect, type WorkspaceFixture } from "./fixture.js";
type Schema<K extends keyof components["schemas"]> = components["schemas"][K];
const base = (w: WorkspaceFixture) =>
  `${w.runtime.origin}/#/app/t/${w.tenant.id}/p/${w.project.id}`;
async function selectExcerpt(
  page: import("@playwright/test").Page,
  text: string,
) {
  await page.getByRole("button", { name: "选文带入画布", exact: true }).click();
  const source = page.getByRole("textbox", { name: "当前稿原文", exact: true });
  await expect(source).toHaveValue(text);
  await source.focus();
  await source.press("ControlOrMeta+A");
  await expect(
    page.getByRole("alert").filter({ hasText: "选中的原文" }),
  ).toContainText(text);
}

test("CW-06: fixed script excerpt becomes a canvas source and survives a newer manuscript", async ({
  page,
  workspace: w,
}, info) => {
  const script = await w.command<Schema<"ScriptRevision">>(
    "POST",
    `${w.path}/scripts`,
    { text: "她😀推开门。\n夜雨落在肩上。" },
    (await w.content()).revision,
  );
  await page.goto(`${base(w)}/script`);
  await selectExcerpt(page, script.text);
  await page
    .getByRole("button", { name: "添加选文到项目画布", exact: true })
    .click();
  await expect(
    page.getByText("选文已添加到画布", { exact: true }),
  ).toBeVisible();
  const original = (
    await w.command<Schema<"ProjectCanvas">>("GET", `${w.path}/canvas`)
  ).canvas;
  expect(original.document.nodes).toHaveLength(1);
  const node = original.document.nodes[0]!;
  expect(node.content).toEqual({
    type: "text",
    text: script.text,
    sourceExcerpt: {
      scriptRevisionId: script.id,
      range: { startOffset: 0, endOffset: Array.from(script.text).length },
      quote: script.text,
    },
  });
  await page.getByRole("button", { name: "进入画布", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "画布保存状态：已保存", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(script.text, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "继续创作", exact: true }).click();
  await page.getByRole("button", { name: "新的视频草稿", exact: true }).click();
  await page
    .getByRole("textbox", { name: "本次提示词", exact: true })
    .fill("雨夜慢慢推近。");
  await page.getByRole("button", { name: "保存画布", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "画布保存状态：已保存", exact: true }),
  ).toBeVisible();
  const saved = (
    await w.command<Schema<"ProjectCanvas">>("GET", `${w.path}/canvas`)
  ).canvas;
  expect(saved.document.nodes).toHaveLength(2);
  expect(saved.document.edges[0]).toMatchObject({
    sourceNodeId: node.id,
    purpose: "prompt",
    enabled: true,
  });
  await w.command(
    "POST",
    `${w.path}/scripts`,
    { text: "新稿：晴天。" },
    (await w.content()).revision,
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "画布保存状态：已保存", exact: true }),
  ).toBeVisible();
  expect(
    (
      await w.command<Schema<"ProjectCanvas">>("GET", `${w.path}/canvas`)
    ).canvas.document.nodes.find((n) => n.id === node.id)?.content,
  ).toEqual(node.content);
  const screenshot = info.outputPath("fixed-script-canvas.png");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("fixed-script-canvas", {
    path: screenshot,
    contentType: "image/png",
  });
});

test("CW-06/11: lost excerpt reply recovers the original node after reload without another POST", async ({
  page,
  workspace: w,
}) => {
  await page.goto(`${base(w)}/script`);
  await selectExcerpt(page, w.current.text);
  let posts = 0;
  await page.route("**/canvases/*/script-excerpts", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    await route.fetch(); // Real API commits before the client loses the receipt.
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "添加选文到项目画布", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "核对原选文添加结果", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "操作未完成" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "选文带入画布", exact: true }).click();
  await page.getByRole("button", { name: "恢复创建记录", exact: true }).click();
  await page
    .getByRole("button", { name: "核对原选文添加结果", exact: true })
    .click();
  await expect(
    page.getByText("选文已添加到画布", { exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  expect(
    (await w.command<Schema<"ProjectCanvas">>("GET", `${w.path}/canvas`)).canvas
      .document.nodes,
  ).toHaveLength(1);
});

test("CW-06/11: concurrent canvas changes survive excerpt CAS conflict and explicit continuation", async ({
  page,
  workspace: w,
}) => {
  await page.goto(`${base(w)}/script`);
  await selectExcerpt(page, w.current.text);
  const collaborator = {
    id: randomUUID(),
    title: "协作内容",
    kind: "text",
    position: { x: 0, y: 0 },
    width: 320,
    content: { type: "text", text: "另一位作者写下的内容" },
  };
  let raced = false;
  await page.route("**/canvases/*/script-excerpts", async (route) => {
    if (!raced && route.request().method() === "POST") {
      raced = true;
      const canvas = (
        await w.command<Schema<"ProjectCanvas">>("GET", `${w.path}/canvas`)
      ).canvas;
      await w.command(
        "PUT",
        `${w.path}/canvases/${canvas.id}`,
        {
          schemaVersion: 1,
          document: {
            ...canvas.document,
            nodes: [...canvas.document.nodes, collaborator],
          },
        },
        canvas.revision,
      );
    }
    await route.continue();
  });
  await page
    .getByRole("button", { name: "添加选文到项目画布", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "操作未完成" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "核对原选文添加结果", exact: true })
    .click();
  await page
    .getByRole("button", { name: "按最新画布继续添加", exact: true })
    .click();
  await expect(
    page.getByText("选文已添加到画布", { exact: true }),
  ).toBeVisible();
  const canvas = (
    await w.command<Schema<"ProjectCanvas">>("GET", `${w.path}/canvas`)
  ).canvas;
  expect(canvas.document.nodes).toHaveLength(2);
  expect(canvas.document.nodes.find((n) => n.id === collaborator.id)).toEqual(
    collaborator,
  );
});
