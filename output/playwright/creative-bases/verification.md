# 创作依据浏览器验收

2026-09-10，Chromium，真实本地业务 API／PostgreSQL，`fixture@example.test` 模拟身份。界面路径：工作室 → 项目 → 集场镜 → 创作依据。此次未调用真实模型。

1. 迁移后列出未确认依据，原有来源不自动确认。[未确认列表](01-unconfirmed-list.png)
2. 第二标签页保存第二版剧本，再明确确认该固定版本；页面显示确认者、时间、说明和正式状态。[确认新稿](02-confirmed-current.png)
3. 第一标签页仍核对旧稿且保留首次空指针，提交返回 412；原说明保留，正式内容更新为第二版，确认按钮停止接受提交。[冲突保留说明](03-conflict-preserves-note.png)
4. 刷新第一标签页，从历史列表找回旧稿，出现本地未提交说明的恢复提示。恢复后仍保留旧指针，不自动越过冲突。[恢复入口](04-recovered-confirmation-draft.png)
5. 在 320 × 740 窗口核对最新正式内容，再明确确认旧稿；窗口无横向溢出（document.scrollWidth=320），说明与全部确认记录持续保留。[窄屏冲突](05-narrow-conflict.png)

6. 重启业务服务并打开 1512 × 1000 的构建产物（4312，只读核对），当前剧本第 2 版继续存在，正式依据已明确切回第 1 版；两次确认历史和说明均保留。[构建页面核对](06-built-current-draft-vs-formal.png)

截图已逐一查看。冲突操作产生一次预期 HTTP 412 控制台资源错误。最终构建页面控制台为 0 errors／0 warnings。SQL 复核：contentRevision=12、currentScript.number=2、formalBasis.number=1、confirmation count=2。
