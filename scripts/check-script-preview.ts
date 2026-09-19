// 剧本页效果稿的规则符合性检查（设计预览页专用）。
//
// 为什么需要它：2026-09-18 的评审里出现过三次「规则定了、但只改了当时正在看的那一屏」
// （动作形态漏 4 屏、信息密度漏 1 屏、页级横幅几何未定义）。人眼复核不可靠，改成机器检查。
//
// 规则来源：docs/research/2026-09-18-script-status-consistency-rules.md
//   R1 状态信息只出现在两个合法位置（页级横幅 = 首个 notice；其余 = 通知轨），同一屏最多两条
//   R2 通知轨一律一行：不得出现 title（徽标允许）
//   R3 通知轨一律文字动作：内部不得出现 <button>
//   R4 内容块必须落在同一内容列（同 x、同宽）
//   R5 字号只用四档：标题 26 / 图标 20 / 正文 14 / 徽标 11（另有壳层面包屑 12 与 Mantine 按钮 12）
//   R6 通知轨几何唯一：左边界与宽度一致，圆角只用左侧
//
// 用法：
//   node --import tsx scripts/check-script-preview.ts --serve     # 自己起预览服务、跑完关掉
//   node --import tsx scripts/check-script-preview.ts [url]        # 对着已起的服务跑
import { spawn, type ChildProcess } from "node:child_process";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const SERVE = args.includes("--serve");
const portArg = args.find((a) => a.startsWith("--port="));
const PORT = portArg ? Number(portArg.split("=")[1]) : 4399;
const explicit = args.find((a) => a.startsWith("http"));
const URL = explicit ?? `http://127.0.0.1:${PORT}/#/script-layout`;

let server: ChildProcess | undefined;
if (SERVE) {
  server = spawn(
    "npx",
    ["vite", "--config", "apps/web/vite.config.ts", "--port", String(PORT), "--strictPort", "apps/web"],
    {
      env: { ...process.env, VITE_ENABLE_DESIGN_PREVIEWS: "true" },
      stdio: "ignore",
      detached: false,
    },
  );
  const deadline = Date.now() + 60_000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) { up = true; break; }
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 700));
  }
  if (!up) {
    server.kill();
    console.error("预览服务 60 秒内未就绪");
    process.exit(2);
  }
}
const VIEWS = [
  "① 空态",
  "② 阅读",
  "③ 选段引用",
  "④ 历史稿",
  "⑤ 导入·读取中",
  "⑤ 导入·预览",
  "⑤ 导入·冲突",
  "⑤ 导入·失败",
  "⑥ 草稿恢复",
  "⑦ 归档只读",
  "⑧ 读取失败",
  "⑨ ⋯菜单",
];
const CONTENT_BLOCKS = ["head", "notice", "versionRow", "doc", "previewDoc", "errorBox"];
const ALLOWED_SIZES = new Set(["26px", "20px", "14px", "12px", "11px"]);

type ScreenResult = {
  error?: string;
  noticeCount: number;
  noticeTitles: string[];
  noticeButtons: string[];
  noticeGeometry: { x: number; w: number; radius: string }[];
  blocks: { name: string; x: number; w: number }[];
  sizes: string[];
};

const failures: string[] = [];
const notes: string[] = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1449, height: 800 }, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

for (const view of VIEWS) {
  const entry = page.getByText(view, { exact: true }).first();
  if (!(await entry.count())) {
    failures.push(`${view}: 找不到该屏入口`);
    continue;
  }
  await entry.click();
  await page.waitForTimeout(500);

  // 注意：用字符串形式的页面函数，避免 tsx 的 keepNames 注入 __name 到浏览器上下文。
  const r = await page.evaluate(`(() => {
    const sheet = document.querySelector('[class*="sheet"]');
    if (!sheet) return { error: "no sheet" };
    const box = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width) }; };
    const SKIP = ["noticeBody","noticeLine","noticeText","noticeTitle","noticeLinks","noticeBadge","noticeActions"];
    const notices = [...sheet.querySelectorAll('[class*="notice"]')].filter((el) => !SKIP.some((k) => el.className.includes(k)));
    const blocks = [];
    const INNER = ["noticeBody","noticeLine","noticeText","noticeTitle","noticeLinks","noticeBadge","noticeActions"];
    for (const name of ["head","notice","versionRow","doc","previewDoc","errorBox"]) {
      for (const el of sheet.querySelectorAll('[class*="' + name + '"]')) {
        if (INNER.some((k) => el.className.includes(k))) continue;
        if (el.parentElement && el.parentElement.closest('[class*="notice"]')) continue;
        blocks.push({ name, x: Math.round(el.getBoundingClientRect().x), w: Math.round(el.getBoundingClientRect().width) });
      }
    }
    return {
      noticeCount: notices.length,
      noticeTitles: notices.map((n) => { const t = n.querySelector('[class*="noticeTitle"]'); return t ? t.textContent.trim() : null; }).filter(Boolean),
      noticeButtons: notices.flatMap((n) => [...n.querySelectorAll("button")].map((x) => (x.textContent || "").trim())),
      noticeGeometry: notices.map((n) => { const cs = getComputedStyle(n); const b = n.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), radius: cs.borderRadius }; }),
      blocks,
      sizes: [...sheet.querySelectorAll("*")].filter((el) => el.children.length === 0 && (el.textContent || "").trim()).map((el) => getComputedStyle(el).fontSize),
    };
  })()`) as ScreenResult;

  if ("error" in r) {
    failures.push(`${view}: 未找到预览容器`);
    continue;
  }

  // R2 一律一行
  if (r.noticeTitles.length)
    failures.push(`${view}: 通知轨出现标题（应一行）→ ${JSON.stringify(r.noticeTitles)}`);
  // R3 一律文字动作
  if (r.noticeButtons.length)
    failures.push(`${view}: 通知轨出现按钮（应文字动作）→ ${JSON.stringify(r.noticeButtons)}`);
  // R1 位置数量
  if (r.noticeCount > 2)
    failures.push(`${view}: 状态块超过两个合法位置 → ${r.noticeCount}`);
  // R5 字号档位
  const bad = [...new Set(r.sizes)].filter((s) => !ALLOWED_SIZES.has(s));
  if (bad.length) failures.push(`${view}: 出现档位外字号 → ${bad.join(", ")}`);
  // R6 通知轨几何唯一
  const geos = [...new Set(r.noticeGeometry.map((g) => `${g.x}/${g.w}`))];
  if (geos.length > 1)
    failures.push(`${view}: 通知轨几何不一致 → ${geos.join(" vs ")}`);
  for (const g of r.noticeGeometry) {
    if (g.radius !== "6px" && !/^6px( 0px){3}$/.test(g.radius))
      notes.push(`${view}: 通知圆角 ${g.radius}（应为只圆左侧 6px）`);
  }
  // R4 内容列一致
  const xs = [...new Set(r.blocks.map((b) => b.x))];
  if (xs.length > 1)
    failures.push(
      `${view}: 内容块不在同一列 → ${r.blocks.map((b) => `${b.name}@${b.x}`).join(", ")}`,
    );
}

await browser.close();
if (server) server.kill();

for (const n of notes) console.log(`note  ${n}`);
if (failures.length) {
  console.error(`\n效果稿规则检查失败 ${failures.length} 项：`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(
  "效果稿规则检查通过：" + VIEWS.length + " 屏；规则 R1-R6（位置数量/一行/文字动作/同一内容列/字号档位/通知几何）",
);
