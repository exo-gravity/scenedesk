# 首次创作流程修复验证

2026-09-12，独立分支 `feat/creation-workflow-recovery`，基于音频前端 `5f9b426`。`npm run check` 包含生产构建并通过 88 项测试；提示专项 11/11。没有运行数据库或媒体回归，没有真实模型、付费调用或真实权限变更。

`verify-workflow.js` 运行完整 BusinessApp／ContentWorkspace／ShotPromptComposer 生产代码。全部 `/v1/` 和 `/health/` 由明确的受控 transport 提供；测试身份是虚构的普通工作室 member，工作室 membership 始终 active。没有使用真实 API 的成功来替代权限恢复证明，也没有把受控任务称为真实 AI 验收。

[完整结果](result.json)：工作室权限门继续可见，原项目 GET／内容 GET 返回 403 后旧项目内容、模态编辑器和项目名标题隐藏；明确重新读取时内容连续返回两次 503，拒绝锁仍保持，不重新展示缓存。此前普通 503 不清空编辑器或本机草稿；重新授权后，明确恢复同一未提交草稿，文字完整。检查实际 IndexedDB 前后副本一致，其他业务写入为 0。

同一流程实际准备一个固定提示计划并执行一次，尚未应用任何建议。随后所选镜头从 v1 变为 v2，旧创作输入与计划保持 v1；“另开一次”的确认明确展示 v2，确认后切换到 v2，刷新仍保留此前的手工原文、准备要求、v1 来源及旧 planId／jobId。计划 POST 1 次、执行 POST 1 次，刷新不执行。`pageErrors=[]`。

[窄屏结果](mobile-result.json)使用 `verify-mobile.js` 在上个流程完成后核对 390 px；创作区没有横向越界。已逐一查看 `transient-draft.png`、`denied-cache-hidden.png`、`explicit-new-revision.png`、`restored-next-input.png`、`retained-input.png` 与 `retained-input-390.png`。这条前端分支保留独立旧导航基线；主线程的首发入口裁剪没有被本提交修改或替换，不将截图中的旧导航当作当前发布范围验收。

保留前三次 harness 失败记录：`initial-navigation-failure.txt` 是首次先打开 app 再仅变更 hash，保留了原 401 会话缓存；修正为先离开文档再安装受控页面。`close-locator-failure.txt` 是关闭按钮无所猜测的英文 aria-label，改用实际 Escape 关闭。`fixture-storage-failure.txt` 是清理脚本不慎创建了没有 object store 的空数据库；确认 stores=[] 后删除该空测试库，修正脚本为只处理已存在且结构正确的数据库。最终完整运行通过。这些均未修改产品权限、查询超时或恢复逻辑来掩盖失败。

剩余创建回执未知问题及外部服务／真实适配器条件详见[实现说明 53](../../../docs/implementation/53-creative-workflow-recovery.md)。
