# 单视频生成前端验证

生产预览为 4316；独立浏览器 scenedesk-ai-ui。实际本地 OIDC 身份只读获取项目、镜头和画布上下文；能力、生成、画布写入及结果访问为明确受控 transport。未写入实际模型结果或调用任何付费供应商。

`controlled-fixture.mp4` 是本地 ffmpeg 编码的 256×144、25 fps、2 秒 H264/AAC 测试图案与音调，不是模型输出。完整媒体在文件中，不放入画布状态或 IndexedDB。`verify-controlled-video.js` 检查媒体访问 CSRF 与 Idempotency-Key；服务器完整校验仍须由主线程进行实际联调。

- `verify-image-regression.js` 保留原单图完整用户路径，证据写入新的 image-regression/，不覆盖原截图。
- `verify-controlled-video.js` 验证固定镜头／画布视频计划、明确执行、未知提交只读恢复、归档恢复、原片点击播放、结果添加丢失回执后同请求恢复、原草稿保留、来源删除后历史找回、冲突结果与无能力禁用。
- `player-check.tsx` 直接导入实际共享 MediaPlayer。先执行 `node output/playwright/2026-09-11-video-generation/build-player-check.mjs`，将独立验证页面构建到未提交的 apps/web/dist/player-check/；`verify-player-coordination.js` 使用两个实际实例验证有声互斥、静音和零音量保留、取消静音／提高音量协调、卸载 source 释放和重新挂载。

独立预览中的既有媒体／presence 仍受真实服务 Origin 4311 限制；这些错误被保留，不作为媒体后端验收。这些截图中的既有服务错误不属于本次受控结果。


2026-09-12 完成：

- `npm run check`：82 项通过，0 失败／跳过；包括完整类型、合同、UI 边界、生产构建和既有权限／迟到回包恢复单测，新增 4 项视频能力、输出与固定来源行为测试。
- [视频浏览器结果](result.json)：2 次准备、2 次执行、1 次归档恢复；添加结果首次回执丢失，刷新不重发，用户明确恢复时复用原键，总 2 次添加请求仅 1 个结果节点。模型选择触发保存期间，准备按钮保持禁用。归档后无海报／代理仍可明确点击解码原片；画布结果节点点击前不挂载视频，离开视口会释放实例。
- [图片回归结果](image-regression/result.json)：原镜头和画布单图流程均通过，2 次准备／执行、1 次归档恢复、2 次同键添加请求；保留草稿与原图无海报回退。原图片独立预览访问的后端身份修复在主线程，不以本受控测试替代实际 API 验收。
- [双播放器结果](player-result.json)：两个真实 MediaPlayer 解码 H264/AAC，播放、取消静音、从零提高音量均只保留一个有声实例；静音／零音量播放不会被一概暂停。卸载暂停、移除 source，重新挂载仍正确协调，播放器错误为 0。
- 视频和图片均验证 `reconciliation_required` 保留原任务但禁止确定结果及添加动作、来源草稿删除后从历史找回、只剩目标描述能力时不可执行；手工文字保持原样。两种流程 pageerror 均为 0。
- 已逐张查看视频 `shot-result-1512.png`、`shot-result-390.png`、`canvas-result.png`、`canvas-original-preview.png`、`deleted-source-history.png`、`unavailable.png`，图片回归目录对应的 5 张截图，以及 `two-players.png`。独立结果区保持有界宽度，移动端控制与原片取回入口可读。

这些结果证明生产前端和真实浏览器解码／播放行为在明确受控接口下成立。它们不证明供应商提交、实际任务持久化或真实模型质量；实际 API、worker 和对象存储联调由主线程整合后进行。
