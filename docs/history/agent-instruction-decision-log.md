# Agent 指令文件的决策记录(冻结)

冻结日期：2026-09-17。这是 `AGENTS.md` 与 `apps/web/AGENTS.md` 在 2026-09-17 整理**之前**所携带的日期化决策记录。

**这份文件只作历史阅读，不是现行规范。** 当时这些内容按"最新一条覆盖较早条目"的方式堆叠在指令文件里，读者必须先做版本仲裁才能知道当前规则。整理后，现行规则以两处指令文件为准，被取代的条目移到这里保留原文。

返回[文档入口](../README.md)、[历史索引](README.md)、[根工程约定](../../AGENTS.md)、[前端工程约定](../../apps/web/AGENTS.md)。

## 根 `AGENTS.md` 移除的时效化段落

以下三段原文以日期和"Latest …"开头，并包含当时的临时外部条件。

> Latest delivery order (2026-09-16): finish the retained creative-workspace refactor and its non-provider acceptance first, then integrate real models last. This changes delivery order, not the canvas/AI scope or paid-call authorization requirements. Preserve separate evidence for controlled fixtures, actual Feishu team authorization, real provider execution, and external deployment.

> The user authorized implementation and merging verified changes into `exo-gravity/scenedesk`. Latest first-release direction (2026-09-11) supersedes the original full-platform launch gate: prioritize a usable private creative workspace; defer post-production editing/rendering, full team management, public signup and operations. The user explicitly retained canvas and AI capabilities according to the original plan, including generation, fixed inputs/results and documented recovery; do not reduce them to a lightweight board or text-only assistant. See `docs/implementation/38-first-release-scope-review.md`. Preserve deferred code and history, but do not continue media normalization/rendering as a prerequisite for this MVP. Commercial billing and cost operations are deferred; safe model execution, limits and duplicate-submission protection remain necessary. Imported media supports manual workflows but cannot replace real AI acceptance. Do not make paid provider calls without the actual service, credentials and spending authorization.

> Latest refactor authorization (2026-09-16): implement the independent Web creative-workspace direction in `docs/design/creative-workspace-approved-2026-09-16.md`, delivered incrementally using `docs/implementation/70-creative-workspace-refactor.md`. Canvas is the main creative workspace; scripts are primarily imported/read, shots become an optional list/focus view. Preserve all execution and recovery invariants. The approved prototype is a reference, not production code or real-model acceptance.

以及以临时外部条件开头的合并授权段：

> 2026-09-16 manual-merge authorization: while GitHub Actions jobs cannot start because of account billing/quota, the user authorizes continuing development and ordinary manual merges after relevant local verification and diff review. Record the exact merged head, local evidence, and checks that did not run; never represent unavailable CI as passing. Prefer merging with the GitHub CLI and ask the user to merge only when their access is actually required. This does not authorize changing repository visibility, weakening protections, or ignoring a relevant unresolved product failure.

### 为什么移除

三段都在陈述**当时**的顺序、范围和授权状态，并靠"Latest …"自我标注新旧。整理后它们的现行含义已并入根文件的 `Current scope and delivery order`；合并授权段的通用规则（记录合并头、记录未运行的检查、不把不可用的 CI 写成通过、不借此削弱保护）提炼为常驻条目，去掉了"额度耗尽期间"这一时效外壳。原文在此保留。

## `apps/web/AGENTS.md` 移除的按日期堆叠条目

前端文件当时由 12 段日期化条目构成，其中若干条明确标注"取代下方冲突规则"。以下为**已被取代**或**仅为阶段性状态**、整理时删除的内容。

### 2026-09-15 项目导航顺序（已被取代）

> Project navigation (user correction, 2026-09-15): show `剧本`, `场次`, `资产` in that exact order. The studio entry remains `资产库`.

被 2026-09-16 的创作工作区条目取代：现行项目导航为 `剧本`、`画布`、`项目资产`。`资产库` 仍为工作室入口。

### 2026-09-14 全局头部居中模式切换（已被取代）

> Latest approved structure (2026-09-14): … Default scene entry is canvas; preserve the full storyboard mode. Center `画布 / 分镜` in the whole desktop header; place a compact episode/scene navigator at the left. Use one scene header, a narrow canvas tool rail, truly node-local creation, and the flush right conversation sidebar. Preserve mode/scene editing state and all durable execution/recovery semantics. This supersedes the v0.5 screen-overlay placement rule for node editing; the approved image is a layout reference, never permission to fabricate media or model results.

其中"全局头部居中放 `画布 / 分镜`"与"左侧独立集／场次选择器"被 2026-09-16 的导航收敛取代：模式切换在场次工作区内，场景创建与 `场次目录` 由共享的画布切换器负责；2026-09-16 的壳层整理又移除了已登录页面的独立全局头部。其余规则（默认进入画布、保留分镜模式、窄工具轨、就近创建、右通栏助手、恢复语义、效果图仅为布局参考）仍在现行文件中生效。

### 2026-09-14 v0.5 浮层辅助面板（已被取代）

> On 2026-09-14 the user accepted `docs/design/canvas-redesign-v0.5-2026-09-14.md` and authorized implementation. This supersedes the older common bottom editor and layout-consuming canvas dock: explicit contextual editing, a separate editing target, one overlay auxiliary panel, and same-session focus editing. Fixed attempts and editable drafts stay independent. Include real fixed canvas-node assistant context and guarded suggestion application; the design prototype is not production implementation.

其中"一个浮层辅助面板"及 v0.5 的节点编辑浮层规则，被同日之后的助手修正与 2026-09-16 方向取代：助手改为**右侧通栏对话侧栏**，节点编辑保持就地上下文。其余规则（显式就地编辑、独立编辑目标、同会话专注编辑、固定尝试与可编辑草稿独立、真实固定画布节点上下文、受保护的建议应用、设计原型不等于生产实现）仍在现行文件中生效。

### 2026-09-13 阶段性行冻结说明（仅状态）

> On 2026-09-13 the user explicitly requested further visual, information-architecture and interaction improvements on the existing foundation, with parallel design review and end-to-end implementation. This reopens the older phase-specific layout freeze below. …

"重新打开此前的阶段性布局冻结"只是当轮状态；现行文件保留的是其结果规则：按 `creative-experience-refinement-2026-09-13.md` 推进，并保留媒介优先工作区、固定输入、显式执行与恢复语义。

### 2026-09-16 八个 PR 的阶段进度（仅状态）

> … During PR-1 the existing production workspace keeps its retention-aware shell; PR-2 integrates project canvas and guarded workspace navigation. …

PR-1／PR-2 的交付阶段已完成并合入，属实施进度而非常驻规则，状态以 `docs/implementation/22-implementation-progress.md` 与 `70-creative-workspace-refactor.md` 为准。

### 2026-09-11 范围段（与根文件重复）

> Latest user direction (2026-09-11): prioritize a usable private creative workspace. Post-production editing/rendering, full team management, public signup and operations are outside this MVP. …

该段与根 `AGENTS.md` 的 `Current scope and delivery order` 重复。为避免两处漂移，范围规则收归根文件；前端文件只保留其中与页面直接相关的部分（基于真实 API、保留受保护导航／草稿／固定历史、在列表／聚焦／比较／选用可用后才替换完整分镜流程、把已后置的后期与运营导航移出发布流程）。

## 文档维护约定

本文件按[历史索引的维护约定](README.md)冻结：不再改写，不作为当前依据。若需了解整理后的现行规则，请阅读[根工程约定](../../AGENTS.md)与[前端工程约定](../../apps/web/AGENTS.md)。
