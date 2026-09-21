# 85 核心创作区重建：分片记录与流程对照

日期：2026-09-21。依据：[核心创作区重建决定](../design/creative-workspace-rebuild-libtv-2026-09-21.md)（已确认）。分支 `feat/studio-rebuild`，独立 worktree；每片先交「LibTV 截图 vs 新页面」并排图再提交，不推送。

状态：**阶段 0 与第 ① 片已交付；后续逐片记账。** 本文只记每一片实际做了什么、怎么验证的，以及决定文档附录 A 的 21 条流程规则在新面板里的落点；范围、边界与分期以决定文档为准，不在此重述。

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

## 2. 新目录的模块规划

按决定文档 §6 分片，目录随片建立，不预先建空目录：

| 位置 | 内容 | 片 |
|---|---|---|
| `studio/StudioEntry.tsx` | 路由入口、权限之后的项目读取、视图分派 | 0 |
| `studio/shell/` | 顶栏（项目菜单、视图切换、创作台切换、保存状态、任务、助手、账号）、底部工具条、缩放指示、快捷键总览 | ①⑧ |
| `studio/board/` | React Flow 创作台：四类卡片、端口与连线、右键菜单、快捷键、框选、就地文本编辑、改名；接 `use-canvas`／`canvas-controller` 的保存与恢复 | ①② |
| `studio/composer/` | 输入面板、模型列表、规格浮层、提交；接 `use-generation-session` 与三种生成的请求构造 | ③ |
| `studio/results/` | 卡内排队／生成中／失败、结果铺满、重试保留上一张、放置评审、归档恢复、每张卡的历史入口 | ④ |
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
| 1 | 会话身份 = 会话 · 类型 · 画布 · 节点 ·（检视时的计划 id），任一变化即重建 | `MediaGenerationWorkspace` 外层 `key`：`session.id : kind : canvas.id : nodeId : (inspection ? historyPlanId : "editor")` | `composer/Composer.tsx` 外层同样的 `key`；`use-generation-session` 不改 | ③ | e2e：切换所选卡后面板从该卡自己的草稿重建 |
| 2 | 打开面板时向画布登记「保留草稿」检查：会话落定且草稿已保存，否则阻止并说明 | `onRetainDraft` effect：`controller.settle()` 后要求 `access === "ready" && draftSaved`，否则抛「当前生成输入尚未保留」 | `Composer` 挂载时向 `board` 的离开守卫登记同一检查；守卫沿用 `project-navigation-guard` | ③ | 搬入 `canvas-continuous-creation` 的离开阻止用例 |
| 3 | 检视固定尝试只打开一次，并校验项目与用途 | `openedAttempt` ref + `controller.openExisting(historyPlanId, fixed => 校验 id / projectId / purpose)` | `results/` 的历史入口沿用同一 ref 与校验 | ④ | e2e：从历史入口打开固定尝试，只读一次 |
| 4 | 能力读取 401／403／404 → 挂起会话并重新核对权限 | `capabilities.error` effect：`controller.suspend(); controller.verify()` | `Composer` 的能力查询 effect | ③ | 搬入撤权用例：撤权后创作台失效并清缓存 |
| 5 | 草稿的模型与规格保存在画布文档里，不在会话里 | `change()` → `source.configure(nodeId, { connectionId, capabilityId, output })` | `Composer` → `board` 暴露的 `configure`（来自 `use-canvas`） | ③ | e2e：选模型、改规格 → 保存 → 刷新仍在 |
| 6 | 已有计划或原请求时，模型与规格全部冻结 | `frozen = !!record?.planId \|\| !!record?.planRequest`，作用于模型 `Select` 与全部规格控件 | `ModelList`、`SpecificationPopover` 的 `disabled` 同样取 `frozen` | ③ | e2e：准备后模型胶囊与规格胶囊不可改 |
| 7 | 不活跃、会话忙、无草稿时禁用输入 | `disabled = !active \|\| state.busy \|\| !draft` | `Composer` 顶层 `disabled` | ③ | e2e：提交中输入禁用 |
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
| ② 端口与连线 | 未开始 | — |
| ③ 输入面板 | 未开始 | — |
| ④ 卡内结果 | 未开始 | — |
| ⑤ 资产侧面板 | 未开始 | — |
| ⑥ 剧本视图 | 未开始 | — |
| ⑦ 镜头整理视图 | 未开始 | — |
| ⑧ 助手、任务、创作台切换、项目菜单 | 未开始 | — |
| ⑨ 切换与清理 | 未开始 | — |
