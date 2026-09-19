# 交接：画布能力改造（新对话从这里开始）

日期：2026-09-18。用途：**把画布这条线完整交接给新对话**,避免重复调研。

## 你要做的

在 Web GUI 里**手动开一个新对话**,把下面这段直接粘进去:

```
读 docs/research/2026-09-18-CANVAS-HANDOFF.md，按里面的交接内容继续做画布能力改造。
先不要改代码，先把第 1 步的实现方案给我确认。
```

## 交接内容

### 1. 已定稿的结论（不要重新讨论）

- **定稿文档**：[2026-09-18-canvas-next-capabilities-review.md](2026-09-18-canvas-next-capabilities-review.md)（第三版，已过文档门禁）。
- **核心主张**：短剧主链路（生成 → 组织 → 比较 → 选用）现在**一次一个镜头**；而**场次连续性无法在单镜头内判定** —— 这是结构性问题，所以第 1 步必须把粒度改粗。
- **第 1 步三项必须一起做**：① 按场次/所选镜头批量生成；② 镜头列表与候选的多选批量；③ 画布↔镜头↔候选的明确衔接（**不自动采用**，守住既定边界）。
- **业务模型不对齐竞品**：镜头节点、固定版本、明确采用、每场一张画布、画布不做采用 —— 这些是短剧工具的定位本身。

### 2. 依据文档（都在，不用重查）

| 文档 | 内容 |
|---|---|
| [2026-09-18-canvas-capability-inventory.md](2026-09-18-canvas-capability-inventory.md) | 即梦（两套画布）与 LibTV 的能力全景 + 实机走查 + 未确认清单 |
| [2026-09-18-scenedesk-canvas-gap-analysis.md](2026-09-18-scenedesk-canvas-gap-analysis.md) | SceneDesk 现状 + 27 项三方逐项对照 + 建议补/不补 |
| [../design/research/2026-09-14-libtv-canvas.md](../design/research/2026-09-14-libtv-canvas.md) | 旧 LibTV 调研，已回填实机进展 |
| `output/research/2026-09-18-jimeng-upload-ux.md` | 即梦全量调研（1878 行，含第 11/12 章画布） |
| `output/research/2026-09-18-libtv-identity-and-upload-ux.md` | LibTV 全量调研（540 行，第 4 章画布） |

### 3. 实机证据与可复现脚本

- 位置：`output/reviews/2026-09-18-workspace-usability-round-2/probes/`（**88 张实测截图 + 20 个 Playwright 脚本**）
- **登录态已备好**（在 `.runtime/bench-profiles/`，已被 `.gitignore` 覆盖）：
  - `jimeng/` —— 即梦已登录，可直接用 `chromium.launchPersistentContext` 复用
  - `libtv/` —— LibTV 已登录，同上
- **注意**：用这些 profile 前先删 `Singleton*` 锁文件（脚本异常退出会留 stale lock 导致启动挂住）。
- 即梦有两套画布：`/ai-tool/canvas`（`jimeng/` 构建）与 **`/ai-tool/ai-canvas`（`lvweb/octo_web/` 独立构建，9 类节点，能力更全）** —— 查即梦画布能力**要看后者**。

### 4. 第 1 步落地前必须先过用户的点

按仓库约定（根 `AGENTS.md`「⚠️ 先问」）：

- **批量生成会新增公开契约操作** —— 改契约前必须先取得用户确认。
- 契约修改顺序：先改 `docs/implementation/build_contract.py` 等契约模块 → 跑生成器 → `check_design.py` → `npm run contracts:generate`；并同步维护 `sample-payloads.json`。
- 数据库 schema 改动同样先问。

### 5. 第 1 步的三个切片（建议，待方案确认）

| 切片 | 范围 | 涉及的层 |
|---|---|---|
| ① 批量生成 | 选中 N 个镜头节点 → 一次提交 N 个作业；合计估价；按并发与预算排队；失败逐项可见可重试 | 契约 + API + 队列消费 + 画布 |
| ② 镜头/候选多选 | 镜头列表与候选工作区从单对象改为多选 + 批量动作 | 前端为主（`ShotListWorkspace` / `CandidateWorkspace`） |
| ③ 画布↔候选衔接 | 画布结果一键进候选、跳回来源节点；候选反查生成现场。**不自动采用** | 契约 + 前端 |

**依赖关系**：① 的批量提交要以「生成前可执行性校验」和「估价」为前置（画布 review §2 第 6–7 项），否则批量会放大不可见的付费风险。

### 6. 当前仓库状态

- 分支：`feat/workspace-usability-round-2`（从 `main` 的 `39dec64` 切出）
- 本轮已提交：`86b95bd chore(repo): ignore macOS .DS_Store files`
- 未提交的改动：本篇交接文档 + 四份画布研究文档 + `output/` 下的证据
- **未推送**（用户未要求）
- 文档门禁：最后实测 **PASS**（1705 处内部引用可解析）

### 7. 与另一条线的边界

同轮还有两条**用户报告的问题**在另一个对话里处理，**不要混进画布切片**：

- 问题 01：新建项目后的剧本页面布局杂乱（`ContentWorkspace` / `ScriptDocumentReader`）
- 问题 02：素材库上传的流程与体验差（`AssetWorkspace` / `MediaWorkspace` / `MediaImports`）

它们的记录在 `output/reviews/2026-09-18-workspace-usability-round-2/README.md`。

**唯一的交汇点**：画布内的素材浏览器（`CanvasMediaBrowser`，画布 dock 里）读的就是资产库同一份 `Media`，且**目前是单选**。画布第 1 步的第 ③ 项与问题 02 耦合最紧 —— 两个对话如都动到这里，需协调。
