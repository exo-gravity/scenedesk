# 历史方案、研究与评审索引

整理日期：2026-09-10。这里是历史阅读入口，原文件与截图保留原位。当前执行请返回[产品与设计文档入口](../README.md)。

## 产品范围与领域推导

| 材料 | 如何使用 |
|---|---|
| [核心 v0.1](../ai-drama-workbench-core-design-v0.1.md)／[v0.2](../ai-drama-workbench-core-design-v0.2.md) | 理解从早期小团队假设到中小工作室的演变；10 人上限已撤销 |
| [完整主稿 v1.0](../ai-drama-workbench-product-design-v1.0.md) | 原整合记录；当前主稿正文是 v1.3，不按旧稿排实施任务 |
| [双场景 MVP v0.1](../ai-video-platform-mvp-plan-v0.1.md)／[短剧优先 v0.2](../ai-video-platform-mvp-plan-v0.2.md) | 共享能力与短剧优先的推导；后续画布和完整交付要求已写入现行主稿 |
| [场次交互 v0.1](../ai-drama-scene-mvp-interaction-v0.1.md) | 场次主责与业务旅程背景；早期三阶段导航及布局被 v0.3 替代 |
| [资产专项](../ai-drama-workbench-assets-v0.1.md)／[租户专项](../ai-drama-workbench-tenancy-v0.1.md) | 分类与治理推导；当前行为以实施包及专项 v0.4 为准 |
| [工作区决策与验证方法](../ai-drama-workspace-decision-and-validation-v0.1.md) | 保留第一性原理与用户验证方法；每场双模式已进入 MVP，不再等待是否引入画布的选择 |
| [产品内核、原因与选择策略](../ai-drama-product-core-decision-questions-v0.1.md) | 保留分组、代表产品深挖及截图；后续已选择“团队完成一场戏”，旧问题不是必须重选的清单 |

## 视觉探索与原型演变

| 材料 | 当前关系 |
|---|---|
| [早期页面原型](../design/mvp-visual-prototype-v0.1.md)／[Mantine 样板](../design/mantine-visual-sample-v0.2.md) | 旧页面与组件迁移证据；不采用其旧配色或布局作为当前规范 |
| [视觉讨论](../design/visual-design-discussion-v0.1.md)／[三套方向](../design/visual-directions-review-v0.1.md) | 已收敛为共同视觉语言，不再等待 A／B／C 选择 |
| [布局三方案](../design/layout-concepts-v0.3.md)／[早期双模式效果图](../design/scene-dual-mode-visuals-v0.4.md) | 保留方案比较；文件中的 v0.4 不表示比当前核心体验更新 |
| [原导航流程](../design/navigation-and-core-flow-v0.1.md)／[当轮自审](../design/journey-independent-review-2026-09-10.md) | 含旧网格与遮挡问题，已由后续工作区修正 |
| [三方评审后推荐 v0.2](../design/core-workspace-recommendation-v0.2.md)／[当轮效果图](../design/workspace-recommendation-visuals-v0.2.md) | 当前设计的推导依据；具体行为、确认状态与最新验证以核心 v0.3 和专项 v0.4 为准 |

旧原型仍可在本地打开，以便比较，不代表多套现行方案：[#/scene/production](http://127.0.0.1:4311/#/scene/production)、[#/layouts/](http://127.0.0.1:4311/#/layouts/)、[早期 journey](http://127.0.0.1:4311/#/journey/)。

## 研究与独立评审证据

- [市场研究汇总](../research/2026-09-07-workbench-market-review.md)、[画布市场复核](../research/2026-09-07-canvas-market-review-v2.md)、[模型工作流研究](../research/2026-09-07-model-production-workflows.md)：访问日期的公开证据与推论；不保证当前价格、版本、地区或账号能力。
- [首轮完整评审](../reviews/2026-09-07/README.md)及其冻结基线：保留原文、原始校验值和裁决，不能回写成后续状态。
- [09-09 收口评审](../reviews/2026-09-09/closure-decisions.md)：当轮产品、契约及验收追踪。
- [09-10 工作区三方独立评审](../reviews/2026-09-10-workspace/README.md)：当前布局的多视角依据；独立 AI 评审不替代真人团队验证。
- [原静态校验报告](../implementation/validation-report.md)、[09-09 实施交付清单](../implementation/implementation-handoff-manifest.json)、[专项设计当次交付清单](../design/design-handoff-2026-09-10.json)：均为当次文件和检查范围的快照，后续编辑造成哈希不同是正常的。新维护记录见[文档审计](../documentation-audit-2026-09-10.md)。

其余 `docs/research/` 文件按文件名日期与各自证据边界阅读。本次不改写原始研究或独立评审结论。

## 后续广告探索

[早期产品线讨论](../ai-video-product-lines-v0.1.md)、[后续产品方向](../ai-video-product-lines-v0.2.md)与[营销人员广告条件方案](../ai-marketing-video-mvp-v0.1.md)保留客户与流程假设。长期共用平台的方向有效；广告产品发布、完整交互、投放验证不属于当前短剧 MVP 前置条件。

## 文档维护约定

现行入口只列现行规范；被替代的材料在首部标注状态并指向当前入口。保留原文件名以避免破坏引用；原始评审、冻结基线与旧验证报告保持原样。后续检查使用实际执行时间及独立产物目录，不能覆盖旧报告来暗示旧日期已经验证新内容。
