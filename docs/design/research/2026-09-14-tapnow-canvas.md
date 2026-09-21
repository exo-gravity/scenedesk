# TapNow 官方画布布局与交互研究

> 本文引用的部分源文件与 e2e 规格属于旧创作界面，已在 2026-09-21 阶段 3 删除（见 [85-studio-rebuild.md §1i](../../implementation/85-studio-rebuild.md)）；这些引用改为纯文本，内容按当时原样保留。

研究日期：2026-09-14。用途：为 SceneDesk 下一版画布方案提供依据，**本稿不实施产品修改**。SceneDesk 对照源码为 `f4f005c981ea195dbca56c1c5d570de66470f994`。执行 research 技能的后台一手源研究：只读取 TapNow 官方文档、其中的官方动图，以及当前项目源码；未登录 TapNow、未上传数据、未调用生成，也未操作主任务浏览器。

## 先给设计判断

TapNow 值得借鉴的核心是**对象、输入和动作的位置关系**：平时看媒体；选中后在对象上方出现短工具、下方出现紧凑创作输入；Agent 则有独立右侧空间。并非简单把所有控件变成深色、小号或圆角。

这与 SceneDesk 目前“选中节点 → 页面底部一块最多 370px 的公共滚动编辑区 → 节点编辑和生成两段组合”有实质区别。下一方案应优先解决“正在对哪一个对象做什么”的空间连续性，而不是继续给底部表单加折叠。以下区分官方事实与本项目建议。

## 证据方法与边界

- **V，高置信**：本轮在独立 Chrome 会话中，实际打开官方文档图片放大查看，观察到动态图的不同帧。仅证明被观察画面；不能证明所有分辨率、所有节点及当前登录版均一致。
- **T，高置信**：官方文档明确说明行为；未在付费产品中执行该行为。
- **I，中置信**：从已观察布局推导的设计原则，不能写成 TapNow 实现事实。
- **未知**：没有足够一手证据，明确保留，不能靠仿制仓库或第三方评测补齐。

本次目视了 `Create a node`、`Connect nodes`、`Open TapNow Agent`、`Recover generated content from History`、`Confirmation card`、`Redraw part of an image` 六段官方图示，包含空白、预览、选中输入、Agent 展开和历史展开的不同帧。图示以英文深色 UI 为主，部分示例标题带 07 月日期；文档访问日期不等于素材录制日期。没有据此测量或宣称正式产品的像素规格。

网页提取工具不能直接显示媒体，随后通过**官方文档自身的放大图片**实际目视。直接打开 `files.tapnow.media` 原媒体链接时浏览器阻止访问；未绕过该阻止、未下载原媒体。下面记录官方页面及图示名称，便于重新打开核对。没有把未播放的 YouTube 嵌入链接算作观看证据。

## 1. 画布外围布局：全局、视口、对象、助手四层

| 区域 | 本轮可以确认的事实 | 证据与置信度 |
| --- | --- | --- |
| 左上 | 示例显示画布名与轻量保存状态；没有纵向项目目录常驻占据中央空间 | V：节点创建图、历史图，见 [节点文档](https://docs.tapnow.ai/en/docs/canvas/understand-nodes-and-connections#1-create-a-node) |
| 左侧 | 窄竖工具条提供添加等全局入口；搜索、Library、History 从左侧打开 | V：创建/历史图；T：[画布介绍](https://docs.tapnow.ai/en/docs/canvas/explore-the-canvas)、[Library](https://docs.tapnow.ai/en/docs/canvas/use-library-and-templates)、[组织画布](https://docs.tapnow.ai/en/docs/canvas/organize-your-canvas) |
| 左下 | 视口工具集中在低位：缩放、Fit、可展开小地图；示例中小地图浮在这一组上方 | V：历史图；T：[视口操作表](https://docs.tapnow.ai/en/docs/canvas/explore-the-canvas#canvas) |
| 中央 | 节点与连接构成主要内容；空态在中央给双击提示和起步建议。未选节点不会各自铺一份完整参数表 | V：创建图与连接图，[节点文档](https://docs.tapnow.ai/en/docs/canvas/understand-nodes-and-connections) |
| 右下/右侧 | 关闭时有 Agent 圆形入口；展开后右侧是独立对话面板，输入固定在该面板底部 | V：`Open TapNow Agent` 前后帧；T：[打开 Agent](https://docs.tapnow.ai/en/docs/agent/chat-with-agent#1-open-agent) |
| 右上 | 示例有额度、社区和分享等入口 | V：创建图；这里只记录位置，SceneDesk 不应借研究恢复商业运营和分享功能 |

**I：** 四层各自回答不同问题：全局“从哪找材料”；视口“怎么查看空间”；对象“对此素材做什么”；Agent“委托什么任务”。把四层全堆在一个固定底部区，会让每次选择都变成页面表单编辑。

## 2. 节点状态：媒体先于表单

| 状态 | 观察/明确行为 | 证据类型与限制 |
| --- | --- | --- |
| 空节点 | 媒体占位块、轻标题、两侧连接入口；创建动图随后显示节点下方输入框 | V，高：[Create a node](https://docs.tapnow.ai/en/docs/canvas/understand-nodes-and-connections#1-create-a-node) |
| 未展开的已有内容 | 连接演示中，来源图片是图片本体和上方轻标题；没有常驻全宽属性卡 | V，高：同页 `Connect nodes`；**未知**：hover 与 selected 的全部样式差别 |
| 选中 | 图片上方出现一排短图标工具；输入面板出现在图片下方；左右仍有续接入口 | V，高：`Redraw part of an image` 的选中帧；T：[图片 Toolbar](https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-images#open-the-image-toolbar) |
| 编辑工具 | 先选图片再选工具，裁剪/重绘/扩图各自进入任务专用控制；多数生成编辑保留源图并产生相邻新结果 | T，高：[图片编辑](https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-images)；本轮目视到进入工具前的选中帧，**没有把所有重绘遮罩细节当作已观看证据** |
| 生成中 | 音频节点展示进度；Ask 图中可看到节点占位与对话确认状态同时存在 | T：音频文档；V：Confirmation card 后续帧。**未知**：精确进度算法、取消/网络未知状态及重试语义 |
| 结果 | 图片可全屏检查、下载、保存到库；音频完成后出现波形和播放控制，视频在节点中播放 | T，高：[图片结果](https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-images#save-view-and-download)、[音频预览](https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-audio#4-generate-and-preview)、[视频](https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-video) |

**重要差别：** 官方音频文档明确说再次生成会让当前音频节点显示新结果，保留当前版本需先保存/下载。这不能直接成为 SceneDesk 语义：本项目固定计划、原结果、候选与采用有独立身份，新生成不能覆盖旧 Media 或 Take。[音频再生成说明](https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-audio#5-regenerate-download-or-connect-the-result)（T，高）

## 3. 输入和参数：节点下方的紧凑操作面

创建动图中实际可见的结构是：

```text
                   轻标题
             [ 当前节点预览 ]
             +              +
       ┌───────────────────────────┐
       │ 引用/添加入口               │
       │ 本次提示正文                 │
       │                             │
       │ 模型 · 比例 · 尺寸   数量/生成 │
       └───────────────────────────┘
```

图中输入比节点预览宽，但属于同一局部构图，没有横跨整个应用；常用规格紧凑排在底行，正文占输入面主要空间。**V，高，限此演示**：[节点创建](https://docs.tapnow.ai/en/docs/canvas/understand-nodes-and-connections#1-create-a-node)。不能由此推出它必定采用某个 DOM/Portal 技术、固定宽度，或在任意平移后如何避让。

音频文字直接确认同类结构：选中打开节点下方输入；模型位于左下；参考位于正文上方；格式与模型相邻，高级参数经齿轮展开；生成在右下。**T，高**：[音频输入与输出](https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-audio)。

视频需要的模型、比例、时长、分辨率随实际模型变化；某些运行中或只读状态不展示不可用工具。**T，高**：[视频生成与工具](https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-video#generate-a-video)。这支持“按当前能力显示必要参数”，不支持把所有参数永久删掉，也不能推断这些规格在每个视频编辑工具的位置完全相同。

## 4. 连线、多个来源与本次实际引用

官方区分“图上的关系”和“这次生成使用的输入”：可从右侧端口连接已有节点；图片下游输入通过 `@` 选入上游图片，并在生成前检查实际引用。删除线只移除关系。多选后从选择范围右侧继续创建，可以把多个来源连到新节点。**T，高**：[节点与连接](https://docs.tapnow.ai/en/docs/canvas/understand-nodes-and-connections#4-connect-two-existing-nodes)。

连接动图本轮看到了两张并排节点和两侧端口；完整拖线成功的中间帧没有被逐帧保存，因此连线执行语义以官方文字为据。不能仅看到连接就宣称内容已送入模型。

**I：SceneDesk 应借鉴的可见关系**是“来源缩略/名称 → 当前输入 → 独立结果”。仍需显示 `enabled`、用途和固定版本，不能把自然语言 `@名字` 当作已验证的 typed reference。普通选中、浏览历史、切镜头也不能成为隐式引用升级。

## 5. Agent：独立会话，而非另一份节点属性表

官方展开图里，右侧上方是会话标题/操作，中间是消息内容，底部是 Agent 自己的输入；Ask、模型等控件位于该输入底部。画布仍在左侧可见。**V，高**：[Open TapNow Agent](https://docs.tapnow.ai/en/docs/agent/chat-with-agent#1-open-agent)。

官方说明两种上下文添加：输入旁添加按钮选画布材料，缩略项出现于正文上方；需要区分各材料职责时，再在正文中用 `@` 明确指代。发送前应检查并移除不需要的上下文。**T，高**：[Agent 引用](https://docs.tapnow.ai/en/docs/agent/chat-with-agent#3-reference-images-on-the-canvas)。

Ask 先呈现模型、规格、数量、引用的确认卡，用户明确 Generate 才调用；Auto 则可直接执行。实际目视的确认卡位于右侧对话流内，卡里有提示摘要和一行模型/规格，随后显示 Confirmed，同时左侧节点展示任务。**T + V，高**：[生成模式](https://docs.tapnow.ai/en/docs/agent/choose-a-generation-mode#ask-review-a-confirmation-card-before-generating)。**不建议 SceneDesk 因此加入 Auto**；现有服务、限额和未知提交约束仍要求明确执行。

会话可以独立命名、重新打开或分支，但节点仍属于同一画布。文字/脚本类 Agent outputs 还有自己的侧栏入口，不一定全部立即成为媒体节点。**T，高**：[会话](https://docs.tapnow.ai/en/docs/agent/manage-conversations)、[Agent outputs](https://docs.tapnow.ai/en/docs/agent/manage-agent-outputs)。本轮未实测跨会话持久化实现。

## 6. 历史、Library 和模板不是同一个容器

| 内容 | 官方行为与实际观察 | 证据 |
| --- | --- | --- |
| 生成 History | 目视到左侧入口旁展开缩略网格，顶部按 Image/Video/Audio/3D 分类和计数、内容带日期；画布仍在后方可见。文档说明删除生成节点后可重新应用结果，不等同回滚整张画布 | V + T，高：[History](https://docs.tapnow.ai/en/docs/canvas/organize-your-canvas#1-recover-generated-content-from-history) |
| Library | 保存可复用素材；可从节点工具保存，选择 Private/Team 与文件夹。回画布可直接应用或先预览；原节点保留 | T，高：[Library](https://docs.tapnow.ai/en/docs/canvas/use-library-and-templates)；本轮没有把 Library 每个展开状态都做视觉确认 |
| Templates | 保存一组节点/连接，应用时新增一组而非覆盖现有画布 | T，高：同上；SceneDesk 当前不应为追求界面相似而扩做模板运行系统 |
| 定位与标记 | 标记用于检索，不改变内容；搜索可查标题、提示、文本并定位/短暂高亮结果 | T，高：[组织画布](https://docs.tapnow.ai/en/docs/canvas/organize-your-canvas#3-find-a-node) |

**I：** SceneDesk 的结果浏览应从下拉纯文字升级为可辨认的缩略与阶段，但“浏览”“明确取回”“形成候选”“采用”必须分开。TapNow 单击历史项即可新建节点，不等于 SceneDesk 应自动 materialize；我们的幂等结果身份也不能复制成“每点一次多一份”。

## 7. 平移、缩放、多选与键盘

官方画布操作表明确：空白左键拖动是框选；鼠标滚轮或触控板双指移动平移；中键/右键拖动也可平移；缩放有手势/组合键和左下控件；Fit 用于全览；小地图可跳转。**T，高**：[Explore the canvas](https://docs.tapnow.ai/en/docs/canvas/explore-the-canvas#canvas)。本轮没有在登录产品中校准滚动方向、速度或触控板惯性。

复制/粘贴、删除、撤销/重做和 Shift 多选有明确快捷键；文本输入获得焦点时，编辑键作用于文字而不是节点，画布缩放快捷键也避开文本编辑。**T，高**：[快捷键](https://docs.tapnow.ai/en/docs/account/use-shortcuts)。

SceneDesk 可以采用同样“明确焦点域”的原则，不能把新 floating composer 中的 Backspace、中文组合输入或文字撤销误路由为删节点/画布撤销。视口全览、合法极值坐标、2,000 节点和离屏播放器释放仍需保持原实现保证，竞品帮助页不能作为这些性能目标的达标证据。

## 8. 对照 SceneDesk 底部编辑区：具体需要改变什么

当前源码把 `CanvasComposer` 和 `{generation}` 顺序组合在 `localPanel` 中（CanvasBoard.tsx）。样式是视口底部布局中的固定收缩区，宽 `min(900px, calc(100% - 40px))`，高上限 `min(370px, 42dvh)` 并可滚动（canvas.module.css）。这说明“控件位于底部”，并不说明“控件就近跟随当前对象”。以下是**SceneDesk 设计建议，不是 TapNow 事实**：

| 当前影响 | 方案方向 | 必须保留 |
| --- | --- | --- |
| 目光在节点与底部表单间来回 | 单选打开一个节点所属的局部 composer：明确对象名、参考条、正文、必要规格和主动作；位置靠近节点，越界时有明确停靠与定位 | 不因为 UI 移动重建 session；选中视口外对象不能伪装成附近对象 |
| 同一动作跨节点编辑与生成两段 | 将视觉呈现收为一个动作面；底行参数 chips/popover，完整固定计划另一个明确确认状态 | 显式规格、seed、固定来源可查，错误不藏进折叠 |
| 成功、未知、历史详情占正文输入区 | 紧凑任务摘要贴当前来源；完整历史/任务信息在按需结果面板 | 阶段真实、取消未知/unsupported 与结果终态并存，明确恢复原任务 |
| 多选仍易落到单对象属性编辑 | 多选只展示范围名称/数量与共同操作，选定继续创作后产生独立目标 | 0–100 有序固定来源、原素材不变、不自动生成 |
| Agent 与节点输入容易混成一个中心 | Agent 继续右侧按需 dock；把当前上下文做成可核对的对象列表。节点 composer 是局部编辑，不是聊天 | 三类有限助手、固定 plan/artifact/proposal、人工修改与明确应用 |
| 全屏节点表单看起来像管理后台 | 普通预览态只展示媒体、轻标题、真实状态；工具按选择/动作出现 | 键盘可发现、无模型有明确原因、隐藏不是清理草稿 |

建议下一阶段先画出三个必须同时成立的场景：①单节点输入+周边参考；②多个候选结果比较；③Agent 打开但当前节点仍可见。不能只画一个“空白画布+漂亮输入框”。在 1366 宽度、旧对象离屏、长提示和恢复错误时，局部浮层也必须有可解释的退让策略。

## 9. 尚不能确认的内容

1. 输入浮层在每种缩放/画布平移下的锚定与避让算法、极端边缘是否自动移动视口；本轮示意不能证明。
2. 未选中、悬浮、键盘 focus、拖拽中的全部视觉差别；只能确认已观察帧。
3. 取消、供应商提交未知、离线写入、刷新草稿、多人 CAS 冲突的服务端保证；公开“保存状态”不构成事务证据。
4. 节点结果是否在全部类型中始终新增；音频再生成说明已显示并非统一规则。
5. 手机完整画布行为：官方说手机是小屏访问体验；不能宣称它与桌面完全等价。[设备边界](https://docs.tapnow.ai/en/docs/canvas/explore-the-canvas)
6. 官方文档中的精确模型清单、价格和批量数量持续变化，且不影响此次布局结论；不将示例模型名称硬写入 SceneDesk。

## 复核索引

下列标题均为本轮真正打开并目视的官方图片按钮，而非搜索缩略图：

| 官方页面 | 图示标题 | 官方资源标识（便于在页面源码中核对） | 实际目视内容 |
| --- | --- | --- | --- |
| [节点](https://docs.tapnow.ai/en/docs/canvas/understand-nodes-and-connections) | Create a node | `fa5dc37f-c754-4c7a-bbb0-6407037c4cbb` | 空态；节点下方正文+底行规格 |
| 同上 | Connect nodes | `1cdf3cac-ceff-4218-856c-3472cb1e070f` | 来源图与目标占位、端口 |
| [Agent](https://docs.tapnow.ai/en/docs/agent/chat-with-agent) | Open TapNow Agent | `076a0029-984a-4020-8bcf-0a7148d5f546` | 关闭/右侧展开、独立底部输入 |
| [历史](https://docs.tapnow.ai/en/docs/canvas/organize-your-canvas) | Recover generated content from History | `8f82f334-9ee8-4a52-ba5b-f8102d0bc9a3` | 大画布、左侧缩略历史、选中工具和局部输入 |
| [确认](https://docs.tapnow.ai/en/docs/agent/choose-a-generation-mode) | Confirmation card | `dc2b6391-5331-4f10-8373-fea05ecef122` | 对话内确认摘要与 Confirmed、左侧任务占位 |
| [图片编辑](https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-images) | Redraw part of an image | `2358dcda-e7f7-4424-bbbd-affb5678cd40` | 大图轻包装、选中上方工具和下方输入 |

官方图示由文档页面嵌入 `files.tapnow.media` 资源并通过站内图片组件呈现。本稿未复制图像文件，也未声称观察了付费产品运行。文档还嵌入 [图片快捷指令视频](https://www.youtube.com/watch?v=E7A_3BxiPVE) 和 [视频工具演示](https://www.youtube.com/watch?v=_r39weE-vxE)，本轮未播放，列为后续补证入口。
