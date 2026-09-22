# 幕序 · SceneDesk：实施设计包 v1.3

2026-09-22 当前方向：核心创作区已按[核心创作区重建（2026-09-21 已确认）](../design/creative-workspace-rebuild-libtv-2026-09-21.md)重写并合入 `main`，分片、验证与遗留项见 [85 创作区重建分片记录](85-studio-rebuild.md)。创作台 `…/p/{id}/studio` 是唯一创作入口，旧画布、场次工作区、剧本页与镜头列表页面已删除，旧地址转向创作台；固定引用、授权、执行与恢复契约不变。下面 2026-09-16 起的段落保留为当时的方向记录。

2026-09-16 方向（历史）：用户已确认并授权实施[独立 Web 创作工作区](../design/creative-workspace-approved-2026-09-16.md)。主路径为外部剧本导入／阅读 → 画布连续创作 → 镜头整理与明确选用 → 原片交接；项目画布允许没有剧本或场次时开始。按[八个工作包](70-creative-workspace-refactor.md)交付，既有固定引用、授权、执行和恢复契约保持有效。

2026-09-16 验收要求：核心页面和设计随各 PR 完成[端到端、故障恢复与正式构建视觉检查](73-creative-workspace-e2e.md)；项目画布、剧本导入和自动回归并行开发，数据库迁移按依赖顺序合入。

最新推进顺序：先完成真实模型以外的工作区功能与验收，模型接入最后进行。[本轮收尾记录](77-non-provider-workspace-closure.md)区分已完成代码、实际测试和仍需团队提供的真实条件，不扩大首发范围。

最新页面细化见 [78 统一画布入口与场次目录](78-canvas-navigation-directory.md)：场次目录收于画布菜单，剧本主操作为明确选文带入画布，原分镜建议保留为次级操作。依据[用户批准的三页方案](../design/canvas-navigation-approved-2026-09-16.md)，沿用固定来源、草稿保留和原地址兼容。

2026-09-11 当前首发范围：用户确认画布和 AI 整体按原方案推进，后期剪辑／渲染、完整团队管理、开放注册和运营移出 MVP；商业计费与费用运营后置。以[38 当前 MVP 范围](38-first-release-scope-review.md)覆盖本包旧的全平台首发门槛，保留已有能力契约与历史证据。

产品命名已由用户确认：中文 **幕序**，英文 **SceneDesk**，组合 **幕序 · SceneDesk**。前端品牌展示、页面标题与后续交付文档采用此名称；本次命名不改变产品范围或技术契约。

历史技术定案（2026-09-10）：[技术评审方向与收尾清单](../design/technical-direction-confirmation-2026-09-10.md)及[21 技术定案](21-technical-baseline-closure.md)记录任务调度、恢复、异步协作和有限历史的协议依据。后续队列、数据库、媒体与用户效果的实际实现和验证见 22，不沿用当时的“尚待实施”状态。

当前推进状态见[22 实施进度](22-implementation-progress.md)和[77 非模型收尾](77-non-provider-workspace-closure.md)：项目导航、项目画布、Word／飞书导入、同稿连续创作、镜头列表及原片 ZIP 已分批合入，自动回归与部署／恢复按实际结果记账。真实模型与团队授权条件仍单列。历史交付 manifest 保留为当时快照。

契约基线日期：2026-09-10；保留2026-09-09独立评审与验证快照。原独立评审与后续场次主场景共识已合并；当前逐步实现已收口的业务契约。S0 骨架与本地演示是早期交付记录，不能代表完整 MVP、模型样片、工作室试点或生产验收。

当前页面依据：[核心创作区重建](../design/creative-workspace-rebuild-libtv-2026-09-21.md)与 [85 分片记录](85-studio-rebuild.md)；[创作工作区确认](../design/creative-workspace-approved-2026-09-16.md)及[主画布确认](../design/primary-canvas-approved-2026-09-14.md)只作历史。早期核心体验、制作专项和 Mantine 样板见[历史索引](../history/README.md)。所有演示均独立于完整业务验收。

## 当前结论

当前为短剧创作者提供私有工作台，创作台是唯一创作界面，镜头整理视图按需整理制作事实。项目创作台支持先探索再组织内容；场次创作台与旧深链（转向创作台）继续有效，画布位置不代表播放顺序。

首发保留剧本导入、资产参考、AI 辅助与媒体生成、固定结果、比较、明确选用和恢复能力。Word／飞书以导入后阅读为主，日常操作不要求复杂版本控制。后期剪辑与渲染、完整团队管理、公开注册、公共 API 和商业计费按[38](38-first-release-scope-review.md)及最新重构决定后置；长期广告路线不改变本期范围。

主流程：导入剧本或直接进入画布 → 固定选文与参考 → 编辑草稿和生成输入 → 查看、比较并明确选用 → 按需整理镜头 → 下载原片，在外部工具完成后期。当前支持单个固定原件和本场选用原片 ZIP，详见[76](76-shot-list-workspace.md)；它不是剪辑渲染。真实模型接入安排在其余收尾之后，未具备服务、凭据与消费授权时不执行付费调用。

## 文档地图

| 阅读对象 | 文档 | 交付内容 |
|---|---|---|
| 全团队 | [70–77 当前工作区重构](70-creative-workspace-refactor.md) | 最新工作包、页面分工、导入、连续创作、镜头列表和验收证据 |
| 全团队 | [完整产品方案 v1.3](../ai-drama-workbench-product-design-v1.1.md) | 统一定位、边界、业务流程、MVP、长期广告与组织演进 |
| 产品／全团队 | [01 产品需求](01-product-requirements.md) | PR-01–17、权限、流程、MVP深度、三层验收 |
| 产品／前端 | [02 交互规格](02-interaction-spec.md) | 工作区、首次起步、状态、替换、声音和返工行为 |
| 架构／后端 | [03 领域数据](03-domain-data-model.md) | 逻辑表、关系、版本、时间、金额及不变量 |
| 后端／模型 | [04 状态与费用](04-state-execution-and-budget.md) | 作业、未知提交、取消、归档、部分费用和最终结清 |
| 技术／运维 | [05 架构与运行](05-architecture-and-operations.md) | 技术栈、模块、隔离、媒体、容量目标及恢复 |
| 前后端／测试 | [06 接口规则](06-api-contract.md) | 授权、CAS、幂等、实际输入、跨字段校验和交付 |
| 模型接入 | [07 Adapter 与验证](07-provider-adapter.md) | 连接身份、能力配置、输入输出、MV-01–10 |
| 项目／测试 | [08 验收与实施](08-verification-and-delivery-plan.md) | AT-01–76、需求追踪、S0–S4工作包与门槛 |
| 决策者 | [09 决策与缺口](09-decisions-and-open-items.md) | 已裁决默认值、G-01–08、后续TODO与广告边界 |
| 制作／测试 | [10 制作夹具](10-production-fixture.md) | F0/F1两集、F2三类返工、F3内部后期交接 |
| 架构／研发 | [11 事务与实施蓝图](11-transaction-and-implementation-blueprint.md) | 迁移顺序、事务锁、费用、帧／采样算法、恢复隔离 |
| 产品／研究 | [12 MVP工作流与试点](12-mvp-workflows-and-pilot.md) | 六条明确工作流、首发任务与可比试点方法 |
| 制作／试点 | [13 质量与交接规范](13-production-quality-and-handoff.md) | 连续性、声音字幕、原素材交接、成本和实验停止规则 |
| 全团队 | [14 场次主场景收口](14-scene-mvp-closure.md) | 场次主责、三类 AI、当前场次追加、正式创作依据与旧稿确认 |
| 工程团队 | [15 工程就绪记录](15-engineering-readiness.md) | 实际代码、版本、运行命令与验证范围 |
| 工程团队 | [16 下一批实施任务](16-implementation-backlog.md) | 可直接开工的业务切片、依赖、AT 和证据 |
| 前端／架构 | [17 免费组件选型](17-frontend-component-selection.md) | Mantine及专业组件已选型；许可证据、隔离验证与分阶段接入 |
| 全团队 | [18 画布契约](18-canvas-workspace-contract.md) | 文档版本、来源、结果恢复、API与并发；当前项目归属扩展见 71 |
| 全团队 | [19 最新收口与开工](19-design-closure-and-implementation-entry.md) | 本轮完成项、实际证据、直接实施顺序 |
| 实施负责人 | [20 外部执行准备](20-external-validation-and-launch-plan.md) | 模型账号、默认部署、人员、试点与广告验证 |
| 架构／研发 | [21 技术定案](21-technical-baseline-closure.md) | 调度责任、工作稿恢复、有限历史、presence、前端状态及真实验证门槛 |
| 实施团队 | [22 实施进度](22-implementation-progress.md) | 当前实现、验收与 GitHub 合入状态 |
| 实施团队 | [27 场次主责与任务](27-scene-tasks.md) | 有效受派资格、唯一主责、处理历史与冲突恢复 |
| 架构／研发 | [28 内部队列](28-durable-queue.md) | 受限角色、同事务入队与进程中断验证，付费门槛仍待验证 |
| 架构／研发 | [29 媒体运行基础](29-media-runtime.md) | 固定对象版本、受限解码与真实存储／信号测试 |
| 架构／研发 | [30 素材导入服务](30-media-import-service.md) | 上传事务、受限 Worker、权限、原文件验收和派生恢复 |
| 实施团队 | [31 素材工作台](31-media-workspace.md) | 浏览器导入续办、私有播放下载、来源冲突与复制标签页草稿隔离 |
| 实施团队 | [35 候选与明确采用](35-candidates-and-adoption.md) | 连续视频区间、固定要求沿用、采用历史与场次制作恢复 |
| 实施团队 | [工作模板](templates/README.md) | CSV录入、连续性、声音、交接、质量返工、人工与费用记录 |
| 全团队 | [独立评审与裁决](../reviews/2026-09-07/README.md) | 原始基线、三份首评、29项处理、二次复核 |

机器附件：[OpenAPI 3.1](openapi.json)、[API 操作目录](api-operations.md)、[正反结构样例](sample-payloads.json)、[09-09 历史静态校验报告](validation-report.md)、[09-09 历史交付校验值](implementation-handoff-manifest.json)。契约目录包含长期和后置能力，不表示当前首版必须实现或启用所有操作；执行顺序以 70 和当前进度为准。

首次阅读：[核心创作区重建](../design/creative-workspace-rebuild-libtv-2026-09-21.md) → 85 分片记录 → 22 进度；70 工作包与 77 收尾是重建前的交付记录。工程修改再读 03／06／11 和适用的画布、提供商或媒体契约；早期 14–21 保留决策依据。13 中的模板用于记录实际试验，不替代服务端清单或访问控制。

## 关键不可破坏规则

- 新生成不自动采用；采用不自动更换任何剪辑。审阅与交付固定到实际版本。
- 入口／出口剧情状态是制作意图，声音与字幕是否实现当前台词是独立事实。
- 生成计划固定实际参考、文本、来源及费用估计；未知提交不自动再购买。
- 媒体原字节不可变，代理、制作副本和原片分别管理；旧上传链接不能改写已验收内容。
- 归一、保存、冻结、渲染、字幕和评论来源共享精确边界，不能多轮重复吸附丢帧。
- 部分费用不等于结清；原素材包不需要假剪辑；外部成片不伪造时间线。

## 明确开工后的阶段安排

当前首发按[38 范围调整](38-first-release-scope-review.md)与[70 重构计划](70-creative-workspace-refactor.md)推进私有创作工作台。身份、内容、素材、固定资产、画布、助手及媒体生成的站内业务已分阶段交付，具体合并与验收事实见[22](22-implementation-progress.md)。按[77](77-non-provider-workspace-closure.md)关闭非模型收尾，再落实真实模型服务；真实登录、团队文档及外部部署仍需相应条件。完整后期、团队与公开运营、商业计费继续后置。

实际服务账号／测试预算对应G-02／03，在事实落实前可以继续工程和导入素材验证；不执行未授权付费调用。阶段门须用真实证据关闭，不能以接口结构校验代替。

## 维护与适用顺序

用户最新方向优先。完整产品主稿负责定位与范围，本包负责当前行为、数据和接口；字段以openapi.json为准，跨字段规则以03／04／06／11／18／21为准。发现冲突须共同修订和复检，不能任选解释。旧方案、专项和研究保留背景，不扩大本期承诺。

术语只维护在 [CONTEXT.md](../../CONTEXT.md)。原三项已接受的架构决定：[制作对象与视图分离](../adr/0001-production-records-independent-of-views.md)、[固定版本与明确采用](../adr/0002-freeze-review-and-explicit-adoption.md)、[未知供应商提交](../adr/0003-uncertain-provider-submission.md)。其接受表示本轮用户授权下的设计裁决，不代表真人专家签字。参考证据见 [模型](../research/2026-09-07-implementation-model-evidence.md) 与 [基础设施](../research/2026-09-07-implementation-infra-evidence.md)。

## 重跑静态检查

使用独立Python虚拟环境，安装 [固定依赖](validation-requirements.txt)，执行：

```sh
python docs/implementation/build_contract.py
python docs/implementation/check_design.py
```

静态校验默认写入 `output/documentation-checks/<UTC 时间戳>/`，输出报告与文件清单的实际路径。可用 `--output-dir output/documentation-checks/<新目录>` 指定位置；已有目录拒绝覆盖。`validation-report.md` 与原实施交付清单保留为 09-09 的历史快照。两个工程验证脚本的结果也改按实际时间写入 `output/engineering/`。

检查OpenAPI、Schema引用、权限与版本头、PR／AT追踪、正反结构样例、文件链接、冻结基线、评审处理清单和生成可复现性。DB、浏览器、实际供应商、媒体渲染与用户验收均由08／07规定另行执行。

本轮新增 [ADR-0004](../adr/0004-scene-production-and-explicit-assistance.md)，收尾独立复核及处理见 [09-09 评审闭环](../reviews/2026-09-09/closure-decisions.md)。静态通过不等于业务运行通过；首期不要求证明固定效率差异化。

后续用户已确认 [ADR-0005：Mantine通用UI](../adr/0005-frontend-free-component-stack.md)。核心工作区保持自主设计，当前视觉语言与核心布局已确认，专业组件已按17完成裁决；原型不等于生产接入。当前执行约束见 [UI Agent 规范](../design/mantine-ui-agent-spec-v0.1.md)，旧视觉方向仅作历史参考。

## 当前设计与后续实施入口

当前工作入口为[70 重构计划](70-creative-workspace-refactor.md)及[77 收尾记录](77-non-provider-workspace-closure.md)；[21 技术定案](21-technical-baseline-closure.md)、[18 画布契约](18-canvas-workspace-contract.md)和各专题继续约束业务行为。模型／基础设施／试点的历史准备清单见[20](20-external-validation-and-launch-plan.md)，不据此恢复已后置的广告与商业范围。设计包和 OpenAPI 版本号不代表产品发布或实际验收，状态以[22](22-implementation-progress.md)为准。

当前实际资产引用与失败恢复的实现证据见[场镜资产引用](33-creative-asset-bindings.md)；工程执行与合入要求见仓库[工程约定](../../AGENTS.md)。

私有工作台的首次开通见[55 操作者入口](55-private-owner-bootstrap.md)，新建项目的跨刷新与持久身份恢复见[56 项目创建恢复](56-project-creation-recovery.md)。

编辑器明确提交后的清理与恢复、提案草稿转移以及失效定位行为见[编辑器提交后恢复](34-editor-completion-recovery.md)。

[共享剪辑工作稿](36-cut-work-drafts.md)保留后端持久化、独立 CAS、有限历史及片段／对白／声音／字幕的阶段实现和证据。后期剪辑已后置，不是本轮进行中的交付任务。

[精确制作副本](37-production-copies.md)保留视频源映射、无损内部工件和流式隔离的契约与阶段证据；归一、确认与固定渲染按首版范围后置。

最新助手体验及验证见[68 对话侧栏](68-assistant-conversation-sidebar.md)：连续对话、统一输入、固定引用、任务往返与按需结果操作。

统一资产库入口、固定共享版本图库和图片加入角色的实施与验收见[69 统一资产库](69-unified-asset-library.md)。
