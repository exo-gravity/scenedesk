# 提示准备生产页面验证

2026-09-11，`feat/ai-prompt-workspace`。生产构建，独立 4316 预览及 `scenedesk-ai-ui` 浏览器；实际合法测试身份和只读镜头上下文，生成与建议使用受控 transport。没有真实模型或实际 AI 数据库写入。

完整流程与恢复约束见 [实施记录 45](../../../docs/implementation/45-prompt-workspace-ui.md)。可重跑脚本：[verify-controlled-prompt.js](verify-controlled-prompt.js)。该脚本仅在专用本地测试 Origin 下清理自己的测试 IndexedDB；不能对真实用户环境运行。

最终检查 `npm run check`：69/69 pass。浏览器结果见 [result.json](result.json)。已验证一次计划、一次执行、一次修订写请求，执行与保存分别模拟丢失回执后只读恢复；固定 r1/r2、明确追加、保留手工输入、双模式共享、刷新、另开输入保留历史以及无模型禁用。

截图已查看：[明确追加](confirm.png)、[1512 已应用](applied-1512.png)、[390 已应用](applied-390.png)、[无可用模型](unavailable.png)。本机 API 的 Origin 限制使预览中的媒体／presence 请求返回 403，截图保留了真实错误；不计作媒体验收。
