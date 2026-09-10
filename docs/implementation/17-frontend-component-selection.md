# 17 前端免费组件选型与接入方案

日期：2026-09-09。状态：**通用 UI 与专业组件选型已收口**。用户确认 Mantine 后进一步授权完成剩余设计；本轮通过官方发布包／许可核对及隔离浏览器样例，确定 React Flow、Media Chrome、dnd-kit、Query，Virtual 按需接入。主应用已接入 Mantine；专业库只在隔离样例验证，随真实业务切片进入主应用。完整证据见[专业组件裁决](../research/2026-09-09-specialized-stack-closure.md)。

## 1. 已确定的通用 UI 与专业组件

**已确认：Mantine 作为 MVP 唯一通用 UI 库，表单优先复用 Mantine Form，多面板优先使用 Mantine Splitter；核心创作工作区由本项目设计。** 保持集中主题与有作用域的 CSS，不混入第二套通用 UI，不修改第三方源码来硬套页面。Kumo 不再与 Mantine 平行实施，只有出现具体、难以通过公开 API 解决的障碍才重开评估。

专业组件确定为 Media Chrome + dnd-kit + TanStack Query，画布使用 React Flow，复杂资产列表按需使用 TanStack Virtual。React、TypeScript、Vite、Phosphor 及 Mantine 9.6.0 沿用现有基线。具体工作区由本项目设计；轻量剪辑与 FFmpeg 边界保持，视觉沿用已确认的中性、轻包装、媒体优先语言及当前明暗样例。组件选定不代表服务端或生产容量验收通过。

目标是减少基础功能开发和长期维护，不追求某一个组件品牌，也不按组件数量、星数或官网演示的完整程度排名。业务完成标准仍以 [14 场次收口](14-scene-mvp-closure.md) 为准。

| 层次 | 已选方案及本轮版本起点 | 本期用途 | 许可与接入阶段 |
|---|---|---|---|
| 通用 UI | `@mantine/core`、`@mantine/hooks` 9.6.0 | 按钮、输入、弹窗、菜单、选择、标签页、基础表格等 | MIT；已接入本地样板，完整业务逐步迁移 |
| 表单 | `@mantine/form` 9.6.0 | 生成参数、镜头要求、审阅与管理表单的值、校验和错误 | MIT；随 Mantine 方案优先复用，不同时管理两套表单状态 |
| 工作区分隔 | Mantine `Splitter`，随 core 9.6.0 | 横纵分隔、尺寸限制、折叠、嵌套、键盘调整 | MIT；本地场次样板已接入并验证调整、折叠和尺寸恢复 |
| 媒体播放 | `media-chrome` 4.19.2 + 原生 video/audio | 素材、候选与固定版本文件的播放、字幕、音量和进度 | MIT；已选定，随真实媒体接入 |
| 拖拽排序 | `@dnd-kit/react`、`@dnd-kit/helpers` 0.5.0 | 镜头排序、片段排序及有明确目标的素材投放 | MIT；已选定，随排序业务接入，采用当前 React API |
| 服务端状态 | `@tanstack/react-query` 5.102.8 | 对象查询、缓存、失效刷新和请求状态 | MIT；已选定，随 API 接入 |
| 大列表 | `@tanstack/react-virtual` 3.14.11 | 大量素材与候选的可见区渲染 | MIT；已选定，按实际列表规模引入 |
| 画布引擎 | `@xyflow/react` 12.11.6 | 独立节点、引用连线、视口及选择，业务 DTO 独立 | MIT；已选定，隔离验证通过，随 CX02 接入 |
| 图标 | 现有 `@phosphor-icons/react` 2.1.10 | 导航、操作和状态图标 | MIT；继续沿用 |
| 视觉 | 集中 Mantine theme + CSS Modules/有作用域的现有 CSS | 独立维护产品视觉；当前采用共同语言的中性明暗样例；深灰／暖杏仅为早期组件样板记录 | 集中规则已建立；当前原型与旧根主题尚未全站归一，不视为永久冻结品牌 |
| 编排与输出 | 现有 CutDraft / CutRevision + 隔离媒体 Worker 中的 FFmpeg | 一条主视频序列、必要声音/字幕、规范化、固定版本渲染 | FFmpeg 按实际构建适用 LGPL/GPL；不是 MIT 包 |

版本及 latest／next、许可描述是 2026-09-09 核对时的记录，不是本次文档维护重新联网核验的结果；安装或升级时复核目标发布包。版本是本次可复核的实施起点，隔离样例已使用精确版本及自己的 lockfile；主应用 lockfile 已锁定本轮 Mantine 三个包。后续升级采用兼容验证与明确版本更新，不跟随漂移的 latest/next，也不使用 `--force` 或 `--legacy-peer-deps` 掩盖冲突。

## 2. 为什么调整最初参考清单

### 2.1 已确认 Mantine 作为通用 UI 主选

两个库都可用。Kumo 有 standalone CSS，不强制 Tailwind；当前 React 版本也满足其要求。选择 Mantine 的主要原因是本项目同时需要生成参数、复杂表单、素材检索、审阅弹窗和团队管理，Mantine 的现成控件、表单状态及 Splitter 可以直接组合，减少基础交互补齐工作。

Mantine 9.6.0 要求 React 19.2+，当前应用 19.2.8 满足。使用公开主题与 Styles API 调整密度和颜色，不 fork 组件源码。shadcn/ui 适合希望长期拥有组件源码的团队，但源码更新合并也归本项目；直接用 Base UI/React Aria 建设计系统会留下更多组装工作。本期优先完成场次业务，因而不选择这两条路线。[Mantine Vite](https://mantine.dev/guides/vite/)、[表单](https://mantine.dev/form/use-form/)、[Styles API](https://mantine.dev/styles/styles-api/)、[Kumo 安装](https://kumo-ui.com/installation/)、[shadcn 定位](https://ui.shadcn.com/docs)

代价：Mantine 提供的能力较多，样式与包体需要按实际页面控制；跨主版本升级需要统一验证。现有 `style.css` 中宽泛的 button/input/svg 规则应先收窄，不能靠大量 `!important` 修复冲突。Kumo 保留为有具体阻碍时的备选，不同时引入两套通用 UI。

### 2.2 优先 Mantine Splitter，减少重复布局依赖

Splitter 已覆盖本项目的横纵布局、多面板、嵌套、min/max、px/rem 与百分比尺寸、折叠、受控尺寸和键盘操作。应用保存布局偏好，并在窄屏切换折叠/抽屉视图。[Splitter](https://mantine.dev/core/splitter/)、[useSplitter](https://mantine.dev/hooks/use-splitter/)

`react-resizable-panels@4.12.4` 是有效 MIT 备选；如果实际动态布局或恢复存在无法通过公开 API 解决的障碍，再替换这一层。Allotment 也能实现分隔，但本期没有额外收益；Dockview 的停靠、标签组、浮动窗口适合 IDE 式产品，超过本期需求。不能为了未来可能需要任意停靠而先改变工作区交互。[react-resizable-panels](https://github.com/bvaughn/react-resizable-panels)、[Dockview 定位](https://dockview.dev/docs/overview/introduction/)

### 2.3 采用 Media Chrome 作为播放器默认，Vidstack 保留备选

本期主要播放平台上传、生成和渲染的私有素材，不依赖聚合外站播放器。Media Chrome 提供官方 React 包装和现成控制组件，直接连接原生媒体元素，且不要求使用 Mux 托管服务。适合控制视频身份、时间码与审阅界面。[React 指南](https://www.media-chrome.org/docs/en/react/get-started)、[项目许可](https://github.com/muxinc/media-chrome)

Vidstack 1.15.6 的媒体状态、字幕、缩略图和 provider 能力有价值，但本次默认 npm latest 仍解析到另一代 0.6.15，只声明 React 18；当前文档对应的 React 19 兼容 1.x 走 next 标签。若使用应固定 1.15.6，不能混用两代 API。**标签本身不证明停更或不成熟**，选择 Media Chrome 是基于本期媒体来源与集成边界。[Vidstack 安装](https://vidstack.io/docs/player/getting-started/installation/react/?bundler=none&provider=video&styling=default-layout)

Video.js 更适合已有流媒体/插件投入；ReactPlayer 的多来源识别暂时用不上。没有必要为同一播放器同时引入多套框架。

### 2.4 保留 dnd-kit，明确采用哪一代 API

本期使用 `@dnd-kit/react` 0.5.0 与对应 helpers。官方已将 `@dnd-kit/core` / `@dnd-kit/sortable` 文档放入 legacy，不能把旧 DndContext/active/over 写法与新 DragDropProvider API 混装。0.x 版本更新仍需逐次审查，不能因采用新 API 就忽略兼容性。[当前快速开始](https://dndkit.com/react/quickstart/)、[迁移指南](https://dndkit.com/react/guides/migration/)

Pragmatic drag and drop 对原生文件拖入和高性能拖放有价值，但其 core 不自动提供完整可访问操作，需额外设计。本期优先复用 dnd-kit 的 React 排序与传感器体系；从操作系统拖入文件仍走文件上传入口，不假设列表排序库自动具备上传能力。[Pragmatic 可访问性说明](https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines)

拖拽使用明确把手，避免与文字选择、播放进度条、音量滑块、分隔条冲突。镜头排序与剪辑片段排序是不同命令：前者不隐式改变实际剪辑；拖入也必须区分引用参考、添加候选和加入剪辑。保留可见移动按钮/菜单，不让拖拽成为唯一入口。

## 3. 免费编辑器 SDK 的取舍

本轮比较了 Remotion、Twick、Diffusion Studio、OpenCut 和 Mediabunny，未发现比现有受限编排模型更适合立即接入、且满足本项目全部免费使用条件的完整 SDK。

| 候选 | 核查结论与本期建议 |
|---|---|
| Remotion | 有盈利组织规模的免费门槛，不符合团队增长后仍不依赖席位/公司授权的底座目标；不选作免费基础 |
| Twick | 正式许可含托管 SaaS 等商业协议要求，与 README 的概述存在需澄清差异；不作为本轮已确认免费的方案 |
| Diffusion Studio Core 4.0.3 | 当前已改为 MPL-2.0，不能沿用旧非商用结论；官方支持的无水印路径仍涉及购买 key，且不面向服务器渲染；不作为首期主引擎 |
| OpenCut | MIT，但完整编辑应用与正在重写的架构，不等于可直接嵌入的成熟 SDK；不 fork 为平台基础 |
| Mediabunny | MPL-2.0 的媒体底层工具，保留为将来浏览器取帧/局部实时预览专项候选，不冒充完整编辑器 |

具体版本、许可条文与官方来源见 [媒体专项 §3](../research/2026-09-09-frontend-media-evaluation.md#3-免费编辑-sdk-值不值得直接复用)。这里没有判定 GPL/MPL 禁止商业使用；不选择的原因包括明确的商业条款、产品适配、维护责任和后台输出边界。

继续复用 FFmpeg 的解码、裁切、拼接、混音、字幕和编码。自己实现的部分是“把我们受限的编排模型转换为处理计划”，不是自研编解码器。FFmpeg 的具体镜像/构建许可要单独记录；组件免费不等于计算、存储和模型调用免费。[FFmpeg 官方许可](https://ffmpeg.org/legal.html)

## 4. 播放、剪辑、预览和审阅的工程边界

### 4.1 保留既定剪辑能力

分镜卡片/分镜条表达计划和顺序；CutDraft 表达实际素材版本、源入出点、主视频位置、原轨静音、独立声音与字幕。正式冻结和输出按现有 normalization/CAS/CutRevision/render 流程执行。播放器内部状态、拖拽坐标和 React Flow 节点均不能成为领域事实源。

不因没有完整多轨 UI 而删除跨镜声音。人物讲话切到对方反应镜头时，对白应能继续；取出视频混合音轨仍是混合音轨，不宣称已经分离人声。视频原轨与独立音频的选择需要避免重复对白。范围和验收见 [05 媒体规范](05-architecture-and-operations.md#4-媒体验收与渲染)、[13 质量规范](13-production-quality-and-handoff.md)。

### 4.2 先复用现有固定版本渲染路径

源素材播放、入出点检查即时响应。第一批完整声画连续预览沿用现有保存/归一/固定 CutRevision/渲染路径，允许异步等待；创建固定版本不等于发起正式审阅或批准。是否发起审阅仍是独立业务动作。

本轮**不额外新增直接渲染可变草稿的 API**，也不把尚未合成的多个 video 元素轮播当作可批准的成片。研究中“草稿预览任务”是可优化方向；如将来要在冻结前自动生成预览，应先补齐输入快照身份、去重、过期和接口契约，再进入实现。

页面必须标明视频对应哪个固定修订，当前编辑变化后不能把旧预览标成新结果。素材预览和连续渲染预览的操作、等待状态都应清晰。第一场真实素材测试记录预览等待时长，若阻断制作，再增加局部接点预渲染或浏览器实时合成专项。选定免费播放器不代表已经解决即时、多片段、音画一致的预览。

### 4.3 媒体专用约束

- 以不可变 mediaId / CutRevision / render 身份定位内容，签名 URL 只是访问凭据；续期不能换成另一份素材。
- 审阅记录来自实际观看文件与规范化时间映射。`timeupdate` 和反复设置 `currentTime` 不构成帧级精确定位的证明。
- 原生字幕播放使用由统一字幕数据派生的 VTT；SRT 仍用于交付。精确审查烧录字体与断行时播放对应烧录文件。
- 单一候选播放器默认发声，先实现切换比较；多视频同步比较继续后置。
- 私有对象的 Range、MIME、CORS、字幕、URL 续期、播放失败和资源释放一起验证，不能只测试 URL 能打开。
- 首期正式渲染由后台 Worker 完成，不依赖用户持续打开浏览器，也不把 ffmpeg.wasm 当作低成本替代。

## 5. 按需引入，避免组件清单反过来扩大产品

| 能力 | 本期做法 | 何时才增加新依赖 |
|---|---|---|
| 大型资产列表 | 服务端分页/检索，缩略图懒加载；必要时 Virtual | 实际 DOM/滚动成本超出目标；不把大列表虚拟化当作视频解码优化 |
| 复杂表格 | Mantine Table + API 过滤和分页 | 多列排序、固定列、行模型等需求稳定后再选 TanStack Table；不同时装多个表格封装 |
| 上传 | 现有上传意图/验收契约，Mantine 文件选择/投放 UI | 分片与恢复协议落实后再评估 Uppy；加入前端插件本身不能创造后端续传能力 |
| 声音波形 | 基本音量/区间控件，保留后端时间规则 | 确认需要波形操作后再核查 wavesurfer.js 等；不把波形库当混音引擎 |
| 剧本编辑 | 现有文本/结构化字段与版本流程 | 富文本、精确选区或协同编辑成为明确需求后单独选编辑器 |
| 客户端状态 | React 局部 state/reducer/context；表单状态归 Mantine Form | 有具体跨区域高频订阅压力时再考虑 Zustand，不把全部服务端对象复制一遍 |
| 场次自由画布 | 用户已纳入首版；React Flow 12.11.6 已在隔离样例验证并选定，主应用待集成 | 与场次分镜模式切换，承接引用、生成和继续尝试；按[交互设计](../design/scene-canvas-interaction-v0.1.md)补齐保存、性能、事件边界和验收，不扩成任意流程引擎 |
| 动效 | CSS transition 和组件自带机制 | 确有复杂动画需求再增加动画运行时 |

TanStack Virtual 是 headless 可见区工具；React Virtuoso 提供更现成的列表行为，也可用，但当前自有卡片和横向条带更适合统一使用 Virtual。虚拟化/拖拽组合必须专测焦点、滚动、尺寸变化和拖出可见区，不混用两套虚拟化方案。[Virtual 官方定位](https://tanstack.com/virtual/latest/docs/introduction)

## 6. 业务数据与组件状态分工

- **Query**：服务端对象读取和失效刷新；query key 含可信上下文对应的 tenant/project/object 身份。退出或切换账号时清理相应缓存。
- **SSE**：沿既定契约只触发资源失效/重新读取；GET 是权威状态。新旧 revision 比较避免旧响应覆盖新事实。
- **Form / reducer**：本地未提交输入和剪辑实验。后台 refetch 不覆盖 dirty 草稿；冲突保留用户输入，按 CAS 流程处理。
- **Mutation**：生成购买、采用、保存、冻结等明确动作。默认 `retry:false`，重试按原幂等键和查询恢复处理，不因组件自动恢复网络就重复购买。
- **布局与播放位置**：视图偏好，可本地保存；不得同时保存另一份权限、批准或费用事实。

组件层只在有具体业务约束时封装 AssetPicker、GenerationForm、ScenePlayer、ShotStrip、ReviewDialog 等；普通 Button/Input 直接使用主库，不为每个组件增加透传包装。保留专业组件公开 API，避免跨层读取第三方私有 store。

## 7. 接入顺序与验收

F00 是 E01–E06 的前端支撑，不替代原有业务切片，也不要求一次改完全部页面。F00-A 的主题/控件和 F00-B 的 Splitter 已进入本地视觉样板，基础交互走查通过；真实业务和其余页面继续随 E01–E06 推进。双模式与视觉基线已确认，细节继续打磨；专业库按本轮裁决接入，服务端和多浏览器继续验收。

1. **F00-A：主题与基础控件。** 集中主题、收窄全局 CSS，替换一类完整表单/弹窗；验证中文输入、Tab/Esc、焦点返回和字段错误。
2. **F00-B：场次工作区。** 接入 Splitter 和镜头排序；布局偏好与镜头排序分别存储，验证折叠、键盘、尺寸恢复与 1366 宽工作区。
3. **F00-C：真实素材播放器。** 接入 Media Chrome，使用 E03 的真实媒体和授权 URL，验证加载、seek、字幕、续期、切换和释放。
4. **F00-D：API 状态。** E02/E04 接入 Query，与 Mantine Form/草稿隔离；验证采用成功但剪辑保存冲突、旧响应和 SSE 断线恢复。
5. **E05/E06：真实声画与审阅。** 按原验收处理归一、跨镜对白、固定版本渲染、旧评论定位及后期交接。播放器样例通过不能代替这些检查。
6. **实际资产规模验证。** 使用已有 500 镜头/10,000 媒体容量目标测试分页、缩略图、DOM 和视频解码；必要时启用 Virtual 与按路由加载。

没有测量就不设虚构的性能优势。初始镜头数少的页面优先普通列表；播放器、资产库和专业编辑代码按页面需要加载，避免所有依赖进入首次打开的一个 chunk。

## 8. 本轮证据与实施限制

- [通用 UI 独立研究](../research/2026-09-09-frontend-ui-evaluation.md)：6 类方案、许可证、主题、表单和 Splitter。
- [媒体独立研究](../research/2026-09-09-frontend-media-evaluation.md)：播放器、编辑 SDK、许可与连续预览取舍。
- [npm 版本与兼容声明快照](../../output/research/2026-09-09-frontend-packages.json)：直接读取 Registry，包含查询错误及纠正，不把 latest 自动当生产版本。
- [发布包 LICENSE 证据](../../output/research/2026-09-09-frontend-license-evidence.json)：核对选中组件及部分备选的实际 tarball LICENSE、包摘要；范围是列出的直接包，不宣称覆盖整个传递依赖树。
- [隔离集成样例](../../output/prototypes/2026-09-09-component-spike/package.json)：React 19.2.8 / Vite 7.3.6 / TypeScript 5.9.3，与主应用分开安装；独立 lockfile，不修改主应用依赖。

集成样例的构建与浏览器结果见 [验证记录](../../output/playwright/2026-09-09-component-spike/verification.md)。它验证所选组件能共同运行，不是完整产品迁移、真实模型调用、私有对象授权、声画合成或生产容量验收。

## 9. 与历史资料的关系

视觉方向的工程化约束见 [Mantine UI Agent 执行规范草案](../design/mantine-ui-agent-spec-v0.1.md)。它提出主题、样板、组件职责和检查机制，作为当前视觉执行基线，细节可迭代；专业组件以本文件本轮裁决为准。

本文件与已接受的 [ADR-0005](../adr/0005-frontend-free-component-stack.md) 共同记录 Mantine 通用 UI 决策，专业组件已按本轮授权研究与隔离验证完成裁决。原型文档与工程就绪记录仍描述各自当时的实际实现。主应用完成对应迁移并验证后，再更新其运行状态。当前视觉和布局见 [设计确认记录](../design/approved-baseline-2026-09-10.md)与 [UI Agent 规范](../design/mantine-ui-agent-spec-v0.1.md)。既定产品范围、API 字段和冻结历史评审不因组件选择改变。

## 10. 本轮专业组件验证与实施约束

[隔离样例与研究](../research/2026-09-09-specialized-stack-closure.md)已核对精确版本与发布包许可，验证节点移动／连线、Mantine输入和弹层、媒体seek不拖节点、双模式本地恢复、指针和键盘排序、查询更新保留dirty草稿及10,000条虚拟列表。TypeScript、构建、浏览器通过，生产容量／私有媒体／服务端冲突尚未验证。正式主应用按路由与模式拆包，不把样例全库单包直接搬入首屏。默认保留React Flow署名，不依赖Pro示例或付费模板。

## 技术收尾补充（2026-09-10）

组件名单不变。状态接入按[21 §6](21-technical-baseline-closure.md#6-前端状态与实施门槛)：Query维护服务端快照，编辑store拥有工作稿／base／pending／撤销，本人视图偏好独立。工作稿可以已保存但仍不可渲染；新API与精确归一按1.3.0契约接入。React Flow不直接序列化全部运行状态作为业务文档；Media Chrome不承担多片段音画合成。旧本地组件样板没有因此升级为真实保存实现。
