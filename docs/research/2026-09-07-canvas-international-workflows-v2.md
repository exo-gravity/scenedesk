# 国际 AI 视觉制作产品：画布、工作流与剪辑衔接复核 v2

调研日期：2026-09-07。范围：Morphic、FLORA、Figma Weave（原 Weavy）、Runway。为整体国内外调研提供国际视觉工作流产品分项证据。

## 方法与证据边界

- 本轮重新获取各产品当前官方帮助中心、文档目录及具体操作页；旧笔记仅作选题线索。
- **D：官方操作文档**，具体描述入口、对象、操作和结果；**P：官方定位／宣传／词汇页**，仅证明产品如何描述自身；**I：研究者推断**；**U：本轮未确认或文档冲突**。
- 本轮没有登录或付费生成，没有使用浏览器实际操作产品；D 不能写成已经实测。未找到证据不等于产品没有能力。宣传中的效果、一致性、效率提升不作为测试结论。
- Morphic、FLORA 的 GitBook 页面经 web 读取部分返回不支持 Markdown；改为公开 HTTPS 获取官方 `.md` 正文并阅读。引用保留对应可浏览的官方页面 URL。
- 本报告没有将四款全部归为“短剧专用工作台”：Morphic 与叙事影视创作直接相邻；另外三款主要是通用媒体／视觉制作平台，作为共享制作能力和交互方式的对照。

## 1. 总体定位：不能把不同画布当成一种功能

| 产品 | 画布在产品中的位置 | 画布核心对象与边 | 与短剧制作的关系 | 证据 |
| --- | --- | --- | --- | --- |
| Morphic | Canvas 是主要视觉创作空间，同时有 Copilot 与可复用 Workflows | 画板、图层、图片、视频、声音、Section；本轮未确认普通 Canvas 有通用端口连线执行语义 | 面向动画师与电影创作者，提供脚本故事板、角色参考、镜头生成与组接；未据此推断有我们定义的剧目／单集生产管理 | P：[Overview](https://morphic.com/docs/getting-started/overview)；D：[Sidebars](https://morphic.com/docs/getting-started/navigating-the-canvas/sidebars) |
| FLORA | 通用创作主界面是节点画布；Technique App Mode 可以绕过画布 | 多模态生成／处理节点、结果、连接、批次；边传递输入，分组和颜色用于组织 | 影视、广告、品牌等多用途视觉流程；不是已验证的短剧专用业务管理系统 | D：[Quickstart](https://docs.flora.ai/getting-started/quickstart)、[Canvas](https://docs.flora.ai/editor/canvas)、[Techniques](https://docs.flora.ai/nodes/techniques) |
| Figma Weave | 专业创作者以节点工作流构建；使用者也可通过简化 Tool 界面运行 | 生成节点与确定性编辑节点，带类型的输入输出；连线是数据传递 | 通用视觉工艺、合成、批量制作的邻近对照 | P：[官网](https://weave.figma.com/)；D：[Understanding Nodes](https://help.weavy.ai/en/articles/12292386-understanding-nodes)、[Tools](https://help.weavy.ai/en/articles/12267755-tools) |
| Runway | 标准生成界面之外的 Workflows 入口，适合自动化与复用；也可发布 Apps | 输入、模型、LLM、媒体工具节点；有类型约束的连线 | 综合媒体平台中的可重复制作流程；Workflows 不等于剧集工作台 | D：[Introduction to Workflows](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)、[Publishing Workflows as Apps](https://help.runwayml.com/hc/en-us/articles/47865876793747-Publishing-Workflows-as-Apps) |

**I：本轮最明确的共性是“保留自由构建能力，同时提供简化使用入口”。** 这并不证明所有用户都应使用节点画布。它更支持我们区分创作者探索／调试与团队稳定复用两类任务。

## 2. Morphic：空间化制作与工作流复用并存

### 2.1 可追踪的关键设计

1. **D — Canvas 组织的是可操作的内容对象。** 左侧有 Layers、Chats、Assets；选中对象后右侧出现适用工具，包括再生成、制作视频、用作参考等，以及提示词、模型、尺寸、费用等来源信息。画布上的文件对象不是只有预览图。[Sidebars](https://morphic.com/docs/getting-started/navigating-the-canvas/sidebars)
2. **D — Section 是空间容器。** 可把图像、画板、视频和声音放入命名分区、嵌套分区，自动排成网格／横排／竖排，整组移动。官方列举按项目、参考、状态等分组的使用方式；没有说明“Final 分区”会自动形成正式审片状态。[Sections](https://morphic.com/docs/getting-started/navigating-the-canvas/section)
3. **D — 故事板从脚本和参考生成，再继续处理素材。** Copilot 可以从脚本拆出故事板画面；“动态漫画”教程则从同一参考反复生成图片、逐张制作视频，最后组接。这里可以确认视觉规划和素材制作衔接，不能把生成的九宫格图片等同于带版本与审批的结构化分镜表。[Storyboarding using a script](https://morphic.com/docs/how-tos/storyboarding/storyboarding-using-a-script)、[Creating motion comics](https://morphic.com/docs/how-tos/creating-motion-comics)
4. **D — 局部操作通过选中对象进入。** Video focus mode 从上传／生成的视频开始，选择后输入修改要求；官方描述换角色、环境、光线或移除元素。效果是否贯穿所有帧属于待实测质量，不作为画布自身保证。[Video focus mode](https://morphic.com/docs/video/video-focus-mode)
5. **D — 多人共创与反馈有分别明确的机制。** Team plan 的 Live Collab 文档描述同时生成编辑、实时光标和跟随视角；Comments 文档描述资产级、画面点／区域级和视频时间点反馈，带回复、解决和重新打开。后者是在资产查看面板的证据，不能简化成“空白画布上评论就完成了审片”。[Live Collab](https://morphic.com/docs/collaboration/live-collab)、[Comments](https://morphic.com/docs/collaboration/comments)
6. **D — Workflows 是当前必须补入的能力。** 用户可以让 Copilot 从任务创建工作流，或将刚完成的对话任务转为可复用流程；运行时通过步骤输入素材与偏好，编辑器由左侧流程细节和右侧 Copilot 组成。本轮文档没有证明它必须以普通 Canvas 的节点连线编辑。[Create a workflow](https://morphic.com/docs/workflows/create-a-workflow)、[Run a workflow](https://morphic.com/docs/workflows/run-a-workflow)、[Edit a workflow](https://morphic.com/docs/workflows/edit-a-workflow)

### 2.2 历史、发布与剪辑

- **D：工作流版本历史记录修改人与时间；查看旧版本不会影响运行，发布旧版本才改变团队运行的版本，后续版本仍保留。** 可以复制流程实验。这是“流程定义版本”，不能外推为所有画布对象或已交付成片有同样版本规则。[Version history](https://morphic.com/docs/workflows/version-history)
- **D：允许嵌套调用其他工作流；底层流程发布更新后，调用它的流程会使用更新。** 官方也提示删除前检查引用。这证明复用能力同时带来依赖变更问题；它没有证明我们可以省略执行输入与版本快照。[Nested workflows](https://morphic.com/docs/workflows/nested-workflows)
- **P：Compose 官方词汇页将其定义为素材生成后的时间线组接，提供排序、裁切、预览和转场，复杂后期仍由专业 NLE 完成。** 当前操作文档目录没有检索到同等完整的 Compose 使用章节，因此具体同步方式、导出工程格式和更新传播规则仍为 U。[Compose](https://morphic.com/ai-glossary/compose)
- **U：普通 Canvas 的可执行边、整图／分组运行、固定候选采用规则、剧集结构与正式审片状态，没有在本轮选读文档中得到完整证据。** 不应把它写成与 FLORA 相同的通用 DAG 画布。

**I — 对我们的价值：** Morphic 证明自由画布可以围绕素材选择、就地编辑、空间分组与团队沟通成立，而不必先把用户训练成节点工作流工程师。场次画布可借鉴这种对象组织，工作流复用可以另有界面。

## 3. FLORA：画布是执行、探索和编辑的共同空间

### 3.1 可追踪的关键设计

1. **D — 节点连接具有输入语义。** 图片到视频可作为参考帧，具体首／尾帧能力取决于模型；多输入可重排，运行前检查上游是否就绪。画布的颜色标记和空间位置用于组织，不是这些语义的替代品。[Canvas](https://docs.flora.ai/editor/canvas)
2. **D — 局部图片编辑产生新节点并保留原图。** 在图片节点上使用遮罩重绘或扩图，结果作为新图并置比较。这里“图片内编辑区域”和“无限画布上的节点位置”是两种不同坐标含义。[Image Editing](https://docs.flora.ai/editor/image-editing)
3. **D — 批量以明确的集合规则运行。** Batch Node 可将同类素材或文本逐项送入相同制作步骤；两个批次有 Cross 和 Zip 模式，并有数量与组合限制。批量生成由执行机制提供，视觉摆放只是配置和理解它的方式。[Batch Node](https://docs.flora.ai/nodes/batch-node)
4. **D — FAUNA 把选区与对话结合。** 可把选中节点或 @ 引用作为上下文，让 Agent 添加、连接、修改、分组与运行；Assist 模式展示待运行节点与预计费用，Auto 模式直接执行。文档也列出跨项目和历史资产访问限制，不能将“Agent 理解画布”理解为无限上下文。[FAUNA](https://docs.flora.ai/editor/fauna)
5. **D — Technique 将流程封装成一个节点或独立 App。** 定义输入输出、预览示例、使用成本与可修改参数；可查看内部图，也可展开后修改。发布流程时校验连接和循环等问题。此机制明确把“构建流程”和“重复使用流程”区分开。[Technique Builder](https://docs.flora.ai/nodes/technique-builder)、[Techniques](https://docs.flora.ai/nodes/techniques)
6. **D — 协作不只有分享链接。** 文档明确描述同一设计文件同时编辑和画布文字注释；工具栏另外提供生成资产历史以便跨项目搬运。没有从中确认视频时间码反馈或正式版本审批。[Collaboration & Sharing](https://docs.flora.ai/editor/collaboration-and-sharing)、[Toolbar](https://docs.flora.ai/editor/toolbar)

### 3.2 当前 Timeline Editor 是重要新增证据

**D — 时间线以节点存在于画布上。** 来源节点连入后，双击展开预览、属性栏与底部多轨时间线；支持裁切、拆分、声音、文字和组接。输出通过渲染形成新的 MP4 节点版本，也提供 EDL／XML／FCPXML 加源素材包。它不是“画布替代时间线”，而是把时间线编辑器嵌入制作图。[Timeline Editor](https://docs.flora.ai/editor/timeline-editor)

**D — 更新传播有明确代价。** 时间线跟随来源节点的 active output；上游重生成会自动替换对应片段并重置该片段裁切。未渲染的编辑会标记出来，下游继续使用上次渲染版本。[同一 Timeline Editor 文档的 Connected Inputs & Live Updates、Unexported Edits 小节](https://docs.flora.ai/editor/timeline-editor#connected-inputs-and-live-updates)

同页排障还给出替代办法：从资产库拖入完成素材作为独立片段，可以避免继续跟随来源节点重生成。问题因此是选择动态连接还是固定素材，而不是产品完全无法保留裁切。

**I — 对短剧生产是特别重要的对照。** 自动跟随在快速探索时方便，却可能影响已经审过的剪辑；我们的“候选、采用、剪辑引用、交付”应分别记录。画布并不解决这种状态规则，需要产品主动设计。

### 3.3 官方文档冲突与未确认项

- **U — Technique 对 Batch 的支持文档不一致。** Technique Builder 的主体和支持列表写可包含 Batch，末尾警告又写 Batch 与 Layer Editor 不受支持；Batch Node、Techniques 两页均描述包含 Batch 的运行方式。可以判断文档正在迭代，不能在未实测前承诺任意批次可封装。[Technique Builder](https://docs.flora.ai/nodes/technique-builder)、[Batch Node](https://docs.flora.ai/nodes/batch-node)
- **U — Timeline 删除行为有细节矛盾。** 片段操作节写删除会移除连接，后文又说只要源连接仍在，已删片段重开会回来。应在真实体验时检查，不能据文档定义我们的删除行为。[Timeline Editor](https://docs.flora.ai/editor/timeline-editor)
- **U — FAUNA 同页对会话持续性与历史访问的描述存在范围不清。** 文档先描述会话保留，又列“不能访问之前会话资产／历史”的限制；可以确认当前选区与对话操作，不能声称它拥有完整跨会话资产记忆。[FAUNA](https://docs.flora.ai/editor/fauna)
- **U：未确认完整短剧剧目／集／场次模型、正式镜头审片和交付审批。** 节点图能够制作相关内容，不等于已具备上述业务结构。

## 4. Figma Weave：专业流程可封装为简化工具

### 4.1 可追踪的关键设计

1. **P／D — 当前名称已为 Figma Weave。** `www.weavy.ai` 本轮重定向到 `weave.figma.com`，官方继续以多模型与专业编辑工具的节点平台定位。节点带兼容类型输入输出，生成与非生成编辑分开。[官网](https://weave.figma.com/)、[Understanding Nodes](https://help.weavy.ai/en/articles/12292386-understanding-nodes)
2. **D — 节点可以容纳多个结果，也可展开为独立对象。** 上传多文件时可以独立摆放，也可以归在一个 Import Node；结果在单项和图库间切换，Unpack 将结果展开成组。通过保留连接复制节点，可以分支尝试，而不必每个候选都占一个独立节点。[Working with Media](https://help.weavy.ai/en/articles/14653652-working-with-media)、[Unpack a Node](https://help.weavy.ai/en/articles/14688070-unpack-a-node)、[Delights #3](https://help.weavy.ai/en/articles/15068263-new-figma-weave-delights-3)
3. **D — Compare Node 的对象明确是两张图片。** 提供滑杆／切换比较，并可选一张作为下游输出。不能写成视频同步比较功能。[Compare Node](https://help.weavy.ai/en/articles/14046860-compare-node)
4. **D — 批量通过 Iterator 表达。** 文本、图片、视频保持每项独立处理；可用 CSV 文本，也可将已有节点的多结果转成迭代输入。这是可复用执行逻辑，并非只是摆放许多节点。[Iterators](https://help.weavy.ai/en/articles/12343281-iterators)、[Creating Iterators from Existing Node](https://help.weavy.ai/en/articles/14688156-creating-iterators-from-existing-node)
5. **D — Compositor 内有另一种画布和时间线。** 输入成为图层，支持文字、形状、位置、混合等；Timeline 调整时间、裁切、声音。这里像素／合成位置会影响成片，外围节点位置主要组织流程，不能混为一谈。[Compositor node](https://help.weavy.ai/en/articles/15887786-compositor-node)、[Timeline Editor](https://help.weavy.ai/en/articles/14689260-timeline-editor)
6. **D — Workflow → Tool 有明确发布边界。** 添加 Output 节点后生成 Tool 入口，作者选择暴露或锁定输入，用户看到独立简化界面；工作流后续编辑不会立刻干扰已发布 Tool，更新才推送。每次发布有带时间的版本，旧版可查看分享。[Tools](https://help.weavy.ai/en/articles/12267755-tools)

### 4.2 历史与协作不能一概而论

- **D：媒体来源信息和流程历史是两件事。** Gallery 的 Show info 查看提示词与参数；2026-07-28 的 Version History 文档描述自动保存流程版本，可 Restore 或 Duplicate。[Media Gallery](https://help.weavy.ai/en/articles/12292408-media-gallery)、[Version History](https://help.weavy.ai/en/articles/16110597-version-history)
- **D：当前可读的 File Collaboration／Sharing Files 文档描述只读分享、复制后编辑、转交所有权。** 这与多人同时编辑同一张画布不等价。相关页面日期为 2025 年，故不能断言当前所有方案都不支持实时协作；只能报告本轮没有找到清晰的新操作证据。[File Collaboration](https://help.weavy.ai/en/articles/12541127-file-collaboration)、[Sharing Files](https://help.weavy.ai/en/articles/12944804-sharing-files)
- **D：Export Node 可输出图片／视频；U：本轮未确认工程导出和正式审片流程。** `[weavy.com]` 的协作组件产品与 `[weavy.ai]` 的生成平台不是同一个证据来源，本轮排除了前者资料。[Helpers Overview](https://help.weavy.ai/en/articles/12268300-helpers-overview)
- **U：已确认单节点 Run 和 Iterator 批次，未从本轮官方文档确认独立的“运行任意选区／全图”的完整规则。** 第三方同名克隆项目的说明不可用于补齐此项。

**I — 对我们的价值：** 为熟练创作者保留可视化工艺构建，向一般使用者提供带业务名称的输入输出；候选可收纳在对象内部，按需展开。简化入口可以长期服务营销人员，而不要求营销人员直接操作全部流程节点。

## 5. Runway：标准生成、可编排工作流、简化 App 三种入口

### 5.1 可追踪的关键设计

1. **D — 官方直接区分使用场景。** 常规界面用于快速生成与迭代；Workflows 用于串联步骤、分支比较、复用模板与自动化。节点区分输入、媒体模型、LLM 和媒体工具，连线只连接兼容类型。这是辅助生产方式，不是所有创作的强制入口。[Introduction to Workflows](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)
2. **D — 执行范围与保留结果明确。** 支持 Run all、单节点 Run、多个无冲突节点组并行；Active Runs 可查看取消，锁定节点可防止整图重跑时再生成该节点。并行仍受依赖就绪和队列约束。[Introduction to Workflows](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)、[Building your first Workflows](https://help.runwayml.com/hc/en-us/articles/45769159004691-Building-your-first-Workflows)
3. **D — 节点执行历史保留多个输出。** 可浏览、全屏、下载、收藏，把旧结果切为当前输出，或转成独立图片输入节点；这是选择从哪个结果继续制作的明确操作。[Building your first Workflows](https://help.runwayml.com/hc/en-us/articles/45769159004691-Building-your-first-Workflows)
4. **D — 发布为 App 隐藏复杂度。** 给输入输出起名并决定显隐，关键配置锁定；用户在 My Apps 使用。后续通过 Update App 更新，取消发布不删除原 Workflow。[Publishing Workflows as Apps](https://help.runwayml.com/hc/en-us/articles/47865876793747-Publishing-Workflows-as-Apps)
5. **D — 分享流程不等于分享全部结果。** 官方描述 workspace／project 和链接分享；外部共享流程以只读打开，复制后使用，链接只分享输入素材而不分享节点输出素材。因此分享一张流程图不能自动替代成片审阅与交付。[Introduction to Workflows 的 Sharing Workflows 小节](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)

### 5.2 时间线与审片证据边界

- **D：媒体工具节点支持拼接视频、提取帧和加／拆声音。** 这能组成生成后的处理步骤。[Introduction to Workflows](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)
- **U：本轮 Workflows 文档没有说明节点图与故事板／剪辑工程的双向映射，也没有确认工作流画布的实时多人编辑或评论审批。** 不能把 Runway 其他产品区域的能力自动嫁接到 Workflows。
- **I：节点顺序是数据依赖，最终视频顺序要由拼接或剪辑动作定义。** 带线排列的多个视频生成节点本身，不证明它们会按视觉位置组成一集。

## 6. 对当前短剧优先方案的设计含义（研究建议，非新增承诺）

1. **保留“场次内制作画布”作为独立值得验证的产品方案。** 应能实际选择参考、操作素材、比较候选和发起局部返工；只把镜头卡搬到可拖拽背景上，无法复现上述产品的价值。
2. **把三种关系分别设计：** 空间分组用于理解；引用／生成边用于提供输入；剪辑时间线用于确定播出顺序。三者可以在同一界面联动，但不能由同一条含义不清的连接线兼任。
3. **画布不必承载所有专业流程。** Morphic 的对象式 Canvas、Runway 的专门 Workflows、FLORA／Weave 的简化 App，都说明可以有渐进操作深度。短剧工作台默认入口需要用户验证，不能以竞争对手有画布就直接决定全站画布化。
4. **把执行、采用和引用状态放在画布下面。** 节点历史、锁定输出、流程发布版本、渲染版本均需要数据模型支持。FLORA 自动跟随来源的规则说明：即便画布功能成熟，剪辑也可能发生用户不希望的变化。
5. **暂不凭文档承诺任意节点工作流、多轨专业编辑或实时多人光标进入 MVP。** 当前优先验证一场戏内“准备参考 → 生成 → 对比 → 局部改动 → 采用 → 编排”的成本和可理解性。公共生成与版本能力未来可被广告的简化制作入口复用。

## 7. 本轮相较旧结论需要纠正的重点

- Morphic 当前有可创建、编辑、嵌套、发布和回滚的 Workflows，不能只以旧 Canvas／Copilot／Compose 三个名词描述其流程复用能力。
- FLORA 当前存在画布内 Timeline Editor 及 NLE 素材包导出；不能再笼统说画布产出后只能逐个下载去外部组接。
- Figma Weave 当前帮助中心明确有 Compositor Timeline 和流程 Version History；但实时多人协作仍不应由 Team plan 或 Figma 品牌推断。
- Runway 当前有节点执行历史、冻结输出和 App 发布，画布的价值落在可重复执行及选择性返工，不止流程展示。
- 三种“隐藏画布的复用”均有官方证据：FLORA Technique App、Weave Tool、Runway App；Morphic 则通过 Copilot 引导创建和运行流程。由此可支持未来“专业制作能力共享，广告用户采用简化入口”的架构方向，但实际业务产品仍需独立设计。
