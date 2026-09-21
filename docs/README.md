# 幕序 · SceneDesk：文档入口

SceneDesk 当前是独立 Web 的私有短剧创作工作台，以画布为主要创作界面。外部剧本导入后供团队阅读，选文和资产可作为固定参考进入画布；镜头列表按需用于排序、比较、明确选用和原片交接。没有剧本或场次时也能先在项目画布探索。

2026-09-16 的[已确认重构方向](design/creative-workspace-approved-2026-09-16.md)覆盖早期双主工作区安排。实现已获授权并分批合入；当前先完成真实模型之外的功能与验收，真实模型接入最后进行。这里的日期是方向确认时间，实际交付事实以[实施进度](implementation/22-implementation-progress.md)和[本轮收尾记录](implementation/77-non-provider-workspace-closure.md)为准。

## 从哪里开始

| 目的 | 入口 |
|---|---|
| 了解产品、运行本地工作台 | [仓库 README](../README.md) |
| 看当前布局与产品取舍 | [核心创作区重建（2026-09-21 已确认，取代下列两份中的页面分工与导航条款）](design/creative-workspace-rebuild-libtv-2026-09-21.md)、[创作工作区方向](design/creative-workspace-approved-2026-09-16.md)、[画布导航与场次目录](design/canvas-navigation-approved-2026-09-16.md)、[首版范围](implementation/38-first-release-scope-review.md) |
| 看重建所依据的竞品现场与本地审计 | [LibTV / 即梦现场对照](research/2026-09-21-libtv-jimeng-canvas-design-review.md)、[SceneDesk 当前实现审计](research/2026-09-21-scenedesk-canvas-card-audit.md)、[卡片修改计划（历史，已被重建决定取代）](design/canvas-cards-redesign-plan-2026-09-21.md)、[调研交接（历史）](design/canvas-cards-agent-handoff-2026-09-21.md) |
| 看落地节奏、已交付和待验收项 | [创作区重建分片记录](implementation/85-studio-rebuild.md)、[八个工作包](implementation/70-creative-workspace-refactor.md)、[实施进度](implementation/22-implementation-progress.md)、[非模型收尾](implementation/77-non-provider-workspace-closure.md) |
| 导入并阅读剧本 | [Word 导入](implementation/72-script-docx-import.md)、[飞书正文导入与配置](implementation/75-feishu-script-import.md) |
| 理解创作台、助手与镜头整理 | [创作区重建分片记录（现行界面）](implementation/85-studio-rebuild.md)；引擎与领域事实的来历：[项目画布](implementation/71-project-canvas-workspace.md)、[连续创作](implementation/74-canvas-continuous-creation.md)、[镜头列表与原片包](implementation/76-shot-list-workspace.md) |
| 修改业务或接口 | [实施设计包](implementation/README.md)、[领域术语](../CONTEXT.md)、[工程约定](../AGENTS.md) |
| 修改页面 | [前端工程约定](../apps/web/AGENTS.md)、[UI 执行规范](design/mantine-ui-agent-spec-v0.1.md)、[端到端验收矩阵](implementation/73-creative-workspace-e2e.md) |
| 部署与恢复 | [私有部署](../deploy/README.md)、[首次操作者开通](implementation/55-private-owner-bootstrap.md)、[成对恢复检查](../deploy/recovery/smoke/README.md) |

## 当前范围

- 主导航是剧本、画布和项目资产；画布菜单负责切换创作空间、新增场次和打开场次目录，旧分镜台链接保留兼容。
- 剧本以“预览 → 确认导入 → 阅读当前稿”为主。版本与固定引用在后台保留，历史按需查看，不建立复杂的分支或发布流程。
- 画布保留生成草稿、固定输入、结果、比较和恢复。助手建议与手工操作作用于同一份草稿，生成不会自动选用。
- 镜头列表整理已存在的制作事实；本场 ZIP 交付选用原片和有序清单，不生成剪辑成片。
- 后期剪辑／渲染、完整团队管理、公开注册、公共 API 产品及商业计费继续后置。旧实现与契约保留，不作为当前使用前提。

受控适配器和演示媒体验证站内行为，不等于真实供应商执行。真实飞书授权、团队 Word 样本、外部生产环境和真人试作也各有验收条件；未完成项必须保持明确。

## 文档的适用顺序

用户最新决定优先；当前产品方向看 2026-09-16 的确认记录与首版范围，业务数据、权限、事务和固定引用看现行实施契约。实际交付状态由实施进度记录，不由原型、接口数量或设计文档中的“当前”一词推断。

[完整产品方案](ai-drama-workbench-product-design-v1.1.md)、[2026-09-10 设计确认](design/approved-baseline-2026-09-10.md)、[核心体验 v0.3](design/scene-walkthrough-review-v0.3.md)及[制作专项 v0.4](design/production-detail-design-v0.4.md)保留长期路线和历史依据，不能恢复已后置的首发门槛。[历史索引](history/README.md)收录旧稿、原型、研究和评审；研究中的价格、服务及账号条件仅代表当时证据。

文档版本、OpenAPI 版本和产品发布状态分别管理；设计包中的版本号不表示产品已上线或已通过真实业务验收。
