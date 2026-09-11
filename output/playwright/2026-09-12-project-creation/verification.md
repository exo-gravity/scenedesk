# 项目创建持久恢复前端验证

2026-09-12。基线 `279d59c`，整合后端 `4b4cfe1`（本分支 cherry-pick `d1d0cae`），前端提交 `9a90cc2ba3e50bf0e3fe83d527ea9f8b72a302a5`。独立工作树／4316 production preview／`scenedesk-ai-ui`。当前证据不修改产品代码，不覆盖之前的集场镜或助手证据。

`check-integrated.log` 为最终组合 `npm run check`：**108/108 PASS**，含契约、UI、TypeScript、production build 及 9 项新增公共 controller 行为测试。`check.log` 为此前前端阶段通过记录。

## 生产构建受控浏览器

`verify-project.js` 使用真实页面、Query、IndexedDB、严格持久事务与刷新；所有 API 数据由明确受控 transport 提供。最终 `result.json` 完整通过：

- 名称、画幅、语言未提交草稿关闭／刷新后保留，恢复操作不自动 POST。
- **实际 IDB 写事务被故意延迟**，后续已接受的最后文字进入槽位队列；关闭表单并重新打开，新的 owner/read 在旧写队列后执行，恢复“关闭前最后几字”。不是仅用 controller 的内存 storage 替身判断这个边界。
- 首次创建意图写失败零 POST；恢复同一意图后受控服务先提交并绑定项目身份，再丢弃 201 回包。
- 复制标签传入相同 sessionStorage tab 标识后，真实 browser lock 分配不同 tabId；两份草稿分区独立，原未知请求不被另一标签覆盖。
- 相同 actor 续会话后恢复原 request：body、creationRequestId、HTTP key 不变。受控模型不依赖通用 HTTP 缓存，返回已更名／归档的原项目当前表示，只有一个原项目身份。
- 初始 IDB 读取失败时没有可编辑输入或自动写入；明确重新读取后原意图仍在。
- 收到 201 后本机 result 写失败不导航；result 已持久化但清理失败可只重试整理。另一 actor 出现时重试整理先 GET 核对当前身份，拒绝清理／导航；新 actor 看不到原草稿。回到原 actor 后恢复已确认结果，只本机整理并打开项目，零新增 POST。
- 服务已提交后的坏 422（虽含 INVALID_REQUEST 但缺 requestId）、无结构 400、残缺 201 和 PROJECT_CREATION_CONFLICT 均保留未知原身份，不出现“返回编辑”。明确恢复仍只有原项目。只有可信且完整的首次 422 INVALID_REQUEST 可保留输入回编辑。
- 全段 **13 次 POST、7 个受控项目，pageErrors=[]**。包含 6 次原请求恢复／明确拒绝后的请求；这些计数不是实际服务器或数据库验收。

`unknown-project-390.png` 和 `project-cleanup-failed.png` 已检查，截图禁用动画；窄屏原请求恢复入口和字段可见，清理失败与业务已成功状态清楚分开。没有因截屏再创建任何真实项目。

第一次脚本运行的 CLI 在 beforeunload 事件时抢先返回，未提供最终 Result，故不计作最终完整证据。保留 `first-run-modal-note.txt`；修正仅等待新 actor 实际显示后才 reload，并将最终断言结果保存在受控页面以便取回。最终整段重跑通过，没有修改产品代码、关闭保护或放宽断言。

## 边界

恢复记录按 actor＋tenant＋独立 tab 隔离，同 actor 的新登录会话仍可明确恢复。关闭后已接受字段会先排完；新会话／窗口的 read claim 串行接管，旧关闭窗口不能重新 claim、追加迟到业务结果或导航。当前不做跨标签自动发现或恢复别的标签记录。

201 与完整必填 Project／tenant／revision 字段经核对才进入结果整理；可选时间字段有值时校验。只有符合 Error 合同且带非空 requestId 的准确首次 422 业务拒绝才带可信标记。两类身份冲突、代理回包及未知后的拒绝都不释放原创建身份。

真实 API／PostgreSQL 的丢回包、过期 HTTP 回执与永久 binding 由主线程独立完成。本文不将受控 transport 称为真实后端验收；未触主线程数据、服务、媒体／模型、部署环境或付费调用。
