# 实际异步任务与取消恢复验收

2026-09-12。生产前端＋同源真实API＋随机隔离数据库schema／受限角色＋原generation worker＋本机HTTP测试协议。`serve.ts`仅为本次测试入口，不加入生产服务；私有会话只在忽略的`.runtime/async-browser-fixture/`保管。所有业务创建／取消都走原公开API；只通过fixture控制外部测试服务的pending/running/completed状态，不改生产业务状态或快进查询时钟。

## 结果

[start](start.log)、[取消恢复](cancellation.log)、[排队取消](queued.log)、[最终布局及读回](final-layout.log)及[result.json](result.json)记录具体身份和断言。脚本含本轮一次性身份，不能在已消费的计划上盲目重放；重新执行应启动新隔离fixture并采用新身份。

1. 用户选择固定剧本、完整片段、手工要求及明确标识的测试模型，查看计划并执行。计划与执行各POST一次，外部服务只收到一次创建。页面显示已受理，随后沿实际5秒查询节奏显示正在生成，刷新仍取回同一个job/provider ID。
2. 在真实API持久保存取消后丢弃202响应。刷新仅GET原任务，页面恢复独立取消事实；服务只有一次取消外呼。随后外部服务返回完成，真实提案保存为`proposed`，原场次镜头数仍为0。取消事实保留，结果入口正常，不重复生成或自动采纳。
3. 暂停fixture执行器后创建第二任务；页面明确取消排队任务，数据库返回`cancelled/confirmed`且无provider ID。刷新保持取消结果，另开输入仍保留手工原文；外部服务仍只有原来一项任务。
4. 第三项排队任务仅用于确认框稳定帧的目视检查，最终也由页面明确取消。最终三项平台任务：一项成功、两项在提交前取消；外部创建和取消各一次。worker错误数组为空。

最终前端含`7cf995a`的局部层叠修正。390px助手内容仍可滚动，模式标签不再绘制到吸顶标题之上；`elementFromPoint`确认标题处最上层是标题自身，水平无溢出。[最终窄屏](final-heading-390.png)与[稳定确认框](confirm-stable-1512.png)已目视：确认框440×223，居中且文字和按钮清楚。`completed-390.png`保留发现问题前的截图，不作为最终布局验收。

## 保留的首次问题

- 第一次脚本在页面恢复前检查助手可见性，误把已恢复打开的助手再次关闭，等待表单超时；未创建计划或job，fixture只读证明外部任务为0。随后先等待开关再读取`aria-pressed`，实际流程通过；保留[start-first.log](start-first.log)。
- 最早两张confirm截图抓到了确认框首次绘制前的透明帧，即使`animations:disabled`也未证明它已稳定；后续保持真实确认框打开，读取`opacity=1/visible`并截图目视通过。验证脚本现加上明确opacity条件；没有为此更改Modal产品实现。
- 实际390px截图发现模式标签与吸顶标题层级相同，后出现的标签盖住标题。产品仅为助手内容增加`isolation:isolate`，经类型/UI/build及本次同会话复拍验证，未改布局几何。
- 首次未登录页的401、fixture未提供favicon的404及主动中断取消202导致的网络错误不冒充业务通过；本次业务脚本记录`pageErrors=[]`、服务端5xx为空，恢复后的公开API结果单独断言。

## 验证边界及清理

本次浏览器fixture启动时应用冻结0092/0093；追加0094的同结果补充usage语义由最终真实数据库17项异步专项及完整255项回归验证。最终完整仓库检查131项通过，CSS最后一行修正另经UI/type/build与本次复拍。HTTP断连、错误身份和独立Node进程恢复的6项检查参见[HTTP证据](../../engineering/async-provider-http-results.json)。

本机HTTP协议明确标记`test_fixture`，不是任何真实模型API，未调用付费服务。这里完成了真实文本提案持久化；图片/视频/音频解码和外部部署另行验证。原用户业务数据库和既有API／worker服务没有被本fixture重置或停止。

专用浏览器已关闭，4319服务已停止，隔离schema／角色及HTTP服务按资源逆序清理成功；私有cleanup收据证实完成，公开result仅保留无秘密的清理状态。
