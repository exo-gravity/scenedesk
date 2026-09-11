# 实施进度与验收证据

2026-09-11 发布顺序调整：按用户最新决定，**画布与 AI 保持原计划**；后期剪辑、字幕、固定渲染、完整团队管理、开放注册和运营不进入当前 MVP。商业计费与费用运营后置，模型实际执行仍需要必要限制与重复提交保护。以下工作包表同时保留既有成果和旧完整路线的状态；当前首发依赖以[38 当前 MVP](38-first-release-scope-review.md)为准。暂停继续扩展 E05／E06，优先推进 CX01–06、原定 AI 流程及真实部署；未完成画布／AI时不将素材工作台试用切片算作 MVP 完成。

2026-09-10：用户明确授权完整实施项目并将验收后的功能合入 GitHub，取代此前正式业务工程暂停的要求。依据仍为产品设计 v1.3、核心体验 v0.3、专项 v0.4 和技术协议 v1.3。

当前先使用导入素材及模拟供应商实现和验证业务，不执行真实模型付费调用。真实模型服务与质量验收单列，不以模拟通过代替。部署环境与真实试点条件尚待落实。

## 当前工作

| 工作包 | 状态 | 实际成果／剩余验收 |
|---|---|---|
| 仓库与 CI | 完成 | main 已关联 GitHub；修复不可移植的文档链接，提交 72e95bb 的完整 CI 通过 |
| E01 身份、权限与内容基础 | 已合入 | [身份／项目基础](23-identity-project-foundation.md)经 [PR #1](https://github.com/exo-gravity/scenedesk/pull/1) 合入（dd04b77）；[内容层](24-content-structure.md)经 [PR #2](https://github.com/exo-gravity/scenedesk/pull/2) 合入（d92c5cc），两组远端 CI 均通过 |
| E02 剧本、结构与提案 | 实施中 | 手工集场镜、不可变剧本／镜头历史、台词与原文引用、本地草稿恢复已实现；[CSV 提案](25-csv-proposals.md)、明确追加、固定基线复核及永久重复采纳保护已通过 [PR #3](https://github.com/exo-gravity/scenedesk/pull/3) 合入（feb5ea4），两组 CI 通过；[创作依据与项目默认确认](26-creative-bases.md)已通过 [PR #4](https://github.com/exo-gravity/scenedesk/pull/4) 合入（5ae739b），两组 CI 通过；[场次主责与任务分派](27-scene-tasks.md)已通过 [PR #5](https://github.com/exo-gravity/scenedesk/pull/5) 合入（427f528），两组 CI 通过；固定稿限定确认随编辑／审阅完成 |
| T01 队列集成 | 基础已合入 | [pg-boss 基础集成](28-durable-queue.md)通过 [PR #6](https://github.com/exo-gravity/scenedesk/pull/6) 合入（e3c81c9），两组 CI 通过；同事务回滚、受限角色、延时／重复、SIGKILL 和重试耗尽验证，全套 51 项数据库测试通过；付费执行门槛随 G02 完成 |
| E03–E04 媒体与候选 | 实施中 | [媒体运行基础](29-media-runtime.md)通过 [PR #7](https://github.com/exo-gravity/scenedesk/pull/7) 合入（a963678），两组 CI 通过；固定对象版本、受限解码和独立派生的 15 项真实环境测试通过；[素材导入服务](30-media-import-service.md)已接通 9 个操作、原子入队、受限 Worker 及修复扫描，25 项媒体测试通过，已通过 [PR #8](https://github.com/exo-gravity/scenedesk/pull/8) 合入（691a8d2），两组 CI 通过；[素材工作台](31-media-workspace.md)已通过实际导入、断网恢复、并发编辑、播放下载和生产构建布局验证，经 [PR #9](https://github.com/exo-gravity/scenedesk/pull/9) 合入（2d1511e），两组 CI 通过；[资产固定版本](32-asset-versions.md)已接通 12 个操作及业务页面，独立造型、历史确认、共享声音固定引入、真实 412 恢复和生产构建布局均通过；经 [PR #10](https://github.com/exo-gravity/scenedesk/pull/10) 合入（a23bfae）；修复存储冷启动探针等待时提前退出的问题，最终两组远端 CI 的 16 项单元、59 项数据库与 25 项媒体验证通过；[场镜实际引用](33-creative-asset-bindings.md)已通过本地 19 项单元、69 项数据库及 25 项媒体验证，实际绑定、固定历史、使用位置跳转、真实冲突与草稿恢复及生产构建窄屏验收通过，经 [PR #11](https://github.com/exo-gravity/scenedesk/pull/11) 合入（a51671c），两组 CI 通过；[候选与明确采用](35-candidates-and-adoption.md)已完成本地业务与生产构建恢复验收，经 [PR #13](https://github.com/exo-gravity/scenedesk/pull/13) 合入（22e29ae），两组远端 CI 通过；共享发布及实际用片继续实施 |
| E05A–E06 编辑与场次交付 | 首发后置 | [共享剪辑工作稿](36-cut-work-drafts.md)已实现服务、独立 CAS、类型化引用及有限历史，31 项单元与 91 项数据库测试通过；剪辑、源片段、对白／固定声音／字幕、本机恢复、历史取回及实际 412 逐项重放已通过生产浏览器基础验证；容量与损坏副本管理、内存边界、跨标签页核验／退出及会话清理隔离已通过故障与实际页面验证；已通过 [PR #14](https://github.com/exo-gravity/scenedesk/pull/14) 合入（aa138ff）；规格基线、长度处理与后台维护按最新范围后置；[精确制作副本](37-production-copies.md)的视频内核、48 kHz 音频样本／偏移及内部工件存储协议已通过 [PR #15](https://github.com/exo-gravity/scenedesk/pull/15) 合入（b7c14e4），音视频与存储版本的远端 CI 已通过；数据库 journal、租约、受限角色及上传恢复已实现；实际制作 Worker、创建前资源登记、磁盘写入预算和宿主清扫已接通，最新本地 39 项单元、99 项数据库及真实导入／制作队列、超额停止后恢复、解码进程 SIGKILL 清扫检查通过；工作稿归一与页面确认尚未接通；固定渲染、审阅返工和工作包待完成 |
| CX01–CX06 场次画布 | 实施中 | [画布服务基础](39-scene-canvas.md)接通唯一创建、文档 CAS、固定节点／媒体身份、有限历史和个人偏好八个操作；完整 108 项数据库回归及追加容量后的 10 项画布专项通过；2,000 节点／5,000 边已完成 API 保存重读，尚不是浏览器性能验收；双模式页面、独立本机恢复、冻结比较／逐项重放和历史取回已接通；44 项单元及生产浏览器的网络故障、原输入保留、真实视频播放和桌面布局通过；镜头参考／候选关联与独立探索已接通，固定版本／区间、解除保留候选、复制独立和未知回包核对均通过生产浏览器验证，最新完整数据库回归 119 项通过；[PR #16](https://github.com/exo-gravity/scenedesk/pull/16) 已合入 main（d261d0d），编辑者提示和项目 SSE 已接入，最新完整数据库回归 136 项通过；单／多来源继续创作已通过 48 项单元与真实生产浏览器验证，保留来源并支持引用调整、旧来源拒绝及撤销恢复；拖入上传、原文件恢复、固定落点及撤销不重加已通过真实生产浏览器验收，完整数据库回归 144 项通过；上传提交 dc5f3d0 的两组远端 CI 均通过 48 单元／144 数据库／61 媒体；[浏览器容量](42-canvas-browser-capacity.md)完成300／2000节点实际A/B与两处小优化：300本轮交互及平移达建议值，但全览最小余量仅0.5ms；2000编辑P95从785.9降到269.1ms，全览仍81.9–83.6ms。整合70单元／173数据库通过，合法同源页面两种容量短流程与实际播放／释放通过；[PR #20](https://github.com/exo-gravity/scenedesk/pull/20) 已合入（77faa34），精确 1a429346 两组 CI 均通过 70 单元／173 数据库／61 媒体。AI 输入／结果继续推进 |
| 私有首发入口 | 已合入 | [创作工作台入口](40-private-mvp-entry.md)已由独立 agent 完成并集成，默认进入真实项目与集场镜，后置团队／运营／剪辑及原型入口，实际创建项目、旧归档确认 412 恢复与三种宽度验证通过；[PR #17](https://github.com/exo-gravity/scenedesk/pull/17) 已合入（e25a6b9），精确提交 bf137c3 的两组 CI 均通过 48 单元／144 数据库／61 媒体 |
| G01–G04 生成与费用 | 实施中 | [固定分镜建议](41-generation-assistance.md)的后端和助手页面已提交并进入整合，包含固定计划、持久作业／attempt、未知提交恢复、人工修订与采纳；实际 API／受限 worker 的回包丢失、刷新找回、人工修订和明确采纳已通过生产浏览器验证，完整整合检查 60 项单元及 160 项数据库测试通过；[PR #18](https://github.com/exo-gravity/scenedesk/pull/18) 已合入（c939900），精确提交 a390d975 的两组 CI 均通过 60 单元／160 数据库／61 媒体；[固定提示建议](43-prompt-assistance.md)与[创作输入界面](45-prompt-workspace-ui.md)已整合，69 项单元、172 项完整数据库测试及追加 ready 约束后的 13 项专项通过；真实 API／受限 worker 浏览器验证两次回执丢失均通过 GET 恢复，计划／执行／人工修订各一次，原镜头未改变，[PR #19](https://github.com/exo-gravity/scenedesk/pull/19) 已合入（ff5bb6a），精确 bc4cd830 两组 CI 均通过 69 单元／173 数据库／61 媒体。[单图后端](44-image-generation-runtime.md)与[图片界面](46-image-generation-workspace.md)已整合，82 单元／183 数据库通过，实际镜头与画布任务完成真实文件归档、原响应丢失恢复、唯一结果添加和删除来源后取回；[PR #21](https://github.com/exo-gravity/scenedesk/pull/21) 已合入（f3b7433），精确 11ea579 两组远端 CI 均通过 82 单元／183 数据库／66 媒体，本机超时失败保留在专项记录。[视频后端](48-video-generation-runtime.md)与[视频界面](49-video-generation-workspace.md)已通过实际镜头／画布归档、唯一结果与丢回执恢复、原图片兼容检查，经 [PR #22](https://github.com/exo-gravity/scenedesk/pull/22) 合入（30f5adc），精确 891f351 两组 CI 均通过 88 单元／188 数据库／73 媒体。音频与私有部署包继续由三个独立 agent 并行推进。无模型配置时明确不可用，测试适配器不算真实生成；商业计费后置 |
| C01–C03、U01 完整 MVP | 待实施 | 整集、跨集复用、内部后期交接、恢复容量及用户试点 |

[编辑器提交后恢复](34-editor-completion-recovery.md)已接通命令回执、清理重试及提案单项草稿转移，存储事务中断、刷新、编辑器卸载和失效目标均通过生产构建浏览器验证，经 [PR #12](https://github.com/exo-gravity/scenedesk/pull/12) 合入（e0f405d），两组远端 CI 通过。

## 实施规则

每个切片同时交付数据库约束、业务接口、可操作页面、失败恢复和对应验证；不按接口数量宣布完成。使用独立功能分支与 PR，经必要检查和远端 CI 后合入 main。模型采购、真实部署和客户试点依赖真实条件，保持明确状态。

历史评审、校验报告及原型作为当时证据保留。当前状态以本记录及实际代码／CI 为准；详细依赖见[工作包](16-implementation-backlog.md)，行为见[技术定案](21-technical-baseline-closure.md)。
