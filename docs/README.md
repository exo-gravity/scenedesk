# 幕序 · SceneDesk：产品与设计文档入口

用户已确认产品中文名为 **幕序**、英文名为 **SceneDesk**，组合写法为 **幕序 · SceneDesk**。后续实施统一使用该名称，英文保持此大小写；历史文档中的“AI 短剧工作台”等描述仍指本产品。

当前状态（2026-09-10）：核心工作区与连续流程 v0.3 已确认；剧本准备、声音字幕、资产版本、保存冲突四项专项 v0.4 收到“暂时没有问题了”的反馈，暂时收口。正式业务工程仍按用户要求暂停。

## 当前阅读顺序

| 顺序 | 文档 | 职责与状态 |
|---|---|---|
| 1 | [设计确认记录](design/approved-baseline-2026-09-10.md) | 用户确认范围、专项反馈及后续工作边界 |
| 2 | [完整产品方案（正文 v1.3）](ai-drama-workbench-product-design-v1.1.md) | 定位、完整 MVP、长期广告与组织演进；为保持链接沿用原文件名 |
| 3 | [核心体验 v0.3](design/scene-walkthrough-review-v0.3.md) | 已确认的导航、分镜／自由画布、制作、剪辑、固定稿审阅与返工 |
| 4 | [制作专项 v0.4](design/production-detail-design-v0.4.md) | 暂时收口的剧本、声音字幕、资产版本与保存冲突设计；区分演示和真实验收 |
| 5 | [共同视觉语言](design/shared-visual-language-v0.1.md)／[Mantine UI 执行规范](design/mantine-ui-agent-spec-v0.1.md) | 当前视觉原则、组件约束与 Agent 实施规则；旧站点尚未整体迁移 |
| 6 | [实施设计包 v1.3](implementation/README.md)／[设计收口与后续实施入口](implementation/19-design-closure-and-implementation-entry.md) | PRD、领域、状态、接口、验收与未来工作包；不是开工授权 |
| 7 | [领域术语](../CONTEXT.md)／[画布与制作契约](implementation/18-canvas-workspace-contract.md) | 跨页面保持一致的身份、事实、保存、版本与操作语义 |

适用原则：用户最新明确决定优先。页面行为与布局按已确认的 v0.3 及补充 v0.4；业务身份、事务、接口与验收按现行实施包。原型简化不改变业务契约；历史提案不能覆盖上述结论。发现冲突应修正文档，不让实施人员自行挑选旧版本。

## 已确定的关键方案

- 面向中小工作室内部团队，不设 10 人上限；AI 写实短剧优先。长期同平台支持广告，复用资产、媒体、生成、版本、审阅等能力。
- 核心任务是团队完成一场戏；完整 MVP 还包括整集审阅交付、跨集复用与内部后期接手。
- 每场次分镜／自由画布双模式、每场一张画布，共用制作事实。画布位置不代表镜头播放顺序；UX-01 继续验证具体操作收益。
- 分镜采用当前镜头大预览、中央有界输入和底部分镜条；助手、完整素材浏览非模态停靠。固定版本审阅使用独立入口。
- Mantine 为唯一通用组件基础，专业组件按[选型裁决](implementation/17-frontend-component-selection.md)。旧配色与旧布局属于历史样板，不是另一套现行规范。

## 准备情况与后续计划

仓库已有设计文档、S0 本地骨架、内存交互演示和有限检查记录。真实业务 API、模型接入、服务端制作数据、媒体渲染、工作室试点及生产验收尚未完成。

- [工程事实与历史验证](implementation/15-engineering-readiness.md)：已经做了什么、没有证明什么。
- [后续实施工作包](implementation/16-implementation-backlog.md)：明确开工后的分批顺序。
- [模型、部署与试点准备](implementation/20-external-validation-and-launch-plan.md)：实际账号、样片、环境与试点待验证项。
- [本轮文档审计与纠正](documentation-audit-2026-09-10.md)：过期结论、入口、证据日期与修正记录。

## 历史、依据与未来探索

[历史文档索引](history/README.md)统一收录旧产品稿、视觉探索、早期原型、市场研究和独立评审。不移动原文件，保留引用、截图和决策过程；这些材料不再与当前规范并列作为执行入口。

[工作区三方评审](reviews/2026-09-10-workspace/README.md)与[最终推荐的设计推导](design/core-workspace-recommendation-v0.2.md)可用于理解当前选择。研究描述的是访问日期的公开证据，未在本次文档维护中重新核查产品现状、价格或账号能力。

本轮[关键技术选项复核](reviews/2026-09-10-technical-options-review.md)的方向已获用户确认，见[技术方向确认与设计收尾清单](design/technical-direction-confirmation-2026-09-10.md)。架构主干保留，调度、工作稿恢复、画布协作与保存历史已完成[技术协议收尾](implementation/21-technical-baseline-closure.md)；[队列独立研究](research/2026-09-10-task-execution-review.md)中的 pg-boss 仍为首个集成验证候选。现行实施包／API已同步为1.3，真实集成与业务验证待执行；正式工程仍暂停。

文档版本与产品迭代版本不同：主稿正文 v1.3、实施包v1.3、OpenAPI1.3.0，均不表示产品已上线或通过业务验收。
