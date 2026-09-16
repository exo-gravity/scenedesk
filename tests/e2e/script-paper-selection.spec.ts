import type { components } from "@drama/contracts";
import type { Page } from "@playwright/test";
import { test, expect, type WorkspaceFixture } from "./fixture.js";

type Schema<K extends keyof components["schemas"]> = components["schemas"][K];
const base = (w: WorkspaceFixture) =>
  `${w.runtime.origin}/#/app/t/${w.tenant.id}/p/${w.project.id}`;

// Use a real DOM Range in the rendered paper, then the same pointer-up event as
// a reader's drag. This avoids dependence on glyph coordinates or React state.
async function selectPaperQuote(page: Page, quote: string, last = false) {
  const paper = page.getByRole("article", {
    name: "剧本阅读正文",
    exact: true,
  });
  await expect(paper).toBeVisible();
  await paper.evaluate(
    (element, { quote, last }) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let text: Node | null;
      while ((text = walker.nextNode())) {
        const content = text.textContent ?? "";
        const start = last
          ? content.lastIndexOf(quote)
          : content.indexOf(quote);
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + quote.length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
        return;
      }
      throw new Error(
        "The expected quote is not rendered in the reading paper",
      );
    },
    { quote, last },
  );
}

test("script paper: selected Unicode and CRLF quote is confirmed and stored against the fixed manuscript", async ({
  page,
  workspace: w,
}, info) => {
  const text = "开场。\r\n她😀拿起旧钥匙。\r\n门缓缓打开。\r\n灯灭了。";
  const quote = "她😀拿起旧钥匙。\r\n门缓缓打开。";
  const script = await w.command<Schema<"ScriptRevision">>(
    "POST",
    `${w.path}/scripts`,
    { text },
    (await w.content()).revision,
  );
  await page.goto(`${base(w)}/script`);
  await selectPaperQuote(page, quote);
  await page.getByRole("button", { name: "选文带入画布", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "选文带入画布",
    exact: true,
  });
  await expect(
    dialog.getByRole("alert").filter({ hasText: "选中的原文" }),
  ).toHaveText(`选中的原文${quote}`);
  await dialog
    .getByRole("button", { name: "添加选文到项目画布", exact: true })
    .click();
  await expect(
    dialog.getByText("选文已添加到画布", { exact: true }),
  ).toBeVisible();
  const canvas = (
    await w.command<Schema<"ProjectCanvas">>("GET", `${w.path}/canvas`)
  ).canvas;
  expect(canvas.document.nodes).toHaveLength(1);
  const node = canvas.document.nodes[0]!;
  const startOffset = Array.from(text.slice(0, text.indexOf(quote))).length;
  expect(node.content).toEqual({
    type: "text",
    text: quote,
    sourceExcerpt: {
      scriptRevisionId: script.id,
      range: { startOffset, endOffset: startOffset + Array.from(quote).length },
      quote,
    },
  });
  await dialog.getByRole("button", { name: "进入画布", exact: true }).click();
  await expect(page).toHaveURL(
    `${base(w)}/canvas?scope=project&node=${node.id}`,
  );
  await expect(
    page.getByRole("button", { name: "画布保存状态：已保存", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(quote, { exact: true })).toBeVisible();
  const screenshot = info.outputPath("paper-selection-fixed-canvas.png");
  await page.screenshot({ path: screenshot, animations: "disabled" });
  await info.attach("paper-selection-fixed-canvas", {
    path: screenshot,
    contentType: "image/png",
  });
});

test("script paper: repeated quote asks for canonical selection instead of guessing the occurrence", async ({
  page,
  workspace: w,
}) => {
  const text = "等一下。\n她转身关上门。\n等一下。";
  const script = await w.command<Schema<"ScriptRevision">>(
    "POST",
    `${w.path}/scripts`,
    { text },
    (await w.content()).revision,
  );
  await page.goto(`${base(w)}/script`);
  await selectPaperQuote(page, "等一下。", true);
  await page.getByRole("button", { name: "选文带入画布", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "选文带入画布",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "添加选文到项目画布", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("alert").filter({ hasText: "选中的原文" }),
  ).toHaveCount(0);
  const source = dialog.getByRole("textbox", {
    name: "当前稿原文",
    exact: true,
  });
  await expect(source).toHaveValue(text);
  await source.focus();
  await source.press("ControlOrMeta+A");
  await source.press("ArrowRight");
  for (const _point of Array.from("等一下。"))
    await source.press("Shift+ArrowLeft");
  await expect(
    dialog.getByRole("alert").filter({ hasText: "选中的原文" }),
  ).toHaveText("选中的原文等一下。");
  await dialog
    .getByRole("button", { name: "添加选文到项目画布", exact: true })
    .click();
  await expect(
    dialog.getByText("选文已添加到画布", { exact: true }),
  ).toBeVisible();
  const canvas = (
    await w.command<Schema<"ProjectCanvas">>("GET", `${w.path}/canvas`)
  ).canvas;
  expect(canvas.document.nodes).toHaveLength(1);
  const startOffset = Array.from(
    text.slice(0, text.lastIndexOf("等一下。")),
  ).length;
  expect(canvas.document.nodes[0]!.content).toEqual({
    type: "text",
    text: "等一下。",
    sourceExcerpt: {
      scriptRevisionId: script.id,
      quote: "等一下。",
      range: { startOffset, endOffset: startOffset + 4 },
    },
  });
});
