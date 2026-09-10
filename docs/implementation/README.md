# 幕序 · SceneDesk：实施设计包 v1.3

产品命名已由用户确认：中文 **幕序**，英文 **SceneDesk**，组合 **幕序 · SceneDesk**。前端品牌展示、页面标题与后续交付文档采用此名称；本次命名不改变产品范围或技术契约。

技术方向更新（2026-09-10）：用户已确认[技术评审方向与收尾清单](../design/technical-direction-confirmation-2026-09-10.md)。任务调度、未完成剪辑恢复、画布异步协作及有限历史已完成协议同步，见[21 技术定案](21-technical-baseline-closure.md)。OpenAPI升为1.3.0；候选队列、数据库事务、媒体与用户效果仍待真实验证。

当前推进状态（2026-09-11）：用户已授权正式工程实施及 GitHub 合入。身份、项目、手工内容、CSV 提案及创作依据已分阶段验收并合入；场次主责、内部队列及素材导入服务也已合入；素材工作台已完成本地验证。逐项成果、合入证据及未完成范围以[22 实施进度](22-implementation-progress.md)为准。页面沿用已确认的核心工作区 v0.3 与[专项设计 v0.4](../design/production-detail-design-v0.4.md)，确认范围见[记录](../design/approved-baseline-2026-09-10.md)。历史交付 manifest 保留为当时快照。

契约基线日期：2026-09-10；保留2026-09-09独立评审与验证快照。原独立评审与后续场次主场景共识已合并；当前逐步实现已收口的业务契约。S0 骨架与本地演示是早期交付记录，不能代表完整 MVP、模型样片、工作室试点或生产验收。

当前页面依据：[核心体验 v0.3](../design/scene-walkthrough-review-v0.3.md)与[专项 v0.4](../design/production-detail-design-v0.4.md)。旧 Mantine 样板及布局探索见[历史索引](../history/README.md)，不再作为当前视觉入口。所有演示均独立于完整业务验收。

## 当前结论

长期在同一平台内支持短剧与广告工作台；当前为中小工作室交付 AI 写实短剧闭环，不设 10 人上限。本期每场次提供分镜／自由画布两模式，画布覆盖整场并与制作事实分离；UX-01验证实际收益及具体呈现。复杂 AI 重拆、广告入口、外包权限、专业 NLE 后置。

主场景是一位制作人员主责完成一场戏，其他成员按需协助；场次内制作／剪辑为编辑视图，审阅从独立固定版本入口进入。完整 MVP 含整集独立审阅与交付、下一集复用和真实内部后期交接。

主流程：已有剧本／分镜 CSV → 集场镜与确切创作依据 → 固定生成计划 → 候选及明确采用 → 声音与轻量剪辑 → 固定版本审阅 → 指定返工 → 交付。仅有采用时也能导出原素材包，不必先在平台剪完整片。Seedance 等领先模型优先，只启用实际服务／地区／账号验证过的能力。

## 文档地图

| 阅读对象 | 文档 | 交付内容 |
|---|---|---|
| 全团队 | [完整产品方案 v1.3](../ai-drama-workbench-product-design-v1.1.md) | 统一定位、边界、业务流程、MVP、长期广告与组织演进 |
| 产品／全团队 | [01 产品需求](01-product-requirements.md) | PR-01–17、权限、流程、MVP深度、三层验收 |
| 产品／前端 | [02 交互规格](02-interaction-spec.md) | 工作区、首次起步、状态、替换、声音和返工行为 |
| 架构／后端 | [03 领域数据](03-domain-data-model.md) | 逻辑表、关系、版本、时间、金额及不变量 |
| 后端／模型 | [04 状态与费用](04-state-execution-and-budget.md) | 作业、未知提交、取消、归档、部分费用和最终结清 |
| 技术／运维 | [05 架构与运行](05-architecture-and-operations.md) | 技术栈、模块、隔离、媒体、容量目标及恢复 |
| 前后端／测试 | [06 接口规则](06-api-contract.md) | 授权、CAS、幂等、实际输入、跨字段校验和交付 |
| 模型接入 | [07 Adapter 与验证](07-provider-adapter.md) | 连接身份、能力配置、输入输出、MV-01–10 |
| 项目／测试 | [08 验收与实施](08-verification-and-delivery-plan.md) | AT-01–75、需求追踪、S0–S4工作包与门槛 |
| 决策者 | [09 决策与缺口](09-decisions-and-open-items.md) | 已裁决默认值、G-01–08、后续TODO与广告边界 |
| 制作／测试 | [10 制作夹具](10-production-fixture.md) | F0/F1两集、F2三类返工、F3内部后期交接 |
| 架构／研发 | [11 事务与实施蓝图](11-transaction-and-implementation-blueprint.md) | 迁移顺序、事务锁、费用、帧／采样算法、恢复隔离 |
| 产品／研究 | [12 MVP工作流与试点](12-mvp-workflows-and-pilot.md) | 六条明确工作流、首发任务与可比试点方法 |
| 制作／试点 | [13 质量与交接规范](13-production-quality-and-handoff.md) | 连续性、声音字幕、原素材交接、成本和实验停止规则 |
| 全团队 | [14 场次主场景收口](14-scene-mvp-closure.md) | 场次主责、三类 AI、当前场次追加、正式创作依据与旧稿确认 |
| 工程团队 | [15 工程就绪记录](15-engineering-readiness.md) | 实际代码、版本、运行命令与验证范围 |
| 工程团队 | [16 下一批实施任务](16-implementation-backlog.md) | 可直接开工的业务切片、依赖、AT 和证据 |
| 前端／架构 | [17 免费组件选型](17-frontend-component-selection.md) | Mantine及专业组件已选型；许可证据、隔离验证与分阶段接入 |
| 全团队 | [18 场次画布](18-canvas-workspace-contract.md) | 双模式、文档版本、来源、结果恢复、API与并发 |
| 全团队 | [19 最新收口与开工](19-design-closure-and-implementation-entry.md) | 本轮完成项、实际证据、直接实施顺序 |
| 实施负责人 | [20 外部执行准备](20-external-validation-and-launch-plan.md) | 模型账号、默认部署、人员、试点与广告验证 |
| 架构／研发 | [21 技术定案](21-technical-baseline-closure.md) | 调度责任、工作稿恢复、有限历史、presence、前端状态及真实验证门槛 |
| 实施团队 | [22 实施进度](22-implementation-progress.md) | 当前实现、验收与 GitHub 合入状态 |
| 实施团队 | [27 场次主责与任务](27-scene-tasks.md) | 有效受派资格、唯一主责、处理历史与冲突恢复 |
| 架构／研发 | [28 内部队列](28-durable-queue.md) | 受限角色、同事务入队与进程中断验证，付费门槛仍待验证 |
| 架构／研发 | [29 媒体运行基础](29-media-runtime.md) | 固定对象版本、受限解码与真实存储／信号测试，E03 业务继续接入 |
| 架构／研发 | [30 素材导入服务](30-media-import-service.md) | 上传事务、受限 Worker、权限、原文件验收和派生恢复；素材页面与资产继续实施 |
| 实施团队 | [31 素材工作台](31-media-workspace.md) | 浏览器导入续办、私有播放下载、来源冲突与复制标签页草稿隔离 |
| 实施团队 | [35 候选与明确采用](35-candidates-and-adoption.md) | 连续视频区间、固定要求沿用、采用历史与场次制作恢复 |
| 实施团队 | [工作模板](templates/README.md) | CSV录入、连续性、声音、交接、质量返工、人工与费用记录 |
| 全团队 | [独立评审与裁决](../reviews/2026-09-07/README.md) | 原始基线、三份首评、29项处理、二次复核 |

机器附件：[OpenAPI 3.1](openapi.json)、[API 操作目录](api-operations.md)、[正反结构样例](sample-payloads.json)、[09-09 历史静态校验报告](validation-report.md)、[09-09 历史交付校验值](implementation-handoff-manifest.json)。接口目录覆盖整个 MVP 终态，不表示 S1 要同时实现所有操作；执行顺序以 08 为准。

首次阅读：[设计确认记录](../design/approved-baseline-2026-09-10.md) → [核心体验 v0.3](../design/scene-walkthrough-review-v0.3.md)／[专项 v0.4](../design/production-detail-design-v0.4.md) → 19 → 14 → 完整产品方案 → 01／02；工程开工先读21，再读15／16／18，再读 03–08／11。研发进入实现时按 03–08 和 11 拆解；13中的模板用于记录实际试验，不替代服务端清单或访问控制。

## 关键不可破坏规则

- 新生成不自动采用；采用不自动更换任何剪辑。审阅与交付固定到实际版本。
- 入口／出口剧情状态是制作意图，声音与字幕是否实现当前台词是独立事实。
- 生成计划固定实际参考、文本、来源及费用估计；未知提交不自动再购买。
- 媒体原字节不可变，代理、制作副本和原片分别管理；旧上传链接不能改写已验收内容。
- 归一、保存、冻结、渲染、字幕和评论来源共享精确边界，不能多轮重复吸附丢帧。
- 部分费用不等于结清；原素材包不需要假剪辑；外部成片不伪造时间线。

## 明确开工后的阶段安排

S0 工程骨架与有限模拟已完成；S1 已完成身份、内容、任务、导入素材和资产固定版本的阶段交付，正以导入素材贯通完整编辑审阅交付，真实用户试点基线仍待补齐。S2接入指定真实模型与费用路径；S3完成跨集制作、三类返工及真实内部后期接手；S4执行用户对照、恢复与容量验收。

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

优先阅读[21 技术定案](21-technical-baseline-closure.md)和[19 收口清单](19-design-closure-and-implementation-entry.md)，再按[18 画布工程设计](18-canvas-workspace-contract.md)和[16 工作包](16-implementation-backlog.md)实施。模型／基础设施／试点／广告与商业验证见[20](20-external-validation-and-launch-plan.md)。当前主稿v1.3、实施包v1.3、OpenAPI1.3.0；技术收尾新增7个API及AT-64–75。此前12个画布API继续保留，业务路由尚未实现。

当前实际资产引用与失败恢复的实现证据见[场镜资产引用](33-creative-asset-bindings.md)；工程执行与合入要求见仓库[工程约定](../../AGENTS.md)。

编辑器明确提交后的清理与恢复、提案草稿转移以及失效定位行为见[编辑器提交后恢复](34-editor-completion-recovery.md)。

当前正在实现[共享剪辑工作稿](36-cut-work-drafts.md)：后端持久化、独立 CAS 和有限历史已通过阶段测试，页面及完整恢复流程仍在接入。
