# 85 核心创作区重建：分片记录与流程对照

日期：2026-09-21。依据：[核心创作区重建决定](../design/creative-workspace-rebuild-libtv-2026-09-21.md)（已确认）。分支 `feat/studio-rebuild`，独立 worktree；每片先交「LibTV 截图 vs 新页面」并排图再提交，不推送。

状态：**阶段 0 与阶段 1（①②③④）已交付，构成第一个 PR；阶段 2 在叠加分支 `feat/studio-rebuild-views` 上进行，第 ⑤⑥⑦ 片已交付（§6）。** 本文只记每一片实际做了什么、怎么验证的，以及决定文档附录 A 的 21 条流程规则在新面板里的落点；范围、边界与分期以决定文档为准，不在此重述。

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

## 1e. 第 ⑤ 片：资产侧面板

| 项 | 交付 | 验证 |
|---|---|---|
| 入口 | 左下角「资产」开关（与缩放同一组），开关状态写入偏好 `assetPanelOpen`（本片起由创作台拥有此键） | ST-05：刷新后仍开 |
| 面板 | `assets/AssetsPanel.tsx`：左下浮出，标题、「管理资产」（跳完整资产库路由）、搜索（250ms 防抖，同时过滤两段）、「项目资产」（`/assets?scope=project&status=active&q=`，行 = 首版参考的缩略图或类别图标、名称、类别；没有首版或只有文字设定的资产不可拖）、「素材」（`/media?scope=project&status=ready&q=`，行 = 缩略图、名称、种类），分页「更多」 | ST-05：列表、搜索空态、链接 |
| 拖到创作台 | 行以 `application/x-scenedesk-asset` 拖出（只带 mediaId、固定资产版本 id、标题）；创作台 `onDrop` 先读素材记录再建媒体卡，落在放下的位置；也可按行内「加入创作台」放到视野中心。只建媒体卡，不绑定镜头、不采用 | ST-05：拖放后节点 2→3，内容为该 mediaId，不建 take；按钮加入后 3→4 |

按用户要求保持克制，本片不做并记录：工作室共享素材的范围切换（旧素材浏览器有「工作室共享」；共享内容从完整资产库引入项目后再出现在此）、面板内的资产详情与新建、缩略图的懒加载观察器。

调查记录：ST-05 首版在「加入创作台」后立即刷新，页面正确地弹出「发现尚未同步的本机画布」——自动保存还没落地，本机副本先于服务器。这是既有恢复规则的正确表现，不是缺陷；用例改为等公共读取确认后再刷新。

并排图：[slice-5-assets.png](../design/assets/2026-09-21-studio-rebuild/slice-5-assets.png)（LibTV 侧只有 `libtv-text-edit` 里左下拉出的空面板可作对照，调研没有留下打开后有内容的画面）。本机检查：`ui:check`、`typecheck`、`vite build`、ST-00～ST-05 通过。

## 1f. 第 ⑥ 片：剧本视图

| 项 | 交付 | 验证 |
|---|---|---|
| 路由与切换 | `…/studio/script`；顶栏视图切换改为链接（剧本 ⇄ 创作台，镜头整理待 ⑦），`aria-current` 标当前视图；标题「项目 · 剧本」 | ST-06 |
| 阅读 | `script/ScriptView.tsx`：稿件在居中的纸面上（`DocumentBody` 复用），素底不带点阵；顶部一行：当前稿／历史稿·只读 + 来源类型徽记、历史稿选择（`?revision=` 进地址，刷新仍在）、返回当前稿、导入 Word、从飞书导入、选文带入画布、更多（下载原件、导入说明） | ST-06：当前稿、第 1 稿只读并可刷新、返回当前稿 |
| 导入 | Word 导入逻辑从退役的 `ScriptDocumentReader` 原样搬到 `business/ScriptWordImport.tsx`（旧阅读器改为引用，行为不变，单独提交）；飞书导入整体接入 `FeishuScriptImport` | ST-06：真实 .docx 上传→预览→确认导入→当前稿为 Word 导入，下载原件字节一致 |
| 选文入创作台 | `ScriptCanvasExcerpt` 整体接入，只加一个可选的 `canvasHref`，让「进入画布」落到 `…/studio?node=`；创作台按地址里的 `node` 选中并把该卡带入视野 | ST-06：选文→添加→进入画布→卡被选中 |
| 固定摘录卡 | 卡上引号图标与「固定摘录」名，正文只读（双击不进编辑）；可作参考继续创作；右键「回看剧本来源」回到该固定版本的剧本视图 | ST-06 |

按用户要求保持克制，本片不做并记录：剧本纯文本编辑（旧「编辑纯文本」）、分镜建议与提案助手、创作依据；飞书导入只整体接入未搬 e2e（其两例依赖飞书夹具与长流程，留到阶段 3 整体迁移时再定）。

并排图：[slice-6-script.png](../design/assets/2026-09-21-studio-rebuild/slice-6-script.png)——LibTV 的「脚本」是镜头表生成器，决定文档明确不照做（剧本是稿件不是生成器），并排只为对照密度与顶部工具行。本机检查：`ui:check`、`typecheck`、`vite build`、ST-00～ST-06 通过。

## 1g. 第 ⑦ 片：镜头整理视图

| 项 | 交付 | 验证 |
|---|---|---|
| 路由 | `…/studio/shots?scene=&shot=&media=`；顶栏「镜头整理」成为链接；标题「项目 · 镜头整理」 | ST-07 |
| 表格 | `shots/ShotsView.tsx`：场次选择、计数、调整顺序、新增镜头、下载本场已选用；表格列 = 镜号、时长（当前选用的入出点差）、画面描述、来源（选用原片名）、候选数、选用（缩略图 + 已选用／未选用，旧要求另注）、操作（打开、定位）；已归档镜头灰显加标签。表格只改外观：候选数、选用与旧要求都是既有领域事实 | ST-07：三行、归档标签、选用后时长与来源 |
| 候选与选用 | 「打开」在右侧抽屉里整体接入 `ShotResultFocus`（候选条、对比、采用与理由、选用历史、下载已选用原片）；`?media=` 带来创作台视频时抽屉里出现「从所选画布视频建立候选」 | ST-07：登记候选（入出点 0.5–2.5 s）→ 采用 → 预览另一候选仍下载蓝片原件（SHA-256 一致） |
| 交付 | `SelectedDelivery` 整体接入：清单区域、确认下载原片包 | ST-07：清单 2 个已选用、省略 1 个已归档；ZIP 清单顺序与微秒区间一致，文件摘要一致 |
| 候选反查 | 行内「定位」：按当前选用的原片在项目创作台上找媒体卡，`…/studio?node=` 打开并选中；不在创作台上时说明 | ST-07 |
| 关联镜头动作 | 创作台上视频媒体卡右键「登记为镜头候选」→ `…/studio/shots?media=`；未接入 `CanvasShotConnections`（它依赖场次画布，随 ⑧ 的创作台切换再定） | 手动 |
| 顺序与新增 | 「调整顺序」对话框整体接入 `SceneShotOrder`（含归档项、CAS、本机草稿）；「新增镜头」整体接入 `StructureEditor`；抽屉、对话框关闭前沿用 `ContentDraftRetention` 保留输入 | ST-07：下移并保存后表格与内容根顺序一致，刷新仍在 |

按用户要求保持克制，本片不做并记录：镜头多选与批量入口（旧镜头列表本就没有；创作台的多选批次已在 ④）、按镜头的候选反查到具体草稿（现按选用原片定位媒体卡）、旧 e2e 里的并发选用理由保留与撤权缓存隐藏（逻辑在整体接入的组件里未改，留到阶段 3 迁移 e2e 时整体搬）。评审补记：表格每行各读一次候选、选用与原片记录，40 镜的场次打开时约 120 个请求，且每次采用后全部重读；旧列表不在列表层读这些。未改，因为不改后端就只能做虚拟化或限并发，留待镜头数真正上去时再定。「新增镜头」的表单现在拿到真实的剧本列表（评审前传的是空列表，选文段落不可用）。

并排图：[slice-7-shots.png](../design/assets/2026-09-21-studio-rebuild/slice-7-shots.png)。本机检查：`ui:check`、`typecheck`、`vite build`、ST-00～ST-07 通过。

## 1h. 第 ⑧ 片：助手、任务、创作台切换、项目菜单、账号

| 项 | 交付 | 验证 |
|---|---|---|
| 停靠容器 | `dock/Dock.tsx`：助手与任务共用的容器，`data-mode` 为 `docked`（右侧整高）或 `floating`（右下浮窗），头部只有标题、改为浮窗／停靠到右侧、关闭 | ST-08：助手停靠→浮窗 |
| 助手 | 顶栏「助手」开关；`CanvasAssistant` 原样接入，关闭后草稿保留，重开与刷新后仍在；开关状态写入既有偏好 `assistantOpen`（旧画布同一字段）；卡片右键「交给助手」把卡片作为上下文带入 | ST-08：草稿跨关闭与刷新保留，偏好 false→true 往返 |
| 任务 | 顶栏「任务」开关；`SceneTaskPanel` 原样接入（尝试／文件导入两页），尝试页里放 `results/History.tsx` 的 `AttemptBrowser`：本画布固定尝试的列表与只读检视，进行中时每 5 秒刷新 | ST-08：空态文案与文件导入页 |
| 创作台切换 | 顶栏第二个胶囊「切换画布：{当前}」，`CanvasNavigator` 原样接入；场次创作台地址为 `…/studio?scene=`，没有时给「创建场次创作台」；标题与保存状态随画布走，「打开内容目录」「新建场次」跳内容页 | ST-08：切到场次并创建，文字卡只保存进场次画布，项目画布仍为 0 个节点，再切回 |
| 项目菜单 | `shell/ProjectMenu.tsx`：品牌处的菜单：返回项目列表、切换项目（读租户项目列表）、「项目设置、成员与归档」到项目页 | ST-08：两条链接地址 |
| 账号 | 旧壳的账号菜单原样传入顶栏右端（`BusinessApp` 的 `account` 插槽），退出登录与身份邮箱不变 | ST-08：菜单与邮箱可见 |

按用户要求保持克制，本片不做并记录：浮窗的位置与大小不可拖改、停靠／浮窗模式不写偏好（每次打开回到停靠；旧偏好只有 `assistantOpen`，不新增字段）、项目成员与归档不在创作台里重做（菜单直达项目页）、`CanvasShotConnections`（场次画布上的镜头关联面板）仍未接入——它的价值要看场次创作台的实际用法，留到第 ⑨ 片决定去留。评审补记：场次创作台读写自己的 `scenes/{id}/workspace-preference`（评审前误用项目的，切换会互相覆盖视口与选中，ST-08 现在断言两者隔离）；切换画布、打开目录、新建场次都经离开守卫；两个坞停靠时共用右侧一格，同时打开则任务坞被助手盖住；从场次创作台点顶栏「创作台」回到项目创作台而不是本场，这两点未改。

并排图：[slice-8-docks.png](../design/assets/2026-09-21-studio-rebuild/slice-8-docks.png)。本机检查：`ui:check`、`typecheck`、`vite build`、ST-08 与全部生产浏览器用例（55 例）通过。

## 1i. 第 ⑨ 片：切换与清理（分支 `feat/studio-rebuild-switch`）

| 项 | 交付 | 验证 |
|---|---|---|
| 唯一入口 | `studio/legacy-routes.ts`：旧地址一律转到创作台——`…/canvas[?node=]` → `…/studio[?node=]`；`…/production?scene=` → `…/studio?scene=`，带 `shot=` 的旧分镜深链 → `…/studio/shots?scene=&shot=`；`…/script[?revision=]` → `…/studio/script[?revision=]`，`?tab=settings` → 项目页；`…/content?revision=`（无 shot）→ 剧本视图。`BusinessApp` 在渲染前 `location.replace`，期间只显示读取态 | 单测 `studio-legacy-routes.test.ts` 6 例；ST-00、ST-09 |
| 项目页与场次目录 | 项目卡打开创作台；「查看剧目设定」在项目页里弹出（原在旧剧本页的设置页签）；场次目录去掉项目左栏与「画布」面包屑，行内「打开创作台」到场次创作台、「N 镜头 · M 已选用」到镜头整理；创作依据、CSV 与提案仍在目录页 | ST-09 |
| 撤权关门 | `StudioEntry` 对项目、内容或画布任一读取的 401／403／404 整体关门（查询缓存会保留上次成功数据，旧页面各自有同样的判断）：顶栏显示「项目不可访问」，视图换成「操作未完成」，不显示缓存的正文与项目名 | ST-01、ST-06、ST-07 的撤权用例 |
| 删除 | 旧画布（`CanvasBoard`、`CanvasContextualEditor`、`CanvasContinueCreation`、`MediaGenerationWorkspace` 与三个包装、`CanvasMediaGeneration`、结果视图、放置与导航辅助、`canvas.module.css`——上传列表用到的三条规则移到 `canvas-uploads.module.css`）、场次工作区（`SceneProductionWorkspace`、`ProjectCanvasEntry`、`ProjectNavigation`、`CanvasShotConnections`、`EditingPresence`、`SceneAssistant`、`ShotPromptComposer`、`CandidateWorkspace`、`TakeFeedback` 及其控制器）、旧剧本页（`ScriptDocumentReader`；`ContentWorkspace` 的剧本视图、`ScriptArchive`）、旧镜头列表（`ShotListWorkspace`）、早已无人引用的孤儿（`CutWorkspace`、`CutWorkPanels`、`CutDialoguePanel`、`cut-*`、`TaskWorkspace`、`TaskEditor`、`Members`、`canvas-card-dialog`、`use-prompt-session` 与四个样式文件）；共 59 个源文件、7 个单测文件与 `assistant-lifecycle.test.ts` 里两例候选意见用例。`check-ui.ts` 的旧界面清单随之删除；`workbench.module.css`、`content.module.css` 去掉只有旧页面用的路由属性与剧本布局规则 | 可达性脚本（从 `main.tsx` 与 `studio/` 出发）无孤儿；`typecheck`、`ui:check`、`vite build`、286/286 单测 |
| e2e | 删除 14 个旧规格（40 例）。行为仍在的红线用例搬进 `studio-*.spec.ts`：Word 提交回执丢失、选文回执丢失、飞书两例、撤权后不显示缓存剧本、归档项目剧本只读（`studio-script`）；并发选用保留理由与撤权后不显示缓存列表（`studio-shots`）；撤权后不能重开缓存创作台（`studio-board`）；归档项目创作台可读且拒绝新编辑（`studio-switch`）。`continuous-workspace-fixture` 与四个 `preview-*` 人工检查脚本改落到创作台地址 | 全套 24 例通过（见下） |

按用户要求保持克制，本片主动不做并记录：候选意见（`TakeFeedback`，对候选的评审与留言）随旧候选工作区退役，接口与数据未动，需要时在镜头整理抽屉里重新接入；分镜建议（`SceneAssistant`）随旧剧本页退役，提案历史与导入仍在场次目录；`CanvasShotConnections` 退役，场次创作台与镜头的关系走「登记为镜头候选」与镜头整理的「定位」；旧 e2e 中只针对已删界面的用例不搬（左栏键盘导航、旧分镜深链、画布切换对话框、分组面板、剧本纯文本编辑）；Word 无效文件恢复与并发 CAS、交付「改变选用后拒绝旧确认」、助手应用回执丢失这三组用例未搬，模块本身原样接入未改，留作后续补测；`workbench.module.css` 里旧左栏的样式类未清，随下次壳层改动一起清。

评审补记（2026-09-21）：另有四例旧 e2e 也未搬、此前漏记——Word「旧的延迟回执不能清掉导航后的替换草稿」、选文「并发画布修改下的 CAS 冲突与显式继续」、镜头「切换镜头时预览区几何不变」（`apps/web/AGENTS.md` 的禁止项，`ShotResultFocus` 原样接入抽屉但抽屉里没有断言）、镜头「排序失败后本机顺序经关闭与刷新仍保留（含归档子项）」；都与前述三组一样留作后续补测。`EditingPresence`（场次工作区里「谁在编辑」的心跳标签）随场次工作区退役，前端不再调用编辑在场（`getEditingPresence`／`updateEditingPresence`）、场次画布节点绑定（`bindSceneCanvasNode`／`unbindSceneCanvasNode`）与候选评审留言（`reviews` 六个操作）这三组接口，契约与验收样例仍计入它们，下次改契约时要知道它们已无前端引用。`…/script?tab=settings` 曾是可直达的地址，现在转到项目页但不自动弹出「剧目设定」。评审后修正：`StudioEntry` 的关门判断只在项目或内容读取被拒时触发，画布读取的 404 只在既非「尚未创建」也非「场次不在本项目」时算撤权，地址里的陌生场次改为提示并回到项目创作台；`MyWork` 的「继续创作」直接生成创作台地址，不再经兼容转向；旧 `production` 地址的 `node=` 随转向保留，`mode=storyboard` 不带镜号时打开镜头整理。

并排图：[slice-9-switch.png](../design/assets/2026-09-21-studio-rebuild/slice-9-switch.png)（从项目卡进入的创作台）。本机检查：`npm run check`（契约、`ui:check`、构建、单测）、全套生产浏览器用例、文档门禁通过。

## 1j. 设计走查与修正（2026-09-22）

用户在合成预览里看到几处不对：媒体卡上半截图、下半截黑；输入面板里的参考附件缩略图坏且被用途角标盖住；规格浮层里的镜头来源说明太多太显眼；专注编辑的对话框空且标题过重；选模型后面板换位。随后由另一 agent 以资深体验设计师视角在 1920 宽下用无头浏览器逐个走查卡片与内部组件（178 张截图，对照 LibTV 现场图），报告分 P0／P1／P2。本次修正：

| 项 | 修正 |
|---|---|
| 主题变量没生效（P0-1） | React Flow 在 `.react-flow` 自身声明同名 `--xy-*` 变量，`.board` 上的整组被就近覆盖，连线、端口、网格点、框选全是默认色。变量改声明在 `.board .react-flow` 上，选中与连线统一用 `--ws-studio-card-selected`，蓝色只留给键盘焦点环 |
| 媒体卡先按 16:9 再变形（P0-2） | 记录未到时用项目自己的画幅（`project.spec`）做框，经 `StudioEntry → StudioCanvas → Board → Card` 传入；加载态与加载后同一黑底。草稿未指定画幅时也用项目画幅，不再是 16:9／1:1 兜底 |
| 选卡先闪一条"正在核对访问"（P0-3） | 核对中渲染同形面板、全部禁用、状态槽只放小转圈；被拒时仍整体换成重新核对提示（第 19 条的安全边界不变） |
| 面板内容一变就换位（P0-4） | 面板长高／变宽时沿自己那一侧向远离卡片的方向延伸（above 上移、left 左移），原侧放得下就不重排；候选排序先看原侧 |
| 新卡压卡或落到屏幕外（P0-5） | 底部 ＋ 与 ⊕ 共用"就近空位"环形搜索（右、下、左、上、四角，六圈）；落点在视口外时 `fitView` 到它；⊕ 的草稿由引擎先放在来源右侧、再由创作台挪到空位，引擎模块未改 |
| 900 px 顶栏重叠（P0-6） | 顶栏为容器查询单元：窄于 1160 px 时环境标签隐藏、任务／助手／已保存只剩图标 |
| 放置对话框暴露原始坐标（P0-7） | 删掉坐标行；一颗 36 px 主按钮加文字"取消"，去掉默认关闭叉 |
| 图标被 legacy 层钳在 18 px（P1-2） | `.studio svg { width: auto; height: auto }`，Phosphor 尺寸重新生效；视频播放标改成 48 px 半透明圆盘上的 28 px 三角（P1-3） |
| 其余细节 | 标签坐在画布底色上不再被网格点穿过（P1-4）；⊕ 缩到 28 px、加画布色光环、离卡更近（P1-5）；参考缩略图填满 56 px 方块，用途改回小角标（P1-6，与 LibTV 的"首帧"一致）；提示词占位只剩"描述这个画面"，空闲时状态槽留空，原因只在提交键的提示里（P1-8）；结果行的操作改为浅色，一块面板只有一颗深色主键（P1-13 的一半）；历史时间用中文格式（P1-12）；提交键与操作键有 hover／按下态（P2-2）；文字卡宽度手柄光标横向（P2-5）；白底素材加 1 px 内描边（P2-6）；停用连线用选中色 35%（P2-10）；镜头来源在规格浮层里只剩一行"镜头来源 · 选择"，说明只在展开时出现；专注编辑对话框标题改小号次级色、去重复关闭钮、面板自有底色、提示词区随视口给高 |

未改并记录：提交被拒（422）后面板半锁死与接口原话文案（P0-8）——要先弄清计划已固定时哪些控件该冻结、并给出放弃计划的入口，属流程改动，另开；"＋参考"改成缩略图选择器（P1-7）；顶栏右侧环境标签按仓库规则必须常显，只改成与工具同族的安静样式而不移除（P1-9）；顶栏左侧 pill 套 pill（P1-10）、助手停靠面板双标题与停靠不让位（P1-11，要动业务组件）、结果行并入底行（P1-13 另一半）、镜头来源展开后的默认 select（P1-14）、空态版式（P1-15）；快捷键面板把说明渲染成键帽（P2-1）、字级两档统一（P2-3）、React Flow 水印（P2-4，隐藏需其许可）、画布切换搜索框默认样式（P2-7）、缩小时标签可读性（P2-8）、连线穿卡（P2-9）、文字卡编辑态抬起（P2-11）。全套 26 例浏览器用例与 287 单测在修正后通过。

另：为了把港岛箱子上「旧钥匙」项目的 15 条真实原件放进合成预览，`continuous-workspace-fixture.ts` 加了测试专用的 `seedMedia` 钩子（注册字节并写入已接受上传与就绪素材记录），启动脚本在仓库外。

## 1k. 打磨（分支 `feat/studio-polish`，2026-09-22）

合入后按 §1j 的遗留项继续，目标是卡片与面板的每个细节都站在同一套体系上。

| 项 | 修正 |
|---|---|
| 顶栏左侧（P1-10） | 画布切换并入品牌与项目名所在的同一个描边组，用分隔线隔开；导航器自己的边框与底色在创作台里去掉，只剩文字和箭头；项目名最少保留 6 个字宽再省略 |
| 顶栏右侧（P1-9） | 已保存、任务、助手、环境标签四个都是同高的描边胶囊，账号是同高的圆；环境标签按仓库规则常显，只改成同族样式 |
| 提交被拒后半锁死（P0-8） | 计划已固定但没有提交记录时（模型拒绝，或用户停在这一步），底行给一个安静的「修改输入」，走既有的 `session.revise()`：计划进历史、模型与参考解冻。接口原话文案未改——错误码清单不在前端 |
| 结果行并入底行（P1-13） | 「添加到创作台」「恢复本次添加」「定位结果」等结果与恢复操作放进底行、状态槽之后，面板不再因结果到达而长高；说明文字缩到一句 |
| 「＋ 参考」（P1-7） | 由 13 行文字菜单改为 4 列缩略图网格：媒体卡显示画面，文字卡显示图标，标题在下；仍是菜单语义，键盘与用例不变 |
| 助手停靠（P1-11） | Dock 新增 `chromeless`：助手自带的「创作助手 ＋ ⟲ ›」标题行就是标题，Dock 只把浮窗／关闭两个控件叠在它右端；停靠时创作台让出停靠宽度（新增 `--ws-studio-dock-width`），工具条与缩放角随之左移 |
| 卡片与连线 | 缩到 50% 以下时隐藏卡片标签（P2-8）；连线改为 `smoothstep` 圆角折线，从端口出去先走直线再转弯，不再斜穿邻卡（P2-9）；文字卡编辑态加投影抬起（P2-11） |
| 快捷键面板（P2-1） | 只有真键渲染成键帽，「双击名称」「拖动空白处」这类说明改为次级色文字；对话框换成创作区自己的安静标题与底色 |
| 其余 | 规格浮层的时长数字框接主题变量而不是 Mantine 默认边框；提示词占位只剩「描述这个画面」（上一轮只改到一处）；镜头来源展开态里的默认 select（P1-14）与空态版式（P1-15）未改 |

验证：`typecheck`、`ui:check`、生产构建通过；287/287 单测；全套 26 例生产浏览器用例通过。合成预览（港岛箱子「旧钥匙」原件）里逐项看过：顶栏、停靠与浮窗助手、参考缩略图网格、结果就绪时的底行、快捷键面板。

## 1l. 卡片尺寸与面板位置（2026-09-22）

用户在竖版项目里看到：三张空草稿各 360×640 把视口占满，音频草稿也是一整块竖框，输入面板只能跳到左边压住三张卡。查明三件事：新卡宽度是写死的 360，高由画幅推出，竖版项目下面积是横版的 3 倍；`Card.tsx` 的画幅回退链在音频时落到项目画幅，压过了样式里的固定高（§1a 记的是「音频草稿固定高」）；放置算法本身没错，是竖版卡加 240 高的面板在笔记本安全区里放不下「正下方」。用户在两个问题上做了决定：新卡等面积；面板保留算法、加可拖动。

| 项 | 改动 |
|---|---|
| 新卡宽度 | `canvas-card-frame.ts` 的 `defaultCardWidth`：图片／视频宽 = 360 × √(宽/高)，夹在 120–1600；文字 320、音频 360 不变。四个入口都用它：工具条新建（项目画幅）、资产放入与上传落卡（媒体真实宽高）、⊕ 继续创作（`createCanvasDraft` 多收一个画幅参数）。只影响新建卡，已保存宽度不动；结果卡的 320 由后端 `CANVAS_RESULT_LAYOUT` 决定，本次不动 |
| 音频草稿 | `emptyDraftFrame`：空草稿的框是已选比例，否则项目画幅；音频与文字没有框。`Card.tsx` 改用它，音频草稿回到 96 高 |
| 拉伸角 | 图片／视频／音频卡也出右下拉伸角，同样只改宽（`resizeWidth` → `updateCanvasNodeGeometry`），高随画幅 |
| 落点 | 搜索抽成 `board/free-spot.ts` 的 `nearestFreeSpot`：从视野中心起，被盖住就越过撞到的那张卡再试，先右、再下、左、上，邻卡比新卡宽也不会再撞上（原来按新卡宽度定步长，邻卡更宽时「右侧」一步仍被盖住，新卡掉到视野外再被带回来，来源卡就被推出视野，QA 走查在三种视口都复现）；仍在视野内的空位优先于更近但在视野外的空位。高度用 `estimateCardHeight`（画幅推出，音频 96、空文字 120；卡名那一行在卡体上方，不计入），不再写死 200；`reveal` 同样用推出的高 |
| 面板对齐 | 试过改成与 LibTV 截图一致的居中对齐，ST-02 立刻失败：⊕ 把新草稿放在来源右侧 96px 处，居中的面板向左伸出 195px 正好盖住来源卡。左对齐是有意的，保持不变 |
| 面板可拖 | `placement.ts` 新增 `pinned`（相对卡左上角的偏移）：钉住后面板 = 卡 + 偏移，只夹进安全区，允许盖住卡；卡出视口仍停靠、板面太小仍停靠。`ComposerAnchor` 持有偏移，按卡重置，松手时把偏移改记为面板实际到达的位置（在边缘越界拖动后仍随卡移动）；`Composer` 右上角多一个拖动把手（六点图标，`aria-label` 「移动面板」），指针捕获，不写服务器 |
| 带入视野 | 新建或 ⊕ 出来的草稿会立刻打开面板，`reveal` 现在按「卡名行 + 卡 + 12 + 面板名义高」检查是否在视野内，不在就按同一缩放做最小平移：横向只到卡进入板面，纵向只到卡名行落在顶栏下或面板有位置；两者在这个缩放下放不下时才 `fitView`（原来横向出界就 `fitView` 把卡垂直居中，面板上下都放不下只能裁边，QA 走查在 1440×900 复现）；⊕ 出来的草稿带参考，名义高按有参考行计（`composerNominalHeight`，162 + 56 + 8）。ST-02 在 1920×902 下就是这种情况：竖版新草稿的正下方差 27px，面板只好换到左边盖住来源文字卡 |
| 换边规则 | 原来只要上一次的边还放得下就一直沿用，新卡被动画带进视野时中途选的边会留下来。现在放置结果记住当时的卡位置，只有卡本身没怎么动（左上角移动 ≤ 24px）时才沿用上一次的位置或优先同一边；卡真的移动后四边重新按顺序选。面板变高后原来的边放不下时，先沿该边滑回安全区再比较，不会只因变高而换边。卡在两次渲染之间还在动（平移、带入视野的动画）时不记录「上一次」，动画中途选的边不会留下来，静止后的第一次渲染才记录（QA 走查发现动画每帧都重新记录会让最后一帧沿用中途的边） |

单测：`canvas-card-frame`（等面积、极端画幅夹紧、固定宽、空草稿框、音频无框）、`canvas-creation`（继续创作的宽随画幅）、`studio-free-spot`（空板居中、被盖时按自身高度换行）、`studio-composer-placement`（钉住三例、真移动后重选边、垂直平移后重选边、变高后滑动保边、名义高）。合成预览（`preview-continuous-workspace.ts`，1440×900，项目画幅 1080×1920）里核对：新图片／视频卡 270×480，新音频卡 360×96；拖把手后面板落在拖放处，平移画布后偏移不变；拉伸角把音频卡从 360 拖到 259、高不变；单击拉伸角不改宽。

独立走查（2026-09-22，另一 agent 只读审查 + 无头 Chromium 端到端）：审查提出标签高度算错边、⊕ 草稿预留不足、换边判断两处漏洞，已按上表修正并各加单测；端到端在 1440×900、1920×902、1280×720 三种视口下量出的卡片尺寸、拖动、钳制、拉伸、持久化、停靠、专注编辑均符合预期，抓到的两处问题（新卡把来源卡推出视野；面板沿用动画中途选的边）已按上表修正并在预览里复核（文字、图片、视频依次新建后来源卡仍在视野内，面板落在新卡正下方、不盖任何卡）。走查另记录两项本次未改：专注编辑对话框里的「退出专注编辑」按钮被 Mantine 弹窗标题栏盖住、点不到，只能按 Esc 关闭（重建时就有，不在本次改动范围）；1280×720 这类矮视口在 100% 下卡加面板放不下，面板按既有规则裁进卡的下沿约两成。

预览里另见：面板首次放置按 `COMPOSER_SIZE` 的 240 高估算，空面板实际 162 高，竖版卡在 1440×900 下本来放得下的正下方因此让给了上方，且一旦选定就沿用。改为量到真实高度前面板先不可见、不记上一次位置，第一次可见的位置就是真实高度算出的；`COMPOSER_SIZE` 的名义高改为空面板的实际高 162，`reveal` 为新草稿预留的就是这一段（按 240 预留时每张新竖版卡都会把前一张卡推到顶栏底下，ST-02 因此点不到文字卡）。未做并记录：结果卡宽度仍是后端固定的 320，等面积策略要到后端一起改；900px 高的显示器在 100% 下，竖版卡加面板几乎占满安全区，连续新建多张草稿时每张都会把先前的卡向上带约 60px，需要用户平移或缩放，本次没有再加规则。


## 1m. 剧本视图版式（分支 `claude/xia-page-layout-refinement-7aa28c`，2026-09-22）

用户看到剧本视图「不够优雅」：工具行分成两行、左对齐参差，历史稿下拉的标签（全日期带秒再加「当前稿」）被截断，四个控件四种样式；正文卡离工具行远得没有道理；空态贴着顶栏、标题与正文同号。按设计师视角在 2000／1440／1180 宽下走查（合成预览，Word 导入一份带集、场标题与对白的稿子）后改三处，各一提交：

| 项 | 修正 |
|---|---|
| 工具行 | 一行：左边历史稿下拉只写「第 N 稿 · 当前稿」，导入时间放进下拉项右侧；「历史稿 · 只读」标签与「返回当前稿」只在读旧稿时出现；文件名作安静文字跟在后面。右边导入 Word／飞书两个入口经槽位样式并入与下拉同族的 32px 灰色胶囊，「选文带入画布」仍是唯一深色键；「当前稿」「日期」各只说一次。e2e 断言随之改为读下拉的值与文件名 |
| 节奏 | Word、飞书、选文三个组件把入口渲染进工具行后各留一个空壳，每个都吃一段列间距，正文卡因此离工具行 48px；现在空壳不占位。工具行离顶栏 24px（镜头整理同改），离正文卡 16px；正文卡内边距 40／48px，场标题上方留 1.25em，集标题后的第一个场标题收紧 |
| 空态 | 居中于视图，标题升一号，「导入 Word」为深色主键、「从飞书导入」为安静键（§1j 记的 P1-15） |

未改并记录：顶栏；阅读列宽仍 880px（新边距下约每行 49 个汉字）；导入组件本身未动（按决定文档「复用不改」，样式只从槽位外部给）。验证：`typecheck`、`ui:check`、生产构建；`studio-script`、`studio-shots` 两组浏览器用例。

## 2. 新目录的模块规划

按决定文档 §6 分片，目录随片建立，不预先建空目录：

| 位置 | 内容 | 片 |
|---|---|---|
| `studio/StudioEntry.tsx` | 路由入口、权限之后的项目读取、视图分派 | 0 |
| `studio/shell/` | 顶栏（项目菜单、视图切换、创作台切换、保存状态、任务、助手、账号）、底部工具条、缩放指示、快捷键总览 | ①⑧ |
| `studio/board/` | React Flow 创作台：四类卡片、端口与连线、右键菜单、快捷键、框选、就地文本编辑、改名；接 `use-canvas`／`canvas-controller` 的保存与恢复 | ①② |
| `studio/composer/` | 输入面板（`Composer.tsx`）、模型与规格（`ComposerControls.tsx`）、参考行（`ComposerReferences.tsx`）、放置（`placement.ts`）；接 `use-generation-session` 与三种生成的请求构造 | ③ |
| `studio/results/` | `useNodeResults.ts`（结果与状态标签）、`History.tsx`（历史与只读检视）；放置评审与归档恢复在 `composer/Composer.tsx` 的任务行 | ④ |
| `studio/assets/` | `AssetsPanel.tsx`：项目资产与素材的列表、搜索、拖到创作台 | ⑤ |
| `studio/script/` | `ScriptView.tsx`：稿件阅读、历史、Word／飞书导入入口、选文带入创作台 | ⑥ |
| `studio/shots/` | `ShotsView.tsx`：镜头表格、抽屉里的候选与选用、交付、顺序、新增 | ⑦ |
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
| ⑤ 资产侧面板 | 已交付（本文 §1e） | [资产侧面板](../design/assets/2026-09-21-studio-rebuild/slice-5-assets.png) |
| ⑥ 剧本视图 | 已交付（本文 §1f） | [剧本视图](../design/assets/2026-09-21-studio-rebuild/slice-6-script.png) |
| ⑦ 镜头整理视图 | 已交付（本文 §1g） | [镜头整理](../design/assets/2026-09-21-studio-rebuild/slice-7-shots.png) |
| ⑧ 助手、任务、创作台切换、项目菜单 | 已交付（本文 §1h） | [助手浮窗](../design/assets/2026-09-21-studio-rebuild/slice-8-docks.png) |
| ⑨ 切换与清理 | 已交付（本文 §1i） | [默认入口](../design/assets/2026-09-21-studio-rebuild/slice-9-switch.png) |

## 6. PR 划分与交接（2026-09-21 决定）

用户要求自行控制 PR 大小并决定是否另起 worktree／分支。划分如下，都不推送：

| PR | 分支 | 内容 |
|---|---|---|
| 1 | `feat/studio-rebuild` | 阶段 0 + 阶段 1（①②③④）：本文 §1–§1d |
| 2 | `feat/studio-rebuild-views`（叠在 1 之上） | 阶段 2（⑤⑥⑦⑧） |
| 3 | `feat/studio-rebuild-switch`（叠在 2 之上） | 阶段 3（⑨）：新入口成为默认、删旧界面与旧 e2e、文档基线 |

后一个分支从前一个分支的末尾开出，评审顺序即合入顺序。

三个分支在 2026-09-21 完成分片时尚未推送；重建已于 2026-09-22 合入，创作区只有 `…/studio` 一个入口。下面保留当时的验证记录，当前交付状态统一见[22](22-implementation-progress.md)。

## 底栏内容随真实供应商重做（2026-09-23）

真实供应商接入后，底栏三个控件显示的内容不再合用：模型名是原始 profile id，同一模型按 (模型, 进料方式) 各占一行且字完全相同，清晰度是 24 个像素串，比例与清晰度不联动因而能选出提交才报错的组合。设计决定在 `../design/studio-model-and-specification-2026-09-23.md`，实施计划在 `../superpowers/plans/2026-09-23-studio-model-and-specification.md`。

改动：能力记录新增两个可选字段 `displayName` 与 `outputs`（尺寸 → 比例 + 档位），值来自 `packages/provider/src/verified/profiles.ts`，接口路由未动；模型列表按 `modelVersion` 去重、每行只有展示名；模型与规格之间新增**进料方式**胶囊（首尾帧／参考图），只在该模型两种都有时出现，与模型一同受规则 6 冻结；规格面板的比例是 `16:9` `9:16` `1:1` 三个，清晰度显示厂商档位名，比例 × 档位算出 `resolution`。

主动不做并记录：不显示厂商名与分组、不显示「已接入」、不显示日期版本号、档位格子里不写像素尺寸、砍掉 `4:3` `3:4` `3:2` `2:3` `21:9` 五个比例（用户 2026-09-23 逐条确认）。比例白名单在前端，能力记录与接口仍支持全部比例；白名单与某模型的允许集合交集为空时退回该模型的完整列表。没有这两个新字段的能力记录（尚未重跑 provision 的部署）按原样渲染，清晰度退回拍平的像素列表。

需要在部署上重跑 `scripts/provision-verified-capabilities.ts`，新字段才会进入能力记录。
