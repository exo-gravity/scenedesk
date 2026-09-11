# 单音频生成前端验证

2026-09-12；独立生产预览 4316，浏览器 scenedesk-ai-ui。使用合法本地 OIDC 身份只读获取场次／镜头／画布上下文，生成计划、任务、写入、固定对白与声音快照及输出访问均为明确受控 transport。没有创建实际模型结果或调用付费供应商。

`controlled-fixture.wav` 为 Python 标准库编码的 48 kHz、单声道、2 秒 PCM16 WAV 音调，不是 AI 生成、对白录音或声音克隆。独立播放验证使用原视频测试文件和此 WAV；媒体字节不进入节点文档或 IndexedDB。

- `verify-controlled-audio.js` 沿原公开接口验证固定镜头／画布计划、参数没有视频字段、固定对白声音快照回显、未知提交只读恢复、归档恢复、明确点击原音频试听、丢失添加回执后同键恢复、原草稿保留、删除来源后历史取回、冲突与无能力不可执行。访问检查 CSRF／Idempotency-Key，受控结果不证明实际服务授权。
- `verify-video-regression.js` 和 `verify-image-regression.js` 保留此前两种完整用户流程，截图写入新目录，不覆盖历史证据。
- `player-check.tsx` 直接导入实际 MediaPlayer，其中一个视频、一个音频。`build-player-check.mjs` 仅构建未提交的独立证明页，`verify-player-coordination.js` 检查播放／取消静音／提高音量的跨媒体有声互斥、静音和零音量保留、卸载 source 释放和重挂。

独立 4316 的既有素材／presence 受真实服务 Origin 4311 限制，错误保持可见，不改授权条件。实际模型提交、归档和声音来源解析仍需主线程联调。

最终验证完成：

- `npm run check`：86/86 通过，0 失败／跳过，包括最终类型、合同、UI 规则、生产构建与原恢复生命周期测试；新增 4 项音频能力／整数时长／拒绝视频参数／固定声音与镜头来源行为测试。
- [音频完整结果](result.json)：2 次准备、2 次执行、1 次归档恢复；第一次添加回执丢失，刷新只读，明确恢复沿用原键，总 2 次添加请求只保留 1 个结果节点与原草稿。固定对白、声音媒体／资产修订和资产声音说明均可见；没有 resolution/aspectRatio/withAudio。原 WAV 通过浏览器实际解码和播放，点击前不挂载 decoder，离开视口释放，删除来源后历史找回，冲突及无能力入口禁用。
- [视频回归](video-regression/result.json)与[图片回归](image-regression/result.json)：两者完整镜头／画布流程均通过，各 2 次准备／执行、1 次归档恢复、2 次同键结果添加；保留此前的原图／原视频回退、未知提交不重发、原草稿保留、删除来源后找回、无能力禁用。最终视频运行没有访问恢复或失败 GET；这不抹去前面的失败记录。
- [混合播放器结果](player-result.json)：一个实际视频实例与一个实际音频实例完成解码；播放、取消静音、从零提高音量保持一个有声实例，静音／零音量播放可继续；卸载暂停并移除 source，重挂后仍协调，播放器错误为 0。
- 所有最终主流程 pageerror 为 0。已逐张查看本目录 7 张音频页面截图、video-regression/ 6 张正常页面截图、image-regression/ 5 张截图、mixed-players.png，以及视频访问核对失败与恢复截图。桌面与 390 px 音频控制可读，画布原音频使用紧凑播放器；不绘制虚假波形。

额外保留的失败与恢复证据：首次视频回归等待“已添加到画布”超时，记录在 [first-failure.txt](video-regression/first-failure.txt)；下一次初始真实上下文读取失败，记录在 [context-failure.txt](video-regression/context-failure.txt)。另一次删除来源后打开历史时，页面隐藏了未核对的任务内容，显示“本机副本仍保留，请联网后重试”，见 [history-access-failure.txt](video-regression/history-access-failure.txt)、[界面快照](video-regression/history-access-snapshot.txt)与 failure.png。此时没有把临时读取失败当撤权销毁或允许继续执行。明确点击访问核对后原历史恢复，可再次播放，见 [恢复结果](video-regression/access-recovery-result.json)与 access-recovered.png。没有新的生成提交；一次手工检查使用未限定区域的同名文本选择器而报 strict-mode，随后限定到原任务区域完成核对。

这些读取失败发生于实际开发服务也在升级／验收的时段，但没有足够证据断言重启就是具体请求失败原因。产品代码未因此更改超时、Origin、权限或自动重试规则。回归脚本允许在明确显示临时不可读时点击现有访问核对按钮并记录次数，绝不自动执行模型；最终独立视频回归此次数为 0。

以上为真实浏览器 UI／解码行为在受控生成接口下的验证，不能代替实际音频 provider、任务持久化、声音来源解析或对象存储验收。主线程整合后需继续实际 API／worker 联调。
