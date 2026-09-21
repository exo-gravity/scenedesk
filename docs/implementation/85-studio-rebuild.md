# 85 核心创作区重建：分片记录与流程对照

日期：2026-09-21。依据：[核心创作区重建决定](../design/creative-workspace-rebuild-libtv-2026-09-21.md)（已确认）。分支 `feat/studio-rebuild`，独立 worktree；每片先交「LibTV 截图 vs 新页面」并排图再提交，不推送。

状态：**阶段 0 与阶段 1（①②③④）已交付，构成第一个 PR；阶段 2、3 在叠加分支上继续（§6）。** 本文只记每一片实际做了什么、怎么验证的，以及决定文档附录 A 的 21 条流程规则在新面板里的落点；范围、边界与分期以决定文档为准，不在此重述。

## 1. 阶段 0（准备）

| 项 | 交付 | 验证 |
|---|---|---|
| 目录骨架 | `apps/web/src/studio/`：`StudioEntry.tsx`（路由入口、项目读取、顶栏与空创作台）、`studio.module.css` | `npm run ui:check` 的范围已含该目录 |
| 新入口 | `#/app/t/{tenant}/p/{project}/studio`。`BusinessApp` 在成员权限核对后直接渲染创作台，不经过工作室栏、位置栏与项目左栏，占满视口；`/canvas`、`/script`、`/production` 等旧入口不变 | [`tests/e2e/studio-entry.spec.ts`](../../tests/e2e/studio-entry.spec.ts)（ST-00）：新入口可打开、三个视图名与当前视图、环境标识、无旧导航；旧 `/canvas` 仍显示项目导航与「创建项目画布」 |
| 主题变量 | `--ws-studio-*`：8 个尺寸（`tokens.ts` 的 `studio`）与 12 个颜色角色（`theme.ts` 的 `scheme()`，浅深各一组），颜色值全部来自现有调色板 | `ui:check` 对比度；清单记入[共同视觉语言 §6](../design/shared-visual-language-v0.1.md) |
| 边界门禁 | `scripts/check-ui.ts`：`src/studio/` 下的文件禁止 import 决定文档 §3「不碰，切换后删除」类文件 | `npm run ui:check` |
| 封存分支的纯逻辑 | 从 `feat/canvas-cards-redesign` 原样带入 8 个模块与 6 组单测（§3） | `npm test` |
| 流程对照表 | 附录 A 21 条 → 现有实现位置 → 新归属与片 → 验证方式（§4） | 用户评审 |

未做，属于后续片：底部工具条、缩放、快捷键总览、视图切换的实际跳转、创作台切换、保存状态、任务、助手、账号。顶栏上的三个视图名此时是静态文字，「创作台」标为当前；创作台本体为空。

并排图：[phase-0-shell.png](../design/assets/2026-09-21-studio-rebuild/phase-0-shell.png)（左 LibTV `libtv-image-selected`，右 ST-00 在 1920×902 浅色下的新页面）。本机检查：`ui:check` 通过、`typecheck` 通过、`npm test` 303/303、`vite build` 通过、ST-00 通过。后端、契约、迁移均未改；未发起付费生成。

## 1a. 第 ① 片：页面壳、创作台本体与四类卡片

| 项 | 交付 | 验证 |
|---|---|---|
| 页面壳 | `StudioFrame.tsx`：顶栏（项目胶囊、视图切换、保存状态、环境标识）；`shell/Toolbar.tsx` 底部工具条（＋ 文字／图片／视频／音频、选择 V、平移 H、撤销、重做、快捷键）；`shell/ZoomControl.tsx` 左下缩放（放大、缩小、适应内容、100%）；`shell/Shortcuts.tsx` 快捷键总览，只列已实现的 | ST-01 |
| 创作台本体 | `board/Board.tsx`：React Flow 接 `use-canvas`／`canvas-controller`（文档、本机恢复、自动保存、撤销重做）；平移（滚轮、Space、抓手）、缩放（捏合、⌘滚轮、⌘+/−/0）、框选、Shift 加选、拖动（分组同移）、删除（⌫）、复制（⌘D，`copyCanvasNodes`）、全选、Esc；右键菜单（重命名、复制、删除）；视口与选中集写入 `workspace-preference`，其余键不碰 | ST-01：新建、输入、改名、缩放、刷新恢复、删除、撤销、右键删除，并读公共接口核对 |
| 四类卡片 | `board/Card.tsx`：标题在卡外（类型图标 + 名称，双击改名，`renameCanvasNode` 校验）；本体白底细边圆角；图片／视频草稿按画幅定高（`draftFrameAspect`），空态只有居中浅灰图标；音频草稿固定高；媒体卡以 `MediaPreview` 铺满，视频叠播放标；文字卡双击就地编辑纯文本、右下拉伸角只改宽度（`updateCanvasNodeGeometry`）；固定摘录只读；选中细边变深并露出两侧端口（端口本片不可拖连）；键盘焦点另有描边；已有分组只在卡名旁显示分组名 | ST-01；归档项目只读用例 |
| 新入口的空态 | 项目尚无创作台时居中提示与「创建项目创作台」 | ST-01 |

未做，属于后续片：端口拖连与 ⊕ 继续创作（②）、输入面板（③）、卡内生成状态与结果、上传（④）、资产面板（⑤）、视图切换的实际跳转、创作台切换、项目菜单、账号、助手与任务（⑧）。多选时的「查看 N 项的生成计划」与「关联镜头」随 ③／⑦ 进右键菜单。

并排图：[slice-1-image-selected.png](../design/assets/2026-09-21-studio-rebuild/slice-1-image-selected.png)、[slice-1-text-edit.png](../design/assets/2026-09-21-studio-rebuild/slice-1-text-edit.png)、[slice-1-shortcuts.png](../design/assets/2026-09-21-studio-rebuild/slice-1-shortcuts.png)。本机检查：`ui:check` 通过、`typecheck` 通过、`vite build` 通过、ST-00 与 ST-01（两例）通过。

实现中定下的两条细则：新卡从视野中心放起，若会盖住已有卡则移到该卡右侧；新建的文字卡在 React Flow 量出尺寸前是隐藏的，焦点在其可见后才落入输入框。

## 1b. 第 ② 片：端口、拖连、用途、⊕ 继续创作、引用角标

| 项 | 交付 | 验证 |
|---|---|---|
| 端口 | 文字与媒体卡只有右侧「作为参考」端口，草稿只有左侧「接收参考」端口；选中或悬停时出现，拖连进行中所有草稿的端口亮起 | ST-02 |
| 拖连 | React Flow 连接接 `appendCanvasReference`（同来源同用途拒绝，位置顺延）；`isValidConnection` 只放行「文字／媒体 → 草稿」；默认用途：文字→提示、音频→声音、图片／视频→构图 | ST-02：拖连成功、重复拒绝并提示、公共接口核对 |
| 用途 | 连线右键菜单：用途子菜单（文字来源只有「提示」，媒体来源为全部用途）、停用／启用、删除；停用的连线虚线；连线可点选，⌫ 删除所选连线 | ST-02：停用、删除 |
| ⊕ 继续创作 | 单选一张可作来源的卡（有内容的文字、已有媒体）时卡右侧出现 ⊕（屏幕尺度，不随缩放），选图片／视频／音频后由 `prepareCanvasCreation`／`createCanvasDraft` 固定来源身份、在右侧放新草稿并连线；多选时在右键菜单「共同作为参考」；草稿不能作来源 | ST-02：⊕ 建视频草稿并连线、草稿无 ⊕ 且菜单项禁用 |
| 引用角标 | 被引用的卡显示用途角标：媒体卡在缩略图左上角，文字卡在标题行；状态由 `referenceState` 决定（已停用、来源不在、素材读取失败、归档、待验收） | ST-02：提示 → 已停用 |

未做，属于后续片：输入面板里的参考缩略图与用途角标（③）；生成时的来源快照（③）。

并排图：[slice-2-references.png](../design/assets/2026-09-21-studio-rebuild/slice-2-references.png)。本机检查：`ui:check`、`typecheck`、`vite build`、ST-00／ST-01／ST-02 通过。

实现中定下的细则：交给 React Flow 的回调与配置对象保持稳定身份（`useCallback`、模块常量），并且创作台组件不订阅 React Flow 的连接状态（改用 `onConnectStart`／`onConnectEnd`）——否则它的 store 更新器会在每次渲染写入 store，而订阅者又触发下一次渲染，直到 React 报「更新深度超限」。`Board` 自己的 `onNodesChange` 等处理函数每次渲染重建，这只在创作台不订阅 store 的前提下安全，代码里已注明。

## 1c. 第 ③ 片：输入面板、模型列表、规格浮层、提交接生成会话

| 项 | 交付 | 验证 |
|---|---|---|
| 输入面板 | `composer/Composer.tsx`：选中生成草稿即出现在卡的正下方、左对齐、660 宽、白底细边轻阴影、高随内容；行 1「＋参考」、行 2 参考缩略图（48px，用途角标，状态角标）、行 3 提示词大字、底行 `模型 ▾`、规格 `▾`、状态文字、黑色圆形 ↑；文本卡不出面板。放置算法 `composer/placement.ts`（下→右→左→上，无处可放时裁边，四边皆不可时停靠左下），单测 `tests/studio-composer-placement.test.ts` 9 例 | ST-03 |
| 模型列表 | `composer/ComposerControls.tsx` `ModelPicker`：行 = 图标、名称（能力记录的 `modelVersion`，不改名）、状态小字（已接入／受控测试）；选中浅灰底；一个都没有时「暂无可用模型」；无耗时、无费用 | ST-03 |
| 规格浮层 | `SpecificationPicker`：比例为带图形的方块 tile、清晰度两列格子、时长滑杆 + 数字 + s（固定时长只显示数值）、生成音频开启／关闭、固定镜头来源（接 `CanvasShotSources`）；只列该模型允许的项；无生成数量 | ST-03 |
| 提交 | `useGenerationSession` 原样接入；一次点击固定输入并提交；附录 A 第 1–9、16–20 条逐条落地（对照见 §4 的「片」列）。底行只有「模型 · 规格 …… 状态 · 圆钮」：有任务时状态文字本身就是「核对任务」按钮，圆钮按阶段变脸——↑ 生成／继续生成、处理中转圈、回执未知时为「核对后恢复原提交」、任务落定或可续时为「保留原任务，准备下一稿」（第 14、15 条），长文字只在 tooltip 与无障碍名里（用户 2026-09-21 对首版长胶囊的反馈） | ST-03 三例：一次提交（plans=1、jobs=1）、准备下一张并刷新恢复、丢回执后只核对不重发、撤权后面板换成核对提示且创作台隐藏项目 |

未做，属于后续片：专注编辑的展开图标、上传、每张卡的历史入口、卡内生成状态与结果（④）；多选时右键菜单的「查看 N 项的生成计划」（随 `CanvasGenerationBatch` 整体接入，放到 ④ 末尾）。

按用户 2026-09-21 的要求保持克制，本片主动不做：面板的费用与耗时显示（能力记录里没有）、`@` 引用、模型说明文案、生成数量、参考的拖拽排序（旧界面也没有）。

并排图：[slice-3-composer.png](../design/assets/2026-09-21-studio-rebuild/slice-3-composer.png)、[slice-3-model-picker.png](../design/assets/2026-09-21-studio-rebuild/slice-3-model-picker.png)、[slice-3-spec-picker.png](../design/assets/2026-09-21-studio-rebuild/slice-3-spec-picker.png)。本机检查：`ui:check`、`typecheck`、`npm test`、`vite build`、ST-00～ST-03 通过。

## 1d. 第 ④ 片：卡内状态与结果、专注编辑、历史、上传

| 项 | 交付 | 验证 |
|---|---|---|
| 卡内状态 | `results/useNodeResults.ts` 的 `taskLabels`：每张草稿最新一次尝试的状态（排队中、正在生成、生成失败…）在卡内左下小标签；成功不显示标签 | ST-04 |
| 结果铺满 | `useNodeResults`（`latestSucceededAttempts` + 受限并发读取 job／media，每个身份只读一次）；卡的本体换成结果媒体；刷新后仍在；重试未成功前保留上一张 | ST-04：完成后卡内出现结果，刷新后仍在 |
| 放置与恢复 | 面板任务行：`添加到创作台`（先再保存创作台、`canvasResultPosition` 算位、进入评审）→ 确认对话框（只在评审态、权限就绪、任务成功时打开）→ `submitCanvasResultPlacement`（412 → 冲突态；成功后回调刷新）；回执未知只给「恢复本次添加」；归档失败两步「核对／继续原归档恢复请求」；附录 A 第 10–15、21 条 | ST-04：放置后节点数 3→4、不建 take、jobs=1 |
| 专注编辑 | 面板右上展开图标 → 同一面板放进对话框，提示词更高 | 手动 |
| 历史入口 | 面板右上「历史 N」与右键菜单「尝试与结果」→ `results/History.tsx`：该卡的固定尝试列表（缩略图、状态、时间）→ 单次尝试的固定输入（提示、模型、规格、参考数）与结果，只读 | ST-04：刷新后历史列出 1 次，固定提示词正确 |
| 上传 | `CanvasUploads` 整体接入：拖文件到创作台或 ＋ 菜单「上传」，导入行以虚线卡出现在落点 | 手动（受控夹具没有素材处理器） |
| 批次入口 | 多选草稿时右键「查看 N 项的生成计划」→ `CanvasGenerationBatch` 整体接入（自带确认屏） | ST-04：选择不提交，打开只准备 |

按用户要求保持克制，本片主动不做并记录：与上次结果的 A／B 比较（旧界面的「与上次比较」，不在决定文档的片内）；任务详情对话框与取消（`GenerationJobControls`，留待任务坞 ⑧ 统一承载）；从历史里把旧结果放回创作台（附录 A 第 3 条的检视会话 `openExisting` 因此没有启用：历史只读，不开检视会话、不放置；如需从历史放置再单独接）。

并排图：[slice-4-result.png](../design/assets/2026-09-21-studio-rebuild/slice-4-result.png)（受控夹具的视频没有海报衍生物，所以结果框里是占位图标而不是画面）。本机检查：`ui:check`、`typecheck`、`vite build`、ST-00～ST-04 通过。

## 2. 新目录的模块规划

按决定文档 §6 分片，目录随片建立，不预先建空目录：

| 位置 | 内容 | 片 |
|---|---|---|
| `studio/StudioEntry.tsx` | 路由入口、权限之后的项目读取、视图分派 | 0 |
| `studio/shell/` | 顶栏（项目菜单、视图切换、创作台切换、保存状态、任务、助手、账号）、底部工具条、缩放指示、快捷键总览 | ①⑧ |
| `studio/board/` | React Flow 创作台：四类卡片、端口与连线、右键菜单、快捷键、框选、就地文本编辑、改名；接 `use-canvas`／`canvas-controller` 的保存与恢复 | ①② |
| `studio/composer/` | 输入面板（`Composer.tsx`）、模型与规格（`ComposerControls.tsx`）、参考行（`ComposerReferences.tsx`）、放置（`placement.ts`）；接 `use-generation-session` 与三种生成的请求构造 | ③ |
| `studio/results/` | `useNodeResults.ts`（结果与状态标签）、`History.tsx`（历史与只读检视）；放置评审与归档恢复在 `composer/Composer.tsx` 的任务行 | ④ |
| `studio/assets/` | 资产侧面板 | ⑤ |
| `studio/script/` | 剧本视图与固定摘录卡 | ⑥ |
| `studio/shots/` | 镜头整理视图 | ⑦ |
| `studio/dock/` | 助手与任务的浮窗／停靠容器（`CanvasAssistant`、`SceneTaskPanel` 原样接入） | ⑧ |

规则：`studio/` 只 import `business/` 里的引擎模块、`api.tsx`、`common.tsx`、契约与领域包，以及决定文档 §3「整体接入」的五个组件；被替换的旧界面由 `ui:check` 拦截。

## 3. 从封存分支带入的模块

以下模块与单测按 `feat/canvas-cards-redesign` 的最终版本原样带入 `apps/web/src/business/` 与 `tests/`，不依赖 React Flow、Mantine 或旧界面：

| 模块 | 用途 | 单测 |
|---|---|---|
| `canvas-node-actions.ts` | 复制的三种语义（只复制节点／带内部连线／创建副本）、改名、精确几何、分组 | `canvas-node-actions.test.ts` |
| `canvas-card-frame.ts` | 图片／视频草稿按所选画幅定高 | `canvas-card-frame.test.ts` |
| `canvas-card-dialog.ts` | 卡旁小对话框在卡上或卡下的落位 | `canvas-card-dialog.test.ts` |
| `canvas-node-previews.ts` | 每张卡最新一次成功结果；受限并发读取 | `canvas-node-previews.test.ts` |
| `canvas-reference-state.ts` | 引用角标的六种状态与文案 | `canvas-reference-state.test.ts` |
| `generation-specification.ts` | 规格摘要、时长控件形态、换模型时的输出归一 | `generation-specification.test.ts` |
| `reference-purposes.ts` | 用途文案；`asset-queries.ts` 改为从此再导出，只有一处来源 | — |
| `escapable-popover.ts` | 触发器保持焦点时 Escape 先关浮层再停止冒泡 | — |

未带入：封存分支对 `canvas-editor-placement.ts`（面板左对齐、`avoid`／`size`、无处可放时裁边）与 `use-canvas-node-preview.ts`（单卡预览改为全画布预览）的改动。两者都会改变旧画布在阶段 2 期间的行为；按决定文档 §3「引擎模块若需改动，单独提交并说明」，分别留到第 ③ 片（面板放置）与第 ④ 片（卡内结果）处理：或在 `studio/` 内以新模块承接，或作为独立提交改引擎。`list-selection.ts` 主干已是同一版本。

## 4. 附录 A 流程对照表

现有实现指 `apps/web/src/business/MediaGenerationWorkspace.tsx` 的画布模式（`source.kind === "canvas"`），以其中的函数与常量名定位；新归属指 §2 的模块。每条都要有 e2e 或单测，第 ③ 片提交前逐条勾对。

| # | 规则 | 现有实现 | 新归属 | 片 | 验证 |
|---|---|---|---|---|---|
| 1 | 会话身份 = 会话 · 类型 · 画布 · 节点 ·（检视时的计划 id），任一变化即重建 | `MediaGenerationWorkspace` 外层 `key`：`session.id : kind : canvas.id : nodeId : (inspection ? historyPlanId : "editor")` | `Board` 以 `canvas.id : nodeId` 为 `key`；会话变化时外壳整体重挂（`BusinessApp` 的 `key={session.data.id}`），卡的类型不会变，效果相同；`use-generation-session` 不改 | ③ | e2e：切换所选卡后面板从该卡自己的草稿重建 |
| 2 | 打开面板时向画布登记「保留草稿」检查：会话落定且草稿已保存，否则阻止并说明 | `onRetainDraft` effect：`controller.settle()` 后要求 `access === "ready" && draftSaved`，否则抛「当前生成输入尚未保留」 | `Composer` 挂载时登记检查：`session.settle()` 后 `hasUnretainedDraft()` 为真即阻止（含挂起时隐藏的草稿；不等权限核对，否则每次快速改选都要等一轮核对）。创作台的改选与离开守卫都先跑它：`StudioCanvas.navigate` = 登记的检查 → 项目助手草稿 → 视图偏好 flush → 改地址，经 `project-navigation-guard` 接壳层对站内链接的拦截 | ③ | 搬入 `canvas-continuous-creation` 的离开阻止用例 |
| 3 | 检视固定尝试只打开一次，并校验项目与用途 | `openedAttempt` ref + `controller.openExisting(historyPlanId, fixed => 校验 id / projectId / purpose)` | 未启用：历史只读，不开检视会话（见 §1d）；从历史把旧结果放回创作台是旧页面有、创作台还没有的能力 | ④ | e2e：从历史入口打开固定尝试，只读一次 |
| 4 | 能力读取 401／403／404 → 挂起会话并重新核对权限 | `capabilities.error` effect：`controller.suspend(); controller.verify()` | `Composer` 的能力查询 effect | ③ | 搬入撤权用例：撤权后创作台失效并清缓存 |
| 5 | 草稿的模型与规格保存在画布文档里，不在会话里 | `change()` → `source.configure(nodeId, { connectionId, capabilityId, output })` | `Composer` → `board` 暴露的 `configure`（来自 `use-canvas`） | ③ | e2e：选模型、改规格 → 保存 → 刷新仍在 |
| 6 | 已有计划或原请求时，模型与规格全部冻结 | `frozen = !!record?.planId \|\| !!record?.planRequest`，作用于模型 `Select` 与全部规格控件 | `ModelList`、`SpecificationPopover` 的 `disabled` 同样取 `frozen` | ③ | e2e：准备后模型胶囊与规格胶囊不可改 |
| 7 | 不活跃、会话忙、无草稿时禁用输入 | `disabled = !active \|\| state.busy \|\| !draft` | `Composer` 顶层 `disabled`；提示词框在冻结、只读、不活跃时隐藏而非禁用，提示词存在画布文档里，第 8 条的文档校验兜底 | ③ | e2e：提交中输入禁用 |
| 8 | 生成前：先固定镜头来源快照，再保存画布，保存后 id 或文档变化则拒绝，再构造请求 | `prepare()`：`fixedShotSources(draft.shotSources)` → `source.save()` → 校验 `canvas.id` 与 `editingCanonical(document)` → `canvasXRequest(...)`，交 `controller.generateFrom` | `Composer` 的提交同序执行；请求构造沿用 `image/video/audio-generation.ts` | ③ | 搬入连续创作与幂等用例 |
| 9 | 画布未保存时显示「生成前会先保存」，并禁用结果放置 | `awaitingSave` → 文案「生成时会先保存本次画布输入…」；放置评审按钮 `disabled \|\| awaitingSave` | `Composer` 底行状态文字；`results/` 的放置入口 | ③④ | e2e：脏画布下提示可见、放置禁用 |
| 10 | 结果放置评审：任务成功且有媒体，先再保存画布，算出位置，进入评审态 | `reviewPlacement()`：`commitDraft` 内 `source.save()`、校验 id、`canvasResultPosition(nodes, nodeId, count)` → `placement.phase = "review"` | `results/placement.ts`，复用 `canvas-result-position`、`canvas-result-placement` | ④ | 搬入结果与恢复用例 |
| 11 | 放置提交：412 版本冲突 → 冲突态；成功后回调 `afterPlacement` | `materialize()`：`submitCanvasResultPlacement` + POST `…/canvases/{id}/results`（If-Match）；`VERSION_CONFLICT` → `version_conflict`；`placed` → `source.afterPlacement` | 同上 | ④ | e2e：并发修改后放置报冲突 |
| 12 | 放置回执未知：只给「恢复本次添加」；冲突则重新评审；已放置则定位到新节点 | `placementActions`：按 `placement.phase` 三段 | `results/` 在卡内呈现三态 | ④ | 搬入回执未知用例 |
| 13 | 归档失败：两步「核对／继续原归档恢复请求」，不重呼模型 | `archiveRecovery`：`recoverArchive()` 以 `draft.archiveRequest` 的固定 key POST `recover-archive`；`checked` 后才出现「继续」 | `results/` 的归档恢复段 | ④ | 搬入归档失败用例 |
| 14 | 继续原计划：以原计划为种子修订；放置未知或评审中时禁止 | `nextAction`：`controller.revise({ capabilityId, output, shotSources }, draft, true)`，`placement.phase` 为 `unknown`／`review` 时禁用 | 卡右侧 ⊕ 的继续创作与结果态的「准备下一张」 | ②④ | e2e：评审中不可继续 |
| 15 | 提交回执未知：只能恢复提交，刷新不会重执行 | `record.execution && !job` → 「核对后恢复原提交」`controller.resumeSubmission()`；文案「刷新只读取原任务，未知提交不会再次执行」 | 卡内状态标签 + 恢复按钮 | ④ | 搬入未知提交用例 |
| 16 | 计划未就绪或已过期时禁止执行 | 执行按钮 `disabled`：`plan.status !== "ready" \|\| Date.parse(plan.expiresAt) <= Date.now()`，另有过期提示 | `Composer` 的计划已固定态 | ③ | e2e：过期计划不可执行 |
| 17 | 切换模型：只保留新模型接受的输出项，补齐唯一可选项 | 模型 `Select.onChange`：只补唯一分辨率与固定时长，其余清空 | `reconcileOutputForCapability`（§3 已带入），比现有实现多保留被新模型接受的项 | ③ | 单测 `generation-specification.test.ts` + e2e |
| 18 | 镜头来源选择只在画布、有草稿、未冻结、非检视时出现 | `shotSourcePicker` 条件：`source.kind === "canvas" && draft && !frozen && !inspection` | 规格浮层内的「固定镜头来源」段，同条件 | ③ | e2e：冻结后不出现 |
| 19 | 权限未就绪时整个面板换成重新核对提示 | `state.access !== "ready"` → `Alert` + 「重新核对访问权限」 | `Composer` 顶层分支 | ③ | 撤权用例 |
| 20 | 紧凑态：圆形填充提交、规格浮层、详情对话框 | `compact` 分支：`primaryAction`、`Popover` 规格、`Modal` 详情 | 新面板只有一种态：黑色圆形 ↑、规格浮层、详情对话框 | ③ | 并排图 `libtv-video-composer`、`libtv-spec-picker` |
| 21 | 放置对话框只在评审态、权限就绪且任务成功时打开 | `Modal opened={placement.phase === "review" && access === "ready" && job.status === "succeeded"}` | `results/` 的放置评审对话框 | ④ | e2e |

## 5. 分片进度

| 片 | 状态 | 并排图 |
|---|---|---|
| 0 准备 | 已交付（本文 §1） | [phase-0-shell.png](../design/assets/2026-09-21-studio-rebuild/phase-0-shell.png) |
| ① 页面壳与卡片 | 已交付（本文 §1a） | [选中图片卡](../design/assets/2026-09-21-studio-rebuild/slice-1-image-selected.png)、[编辑文字卡](../design/assets/2026-09-21-studio-rebuild/slice-1-text-edit.png)、[快捷键](../design/assets/2026-09-21-studio-rebuild/slice-1-shortcuts.png) |
| ② 端口与连线 | 已交付（本文 §1b） | [端口、连线、⊕](../design/assets/2026-09-21-studio-rebuild/slice-2-references.png) |
| ③ 输入面板 | 已交付（本文 §1c） | [输入面板](../design/assets/2026-09-21-studio-rebuild/slice-3-composer.png)、[模型列表](../design/assets/2026-09-21-studio-rebuild/slice-3-model-picker.png)、[规格浮层](../design/assets/2026-09-21-studio-rebuild/slice-3-spec-picker.png) |
| ④ 卡内结果 | 已交付（本文 §1d） | [卡内结果](../design/assets/2026-09-21-studio-rebuild/slice-4-result.png) |
| ⑤ 资产侧面板 | 未开始 | — |
| ⑥ 剧本视图 | 未开始 | — |
| ⑦ 镜头整理视图 | 未开始 | — |
| ⑧ 助手、任务、创作台切换、项目菜单 | 未开始 | — |
| ⑨ 切换与清理 | 未开始 | — |

## 6. PR 划分与交接（2026-09-21 决定）

用户要求自行控制 PR 大小并决定是否另起 worktree／分支。划分如下，都不推送：

| PR | 分支 | 内容 |
|---|---|---|
| 1 | `feat/studio-rebuild` | 阶段 0 + 阶段 1（①②③④）：本文 §1–§1d |
| 2 | `feat/studio-rebuild-views`（叠在 1 之上） | 阶段 2（⑤⑥⑦⑧） |
| 3 | `feat/studio-rebuild-switch`（叠在 2 之上） | 阶段 3（⑨）：新入口成为默认、删旧界面与旧 e2e、文档基线 |

后一个分支从前一个分支的末尾开出，评审顺序即合入顺序。
