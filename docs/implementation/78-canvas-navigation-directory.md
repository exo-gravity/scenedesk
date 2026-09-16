# 78：统一画布入口与轻量场次目录

用户批准[三页设计](../design/canvas-navigation-approved-2026-09-16.md)后实施。此项补充已合入的创作工作区，真实模型与团队飞书授权的验收边界继续按 [77](77-non-provider-workspace-closure.md) 保留。

## 实现

画布菜单统一项目和场次入口，二者共用项目左栏及导航保留屏障。普通 `/canvas` 从当前授权的索引解析最近有效画布；项目显式入口为 `/canvas?scope=project`。进入时将历史规范为具体工作区，避免 Back 被新的最近记录带回刚离开的场次。多画布首次访问让用户选择，不替用户迁移或合并画布。

增加一个小的只读 `GET /canvas-workspaces`，只返回当前授权项目的画布 ID 和可选场次 ID，过滤已归档场次/单集；不读取整张画布文档，不写入业务对象，不增加迁移。浏览器近期记录按会话、用户、租户、项目分区，仅保存身份提示；每次重新进入由服务端现有关系验证。缓存目录不能否定新的索引，撤权失败不展示旧名称或标题。

剧本以当前稿阅读与选文为主；原分镜助手进入次级菜单。Word/飞书导入与回执恢复继续复用原组件。直接选文只能在当前阅读正文内部，且必须唯一精确匹配固定原稿；否则回到规范原文选择。确认后固定引用原稿和 Unicode 范围，成功进入明确的项目画布与节点。

场次目录保留原地址，用分组行、详情抽屉和可点击镜头计数取代常驻大编辑区；旧镜头要求、归档、历史链接继续可达。场次新建高级信息折叠，无单集时要求明确建立单集。

## 验证记录

实施分支 `feat/canvas-navigation-directory`；新接口没有数据库迁移。以下检查使用最终联合产品代码，隔离数据库与合成身份，无真实付费模型调用。

- `npm run check`：265/265，契约生成一致、UI 规则、类型、生产构建通过。证据：[check-release.log](../../output/verification/canvas-navigation/check-release.log)。
- 新只读索引数据库集成：6/6。覆盖空读取不创建、跨项目隔离、归档过滤、旧画布仍可读、归档项目与撤权拒绝。证据：[index-db.log](../../output/verification/canvas-navigation/index-db.log)。
- 最终整套生产浏览器 **36/36 通过**，2.1 分钟，run `2026-09-16-canvas-navigation-4933`。覆盖旧有导入／生成草稿／回执／比较／选用／原片交付，以及新增导航、目录和选文流程，单 worker、零自动重试。证据：[all-e2e-release.log](../../output/verification/canvas-navigation/all-e2e-release.log)。
- 完成三组同尺寸效果图与生产页面对照；修正正文阅读字号、画布项目上下文和目录主按钮强调。桌面、820px／390px、实际选文预览、详情抽屉、新建表单与焦点已人工检查。证据：[设计 QA](../../design-qa.md) 与[截图目录](../../output/verification/canvas-navigation/README.md)。

本轮实际发现并修复：历史 Back 被新的最近画布提示带回、过时内容缓存误判新画布、读取失败后的旧标题，以及只读规范原文中方向键不能精确选择的问题。重复文字不猜测出现位置；E2E 对确认预览做精确相等断言，并核对最终固定 Unicode 范围。

首次整套 35/36 通过的失败记录保留于 [all-e2e-final.log](../../output/verification/canvas-navigation/all-e2e-final.log)。其唯一失败是缩窄窗口后立即 Enter 打开导航，React 断点状态晚于原生视口变化。按钮改为激活时读取实际断点；专项测试延迟首次断点通知稳定复现，随后恢复原生事件，3/3 通过。焦点陷阱、Escape 返回、链接导航后焦点断言未放宽，证据：[resize-e2e.log](../../output/verification/canvas-navigation/resize-e2e.log)。

## 集成与本机切换

PR、精确 head 的 GitHub CI 状态与切换证据在实际执行后记录。用户已授权本机必要检查后普通手动合并；不改变仓库可见性、保护或工作流，不使用管理员绕过。

4311 更新复用原数据库、媒体、身份及 worker 配置，只替换必要的 API 与生产 Web 服务。没有新迁移，不重建用户数据或旧预览。团队飞书授权、真实模型、外部部署和此前完整媒体套件的未通过记录仍按 [77](77-non-provider-workspace-closure.md)保留，本次页面验收不扩展这些结论。
