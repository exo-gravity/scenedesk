# AI 助手交互验证

2026-09-11。分支 `feat/ai-assistant-workspace`，基于 `91c1f47`。本记录覆盖前端 script_analysis 的首条交互，不表示真实 AI、后端任务归档或完整 MVP 已验收。

## 已实现

- 场次内非模态助手；无画布的分镜模式也可使用。
- 明确选择剧本修订和原文选区，Unicode 码点范围与浏览器 UTF-16 选区转换一致；场次上下文只在用户勾选后发送。
- 实际能力列表、测试能力标识、不可用状态、固定计划回显与单独执行确认。原输入、固定目标和既有镜头不会由生成自动覆盖。
- 按用户、场次、标签页及登录会话隔离本机恢复记录。执行意图先落盘；网络丢失回执后通过 planId 查回原 Job；页面恢复和模式切换不自动 POST。只有在明确重新读取原计划为 ready、未发现原任务后，用户可继续原请求；沿用原执行身份，服务端还必须保持每计划唯一任务。
- 复用已有提案编辑、人工修订、明确勾选、采纳确认及内容基线冲突处理。修复保存回执清理快于查询更新时把自己的保存误判为他人修改的时序问题；保存或采纳在途期间锁住本次编辑。
- 复用 editing-lifecycle 注册机制；授权提示先隐藏，当前 session/project GET 确认后恢复，确认撤权清理本机副本；断网隐藏但保留。epoch 拒绝旧会话迟到响应，串行写及清理避免数据复活。清理失败保持隐藏并可重试。

## 检查与实际浏览器证据

`npm run check`：60 tests，60 pass，0 fail/cancelled/skipped。之后对提案在途交互锁的最终修改单独完成 `npm run typecheck` 与 production build。使用独立安装的本 worktree 依赖。

浏览器运行生产构建，1512×982、1366×900、390×844。`verify-controlled-ai.js` 读取本地合法测试身份的实际项目／剧本／画布作为只读上下文；AI 能力、Plan、Job、Proposal、内容采纳结果与视图偏好使用明确的受控 transport。没有调用模型、没有真实写入 AI 提案／新增镜头。控制任务显著显示“测试”，不能作为后端或真实模型验收。

浏览器通过：

- 剧本片段＋明确场次上下文 → 固定计划；分镜／画布切换保留要求。
- 模拟服务端已有任务而执行响应丢失 → 刷新查回原任务；再切换模式不重复提交。
- 将同一受控任务核对为有提案 → 人工改叙事意图 → 保存第 2 版 → 明确采纳并创建。
- 能力为空时禁用分析执行；没有创建画布也可在分镜模式打开助手。
- Plan POST 1 次、execute POST 1 次、edit PUT 1 次、apply POST 1 次；0 pageerror。
- 三个视口的助手边界均在视口内，截图已逐张查看。窄屏停靠在主内容之后并单独滚动。

截图：[1512 待核对](unknown-1512.png)、[1366 待核对](unknown-1366.png)、[390 待核对](unknown-390.png)、[提案已采纳](proposal-applied-1512.png)、[无模型且未创建画布](no-model-without-canvas-1366.png)。

浏览器本地 API 只允许原应用 Origin，4316 独立预览的真实媒体 access／编辑 presence 请求因此返回 403；部分早期重启窗口返回 500。它们没有被记为媒体或身份验收成功，且不是 JS pageerror。最终 AI 受控链路通过；需在整合后的合法 Origin 下重新验证实际后端。

最初几次浏览器脚本因 CLI 沙箱没有 URL/structuredClone、测试存储清理建出空 schema、刷新丢失受控面板偏好而失败；修复的均是受控验收脚本。实际发现的提案保存时序问题另在生产代码修复并通过最终浏览器流程。

## 整合与剩余依赖

`SceneProductionWorkspace.tsx` 与 root 上传 wrapper 修改需要按实际 diff 合并。`BusinessApp.tsx` 由其他切片负责：需顶部 `import "./assistant-lifecycle"`，使全新进入项目首页后立即退出登录也会清理此前会话的助手本机记录；本分支没有修改该文件。

后端需整合 `1ee0a8d` 或其后续修订，包含按 planId 查询、每计划唯一任务及 executionMode。真实 script_analysis／Proposal 归档需使用实际 API＋worker 复验；真实服务、凭据、支出授权及模型效果仍待外部条件。prepare_prompt、prepare_rework 和媒体生成不在这次前端切片的完成声明内，仍属原定 AI 范围。
