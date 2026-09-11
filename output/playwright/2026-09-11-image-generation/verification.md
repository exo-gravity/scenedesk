# 单图生成页面受控验证

2026-09-11；生产构建预览 `http://127.0.0.1:4316`；浏览器会话 `scenedesk-ai-ui`。代码基线 `51cad31`。本记录不声明实际后端、worker、存储或模型验收。

使用合法本地测试身份只读获取实际项目、镜头和画布上下文。`verify-controlled-image.js` 明确拦截能力、计划、Job、画布配置/保存/结果和新图片访问端点。几何测试图片由浏览器 Canvas 生成，包含 LOCAL TEST FIXTURE 字样；不是模型输出。脚本仅清空独立 4316 预览的助手／画布恢复库，未读取或记录 cookie、令牌或存储授权。

## 通过路径

- 当前镜头手工提示创建固定图片计划，继续编辑提示后执行；丢失 execute 回执，刷新后 GET 找回原 Job，未重复执行。
- `archive_failed` 明确调用一次无正文 `recover-archive`，不会发送 JSON Content-Type，也不再执行模型。结果成功后显示独立 ready original，`derivatives=[]` 时媒体访问请求明确使用 original。
- 1512 和 390 视口图片区无水平溢出，手工原文和继续编辑内容保留。
- 图片画布草稿配置实际可执行模型和尺寸，经原编辑器保存，计划 If-Match 使用保存后的 canvas revision，且未隐式加入镜头来源。
- 冲突核对状态隐藏成功结果与添加入口；恢复确定成功后才可继续明确添加。
- 添加首次 POST 已创建结果但模拟丢失响应；刷新不重发添加或执行。用户明确恢复原请求，使用同一 Idempotency-Key、If-Match、job/media/position 正文，结果只有一个独立节点，原图片草稿仍存在。
- 通用画布 MediaPreview 在无 poster 时通过授权 original 显示，图片元素已完成解码。
- 原图片草稿删除后仍从服务端计划历史明确打开原任务和结果，未新建计划或执行。
- 仅剩 target_profile_fixture 时不提供可执行选项，明确显示不可用并禁用准备。

请求计数与断言见 `result.json`。页面异常为 0；独立预览中原服务的既有媒体访问／presence 因 Origin 4311 限制而出现的 403 被保留，没有弱化权限策略或作为图片业务验收。

## 截图

- `shot-result-1512.png`：桌面分镜手工输入与已归档独立图片。
- `shot-result-390.png`：窄视口结果与输入布局。
- `canvas-result.png`：独立图片结果与明确添加成功回执；原图片草稿仍保留。
- `canvas-original-fallback.png`：原草稿删除后的独立结果节点，poster 缺失时授权 original 已解码显示。
- `deleted-source-history.png`：删除原草稿后固定任务及原图仍可读取。
- `unavailable.png`：无可执行图片模型时明确禁用。

运行中发现并修复了画布添加回执尚未保存即刷新父组件的生命周期问题；最终代码先持久化结果，再刷新／提供明确定位。任务历史的浮层选择在画布恢复和折叠布局变化后曾被隐藏；最终采用 Mantine NativeSelect 处理这项普通单选，避免依赖移动布局中的浮层定位。画布生成表单保持有界滚动。
