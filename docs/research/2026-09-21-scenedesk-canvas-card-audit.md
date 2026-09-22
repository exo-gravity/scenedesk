# SceneDesk 画布卡片与交互：当前实现审计

日期：2026-09-21。审计代码：`892a4c85122450030eeed4db151c3f3af216cab3`。用途：为 LibTV / 即梦画布重设计调研提供准确的 SceneDesk 对照基线。

本笔记只读生产源码、现有测试和仓库研究。没有修改产品，没有运行本轮浏览器、生成任务或测试。因此「已实现」表示当前生产代码存在相应行为；「有测试」表示测试源包含断言，不表示本轮重跑通过。既有研究中的实机结果保留为历史证据，不升级为 2026-09-21 实机结论。

额外只读核对了本机 4311 工作台所属 checkout：其 Git HEAD 与本次审计一致，本文涉及的 14 个主要生产文件逐字节相同（卡片、就地编辑、继续创作、生成、批量、工作区入口、预览 hook、样式、引用、控制器和领域校验）。该核对证明源码基线一致；页面实际加载与绘制仍由主调研的浏览器证据单独确认。

## 结论

SceneDesk 已具备自由画布、选中工具条、就地输入、同稿专注编辑、模型与规格、明确来源引用、结果比较、批量计划确认和失败恢复。需要重新设计的主要问题，是这些能力在卡片各状态之间的呈现与发现成本：**未编辑草稿以提示摘要为中心，结果仅在编辑态就近预览；媒体、草稿与固定尝试仍分别呈现；关系端口很小，分组没有可见空间容器；低缩放编辑依赖额外进入专注模式。** 这些是源码可推导的设计评估，实际严重程度还需同一视口下走查。[节点渲染](../../apps/web/src/business/CanvasBoard.tsx#L121)、[就地编辑](../../apps/web/src/business/CanvasContextualEditor.tsx#L64)、[批量确认](../../apps/web/src/business/CanvasGenerationBatch.tsx#L155)

不能继续沿用 9 月 18 日差异表中的「每场一张画布」「无生成参数」「无生成前校验」「无批量生成」「未查到重命名」作为当前缺口；也不能把竞品结果自动放在画布上解释为业务上的自动采用。具体勘误在文末。

## 1. 产品边界和证据入口

- 当前有**项目级画布和场次画布**。无剧本、无集场也能创建项目画布；场次画布继续保留自己的归属。项目入口可选择项目画布或场次。[生产入口](../../apps/web/src/business/ProjectCanvasEntry.tsx#L142)、[项目创建](../../apps/web/src/business/ProjectCanvasEntry.tsx#L341)、[当前产品方向](../design/creative-workspace-approved-2026-09-16.md)
- 生产画布是 `apps/web/src/business/CanvasBoard.tsx`，使用 React Flow；`apps/web/src/pages/` 仅是原型，不能作为能力或媒体事实。[画布挂载](../../apps/web/src/business/CanvasBoard.tsx#L1306)、[前端规则](../../apps/web/AGENTS.md)
- 节点不等于镜头，也不等于生成作业；来源连接提供候选输入，不是自动执行工作流。可用素材、候选、明确采用、成片使用与固定版本批准必须分开。[领域术语](../../CONTEXT.md)、[来源约束](../../packages/domain/src/canvas.ts#L102)
- 历史浏览器、数据库和生产构建验收见[非模型收尾记录](../implementation/77-non-provider-workspace-closure.md)。该记录明确受控媒体、供应商夹具与真实模型、真实外部部署的边界，本次不复述其计数为当前验证结果。

## 2. 卡片解剖：默认态、选中态、编辑态

| 卡片或状态 | 当前生产实现 | 设计含义与待观察点 |
|---|---|---|
| 普通文字 | 标题 +「文字」标记 + 正文；正文保留换行，超过 200px 内部滚动。新建宽度 320 世界像素。[渲染](../../apps/web/src/business/CanvasBoard.tsx#L148)、[文字正文](../../apps/web/src/business/CanvasBoard.tsx#L202)、[样式](../../apps/web/src/business/canvas.module.css#L153)、[默认尺寸](../../apps/web/src/business/CanvasBoard.tsx#L651) | 文字本体可读；长文的内部滚动与画布平移需实机验证。 |
| 固定剧本摘录 | 仍是文字节点；编辑器说明「固定剧本原文」，正文只读；领域校验禁止原文与固定 quote 不符。[编辑器](../../apps/web/src/business/CanvasBoard.tsx#L1698)、[只读条件](../../apps/web/src/business/CanvasBoard.tsx#L1724)、[领域校验](../../packages/domain/src/canvas.ts#L90) | 不应为了统一文字卡外观丢失固定原文身份。 |
| 图片／视频／声音草稿，未编辑 | 标题 +「草稿」标记 + 最多 5 行提示词 + 最近尝试状态；空白时提示双击或选择编辑。新建宽度 360 世界像素、正文最小高度 140px。[草稿渲染](../../apps/web/src/business/CanvasBoard.tsx#L206)、[默认尺寸](../../apps/web/src/business/CanvasBoard.tsx#L661)、[样式](../../apps/web/src/business/canvas.module.css#L173) | 默认卡片没有展示模型、规格、参考缩略图或已有结果；状态能看见，但创作对象的画面需要进一步打开。 |
| 草稿，编辑中 | 节点临时至少扩到 420 世界像素。顶部显示最近完成结果或 16:9 占位区，下方是编辑器占位与实际就地编辑器；结果最多高 280px。[编辑态](../../apps/web/src/business/CanvasBoard.tsx#L160)、[宽度](../../apps/web/src/business/CanvasBoard.tsx#L580)、[样式](../../apps/web/src/business/canvas.module.css#L435) | 编辑前后节点尺寸和内容密度不同；不是始终相同尺寸的媒体卡 + 外部独立输入面板。 |
| 媒体节点 | 独立媒体节点显示标题与素材；最终 CSS 将标题放在媒体上方，隐藏重复媒体类型和文件名行。比例来自实际媒体宽高，预览高度封顶 640px。[媒体渲染](../../apps/web/src/business/CanvasBoard.tsx#L237)、[最终样式](../../apps/web/src/business/canvas.module.css#L360)、[标题位置与高度](../../apps/web/src/business/canvas.module.css#L408) | 图片／视频可以作为画面主体；需实机确认极端比例和缩放下的占地、标题截断。不能只读前面的 CSS 声明推断标题在底部。 |
| 选中与编辑标识 | 选中态使用强调色边框与 outline；编辑态使用焦点色。媒体节点背景与普通草稿背景不同。[状态样式](../../apps/web/src/business/canvas.module.css#L116) | 状态并非只靠媒体染色，但选中与编辑两种细边框能否清楚区分需实看。 |
| 上传中占位 | 单独的 `upload` 渲染类型，固定宽度 320，不能选中、拖动或连线。[上传节点](../../apps/web/src/business/CanvasBoard.tsx#L287)、[React Flow 属性](../../apps/web/src/business/CanvasBoard.tsx#L602) | 上传状态和持久内容节点是不同阶段，不应把「上传」直接算为与图片、文本同级的业务内容类型。 |

最近成功结果的就地缩略图**只针对当前编辑节点读取**，选取最近成功尝试中的首个 `mediaId`，并重新核对任务、项目、模型用途和媒体来源。关闭编辑后草稿卡回到提示摘要。它不会把草稿变成媒体引用，也不会展示该草稿的全部结果。[读取逻辑](../../apps/web/src/business/use-canvas-node-preview.ts#L23)、[来源校验](../../apps/web/src/business/use-canvas-node-preview.ts#L71)

## 3. 选择、编辑和预览交互

| 操作 | 现有行为及证据 |
|---|---|
| 单选 | 选中卡片后出现就近工具条；选中与编辑是两种状态，不会单击就展开输入。编辑中的当前单选节点隐藏重复工具条。[选择动作](../../apps/web/src/business/CanvasBoard.tsx#L1113)、[隐藏条件](../../apps/web/src/business/CanvasBoard.tsx#L1396) |
| 编辑文字／草稿 | 工具条「编辑」或双击节点进入；双击输入、按钮、媒体控件不会触发外层编辑。切换编辑对象前先保留旧输入，失败停留旧目标。[编辑交接](../../apps/web/src/business/CanvasBoard.tsx#L512)、[双击](../../apps/web/src/business/CanvasBoard.tsx#L1340) |
| 退出编辑 | 点击空白画布请求收起；编辑器关闭按钮或 Escape 也可收起。Escape 会避开 IME 合成和打开的下拉／弹窗。[空白点击](../../apps/web/src/business/CanvasBoard.tsx#L1336)、[键盘处理](../../apps/web/src/business/CanvasContextualEditor.tsx#L149) |
| 编辑器位置 | 实际编辑树在 `ViewportPortal` 中，按节点世界坐标定位，随画布缩放；不是始终保持屏幕字号的浮层。高度按可用区域限制。[挂载](../../apps/web/src/business/CanvasBoard.tsx#L1409)、[布局计算](../../apps/web/src/business/CanvasContextualEditor.tsx#L120) |
| 低缩放／越界 | zoom < 0.6、编辑器离屏或可用空间不足时出现「正在编辑 · …」定位条与专注编辑入口。[定位条条件](../../apps/web/src/business/CanvasContextualEditor.tsx#L64)、[定位条内容](../../apps/web/src/business/CanvasContextualEditor.tsx#L223) |
| 专注编辑 | 同一编辑器树改变变换，成为覆盖画布区域的对话框；激活 FocusTrap，背景画布 inert，左侧显示参考。返回不改世界坐标或保存视图。[变换与焦点](../../apps/web/src/business/CanvasContextualEditor.tsx#L80)、[编辑布局](../../apps/web/src/business/CanvasContextualEditor.tsx#L215)、[画布 inert](../../apps/web/src/business/CanvasBoard.tsx#L139) |
| 媒体查看 | 单选「预览」或双击打开 Modal；视频／音频节点还提供「播放预览／收起播放器」。画布状态只保存一个正在播放的节点 id。[动作](../../apps/web/src/business/CanvasBoard.tsx#L1123)、[播放状态](../../apps/web/src/business/CanvasBoard.tsx#L486)、[预览 Modal](../../apps/web/src/business/CanvasBoard.tsx#L1596) |
| 媒体读取 | 图片及视频缩略图优先 poster；视频／音频播放优先 proxy，合适情况下回退原文件。访问失败与预览处理状态有独立处理。[媒体读取](../../apps/web/src/business/MediaPreview.tsx#L54)、[错误与重试](../../apps/web/src/business/MediaPreview.tsx#L110) |
| 窄屏 | 760px 以下走内容列表，提示完整空间制作使用桌面宽度；进入编辑默认专注模式。[断点](../../apps/web/src/business/CanvasBoard.tsx#L463)、[编辑入口](../../apps/web/src/business/CanvasBoard.tsx#L533)、[窄屏提示](../../apps/web/src/business/CanvasBoard.tsx#L1272) |

选择工具条按选区中心定位，宽度最多 440 屏幕像素，靠近顶部时转到选区下方，并限制在可用区域内；编辑器和选择工具条使用不同的缩放与定位策略。[工具条算法](../../apps/web/src/business/CanvasBoard.tsx#L2078)

## 4. 卡片动作和引用关系

**操作按状态分流。** 单媒体选中显示预览；文字／草稿显示编辑；所有非草稿选中项可继续创作；单草稿可打开生成记录；多个已选模型的草稿可查看批量计划；更多菜单提供加入助手上下文、定位、复制、移除节点与多选新建分组。[完整选择动作](../../apps/web/src/business/CanvasBoard.tsx#L1113)

**继续创作是显式派生流程。** 先打开 320px Popover，列出来源，再选择图片、视频或声音草稿；多选时按钮叫「共同作为参考」。来源身份在打开时固定，确认时重新核对；创建保留原节点，新草稿放在来源集合右侧 96 世界像素并建立有序引用边，不直接生成。[操作面板](../../apps/web/src/business/CanvasContinueCreation.tsx#L90)、[来源快照与创建](../../apps/web/src/business/canvas-creation.ts#L17)

**连接端口是受限的一入或一出。** 草稿只有左侧 target；文字、已有媒体只有右侧 source。端口是 12px 圆点，没有节点旁的「+」类型菜单。领域校验只接受「已有文字／媒体 → 草稿」，禁止草稿直接连接草稿和自连；这不是任意工作流图。[端口](../../apps/web/src/business/CanvasBoard.tsx#L226)、[端口样式](../../apps/web/src/business/canvas.module.css#L167)、[领域约束](../../packages/domain/src/canvas.ts#L102)

**边有用途、启用状态和顺序。** 建线默认文字=提示、音频=声音、其他=构图；显示用途标签，停用边仍在图上但透明度降至 0.35；同来源同用途不能重复追加。输入编辑器前四项显示参考条，详细折叠区支持搜索添加、改用途、启停和移除；在本次检查的编辑器中没有重排引用顺序的控件。[建线](../../apps/web/src/business/CanvasBoard.tsx#L742)、[边呈现](../../apps/web/src/business/CanvasBoard.tsx#L621)、[追加规则](../../apps/web/src/business/canvas-reference.ts#L5)、[参考编辑](../../apps/web/src/business/CanvasBoard.tsx#L1743)

**重命名已存在，但发现成本较高。** 节点名称藏在「节点属性」折叠区中，同时还有 x、y、width 和分组字段；不是标题上的双击／铅笔入口。无效或未完成输入保留在本地 buffer，不把空标题保存为有效节点。[属性入口](../../apps/web/src/business/CanvasBoard.tsx#L1927)

**复制仅复制所选节点，不复制边。** 复制保留节点内容与原 `groupId`，标题加「副本」，偏移 48px，分配新 id。没有「仅复制上游输入」「复制节点和连线」等不同命令；复制草稿后可能缺失原来通过边提供的参考。[复制实现](../../apps/web/src/business/CanvasBoard.tsx#L776)

## 5. 多选、分组、导航与快捷键

- 框选、选择工具／手形、空格平移、中／右键拖动、滚动和双指缩放都有配置；撤销支持 Cmd/Ctrl+Z，重做加 Shift，Delete/Backspace 删除，原生 React Flow 删除被关闭，避免两套删除逻辑。[按键](../../apps/web/src/business/CanvasBoard.tsx#L1244)、[React Flow 配置](../../apps/web/src/business/CanvasBoard.tsx#L1372)
- 查找列表有 Shift-click 多选；批量及分组 E2E 都走列表路径。[批量测试](../../tests/e2e/canvas-generation-batch.spec.ts#L65)、[分组测试](../../tests/e2e/canvas-groups.spec.ts#L63)。画布本体只显式配置 `selectionKeyCode="Shift"`，没有显式设置 `multiSelectionKeyCode`；分组测试注释写画布节点本身不支持 Shift 累加。**本轮未实测卡片点击与框选如何叠加，需要专门核对，不能将列表手势外推到画布卡片。**
- 分组是 `groups` 条目 + 节点 `groupId`；移动组内一个节点会给其他成员应用同一偏移；可命名、解散、选中定位整组。React Flow 仍只注册 canvas/upload 类型，未创建 group 容器或背景框。[节点类型](../../apps/web/src/business/CanvasBoard.tsx#L299)、[联动移动](../../apps/web/src/business/CanvasBoard.tsx#L711)、[新建组](../../apps/web/src/business/CanvasBoard.tsx#L1212)、[分组管理](../../apps/web/src/business/CanvasBoard.tsx#L945)
- 撤销最多保留 100 个本地编辑快照，同组 1 秒内修改合并；不是通过撤销退回生成任务或供应商执行。[历史机制](../../apps/web/src/business/canvas-controller.ts#L73)
- 有缩小、100%、放大、适应内容、定位所选与节点查找。当前 `CanvasBoard` 未挂载 minimap、网格吸附、对齐／分布、自动排列、连线显示开关、卡片右键菜单或拖拽缩放手柄；节点宽度可在属性数值输入中修改。该缺口判断限于所审计的生产画布入口。[视口操作](../../apps/web/src/business/CanvasBoard.tsx#L1062)、[画布配置](../../apps/web/src/business/CanvasBoard.tsx#L1306)、[节点宽度](../../apps/web/src/business/CanvasBoard.tsx#L1984)

## 6. 生成、结果与失败恢复

| 范围 | 现有事实 | 对卡片设计的要求 |
|---|---|---|
| 参数位置 | `CanvasMediaGeneration` 以 `presentation="node"` 进入就地编辑器；模型下拉 + 规格 Popover 已存在，规格含尺寸、画幅、视频／音频时长、声音选项和 seed。[挂载](../../apps/web/src/business/CanvasBoard.tsx#L1450)、[模式](../../apps/web/src/business/CanvasMediaGeneration.tsx#L219)、[紧凑参数](../../apps/web/src/business/MediaGenerationWorkspace.tsx#L1152) | 问题是默认卡片不显示参数、低缩放下难操作；不是要从零增加模型参数功能。 |
| 单次生成 | 画布按钮「生成图片／视频／声音」内部调用 `generateFrom`，先保存并固定准确输入再进入执行流程；有模型不可用、画布保存失败／恢复未完成、计划阻断和过期处理。[准备](../../apps/web/src/business/MediaGenerationWorkspace.tsx#L279)、[保存前提](../../apps/web/src/business/CanvasMediaGeneration.tsx#L91)、[按钮](../../apps/web/src/business/MediaGenerationWorkspace.tsx#L1226)、[固定计划](../../apps/web/src/business/MediaGenerationWorkspace.tsx#L919) | 不能根据旧界面中存在「确认执行」就断言当前每次生成始终是手动两阶段；单节点连续路径与恢复路径应分别验。 |
| 批量生成 | 多选两个以上已配置模型的草稿先打开批次 Modal；再次准备计划后逐项展示节点、模型、状态、预留，展示合计，勾选确认后提交可执行项。它不是图拓扑执行或联动下游自动运行。[工具条入口](../../apps/web/src/business/CanvasBoard.tsx#L1164)、[确认面板](../../apps/web/src/business/CanvasGenerationBatch.tsx#L155)、[提交](../../apps/web/src/business/CanvasGenerationBatch.tsx#L310) | 不应再列为「没有」；后续比较应关注多项状态、费用信息和结果的空间呈现是否清晰。 |
| 当前任务 | 节点编辑区显示当前生成阶段、未决读取说明、固定输入变化提示、错误码及任务详情／取消入口。[节点任务态](../../apps/web/src/business/MediaGenerationWorkspace.tsx#L987) | 未决、失败、归档失败、成功应在卡片整体层级上清楚，不让一个泛化红色错误替代不同恢复动作。 |
| 多次尝试与比较 | 「尝试与结果」有按固定计划的记录；可选 A/B 两项进入比较；历史输入只读，不直接覆盖正在编辑的草稿。[历史与比较](../../apps/web/src/business/CanvasMediaGeneration.tsx#L117) | 目前完整历史及 A/B 比较不是收起态卡片本体。可研究如何减少离开当前空间的成本。 |
| 结果放置 | 成功后先「查看添加到画布的位置」，明确添加为独立媒体节点；未知添加恢复原请求，冲突后重新核对位置；成功后能定位结果。[放置状态](../../apps/web/src/business/MediaGenerationWorkspace.tsx#L583) | 放置、关联镜头、候选采用不同；即使以后自动呈现结果，也不能默认为采用。 |
| 归档失败 | 提供「恢复归档」，明确不会重新调用模型；未知供应商提交只读取原任务。[归档恢复](../../apps/web/src/business/MediaGenerationWorkspace.tsx#L633)、[未知状态](../../apps/web/src/business/MediaGenerationWorkspace.tsx#L1001) | 重试文案必须区分重读、重存、重新生成，不能只保留一个无说明的刷新图标。 |
| 保存与协作冲突 | 状态区分权限核对、未完成输入、冲突、保存中、核对保存结果、保存失败、本机恢复与待同步；「已保存」只在其余状态都排除后显示。本机内容可恢复，撤权停止展示。[保存标签](../../apps/web/src/business/CanvasRecovery.tsx#L9)、[恢复 UI](../../apps/web/src/business/CanvasRecovery.tsx#L32) | 可靠性事实应渐进展示；`canvas-reconcile.ts` 不能等价为实时协作光标、房间或节点锁。 |

当前代码已有的相关测试包括：连续生成与刷新恢复、丢执行回执恢复、图片来源→视频草稿→结果→显式放置→A/B 比较、助手应用丢回执后同稿续改、零场次项目画布、批量确认、分组草稿关闭恢复。[连续生成](../../tests/e2e/canvas-continuous-creation.spec.ts)、[连续工作区](../../tests/e2e/continuous-workspace-finish.spec.ts)、[项目画布](../../tests/e2e/project-canvas.spec.ts)、[批量确认](../../tests/e2e/canvas-generation-batch.spec.ts)、[分组](../../tests/e2e/canvas-groups.spec.ts)。本轮只读测试，无新增通过结论。

## 7. 既有竞品研究的可复用部分与需纠正部分

优先继续使用[2026-09-18 能力清单](2026-09-18-canvas-capability-inventory.md)作为取证索引，而不是最终设计规格。它列出官方文案、官方 CLI、生产包和历史实机的证据级别，但同一文件的横向结论有时超过了自己的未知项。

| 旧结论／风险 | 审计修正 | 来源 |
|---|---|---|
| SceneDesk「每场一张画布」，多画布会破坏镜头归属 | 早于本次审计已有项目画布。场次归属与项目探索共存；不能用旧批准稿阻止项目级创作。 | [旧差异表 L61、L120](2026-09-18-scenedesk-canvas-gap-analysis.md#L61)、[2026-09-16 当前方向](../design/creative-workspace-approved-2026-09-16.md)、[项目实现](../../apps/web/src/business/ProjectCanvasEntry.tsx#L341) |
| 无生成参数／无前置校验／无批量生成 | 当前源码都有上述路径，具体见前文。可以批评呈现与可发现性，不能写成功能不存在。 | [旧差异表 L65–67](2026-09-18-scenedesk-canvas-gap-analysis.md#L65)、[模型参数](../../apps/web/src/business/MediaGenerationWorkspace.tsx#L1152)、[阻断](../../apps/web/src/business/MediaGenerationWorkspace.tsx#L957)、[批量面板](../../apps/web/src/business/CanvasGenerationBatch.tsx#L155) |
| SceneDesk 未查到重命名、快捷键仅 Delete/Escape | 重命名在节点属性；撤销重做、空格平移已有，不能混淆「未发现」与「未实现」。 | [旧差异表 L77、L79](2026-09-18-scenedesk-canvas-gap-analysis.md#L77)、[重命名](../../apps/web/src/business/CanvasBoard.tsx#L1935)、[按键](../../apps/web/src/business/CanvasBoard.tsx#L1244) |
| SceneDesk 有「镜头节点」这一独有类型 | 名为 SH-01 的节点不能证明类型系统里存在 Shot 节点。当前 `kind` 是 text/image/video/audio，另有 content 类型与镜头关联。 | [旧结论 L92](2026-09-18-scenedesk-canvas-gap-analysis.md#L92)、[创建类型](../../apps/web/src/business/CanvasBoard.tsx#L645)、[领域命名](../../CONTEXT.md) |
| 即梦只有一套画布，可直接合并能力 | 清单自己确认 `/ai-tool/canvas` 与 `/ai-tool/ai-canvas` 是不同构建。49 工具、frame 容器、Agent 卡片和 7 类创作节点应分别标注所属入口与版本。 | [两入口说明](2026-09-18-canvas-capability-inventory.md#L150)、[混合横向表](2026-09-18-canvas-capability-inventory.md#L504) |
| 即梦有 9 类节点，包含资产库和上传 | 这首先是 9 个工具轨入口；清单说资产库／上传直接进入流程，不能都算持久节点类型。SceneDesk「四类草稿」同样不准确，文字是 text 内容而非生成草稿。 | [入口清单](2026-09-18-canvas-capability-inventory.md#L163)、[各入口行为](2026-09-18-canvas-capability-inventory.md#L183)、[旧类型比较](2026-09-18-scenedesk-canvas-gap-analysis.md#L63) |
| 即梦 / LibTV「没有任何采用动作」，SceneDesk 独有 | 不完整操作和文案检索不能证明全产品不存在；官方 LibTV 规范区分用户明确版本和最新更新时间。最多表述为已走查区域未观察到与 SceneDesk 等同的采用流程。 | [旧排他结论](2026-09-18-scenedesk-canvas-gap-analysis.md#L69)、[官方规范研究](../design/research/2026-09-14-libtv-canvas.md#L60) |
| 结果自动落画布隐含采用，因此不可借鉴 | 空间呈现与领域采用是两回事。自动可见可以与明确采用同时成立；禁止的是自动确立业务选用事实。 | [旧推断 L119](2026-09-18-scenedesk-canvas-gap-analysis.md#L119)、[领域术语](../../CONTEXT.md)、[当前方向](../design/creative-workspace-approved-2026-09-16.md) |
| LibTV 左右手柄、快捷键和文案证明已完整验过连线／多选／批量 | 同份研究记载手柄 0×0、拖拽没产生边、Ctrl+A 只选一项、G 无反应、脚本节点没取到。CLI 能力、菜单存在和可完成手势须分开。 | [未完成实测](2026-09-18-canvas-capability-inventory.md#L484)、[LibTV 后续状态表](../design/research/2026-09-14-libtv-canvas.md#L66) |
| 文本节点「待确认后生成」说明 LibTV 默认所有模式均不自动消费 | 只证明当时那个节点／Agent 状态有确认，不足以推导所有模式默认策略；同份研究提及手动／自动模式与自主性档位。 | [历史观察与推断](2026-09-18-canvas-capability-inventory.md#L471)、[Agent 模式横向记录](2026-09-18-canvas-capability-inventory.md#L513) |
| SceneDesk 有成熟预算金额闸门 | 后续同日 review 已做第三版勘误：当前是任务／在飞配额，真实供应商被阻断，金额为零；金额、配额与已授权消费需分开。 | [预算勘误](2026-09-18-canvas-next-capabilities-review.md#L28) |
| 仅凭 DOM 尺寸决定卡片应大小 | 旧尺寸是在 24% 缩放下读到；须同时记录世界宽高、屏幕宽高、zoom、viewport、选中／编辑状态，否则不可比较。 | [旧尺寸](2026-09-18-scenedesk-canvas-gap-analysis.md#L36)、[SceneDesk 编辑宽度](../../apps/web/src/business/CanvasBoard.tsx#L580) |

此外，9 月 14 日 LibTV 研究清楚区分官方演示、官方操作规范与登录实机未知项，并纠正了把「Codex 右侧浏览器」误读成 LibTV 内置 Agent 位置的问题。这种证据区分仍应保留。[一手来源边界](../design/research/2026-09-14-libtv-primary-workspace-review.md#L46)

## 8. 给本轮实机对照的检查矩阵

以下为待验证设计问题，不是已确认竞品事实：

1. **统一同一条件看卡片**：在 100%、50%、全览三个缩放下，分别拍空白、未选中、选中、编辑、生成中、有结果、失败七种状态；记录画面、标题、提示、模型／规格、状态、端口和动作各在哪里。SceneDesk 基线见[节点状态分支](../../apps/web/src/business/CanvasBoard.tsx#L160)。
2. **完成一次来源到下游的手势**：拖端口到空白、拖到已有节点、点击 `+`、选择输入引用分别会不会新建、连边或立即生成；撤销之后保留什么。SceneDesk 当前是[受限来源连接](../../packages/domain/src/canvas.ts#L102)与[继续创作 Popover](../../apps/web/src/business/CanvasContinueCreation.tsx#L113)。
3. **看输入可读性及参考管理**：模型和费用在默认态是否可见；低缩放如何输入；多个参考能否辨认、换用途、排序、移除。SceneDesk 现有[规格 Popover](../../apps/web/src/business/MediaGenerationWorkspace.tsx#L1182)和[参考折叠区](../../apps/web/src/business/CanvasBoard.tsx#L1810)。
4. **看结果如何留在创作现场**：原卡替换、子卡、结果条、独立节点还是历史抽屉；多结果和多次尝试分别怎样展开；重新编辑是否沿用原输入。SceneDesk 现有[单结果编辑态预览](../../apps/web/src/business/use-canvas-node-preview.ts#L23)、[A/B 历史比较](../../apps/web/src/business/CanvasMediaGeneration.tsx#L184)与[明确放置](../../apps/web/src/business/MediaGenerationWorkspace.tsx#L583)。
5. **实际框选并组织**：卡片 Shift/Cmd-click、框选、组框、标题重命名、组内拖动、解组、复制是否连带引用。SceneDesk 当前[逻辑分组](../../apps/web/src/business/CanvasBoard.tsx#L711)与[仅复制节点](../../apps/web/src/business/CanvasBoard.tsx#L776)。
6. **观察状态恢复而不制造付费任务**：利用已有失败／历史记录检查重试、取消、离线状态；未决提交与归档失败不要混成一个失败。SceneDesk [当前生成状态](../../apps/web/src/business/MediaGenerationWorkspace.tsx#L987)与[归档恢复](../../apps/web/src/business/MediaGenerationWorkspace.tsx#L633)应作为保留要求。

最值得优先出设计对照稿的四点是：卡片默认信息层级；选中动作与输入区的位置／缩放策略；来源端口到继续创作的一致手势；结果与历史在空间中的连续性。小地图、吸附和自动排列属于后续画布操作效率，不能替代这四个核心卡片问题。
