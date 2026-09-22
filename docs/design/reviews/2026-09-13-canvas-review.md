# 自由画布与创作交互审查

> 本文引用的部分源文件与 e2e 规格属于旧创作界面，已在 2026-09-21 阶段 3 删除（见 [85-studio-rebuild.md §1i](../../implementation/85-studio-rebuild.md)）；这些引用改为纯文本，内容按当时原样保留。

日期：2026-09-13。基线：main `585eb10df26bc7b1d32d8b67bb99a8ee7b596898`；本轮检查的场次、画布与生成组件同已验收视觉分支内容一致。主任务已按用户要求执行 `fetch origin --prune` 与 `pull --ff-only origin main`，确认最新 main 仍为该 SHA，无新增差异。

最新用户要求是提升整体视觉与 UX、减少后台表单感，并参考 TapNow / LibTV。这覆盖旧设计记录中“不再调整布局”的限制；以下是待整合的新建议，不把旧原型直接替代真实业务。本轮只读代码、文档、既有生产截图和第三方公开资料，没有更改 UI、运行模型、登录第三方或操作主任务浏览器。

## 判断

主空间已经具备应保留的基础：满高画布、独立媒体节点、左下视口工具、单一按需 dock、双模式上下文、固定输入和结果恢复。当前最影响创作感的是**同一次操作分散在对象、底部全局动作、节点设置和生成折叠表单之间**。建议把它收成“选材料 → 写本次要求 → 核对规格 → 明确执行 → 就近查看成果”的连续路径；视觉升级依靠层级、空间与就近操作，不依靠更换 UI 库或给每块表单加装饰。

阅读依据：根与 web AGENTS；[批准基线](../approved-baseline-2026-09-10.md)、[共同视觉语言](../shared-visual-language-v0.1.md)、[Mantine 规范](../mantine-ui-agent-spec-v0.1.md)、[v0.3 连续体验](../scene-walkthrough-review-v0.3.md)、[画布交互](../scene-canvas-interaction-v0.1.md)、[18 画布协议](../../implementation/18-canvas-workspace-contract.md)、[38 首发范围](../../implementation/38-first-release-scope-review.md)。代码里没有单独的 `CanvasWorkspace.tsx`；该领域的页面组合落在 `SceneProductionWorkspace`、`CanvasBoard` 与各生成组件。

目视复核历史生产截图：[1512 浅色画布](../../../output/playwright/2026-09-12-approved-integration/canvas-light-1512.png)、[1366 深色画布与助手](../../../output/playwright/2026-09-12-approved-integration/canvas-dark-assistant-1366.png)。这两张图片仅用于观察历史空间与表单组织。主任务本轮发现旧标签可能仍挂载 PR33 之前的 bundle，因此不把既有截图当作 `585eb10` 新生产页的视觉证据；本轮问题定位以该 SHA 的源码为准，实施前/后均须新开生产页复核实际绘制。历史图片不能证明下面建议已实现或任务效率已提升。

## 官方公开资料：观察与推断分开

| 来源（本轮重新访问） | 可以确认的内容 | 对 SceneDesk 的启发与边界 |
| --- | --- | --- |
| [TapNow：节点与连接](https://docs.tapnow.ai/en/docs/canvas/understand-nodes-and-connections) | 官方说明支持就地新增、节点右侧继续创建、多选来源，并要求生成前核对实际引用。 | 借鉴就近动作与显式来源。不能推断任意连线会自动执行，或其恢复事务与本项目相同。 |
| [TapNow：组织画布](https://docs.tapnow.ai/en/docs/canvas/organize-your-canvas) | 官方区分生成结果历史与整张画布恢复；提供节点检索和定位。 | 让结果取回成为看得见的素材流程，避免与布局修订混名。这里不引入标记审批系统。 |
| [TapNow：生成模式](https://docs.tapnow.ai/en/docs/agent/choose-a-generation-mode) | Ask 模式先展示模型、输出与引用确认，用户确认后执行；另有 Auto 模式。 | 只借鉴确认卡的清晰表达。SceneDesk 继续明确执行，不增加 Auto 或付费自动编排。 |
| [LibTV 官方首页](https://www.liblib.tv/) | 本轮公开页面可读取“新建画布创作”、LibTV Agent 及创作工具入口。 | 可确认画布与助手并存的产品入口；不能据首页证明节点工具位置、连线语义、快捷键、保存或收费恢复行为。 |

对 LibTV 做了限定官方域名检索，没有获得足以核实上述节点行为的官方操作帮助页。独立公开页面浏览尝试超时，没有取得可作为本轮证据的页面截图；未登录。没有采用第三方测评、同名非官方站点、社区模型页或仿制仓库补充事实。[2026-09-09 历史研究](../../research/2026-09-09-scene-canvas-interactions.md)记录的 LibTV 用户截图原文件已不可用，本轮不把该历史观察当新视觉证据。因此以下细节均是基于本项目的设计判断，不宣称复刻了已实测 LibTV。

## 七个关键问题与落地建议

### 1. 选中对象的动作离对象太远

**证据：** CanvasBoard.tsx:748 将“继续创作、复制、移除、组合”放在全画布底栏；CanvasBoard.tsx:93 的节点只有标题、内容和连线端口。历史 1512 截图也呈现草稿在中部、相关动作在右下的距离问题；本轮以源码结构为定位证据。已有操作可用，问题是位置和发现性。

**建议：** 单选在对象上方放最多三项短动作：继续创作、查看/播放、更多；多选在选择范围旁显示“用作参考 · N”，更多里放复制、移除和组合。屏幕边缘时停靠到画布可见边界；键盘选中也能聚焦工具，不只依赖 hover。左下仅保留视口工具与添加。

**最小闭环：** 移动现有 `CanvasContinueCreation` 入口，保持其打开时捕获来源及 `createCanvasDraft` 逻辑。新草稿仍需明确选择类型，不从连接或选择自动生成。浮动工具不进入节点测量、不成为拖拽区域、不改变 fit 包围盒。

**文件边界：** `CanvasBoard.tsx`、`CanvasContinueCreation.tsx`、`canvas.module.css`；可新增局部 selection toolbar 组件。无需 controller、领域或 SQL 改动。

### 2. 提示与生成是两段叠加表单，主路径不连续

**证据：** CanvasBoard.tsx:916 先挂 `CanvasComposer` 再挂 generation；CanvasMediaGeneration.tsx:75 又用默认折叠 Accordion 包生成；canvas.module.css:161 把两段放进最多 290px 的滚动容器。展开后，模型、规格、种子、计划与结果继续纵向堆叠（MediaGenerationWorkspace.tsx:427）。分镜输入的图/视频/音频也各自嵌套 Accordion（ShotPromptComposer.tsx:326）。

**建议：** 一个稳定、居中的有界 composer：顶行明确对象与类型；中间是主要文本；下面是参考条；最下为模型、比例、时长等紧凑可展开参数与一个主动作。随机种子和非必要字段进入“更多参数”。未配置模型时保留可写输入与清晰不可用说明，不能显示伪可用执行按钮。计划准备后原区切成摘要确认状态，可展开完整固定输入；确认执行仍是独立点击。

**最小闭环：** 先为现有 `MediaGenerationWorkspace` 提供紧凑组合呈现，将编辑与计划/任务显示分区，复用同一会话。不要同时新建两份 draft，也不要因收起/切类型卸载并丢失恢复记录。固定来源 0–100、顺序、历史修订、assistanceSource 继续保留。

**文件边界：** `CanvasMediaGeneration.tsx`、`MediaGenerationWorkspace.tsx`、`ShotPromptComposer.tsx`、`canvas.module.css`、`image-generation.module.css`。这是主要整合点，应由一个 agent 拥有，避免各页面独立做三套 composer。

### 3. 最重要的参考用途藏在几何设置后面

**证据：** CanvasBoard.tsx:1048 的“参考与节点设置”先放名称、x/y/宽度和分组，之后才是添加参考及逐边用途（1190 行以后）。节点连接有用途标签，但用户在输入前不容易确认哪些参考启用、各自负责什么。

**建议：** 输入旁直接显示已启用参考的小缩略、名称和用途；文字来源用短摘录。点击项目展开固定媒体/资产版本和用途选择；移除/停用为局部动作。名称、数值坐标和分组移到独立“节点属性”，保留精确编辑的无效输入恢复。画布参考与固定镜头来源分别标明，不能把镜头导航当引用选择。

**最小闭环：** 来源 UI 读现有 edges、enabled、purpose 和固定来源 GET；只在明确操作时写草稿，计划确认仍从 resolved 快照读取。无需新 `@` 语法或富文本 editor；先把真实引用做清楚，不能用提示字符串中的名字冒充类型化引用。

**文件边界：** `CanvasBoard.tsx` 局部 composer 可拆 `CanvasReferenceStrip`；复用 `CanvasShotSources` / `FixedPlanShotSources`、现有媒体缩略访问，保持懒加载。

### 4. “历史”分散，删除来源后找回成果靠下拉文字辨认

**证据：** 场次顶栏有历史 dock（SceneProductionWorkspace.tsx:448）；生成历史却在 CanvasMediaGeneration.tsx:89 用 `NativeSelect` 列出节点标题/序号/是否有任务，选后再点“打开所选固定任务”。旧节点删除后标题退化为“已删除的…草稿”。生成工作区又有此前任务折叠区（832 行）。这些是现有独立事实，不能合并成一个回滚操作。

**建议：** 明确命名“生成结果”与“画布修订”。结果入口用带缩略、类型、创建时间、真实阶段的紧凑列表，打开详情读原计划及来源，提供“定位已在画布的结果”或“取回画布”。没有 ready 媒体时显示阶段，不造预览。保留本场范围和原 API 分页。

**最小闭环：** 先把现有生成历史选择呈现为可辨认列表，复用同一个 plan/job 打开与 materialize。关闭结果浏览回到原草稿，不让 historyId 继续压过当前编辑目标；操作时明确“查看旧任务”与“编辑当前草稿”。点击结果不自动 materialize，不自动建 Take。

**文件边界：** `CanvasMediaGeneration.tsx`、现有 `GeneratedMediaResult`、`MediaGenerationWorkspace.tsx`；`SceneProductionWorkspace.tsx` 只提供入口/单 dock 协调。

### 5. 生成状态藏在编辑区，节点仍一律写“尚未生成”

**证据：** CanvasBoard.tsx:121 对所有 draft 显示“尚未生成”，与真实任务无关联；实际阶段、取消、归档恢复及成果位于 MediaGenerationWorkspace.tsx:666 的纵向结果区。实现已经有真实状态，缺的是状态与空间对象的就近联系。

**建议：** 对存在固定任务的来源草稿显示轻量“排队/生成/整理结果/待核对/已有结果”附着状态及“查看任务”。正在编辑的新文本与旧任务使用的固定输入分别可查；不能因原草稿有旧成功任务就把当前新输入画成已完成。详细取消/归档恢复仍进任务详情。成功后展示成果缩略和明确取回动作，原草稿、旧媒体保留。

**最小闭环：** 从已加载 canvas plan/job 历史建立只读展示映射，不向 `CanvasDocument` 写 job 状态，不为每个节点新增无限轮询。查询频率与可见范围需受控，离屏媒体仍释放。终态与 cancelStatus 并存时以真实结果为准；unknown/unsupported 不标成取消成功。

**文件边界：** `CanvasMediaGeneration.tsx` / 新局部 task summary seam、`CanvasBoard.tsx` 节点展示、`GenerationJobControls.tsx` 复用。若扩到全部任务索引，先单独审性能与查询，不作为第一天美化必需项。

### 6. 空画布有文案，没有同位置的明确起步动作

**证据：** CanvasBoard.tsx:932 空态只给两句说明，真实入口在左下添加菜单；CanvasBoard.tsx:717 的双击分支直接 `add("text", point)`，没有类型菜单。这是可用入口的发现性问题，不应写成“完全不能创建”。

**建议：** 空态中央提供“写一个想法”“导入参考”“开始图片/视频/声音草稿”，复用已有添加/上传；第一次内容出现即退场。文案说明无需先绑镜头。空白双击只打开就地添加菜单，保留真实点击落点；不要直接创建无意义节点。无实际模型时写入草稿仍可用，明确执行不可用原因。

**最小闭环：** 起步 CTA 调现有 add / uploads；打开菜单本身 0 次业务写入。没有新自动建场次/镜头/Review/模型请求，不预植看似真实的结果。

**文件边界：** `CanvasBoard.tsx`、`canvas.module.css`，共享添加菜单可局部抽取。

### 7. 常态把技术状态和多个操作做成同等显著，削弱作品层级

**证据：** SceneProductionWorkspace.tsx:412 常态同时展示保存状态、服务器版本、保存按钮与协作入口；CanvasBoard.tsx:749 常驻容量分母与百分比。历史截图中这些项与创作动作使用近似按钮外观；最新绘制需新开生产页复核。节点列表及组管理也是原生 details 面板。

**建议：** 正常时简短“已保存”与紧凑状态图标；点击看服务器修订、本机恢复与协作细节。未同步、失败、冲突必须立即可见并给对应动作，容量接近上限也要提升可见度。保留现有媒体 6px / 工具 8px / 浮层 12px 的形状层次，以单一克制强调色标选择和主动作。搜索使用轻量检索面板，数量与容量进入信息区，字体使用 tabular figures 对齐比例与时间。

**最小闭环：** 只改变披露和样式，不把“本机已保留”改写成“已保存到服务器”，不隐藏 fixture 标识或错误。不在整个画布叠加噪点/模糊/光晕，不随机布局、不染色媒体、不做无根据百分比进度。

**文件边界：** `SceneProductionWorkspace.tsx`、`CanvasBoard.tsx`、`canvas.module.css`；全局 tokens 如需修改由壳负责人集中提供，局部不硬编码新色板。

## 建议分工与交付顺序

| 切片 | 拥有边界 | 可独立验收结果 |
| --- | --- | --- |
| A：画布直接操作 | CanvasBoard、CanvasContinueCreation、canvas CSS 的 node/toolbar/empty/search | 空态起步、对象短工具、多选参考、键盘、边缘定位；不改生成会话 |
| B：统一创作输入与结果 | CanvasMediaGeneration、MediaGenerationWorkspace、ShotPromptComposer、局部 reference/task/history 组件、image-generation CSS | 一份输入、紧凑参数、固定确认、结果历史与明确取回；复用原 controller/storage |
| C：场次与视觉系统整合 | SceneProductionWorkspace 顶栏/dock、共享 tokens | A/B 挂点、单 dock、浅深色和 1366/1512 空间协调；不重建服务状态 |

A 与 B 必须先冻结 composer 挂点、参考编辑回调及只读任务摘要参数；不能同时修改 CanvasBoard 的整份 composer。A 可先完成不依赖新任务映射的工具/空态。任务贴附属于第二个小步骤，避免为视觉改动立即构造全场轮询服务。

## 业务约束与 E2E 验收

- 继续使用 Mantine / Phosphor / 当前 React Flow；不建立另一套画布或播放器。位置、分组、选中、镜头关联、Take、采用、媒体和任务是独立事实。
- Node ±1e6、viewport ±8e6、zoom 0.00001–4 与现有 measured fit 保留。只移动工具不改变模型坐标；媒体保持原比例，按钮不裁切。
- 0–100 有序固定 shotSources、媒体/资产具体版本、旧 Take shotRevision、原意见版本和 assistanceSource 不自动升级。浏览/导航/取消选择都不构成新引用。
- 发送前耐久固定 body/key/If-Match；确认绑定打开的对象；未知执行/取消/归档/放置只按原协议恢复。关闭 dock、切模式、刷新、断网、权限变化和迟到响应都不能覆盖或复活其他作用域草稿。
- 原结果只可明确取回或形成候选/采用。取消是请求事实，unsupported/unknown 仍可能最终成功；fixture 和未配置服务仍明确标识。真实模型质量与费用条件不由视觉验收补足。

后续实现的生产构建 E2E 最少覆盖：

1. 空画布通过每个可见起步入口创建，菜单打开不写业务；选择/框选/文本中文输入/播放器不抢拖拽与快捷键。
2. 两份真实参考 → 多选继续 → 新草稿 → 改用途/移除/恢复固定来源，原素材不变，执行前请求为 0。
3. 原场次/节点/类型的文字与参数经切模式、打开/关闭 dock、刷新恢复；旧历史查看返回后仍是原编辑草稿。
4. 计划确认后只执行一次；丢响应、刷新与换节点不新增 execute；旧任务状态不显示成新草稿已生成。
5. 成功结果明确取回；来源节点删除后从结果历史恢复同一成果；不自动新建 Take 或采用。
6. 当前权限撤回、保存 412、临时 GET 故障和本机写失败都保留已有语义；异常动作不能被“简洁样式”藏到不可发现。
7. 1512/1366 浅深色截图人工比较：媒体仍占主空间、composer 有界、工具贴对象、参数无长表单堆叠；输入和媒体按钮的实际 bbox 均可见可点。390 使用可操作列表，不声称完整触屏画布已经验收。
8. 复用既有容量证据做定向回归：不因新缩略/工具给全部 2,000 节点挂载播放器、隐藏表单或单独 job 轮询。[42](../../implementation/42-canvas-browser-capacity.md) 的 300 建议 P95 不能硬套到 2,000，也不能把历史最小缩放不足当作现在尚未修复；若渲染面确有变动再测相关样本，不重跑无关媒体/数据库全套。

本审查没有产生新的用户效率、竞品运行、真实模型或性能达标结论。交付顺序建议 A → A/B 组合主路径 → C 统一截图与故障 E2E；视觉效果和故障恢复必须一并验收。
