# 工作室壳层收敛与 Echo 演示名称

2026-09-16，承接已合入 [PR #55](https://github.com/exo-gravity/scenedesk/pull/55)，用户补充要求将演示工作室改为 Echo，并指出账户菜单的「我的工作／工作室资产库」及最顶部细条与全局导航重复。

已登录工作区去掉单独的品牌／身份／主题顶栏，保留下方位置导航与画布工具栏。账户菜单仅显示身份、测试环境标签、主题切换和退出登录；左侧工作室导航继续提供项目、我的工作、资产库，项目内通过「所有项目」返回。未登录与会话错误页保留原登录顶栏。没有增加新导航系统或开放团队管理。

原本机演示工作室已经按明确 ID、预期旧名称及 revision 前提，在事务内改名 Echo；只更新租户名称、revision 与更新时间，未新建工作室、重新导入或移动业务对象。命名是现有演示数据的操作，不写进所有工作室或 E2E 的默认名称。操作证据位于主工作目录 `output/implementation/2026-09-16-canvas-navigation-upgrade/echo-rename.json`。

本机 `npm run check` 265/265 通过；同一生产构建整套 E2E **36/36** 通过，2.2 分钟、零重试，run `2026-09-16-canvas-navigation-24634`。已有入口用例补充账户菜单仅有两个操作、身份提示仍在、主题切换可用和左栏工作／资产入口仍可见的断言。实际生产截图已检查，见根目录 [design-qa.md](../../design-qa.md)。证据：[基础检查](../../output/verification/workspace-shell/check.log)、[E2E](../../output/verification/workspace-shell/e2e.log)、[工作室页面](../../output/verification/workspace-shell/studio-shell-dark.png)。该小片只改变显示与导航重复入口，真实模型、外部服务与媒体处理的验收范围继续按 77 保留。
