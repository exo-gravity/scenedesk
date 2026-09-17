# 工作区头部与控件重构

2026-09-17。依据本机工作台实测发现的 7 个界面问题，用户逐条确认了优化方案，并要求拆成 4 个切片交付，每片经独立审查与端到端 UI 测试后提交 PR。

评审记录、效果图与逐条确认见 `output/reviews/2026-09-17-local-workspace-findings/`（该目录未纳入版本控制）。效果图用项目真实主题与 Mantine 组件渲染，不是手绘示意图。

## 已确认的决定

| 议题 | 结论 |
|---|---|
| 资产库分类行 | 三带统一（身份／视图／查询）；分类 **9 项全部铺开**并按契约的两个 kind 枚举分组：设定资产 5 ｜ 媒体素材 4。删除固定 `slice(0, 7)`，分类行补响应式断点 |
| 剧本操作行 | 「选文带入画布」保留常驻，未选中正文时 `disabled` 并给 Tooltip；取消下面那行常驻提示文字 |
| 剧本页菜单 | 从「…」移除「场次目录」；场次目录统一由画布菜单提供；`.../content` 旧深链继续可达 |
| 侧栏图标 | 折叠改用面板图标 `SidebarSimple` 并补 Tooltip；返回保留 `ArrowLeft`；两者尺寸统一到主题 token |
| 管理分组 | 改为画布工具轨上的一个工具（与「查找」同构，点开 Popover），移除右上原生 `details` 浮动岛与硬编码 `right: 180px` |
| 命名 | 剧本页 h1 与浏览器标题用「剧本」（与导航同词）；标签页改为「剧本正文 ／ **剧目设定**」；`CONTEXT.md` 补「剧本」术语 |
| 声音设定图标 | 改用 `UserSound`；「音频」保持 `Waveform`（原先两者共用同一图标） |
| 分组命名 | 统一为「分组」（原创建叫「组合」、管理叫「管理分组」） |

## 切片 1：命名统一

分支 `feat/workspace-naming-consistency`。

**改动。** 剧本页 h1 与浏览器标题由「剧本与设定」改为「剧本」，与左侧导航同词；简介相关的一切界面文案由「故事设定」改为「剧目设定」，与 `CONTEXT.md` 的定义一致（含标签页、加载提示、简介字段自身的标签、项目页小节与按钮、剧目设定版本行）；`CONTEXT.md` 补「剧本」术语条目，并把「剧目」条目里的「共同故事设定」改为「共同故事背景」以免与已改名的对象混淆；画布的分组创建项由「组合」改为「新建分组」；现行交互规范 `02-interaction-spec.md` 里的项目目录命名同步。

**未改。** 历史实施记录（`22`、`62`、`63`）保留原文；设计预览原型（`src/App.tsx`、`src/pages/**`）保留旧词，它只在 `VITE_ENABLE_DESIGN_PREVIEWS=true` 时可达，不是生产界面。

**一处需要澄清的说法。** 提交信息里「旧深链页面的标题此前说『场次』、现在与浏览器标题一致」只对**隐藏分支**成立：`/content` 实际渲染的 `SectionHeading` 一直是「场次目录」（`ContentWorkspace.tsx` 第 387 行，在本次改动前就是这样），本次改动的是被 `<div hidden={!scriptView}>` 包住的那一份重复标题。它让不可见的分支保持一致，**没有修复任何用户可见的缺陷**。

**验证。**

| 检查 | 结果 |
|---|---|
| `npm run check`（契约生成物、UI 规则、类型、生产构建、单元） | 265/265 通过 |
| 完整生产浏览器套件 `npm run test:e2e`（一次性 `drama_e2e_naming` 库，真实 API） | **37/37 通过**，2.6 分钟 |
| 真实工作台 UI 验证（本机 4311，真实 API 与数据，只读取与选中） | **13/13 通过**，含剧本页 h1／浏览器标题／标签页、旧深链标题、项目页「剧目设定」且无旧词、以及画布选中两个节点后菜单显示「新建分组」 |
| 独立对抗式 code review（无对话上下文的独立 agent） | 6 项发现，其中 1 项为真实遗漏（简介字段标签仍为「故事与创作设定」），已修 |

**已知未处理（评审发现，超出本片确认范围）。**

- `Projects.tsx` 的项目详情主按钮写「进入剧本与集场镜」、`BusinessApp.tsx` 的占位页写「返回剧本与集场镜」，而目标地址 `.../content` 渲染的是「场次目录」；同一目的地存在三个名字。属既有问题，未在本次改动范围内。
- `.../content?revision=…` 会让 `scriptView` 为真，于是 h1 与浏览器标题显示「剧本」，而面包屑仍显示「场次目录」。同上，既有问题。

## 切片 2：图标与原生控件

分支 `feat/workspace-controls-and-icons`。

**改动。** 侧栏折叠控件改用 `SidebarSimple` 并补 Tooltip，与「所有项目」的返回箭头分成两套字形；两者尺寸统一为 18（原先 17 与 16，没有理由）。资产库的「声音设定」改用 `UserSound`，「音频」保持 `Waveform`。画布的分组管理由原生 `<details>/<summary>` 浮动岛改为工具轨上的一个工具，点开 `Popover`，与既有的「查找」同构；原生展开三角、硬编码的 `right: 180px` 与 `.groupMenu` 样式一并移除；无分组时给出创建指引。

**关于主题 token 的一处偏离。** 确认决定写的是「两者尺寸统一到主题 token」。`apps/web/src/theme/tokens.ts` 里没有图标尺寸 token，而全应用其余图标都使用字面量，只为两处调用点新增 token 并不能统一任何东西。因此改为**把两个尺寸统一为一个值**；引入整套图标尺寸刻度属于覆盖全应用的另一项改动，未在此片进行。

**关于受控 Popover。** Mantine 的 `PopoverTarget` 只在非受控时给 target 挂 `onClick`（源码 `node_modules/@mantine/core/esm/components/Popover/PopoverTarget/PopoverTarget.mjs`：`...!ctx.controlled ? { onClick: … } : null`）。本片需要 `opened` 受控以保住「有未保存的分组名草稿时保持面板打开」的行为，因此工具按钮自带 `onClick`。

**验证。**

| 检查 | 结果 |
|---|---|
| `npm run check` | 265/265 通过 |
| 完整生产浏览器套件 `npm run test:e2e`（一次性 `drama_e2e_controls` 库，真实 API） | **37/37 通过**，2.4 分钟 |
| 真实工作台 UI 验证（本机 4311，真实 API 与数据，只读取与选中） | **10/10 通过**：折叠与返回不再同字形且有 Tooltip；「声音设定」与「音频」图标不同；工具轨出现「管理分组」；画布上不再有原生 `summary`；点开后面板出现 |
| 独立对抗式 code review（无对话上下文的独立 agent） | 10 项发现，其中**两项 High 为本片引入的真实回归**，已修并补了专门的 E2E 用例，见下 |

**独立审查发现并已修的问题。**

1. **（High，本片引入）有未保存草稿时面板关不掉。** 旧 `<details open={showGroups}>` 是声明式的：React 只在 prop **值变化**时写 `open` 属性，所以用户手动关闭后不会被重新打开。改成受控 `Popover opened={showGroups}` 之后，`opened` 每次渲染都从状态重新求值，而 `showGroups` 一开始把「存在 `group:` 草稿」直接并入，于是草稿存在时点击、Escape、点击外部全部失效。改法：拆出 `groupsDismissed`，`showGroups = groupsExpanded || (hasGroupDraft && !groupsDismissed)`，手动关闭即置该标记。
2. **（High，本片引入）键盘不可达。** 面板内联挂在工具轨内、位于触发按钮**之后**，Tab 无法进入；`trapFocus` 默认关闭、`returnFocus` 未设，焦点在按钮上时 Escape 也无效。旧 `<summary>` 的内容距其一 Tab。改法：加 `trapFocus` + `returnFocus`，首个 `TextInput` 加 `data-autofocus`，与 `SceneNavigator` 的既有模式一致。
3. **（Medium）浮层被压在「查找」面板之下。** `withinPortal={false}` 让浮层留在工具轨的 `z-index: 7` 层叠上下文里，而 `.utilities` 是 `z-index: 8`；浮层自身虽设 `z-index: 300` 也无法穿透。改法：去掉 `withinPortal={false}`，走默认 portal。
4. **（Low）可访问名与决定不一致。** `aria-label` 曾是「管理分组」，而决定已把该词统一为「分组」；同时 `aria-pressed` 与 Popover 自带的 `aria-expanded` 语义重复（disclosure 不该用 pressed）。改法：`aria-label="分组"`，去掉 `aria-pressed`。
5. **（Low）侧栏 Tooltip 与可访问名不一致**（「侧栏」对「项目导航」）。改法：Tooltip 文案与 `aria-label` 对齐。

**新增回归测试。** `tests/e2e/canvas-groups.spec.ts` 覆盖：空态、Escape 关闭、从「查找」列表多选两个节点建组、打开后输入框获得焦点、清空名称产生草稿、**草稿存在时仍可用 Escape 与再次点击关闭**、以及重新打开后草稿仍在。已用「临时改回错误形式」验证该用例确有区分力：错误形式在第 91 行（Escape 后面板应隐藏）失败，修正形式通过。

**已知未处理。** 本次只改了「管理分组」这一个原生展开控件。业务代码里还有约 60 处 `<details>/<summary>`，它们同样显示浏览器默认三角，但都是面板**内部**的就地展开（「查看固定来源」「版本历史」「更多参数」等），与本次的问题性质不同：被发现的是**一个绝对定位的浮动岛**，用的是原生控件且带硬编码偏移。把这些就地展开统一成项目自己的展开组件属于覆盖全应用的另一项改动，未在此片进行。

